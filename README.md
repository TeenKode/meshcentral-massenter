# MeshCentral Mass Enter

MeshCentral plugin for one-time mass keyboard input on Windows sign-in screens.

The plugin **does not enable AutoLogon**, does not change the Windows registry, does not store credentials, and does not execute login commands on endpoints. It opens a short normal MeshCentral KVM session to each selected device and sends:

1. `Enter` key down + key up
2. configurable delay, default `900 ms`
3. `Enter` key down + key up
4. closes the KVM relay

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

MeshCentral reads `config.json`, downloads the repository ZIP from GitHub and installs the plugin as `massenter`.

## Usage

1. Open **My Devices**.
2. Select the required PCs using the checkboxes.
3. Click **Вход (Enter×2)** next to **Group Action**.
4. Change the delay or concurrency if necessary.
5. Confirm.

The progress window reports `OK`, `SKIP`, or `ERR` for every processed device.

## Important limitation

The plugin does not analyze the remote screen. If a selected PC is already at the desktop or another dialog, the two Enter key presses will be sent to whatever currently has focus. Select only computers known to be at the expected Windows sign-in screen.

## Repository

https://github.com/TeenKode/meshcentral-massenter

## License

MIT.
