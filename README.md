# MeshCentral Mass Enter

Current version: **0.3.0**

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

Confirmation opens in a separate non-modal panel with explicit Send and Cancel buttons. It does not change MeshCentral's shared dialog state, so the rest of the interface stays usable before, during, and after a batch. Progress appears in a floating panel and reports `OK`, `SKIP`, `CANCEL`, or `ERR` for every processed device.

An `OK` result is only produced after a real Remote Desktop screen-size event has initialized the KVM channel and both Enter sequences have been written to that channel. If the relay opens but the desktop stream does not initialize, the device is reported as an error instead of a false success.

## Cancel and retry

The progress panel includes **Остановить выполнение**. It removes pending devices
from the queue, closes active KVM relays, and clears scheduled key presses. Keys
already sent cannot be undone. Closing the panel with × only hides progress.
Cancelled devices have a separate `CANCEL` result and are not treated as errors.

After completion, **Повторить ошибки** starts a new batch containing only the
failed devices, using the previous delay and concurrency. Successful, skipped,
and cancelled devices are not retried. All failures are retained for retry even
when only the latest 60 results are displayed. Results are kept in the current
browser tab; refresh clears the batch history.

## Server preferences

Delay and concurrency are stored in the MeshCentral database separately for each
authenticated user (including the MeshCentral domain). They load whenever the
confirmation panel opens and save automatically on start. **Сохранить на сервере**
lets you save without sending keys. Preferences survive browser changes, server
restarts, and plugin upgrades. Saving/loading failures are displayed explicitly.
The batch itself runs in the browser and does not continue after the tab closes.

## Windows sign-in check

Click **Проверить экран входа** in confirmation to query each selected Windows
computer through MeshAgent. The probe reads the physical console session using
WTS APIs and the active input desktop using `OpenInputDesktop`. It uses a short,
hidden SYSTEM helper in that console session because a service in session 0
cannot read the interactive input desktop directly. It sends no keys, does not
switch or unlock desktops, stores no screenshots, and installs no service/task.

Results include the time of the check:

- **Экран входа / приветствие**: a stable console session has no logged-in username and its input desktop is Winlogon.
- **Сеанс заблокирован**: the console user is present, WTS reports locked, and the input desktop is Winlogon.
- **Пользователь вошёл, сеанс разблокирован**: the console user is present, WTS reports unlocked, and the input desktop is Default.
- **Защищённый экран (UAC / переход)**: a logged-in, unlocked console session is on Winlogon. This is not treated as a sign-in screen.
- **Неизвестно**: permissions/API data are unavailable, the console changes during the check, results contradict each other, or a request times out.

This reports Windows session/desktop state at that instant, not the exact visible
picture or readiness of a particular credential field. Results can change before
keys are sent. RDP sessions do not substitute for the physical console. Initial
user-list hints remain preliminary until the explicit check finishes. Checking
does not automatically filter the selection or confirm login after sending Enter.

The server verifies Remote Control permission for each device and binds responses
to that authenticated agent connection. Up to four probes run at once per user.
A disconnected/older agent returns Unknown; no success is guessed.

**After upgrading to 0.3.0, use Refresh Agent Cores in the plugin manager** to
deliver `modules_meshcore/massenter.js` to agents. If necessary restart MeshCentral
before refreshing cores, then reload the browser. Windows MeshAgent must run as
a service with the privileges required to inspect the console. No additional
endpoint software is needed.

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
