# Changelog

## 0.3.0

- Adds an explicit read-only Windows sign-in check through a bundled MeshAgent module.
- Reads the physical console session username, connection/lock flags, and input desktop with Win32 APIs from a short-lived hidden console-session helper.
- Distinguishes sign-in/welcome, locked, unlocked, and secure desktop/UAC states. Ambiguous, changing, unsupported, or inaccessible states return Unknown.
- Verifies device/domain permissions on the server and binds replies to the authenticated agent connection using a random one-use token. Bounds probe concurrency and timeouts.
- Shows per-device results with timestamps. Does not send keys, switch desktops, or automatically change the selected devices during a check.
- Requires Refresh Agent Cores after upgrade to distribute the new agent module.

## 0.2.0

- Adds Stop to cancel queued and active work, clear pending key timers, and close KVM relays. Already sent input cannot be undone.
- Adds retry of failed devices only, retaining the complete failure list beyond the 60 displayed results.
- Saves delay and concurrency in the MeshCentral database per authenticated user/domain; restores them across browsers, restarts, and plugin upgrades. Adds an explicit Save button and automatic save on start, with errors shown in the UI.
- Shows per-device Windows session hints from agent users/locked users data, without claiming to detect the sign-in screen or automatically filtering devices.
- Clarifies that successful Enter transmission does not confirm Windows login.
- Adds tests for cancellation before/between key presses, transport errors, retry selection, preference isolation and failures, and persistence across fresh browser contexts.

## 0.1.3

- Moves confirmation and empty-selection messages into a separate non-modal plugin panel. Clicking Mass Enter no longer changes MeshCentral's global modal state or blocks its toolbar.
- Adds explicit Send and Cancel buttons and clears pending selections on close.
- Fixes integration assertions to accept MeshCentral's actual closed-dialog state (`undefined` as well as `0`).

## 0.1.2

- Removes the redundant second `setDialogMode()` call from the dialog callback. MeshCentral closes its modal before invoking the callback, so closing it again can corrupt dialog/UI state on some versions.
- Removes the blind timed KVM fallback that could report success before the remote desktop stream was initialized.
- Requires a real KVM screen-size event before either Enter key is sent.
- Reports an error instead of false success when the KVM relay connects but the screen/input channel never initializes.
- Verifies both relay state and Remote Desktop module state before sending keyboard packets.
- Aligns Remote Desktop setup more closely with MeshCentral's native Desktop implementation.
- Adds an end-to-end GitHub Actions integration harness using real MeshCentral 1.2.6, a real MeshAgent, Chromium, and an X11 keyboard event sink.
- Adds a native MeshCentral Desktop control test so the harness can distinguish plugin bugs from limitations of the Linux/Xvfb test desktop.

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
