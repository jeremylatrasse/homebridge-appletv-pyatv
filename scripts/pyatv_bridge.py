#!/usr/bin/env python3
"""
pyatv_bridge.py

Persistent asyncio bridge between Apple TV (via pyatv) and Homebridge.
Streams newline-delimited JSON events to stdout:
  - {"event": "connected", "name": "..."}
  - {"event": "power", "power": true|false, "raw": "On"|"Off"}
  - {"event": "volume", "old": 40.0, "new": 45.0, "delta": 5.0}
  - {"event": "volume_step", "direction": "up"|"down"}
  - {"event": "playback", "playing": true|false, "state": "Playing"|"Paused"|"Idle"}
  - {"event": "error", "message": "..."}

Accepts newline-delimited JSON commands on stdin:
  - {"command": "power_on"}
  - {"command": "power_off"}
  - {"command": "volume_up"}
  - {"command": "volume_down"}
"""

import argparse
import asyncio
import json
import sys

try:
    import pyatv
    from pyatv.const import Protocol, PowerState, DeviceState
    from pyatv.interface import PowerListener, AudioListener, PushListener
except ImportError:
    print(json.dumps({
        "event": "error",
        "message": "pyatv is not installed. Run: pip3 install pyatv"
    }), flush=True)
    sys.exit(1)


def emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


class BridgePowerListener(PowerListener):
    def powerstate_update(self, old_state: PowerState, new_state: PowerState) -> None:
        is_on = (new_state == PowerState.On)
        emit({
            "event": "power",
            "power": is_on,
            "raw": str(new_state),
        })


class BridgeAudioListener(AudioListener):
    def __init__(self) -> None:
        self.last_volume = None

    def volume_update(self, old_volume: float, new_volume: float) -> None:
        delta = 0.0
        if old_volume is not None and new_volume is not None:
            delta = round(float(new_volume) - float(old_volume), 2)
        emit({
            "event": "volume",
            "old": old_volume,
            "new": new_volume,
            "delta": delta,
        })
        if delta > 0:
            emit({"event": "volume_step", "direction": "up", "delta": delta})
        elif delta < 0:
            emit({"event": "volume_step", "direction": "down", "delta": delta})

    def outputdevices_update(self, old_devices, new_devices) -> None:
        emit({
            "event": "output_devices",
            "count": len(new_devices) if new_devices else 0,
        })


class BridgePushListener(PushListener):
    def playstatus_update(self, updater, playstatus) -> None:
        state_str = str(playstatus.device_state)
        is_playing = (playstatus.device_state == DeviceState.Playing)
        emit({
            "event": "playback",
            "playing": is_playing,
            "state": state_str,
            "title": getattr(playstatus, "title", None),
            "app": getattr(playstatus, "app", None),
        })

    def playstatus_error(self, updater, exception: Exception) -> None:
        emit({
            "event": "error",
            "message": f"Playstatus error: {exception}",
        })


async def stdin_Loop(atv, loop: asyncio.AbstractEventLoop) -> None:
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        line = await reader.readline()
        if not line:
            break
        try:
            cmd = json.loads(line.decode("utf-8").strip())
            action = cmd.get("command")
            if action == "power_on":
                await atv.power.turn_on()
            elif action == "power_off":
                await atv.power.turn_off()
            elif action == "volume_up":
                await atv.audio.volume_up()
            elif action == "volume_down":
                await atv.audio.volume_down()
            elif action == "play_pause":
                await atv.remote_control.play_pause()
        except Exception as exc:
            emit({"event": "error", "message": f"Command error: {exc}"})


async def run_bridge(args) -> None:
    loop = asyncio.get_event_loop()
    emit({"event": "status", "message": f"Scanning for Apple TV at {args.host}..."})

    atvs = await pyatv.scan(loop, hosts=[args.host], timeout=5)
    if not atvs:
        emit({"event": "error", "message": f"No Apple TV found at {args.host}"})
        return

    conf = atvs[0]

    if args.companion_credentials:
        conf.set_credentials(Protocol.Companion, args.companion_credentials)
    if args.airplay_credentials:
        conf.set_credentials(Protocol.AirPlay, args.airplay_credentials)
    if args.mrp_credentials:
        conf.set_credentials(Protocol.MRP, args.mrp_credentials)

    atv = await pyatv.connect(conf, loop)

    # Hold strong references so pyatv weakrefs are never garbage-collected
    power_listener = BridgePowerListener()
    audio_listener = BridgeAudioListener()
    push_listener = BridgePushListener()

    try:
        atv.power.listener = power_listener
        atv.audio.listener = audio_listener
        atv.push_updater.listener = push_listener
        atv.push_updater.start()

        initial_power = (atv.power.power_state == PowerState.On)
        emit({
            "event": "connected",
            "name": conf.name,
            "host": args.host,
            "power": initial_power,
            "volume": atv.audio.volume,
        })
        emit({
            "event": "power",
            "power": initial_power,
            "raw": str(atv.power.power_state),
        })

        await stdin_Loop(atv, loop)
    finally:
        atv.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="pyatv Homebridge bridge")
    parser.add_argument("--host", required=True, help="Apple TV IP address")
    parser.add_argument("--companion-credentials", default="", help="Companion protocol credentials")
    parser.add_argument("--airplay-credentials", default="", help="AirPlay protocol credentials")
    parser.add_argument("--mrp-credentials", default="", help="MRP protocol credentials")
    args = parser.parse_args()

    try:
        asyncio.run(run_bridge(args))
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        emit({"event": "error", "message": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
