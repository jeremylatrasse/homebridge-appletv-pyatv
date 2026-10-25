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
except ImportError as exc:
    print(json.dumps({
        "event": "error",
        "message": f"pyatv is not installed in {sys.executable} ({exc}). Run: {sys.executable} -m pip install pyatv"
    }), flush=True)
    sys.exit(1)


def emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


class BridgeListener(PowerListener, AudioListener, PushListener):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.current_volume = None
        self.last_playing = None
        self.last_power = None

    def powerstate_update(self, old_state: PowerState, new_state: PowerState) -> None:
        is_on = (new_state == PowerState.On)
        if self.last_power != is_on:
            self.last_power = is_on
            emit({
                "event": "power",
                "power": is_on,
                "raw": new_state.name,
            })

    def volume_update(self, old_level: float, new_level: float) -> None:
        prev = self.current_volume if self.current_volume is not None else old_level
        self.current_volume = new_level
        delta = 0.0
        if prev is not None and new_level is not None:
            delta = round(new_level - prev, 2)
        emit({
            "event": "volume",
            "old": prev,
            "new": new_level,
            "delta": delta,
        })
        if delta > 0.01:
            emit({"event": "volume_step", "direction": "up", "delta": delta})
        elif delta < -0.01:
            emit({"event": "volume_step", "direction": "down", "delta": delta})

    def outputdevices_update(self, old_devices, new_devices) -> None:
        pass

    def playstatus_update(self, updater, playstatus) -> None:
        state_name = playstatus.device_state.name if playstatus.device_state else "Idle"
        is_playing = (playstatus.device_state == DeviceState.Playing)
        if self.last_playing != is_playing:
            self.last_playing = is_playing
            emit({
                "event": "playback",
                "playing": is_playing,
                "state": state_name,
                "title": getattr(playstatus, "title", None),
                "app": None,
            })

    def playstatus_error(self, updater, exception: Exception) -> None:
        emit({"event": "error", "message": f"Playstatus error: {exception}"})


async def handle_stdin(atv, loop: asyncio.AbstractEventLoop):
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        line = await reader.readline()
        if not line:
            break
        try:
            cmd = json.loads(line.decode("utf-8").strip())
        except Exception:
            continue

        action = cmd.get("command")
        try:
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
            emit({"event": "error", "message": f"Command '{action}' failed: {exc}"})


async def main():
    parser = argparse.ArgumentParser(description="Homebridge pyatv bridge")
    parser.add_argument("--host", required=True, help="Apple TV IP address")
    parser.add_argument("--companion-credentials", default="", help="Companion protocol credentials")
    parser.add_argument("--airplay-credentials", default="", help="AirPlay protocol credentials")
    parser.add_argument("--mrp-credentials", default="", help="MRP protocol credentials")
    args = parser.parse_args()

    loop = asyncio.get_running_loop()

    atvs = await pyatv.scan(loop, hosts=[args.host], timeout=5)
    if not atvs:
        emit({"event": "error", "message": f"No Apple TV found at {args.host}"})
        await asyncio.sleep(5)
        return

    conf = atvs[0]
    if args.companion_credentials:
        conf.set_credentials(Protocol.Companion, args.companion_credentials)
    if args.airplay_credentials:
        conf.set_credentials(Protocol.AirPlay, args.airplay_credentials)
    if args.mrp_credentials:
        conf.set_credentials(Protocol.MRP, args.mrp_credentials)

    atv = await pyatv.connect(conf, loop)
    listener = BridgeListener(loop)

    atv.power.listener = listener
    atv.audio.listener = listener
    atv.push_updater.listener = listener
    atv.push_updater.start()

    emit({
        "event": "connected",
        "name": conf.name,
        "address": str(conf.address),
    })

    # Emit initial power state immediately
    try:
        power_state = atv.power.power_state
        is_on = (power_state == PowerState.On)
        listener.last_power = is_on
        emit({
            "event": "power",
            "power": is_on,
            "raw": power_state.name,
        })
    except Exception as exc:
        emit({"event": "error", "message": f"Initial power check failed: {exc}"})

    # Emit initial volume if available
    try:
        vol = atv.audio.volume
        listener.current_volume = vol
        emit({"event": "volume", "old": vol, "new": vol, "delta": 0.0})
    except Exception:
        pass

    stdin_task = asyncio.create_task(handle_stdin(atv, loop))

    try:
        while True:
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        pass
    finally:
        stdin_task.cancel()
        atv.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        emit({"event": "error", "message": f"Fatal bridge error: {exc}"})
        sys.exit(1)
