# MeshCentral Mass Enter

Current version: **0.1.2**

MeshCentral plugin for one-time mass keyboard input on Windows sign-in screens.

The plugin **does not enable AutoLogon**, does not change the Windows registry, does not store credentials, and does not execute login commands on endpoints. It opens a short normal MeshCentral KVM session to each selected device and sends:

1. waits until the real KVM screen/input channel is initialized
2. `Enter` key down + key up
3. configurable delay, default `1000 ms`
4. `Enter` key down + key up
5. closes the KVM relay

## What it is for

Typical school-lab scenario: many Windows PCs are powered on and stopped at the sign-in screen. If the selected account has an empty password and manual sign-in is simply `Enter -> Enter`, Mass Enter performs those same keyboard events on all selected compatible devices.

## Requirements

- MeshCentral `>= 1.1.54`
- Plugins enabled in MeshCentral
- Online MeshAgent
- Agent with KVM/Desktop capability
- User must have **Remote Control** rights for the target device
- Classic/default MeshCentral device list UI

The plugin does not bypass Desktop consent policies configured in MeshCentral.

## Install from GitHub

In MeshCentral Plugin Manager add this URL:

```text
https://raw.githubusercontent.com/TeenKode/meshcentral-massenter/main/config.json
```

MeshCentral reads `config.json`, compares the published plugin version with the installed version, downloads the repository ZIP from GitHub and installs/updates the plugin as `massenter`.

## Usage

1. Open **My Devices**.
2. Select the required PCs using the checkboxes.
3. Click **Вход (Enter×2)** next to **Group Action**.
4. Change the delay or concurrency if necessary.
5. Confirm.

MeshCentral itself closes the confirmation dialog before invoking the plugin callback. Mass Enter does not close that modal a second time. Progress is displayed in a non-blocking floating panel so the rest of the MeshCentral interface remains usable. The panel reports `OK`, `SKIP`, or `ERR` for every processed device.

An `OK` result is only produced after a real Remote Desktop screen-size event has initialized the KVM channel and both Enter sequences have been written to that channel. If the relay opens but the desktop stream does not initialize, the device is reported as an error instead of a false success.

## Testing

The repository includes an integration workflow that runs against the official MeshCentral 1.2.6 container, creates a real device group, connects a real KVM-capable MeshAgent, opens the real MeshCentral web UI in Chromium, and compares Mass Enter behavior with MeshCentral's native Desktop implementation.

## Versioning

The project uses semantic versioning. Every functional change or bug fix increments the version in `config.json` and is documented in `CHANGELOG.md`. MeshCentral can then detect an update when the repository version is higher than the installed version.

## Important limitation

The plugin does not analyze the remote screen. If a selected PC is already at the desktop or another dialog, the two Enter key presses will be sent to whatever currently has focus. Select only computers known to be at the expected Windows sign-in screen.

## Repository

https://github.com/TeenKode/meshcentral-massenter

## License

MIT.
