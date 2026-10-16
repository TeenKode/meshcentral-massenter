'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const factory = require('../massenter.js').massenter;
const { classifyFacts, nativeSnapshot, buildProbeScript } = require('../modules_meshcore/massenter.js');
const signin = { sessionId: 1, processSessionId: 1, username: '', connectionState: 1, locked: true, desktop: 'Winlogon', consistent: true };
const unlocked = { ...signin, username: 'Alice', connectionState: 0, locked: false, desktop: 'Default' };

test('classifies only coherent console snapshots; secure UAC is never called sign-in', () => {
    assert.equal(classifyFacts(signin), 'signin');
    assert.equal(classifyFacts(unlocked), 'unlocked');
    assert.equal(classifyFacts({ ...unlocked, desktop: 'Winlogon' }), 'secure');
    assert.equal(classifyFacts({ ...unlocked, locked: true, desktop: 'Winlogon' }), 'locked');
    for (const patch of [{ consistent: false }, { processSessionId: 0 }, { sessionId: 0xFFFFFFFF }, { username: null },
        { connectionState: 4 }, { locked: null }, { desktop: 'Screen-saver' }, { error: 'timeout' }]) {
        assert.equal(classifyFacts({ ...unlocked, ...patch }), 'unknown', JSON.stringify(patch));
    }
    assert.equal(classifyFacts({ ...signin, desktop: 'Default' }), 'unknown');
    assert.equal(classifyFacts({ ...signin, locked: null }), 'signin');
});

function nativeHarness(options = {}) {
    let frees = 0, closed = 0, reads = 0, changed = false;
    function variable(size) { const buffer = Buffer.alloc(size); return { toBuffer: () => buffer }; }
    function bufAttribute(info) {
        reads++;
        if (info === 5) return Buffer.from((options.username === undefined ? 'Alice' : options.username) + '\0', 'utf16le');
        if (info === 8) { const b = Buffer.alloc(4); b.writeUInt32LE(0); return b; }
        if (info === 25) {
            const b = Buffer.alloc(224); b.writeUInt32LE(1); b.writeUInt32LE(1, 8);
            b.writeUInt32LE(options.flags === undefined ? 1 : options.flags, 16); return b;
        }
        throw new Error('unexpected attribute');
    }
    const proxies = {
        'kernel32.dll': { WTSGetActiveConsoleSessionId: () => ({ Val: options.changeConsole && changed ? 2 : 1 }),
            ProcessIdToSessionId(pid, ptr) { ptr.toBuffer().writeUInt32LE(options.childSession || 1); return { Val: 1 }; } },
        'wtsapi32.dll': {
            WTSQuerySessionInformationW(server, sid, info, ptr, len) {
                const b = bufAttribute(info); len.toBuffer().writeUInt32LE(b.length);
                ptr.value = { Deref: () => ({ toBuffer: () => b }) }; return { Val: 1 };
            }, WTSFreeMemory() { frees++; }
        },
        'user32.dll': {
            OpenInputDesktop(a, inherit, access) { assert.equal(access, 1); return { Val: options.denyDesktop ? 0 : 99 }; },
            GetUserObjectInformationW(h, info, name) {
                name.Wide2UTF8 = options.desktop || 'Default'; changed = true; return { Val: 1 };
            }, CloseDesktop() { closed++; }
        },
        'ntdll.dll': { RtlGetVersion(ptr) {
            const b = ptr.toBuffer(); b.writeUInt32LE(options.win7 ? 6 : 10, 4); b.writeUInt32LE(options.win7 ? 1 : 0, 8); return { Val: 0 };
        } }
    };
    for (const p of Object.values(proxies)) p.CreateMethod = () => {};
    const gm = { CreateNativeProxy: name => proxies[name], CreateVariable: variable,
        CreatePointer: () => ({ Deref() { return this.value; } }) };
    const context = vm.createContext({ Buffer, process: { pid: 1 }, require(name) { assert.equal(name, '_GenericMarshal'); return gm; } });
    const run = () => vm.runInContext('(' + nativeSnapshot.toString() + ')(1)', context);
    return { run, frees: () => frees, closed: () => closed, reads: () => reads };
}

test('native snapshot releases handles and WTS buffers, reads lock flags and Unicode users', () => {
    const h = nativeHarness({ username: 'Ученик', flags: 0, desktop: 'Winlogon' });
    const result = h.run();
    assert.equal(result.username, 'Ученик');
    assert.equal(result.locked, true);
    assert.equal(result.consistent, true);
    assert.equal(h.frees(), h.reads());
    assert.equal(h.closed(), 2);
    assert.equal(classifyFacts(result), 'locked');
});

test('Windows 7 inverted lock flags are handled explicitly', () => {
    assert.equal(nativeHarness({ win7: true, flags: 1 }).run().locked, true);
    assert.equal(nativeHarness({ win7: true, flags: 0 }).run().locked, false);
    assert.equal(nativeHarness({ flags: 0xFFFFFFFF }).run().locked, null);
});

test('session 0 helper, denied desktop access and console switches never produce success', () => {
    assert.throws(() => nativeHarness({ childSession: 2 }).run(), /console-changed/);
    const denied = nativeHarness({ denyDesktop: true });
    assert.throws(denied.run, /desktop-unavailable/);
    assert.equal(denied.frees(), denied.reads());
    const changed = nativeHarness({ changeConsole: true }).run();
    assert.equal(changed.consistent, false);
    assert.equal(classifyFacts(changed), 'unknown');
});

function serverHarness() {
    const me = factory({ parent: {} });
    const agent = { dbNodeKey: 'node//device', authenticated: 2, send(data) { this.last = JSON.parse(data); } };
    const replies = [];
    const session = { user: { _id: 'user//alice' }, domain: { id: '' }, send(data) { replies.push(data); } };
    const web = { wsagents: { 'node//device': agent },
        GetNodeWithRights(domain, user, id, cb) { cb({ agent: { id: 4 } }, 8, true); } };
    const command = { operation: 'checkSession', nodeid: 'node//device', requestId: 'browser-1' };
    return { me, agent, session, web, command, replies,
        cleanup() { for (const p of Object.values(me.pendingProbes || {})) clearTimeout(p.timer); } };
}

test('server checks domain and Remote Control rights before querying an agent', () => {
    const h = serverHarness();
    h.me.serveraction({ ...h.command, nodeid: 'node/other/device' }, h.session, h.web);
    assert.equal(h.agent.last, undefined);
    h.web.GetNodeWithRights = (d, u, id, cb) => cb({}, 0, true);
    h.me.serveraction(h.command, h.session, h.web);
    assert.equal(h.agent.last, undefined);
    assert.equal(h.replies.length, 2);
    assert.equal(h.replies[1].result.state, 'unknown');
});

test('probe replies are bound to the authenticated agent connection and cannot be forged by web clients', () => {
    const h = serverHarness();
    try {
        h.me.serveraction(h.command, h.session, h.web);
        assert.equal(h.agent.last.operation, 'probeSession');
        const response = { operation: 'probeResult', probeToken: h.agent.last.probeToken, facts: signin };
        h.me.serveraction(response, h.session, h.web);
        h.me.serveraction(response, { ...h.agent }, h.web);
        assert.equal(h.replies.length, 0);
        h.me.serveraction(response, h.agent, h.web);
        assert.equal(h.replies.length, 1);
        assert.equal(h.replies[0].result.state, 'signin');
        h.me.serveraction(response, h.agent, h.web);
        assert.equal(h.replies.length, 1);
    } finally { h.cleanup(); }
});

test('non-Windows and offline agents receive no native probe; per-user requests are bounded', () => {
    const h = serverHarness();
    try {
        h.web.GetNodeWithRights = (d, u, id, cb) => cb({ agent: { id: 6 } }, 8, true);
        h.me.serveraction(h.command, h.session, h.web);
        assert.equal(h.agent.last, undefined);
        h.web.GetNodeWithRights = (d, u, id, cb) => cb({ agent: { id: 4 } }, 8, true);
        h.agent.authenticated = 0;
        h.me.serveraction(h.command, h.session, h.web);
        assert.equal(h.agent.last, undefined);
        h.agent.authenticated = 2;
        for (let i = 0; i < 5; i++) h.me.serveraction({ ...h.command, requestId: String(i) }, h.session, h.web);
        assert.equal(Object.keys(h.me.pendingProbes).length, 4);
        assert.equal(h.replies.length, 3);
    } finally { h.cleanup(); }
});


test('helper embeds original module source rather than Duktape function placeholders', () => {
    const source = fs.readFileSync(require.resolve('../modules_meshcore/massenter.js'), 'utf8');
    const script = buildProbeScript(2, source);
    const modules = {};
    let result, exit;
    vm.runInNewContext(script, {
        addModule(name, text) { modules[name] = text; },
        require(name) { assert.equal(name, 'massenter'); return { nativeSnapshot(id) { assert.equal(id, 2); return unlocked; } }; },
        console: { log(text) { result = JSON.parse(text); } }, process: { exit(code) { exit = code; } }
    });
    assert.equal(modules.massenter, source);
    assert.deepEqual(result, unlocked);
    assert.equal(exit, 0);
    assert.ok(Buffer.from(script).toString('base64').length < 24000);
    assert.throws(() => buildProbeScript('2);malicious()', source), /invalid-probe-script/);
});


function agentHarness() {
    const handlers = {}, output = [], timers = new Map();
    let next = 0, killed = 0;
    const child = { stdout: { on(event, fn) { handlers.stdout = fn; } }, stderr: { on() {} },
        on(event, fn) { handlers[event] = fn; }, waitExit(ms) { assert.equal(ms, 6000); }, kill() { killed++; } };
    const source = fs.readFileSync(require.resolve('../modules_meshcore/massenter.js'), 'utf8');
    const context = vm.createContext({ module: { exports: {} }, Buffer, console,
        process: { platform: 'win32', execPath: 'C:\\MeshAgent.exe' }, getJSModule() { return source; },
        require(name) {
            if (name === 'user-sessions') return { consoleUid: () => 2 };
            if (name === 'child_process') return { execFile() { return child; } };
            throw new Error(name);
        },
        setTimeout(fn) { const id = ++next; timers.set(id, fn); return id; },
        clearTimeout(id) { if (!timers.delete(id)) throw new Error('Invalid Parameter'); }
    });
    vm.runInContext(source, context);
    context.module.exports.probe(facts => output.push(facts));
    return { handlers, output, timers, killed: () => killed,
        expire() { const [id, fn] = [...timers][0]; timers.delete(id); fn(); } };
}

test('MeshAgent watchdog never clears its own expired native timer', () => {
    const h = agentHarness();
    h.expire();
    assert.equal(h.output.length, 1);
    assert.equal(h.output[0].error, 'timeout');
    assert.equal(h.killed(), 1);
    h.handlers.exit();
    assert.equal(h.output.length, 1);
});

test('complete JSON stdout resolves before the child exit event; split output is supported', () => {
    const h = agentHarness();
    const json = JSON.stringify({ ...unlocked, sessionId: 2, processSessionId: 2 });
    h.handlers.stdout(Buffer.from(json.slice(0, 20)));
    assert.equal(h.output.length, 0);
    h.handlers.stdout(Buffer.from(json.slice(20)));
    assert.equal(h.output.length, 1);
    assert.equal(h.output[0].desktop, 'Default');
    assert.equal(h.timers.size, 0);
    assert.equal(h.killed(), 1);
    h.handlers.exit();
    assert.equal(h.output.length, 1);
});
