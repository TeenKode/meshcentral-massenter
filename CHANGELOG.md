# Changelog

## 0.1.0

- Initial GitHub-installable release.
- Adds a `Вход (Enter×2)` button next to `Group Action` in the classic MeshCentral device list.
- Works on selected devices only.
- Uses the normal MeshCentral KVM relay (protocol 2).
- Sends Enter key down/up, waits a configurable delay, then sends Enter down/up again.
- Skips offline devices, devices without Remote Control rights, and agents without KVM capability.
- Limits simultaneous KVM connections and shows per-device results.
- Does not configure Windows AutoLogon and does not store credentials.
