/* Read-only Windows console-session probe for MeshAgent. No input or desktop switching. */
'use strict';

function classifyFacts(facts) {
    var f = facts || {};
    var state = 'unknown';
    if (f.error) return state;
    if (!Number.isInteger(f.sessionId) || f.sessionId <= 0 || f.sessionId === 0xFFFFFFFF ||
        f.sessionId !== f.processSessionId || f.consistent !== true || typeof f.username !== 'string' ||
        (f.connectionState !== 0 && f.connectionState !== 1) || typeof f.desktop !== 'string') return state;
    var desktop = f.desktop.toLowerCase();
    if (desktop === 'winlogon' && f.username === '') return 'signin';
    if (f.username !== '' && f.locked === true && desktop === 'winlogon') return 'locked';
    if (f.username !== '' && f.locked === false && desktop === 'default') return 'unlocked';
    if (f.username !== '' && f.locked === false && desktop === 'winlogon') return 'secure';
    return state;
}

// Runs in a short-lived SYSTEM child in the physical console session. Session 0
// cannot query the console input desktop. Spawn type WINLOGON only attaches the
// child to that window station; it does not make that desktop active.
function nativeSnapshot(expectedSession) {
    var GM = require('_GenericMarshal');
    var kernel = GM.CreateNativeProxy('kernel32.dll');
    var user = GM.CreateNativeProxy('user32.dll');
    var wts = GM.CreateNativeProxy('wtsapi32.dll');
    var ntdll = GM.CreateNativeProxy('ntdll.dll');
    kernel.CreateMethod('WTSGetActiveConsoleSessionId');
    kernel.CreateMethod('ProcessIdToSessionId');
    user.CreateMethod('OpenInputDesktop');
    user.CreateMethod('GetUserObjectInformationW');
    user.CreateMethod('CloseDesktop');
    wts.CreateMethod('WTSQuerySessionInformationW');
    wts.CreateMethod('WTSFreeMemory');
    ntdll.CreateMethod('RtlGetVersion');
    function attribute(session, infoClass) {
        var pointer = GM.CreatePointer(), length = GM.CreateVariable(4);
        if (wts.WTSQuerySessionInformationW(0, session, infoClass, pointer, length).Val === 0) throw new Error('wts-unavailable');
        try {
            var size = length.toBuffer().readUInt32LE(0);
            if (size > 65536) throw new Error('wts-invalid');
            var copy = Buffer.alloc(size);
            pointer.Deref().Deref(0, size).toBuffer().copy(copy);
            return copy;
        } finally { wts.WTSFreeMemory(pointer.Deref()); }
    }
    function text(buffer) {
        var value = '';
        for (var i = 0; i + 1 < buffer.length; i += 2) {
            var code = buffer.readUInt16LE(i);
            if (code === 0) break;
            value += String.fromCharCode(code);
        }
        return value;
    }
    function desktopName() {
        var desktop = user.OpenInputDesktop(0, 0, 1); // DESKTOP_READOBJECTS only
        if (desktop.Val === 0) throw new Error('desktop-unavailable');
        try {
            var name = GM.CreateVariable(512), needed = GM.CreateVariable(4);
            if (user.GetUserObjectInformationW(desktop, 2, name, 512, needed).Val === 0) throw new Error('desktop-unavailable');
            return name.Wide2UTF8;
        } finally { user.CloseDesktop(desktop); }
    }
    var consoleId = kernel.WTSGetActiveConsoleSessionId().Val >>> 0;
    var processId = GM.CreateVariable(4);
    if (consoleId !== expectedSession || consoleId === 0 || consoleId === 0xFFFFFFFF ||
        kernel.ProcessIdToSessionId(process.pid, processId).Val === 0 ||
        processId.toBuffer().readUInt32LE(0) !== consoleId) throw new Error('console-changed');
    var major = null, minor = null;
    try {
        var version = GM.CreateVariable(284);
        version.toBuffer().writeUInt32LE(284, 0);
        if (ntdll.RtlGetVersion(version).Val === 0) {
            major = version.toBuffer().readUInt32LE(4); minor = version.toBuffer().readUInt32LE(8);
        }
    } catch (ignore) { }
    function sessionState() {
        var username = text(attribute(consoleId, 5)); // WTSUserName, exact console session
        var connectionState = attribute(consoleId, 8).readUInt32LE(0); // WTSConnectState
        var locked = null;
        try {
            var extended = attribute(consoleId, 25); // WTSINFOEXW, Level 1
            // Windows SDK layout: Level DWORD + 4-byte padding, then Level1's
            // SessionId, SessionState, SessionFlags. Validate before using flags.
            if (extended.length >= 20 && extended.readUInt32LE(0) === 1 &&
                extended.readUInt32LE(8) === consoleId && extended.readUInt32LE(12) === connectionState) {
                var flags = extended.readUInt32LE(16);
                if ((flags === 0 || flags === 1) && typeof major === 'number' &&
                    (major > 6 || (major === 6 && minor >= 1))) {
                    // Windows 7 / Server 2008 R2 inverted these documented flags.
                    locked = major === 6 && minor === 1 ? flags === 1 : flags === 0;
                }
            }
        } catch (ignore) { }
        return { username: username, connectionState: connectionState, locked: locked };
    }
    var before = sessionState();
    var desktop = desktopName();
    var after = sessionState();
    var desktopAfter = desktopName();
    var consistent = JSON.stringify(before) === JSON.stringify(after) && desktop === desktopAfter &&
        (kernel.WTSGetActiveConsoleSessionId().Val >>> 0) === consoleId;
    return { sessionId: consoleId, processSessionId: processId.toBuffer().readUInt32LE(0),
        username: before.username, connectionState: before.connectionState, locked: before.locked,
        desktop: desktop, consistent: consistent };
}

// Duktape's Function.toString() returns "[ecmascript code]", not source.
// Use the original bundled module source from getJSModule(), like win-deskutils.
function buildProbeScript(session, source) {
    if (typeof session !== 'number' || session <= 0 || session >= 0xFFFFFFFF || Math.floor(session) !== session || typeof source !== 'string') throw new Error('invalid-probe-script');
    return 'try { addModule("massenter", ' + JSON.stringify(source) + '); ' +
        'console.log(JSON.stringify(require("massenter").nativeSnapshot(' + session + '))); }' +
        'catch(e) { var code = String(e.message || e); var known = ["wts-unavailable", "wts-invalid", "desktop-unavailable", "console-changed"]; ' +
        'console.log(JSON.stringify({error:known.indexOf(code) >= 0 ? code : "native-unavailable"})); } process.exit(0);';
}

var busy = false;
function probe(callback) {
    if (process.platform !== 'win32') { callback({ error: 'not-windows' }); return; }
    if (busy) { callback({ error: 'busy' }); return; }
    var child = null, done = false, output = '', timer = null;
    function finish(facts) {
        if (done) return;
        done = true; busy = false;
        try { if (timer) clearTimeout(timer); } catch (ignore) { }
        timer = null;
        try { if (child) child.kill(); } catch (ignore) { }
        callback(facts);
    }
    try {
        var session = require('user-sessions').consoleUid();
        if (session <= 0 || session === 0xFFFFFFFF) { finish({ error: 'no-console' }); return; }
        busy = true;
        var script = buildProbeScript(session, getJSModule('massenter'));
        var encoded = Buffer.from(script).toString('base64');
        if (encoded.length > 24000) throw new Error('probe-script-too-large');
        child = require('child_process').execFile(process.execPath,
            [process.execPath.split('\\').pop(), '-b64exec', encoded], { type: 2 });
        timer = setTimeout(function () { timer = null; finish({ error: 'timeout' }); }, 6000);
        child.stdout.on('data', function (data) {
            output += data.toString();
            if (output.length > 8192) { finish({ error: 'invalid-response' }); return; }
            // Some MeshAgent builds delay the child exit event. The helper has
            // one bounded JSON response; complete as soon as it is available.
            try {
                var facts = JSON.parse(output.trim());
                if (facts.sessionId !== session && !facts.error) facts = { error: 'console-changed' };
                finish(facts);
            } catch (ignore) { }

        });
        child.stderr.on('data', function () { });
        child.on('exit', function () {
            if (done) return;
            try {
                var facts = JSON.parse(output.trim());
                if (facts.sessionId !== session && !facts.error) facts = { error: 'console-changed' };
                finish(facts);
            } catch (ignore) { finish({ error: 'invalid-response' }); }
        });
    } catch (ignore) { finish({ error: 'native-unavailable' }); }
}

module.exports.classifyFacts = classifyFacts;
module.exports.nativeSnapshot = nativeSnapshot;
module.exports.buildProbeScript = buildProbeScript;
module.exports.probe = probe;
module.exports.consoleaction = function (command, rights) {
    if (!command || command.operation !== 'probeSession' || typeof command.probeToken !== 'string' ||
        command.probeToken.length > 100 || typeof rights !== 'number' || (rights & 8) === 0) return;
    probe(function (facts) {
        require('MeshAgent').SendCommand({ action: 'plugin', plugin: 'massenter', operation: 'probeResult',
            probeToken: command.probeToken, facts: facts });
    });
};
