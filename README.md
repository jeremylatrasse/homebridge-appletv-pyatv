# homebridge-appletv-pyatv

A Homebridge dynamic platform plugin powered by [`pyatv`](https://pyatv.dev) that:

1. **Exposes a 2-way synced `Apple TV Power` switch in HomeKit** (as a standard bridged switch—no secondary HomeKit pairing needed!) so you can group or automate your target devices with the Apple TV's power state.
2. **Catches Siri Remote & iOS Remote `Volume Up` / `Volume Down` / `Power` events** via `pyatv` (`AudioListener` & `PowerListener`) and forwards them directly over TCP to your target device with no lag.
3. **Source-Aware Power Guard:** When the Apple TV goes to sleep, it checks which input/profile the target device is currently on—so if you switched the target device to another source and the Apple TV idle-sleeps 15 minutes later, it **won't** shut off your target device!

---

## Prerequisites on your Homebridge Host

1. Install `pyatv`:
   ```bash
   pip3 install pyatv
   ```
2. Pair `pyatv` with your Apple TV once to get your Companion credentials:
   ```bash
   atvremote -s <APPLE_TV_IP> --protocol companion pair && atvremote -s <APPLE_TV_IP> --protocol airplay pair
   ```
   Copy the printed credentials string into the `companionCredentials` field in the Homebridge UI settings.
3. For Siri Remote Volume Up/Down events to stream over `pyatv`, ensure your Apple TV's **Settings -> Remotes and Devices -> Volume Control** is set to **HDMI** (or Auto).
