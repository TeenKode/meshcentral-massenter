# Changelog

## 0.1.1

- Fixes the MeshCentral UI remaining blocked after starting Mass Enter by closing the modal before the batch begins.
- Replaces the minimal raw KVM module with MeshCentral's normal `CreateAgentRemoteDesktop` module.
- Waits for KVM screen initialization before sending keyboard input, with a timed fallback for slower agents.
- Uses `SendKeyMsgKC()` for Enter key down/up instead of writing raw keyboard packets directly.
- Adds a non-blocking floating progress panel so the rest of the MeshCentral interface remains usable while the batch runs.
- Prevents overlapping Mass Enter batches from the same browser tab.
- Changes defaults to 1000 ms between Enter presses and 6 concurrent KVM sessions for more reliable sign-in behavior.

## 0.1.0

- Initial GitHub-installable release.
- Adds a `Вход (Enter×2)` button next to `Group Action` in the classic MeshCentral device list.
- Works on selected devices only.
- Uses the normal MeshCentral KVM relay (protocol 2).
- Sends Enter key down/up, waits a configurable delay, then sends Enter down/up again.
- Skips offline devices, devices without Remote Control rights, and agents without KVM capability.
- Limits simultaneous KVM connections and shows per-device results.
- Does not configure Windows AutoLogon and does not store credentials.
