'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const factory = require('../massenter.js').massenter;

function client() {
    const elements = { MassEnterButton: { disabled: false } };
    const timers = new Map();
    let time = 0, next = 0;
    const context = vm.createContext({
        module: { exports: {} }, console,
        document: { getElementById: id => elements[id] || null,
            createElement: () => ({ style: {} }),
            body: { appendChild(c) { c.parentNode = this; }, removeChild(c) { c.parentNode = null; } } },
        window: { location: { pathname: '/' } }, meshserver: {},
        isWindowsNode: () => true,
        setTimeout(fn, ms) { const id = ++next; timers.set(id, { at: time + ms, fn }); return id; },
        clearTimeout(id) { timers.delete(id); }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../massenter.js'), 'utf8'), context);
    const me = context.module.exports.massenter({ parent: {} });
    context.pluginHandler = { massenter: me };
    me.getNode = id => ({ name: id, conn: 1 });
    me.getEligibility = () => ({ ok: true });
    me.ensureProgressPanel = () => {};
    return { me, context, elements, timers,
        advance(ms) {
            const until = time + ms;
            while (true) {
                const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                time = due[1].at; timers.delete(due[0]); due[1].fn();
            }
            time = until;
        }
    };
}

test('settings persist across plugin instances and are isolated by authenticated user/domain', () => {
    const docs = new Map();
    const db = { Get: (id, cb) => cb(null, docs.has(id) ? [docs.get(id)] : []),
        Set: (doc, cb) => { docs.set(doc._id, structuredClone(doc)); cb(null); } };
    function request(plugin, userid, operation, settings) {
        let response;
        plugin.serveraction({ requestId: 'r1', operation, settings, userid: 'user//victim' },
            { user: { _id: userid }, domain: { id: userid.split('/')[1] }, send: r => { response = r; } });
        return response;
    }
    const first = factory({ parent: { db } });
    assert.deepEqual(request(first, 'user/one/alice', 'getSettings').settings, { delay: 1000, concurrency: 6 });
    assert.equal(request(first, 'user/one/alice', 'saveSettings', { delay: 1500, concurrency: 3 }).error, null);
    const reloaded = factory({ parent: { db } });
    assert.deepEqual(request(reloaded, 'user/one/alice', 'getSettings').settings, { delay: 1500, concurrency: 3 });
    for (const user of ['user/one/bob', 'user/two/alice', 'user//victim']) {
        assert.deepEqual(request(reloaded, user, 'getSettings').settings, { delay: 1000, concurrency: 6 });
    }
    assert.deepEqual(request(reloaded, 'user/one/alice', 'saveSettings', { delay: -4, concurrency: 999 }).settings, { delay: 300, concurrency: 20 });
    assert.deepEqual(request(reloaded, 'user/one/alice', 'saveSettings', { delay: {}, concurrency: 'bad' }).settings, { delay: 1000, concurrency: 6 });
    let wrote = false;
    first.serveraction({ requestId: 'x', operation: 'saveSettings' }, { send() { wrote = true; } });
    assert.equal(wrote, false);
});

test('database failure is reported rather than claiming preferences were saved', () => {
    const me = factory({ parent: { db: { Set(doc, cb) { cb(new Error('disk full')); } } } });
    let response;
    me.serveraction({ requestId: 'x', operation: 'saveSettings' }, {
        user: { _id: 'user//a' }, domain: { id: '' }, send(r) { response = r; }
    });
    assert.match(response.error, /Не удалось сохранить/);
});

test('cancel stops active work and queued work exactly once; another batch can start', () => {
    const { me, elements } = client();
    const started = [], callbacks = [];
    me.runOne = (id, delay, cb) => { started.push(id); callbacks.push(cb); return () => cb({ code: 'CANCELLED', message: 'cancelled' }); };
    me.startBatch(['a', 'b', 'c', 'd', 'e'], 700, 2);
    assert.deepEqual(started, ['a', 'b']);
    me.cancelBatch(); me.cancelBatch();
    callbacks.forEach(cb => cb(null));
    assert.equal(me.batch.done, 5);
    assert.equal(me.batch.cancelledCount, 5);
    assert.equal(me.batch.failed, 0);
    assert.equal(me.batch.active, 0);
    assert.equal(me.batch.running, false);
    assert.equal(elements.MassEnterButton.disabled, false);
    me.startBatch(['new'], 700, 1);
    assert.deepEqual(started, ['a', 'b', 'new']);
    me.cancelBatch();
});

test('retry keeps all failures, including those outside the last 60 displayed rows', () => {
    const { me } = client();
    const failed = Array.from({ length: 70 }, (_, i) => `fail-${i}`);
    me.getEligibility = id => ({ ok: id !== 'offline', reason: 'offline' });
    me.runOne = (id, delay, cb) => cb(id.startsWith('fail-') ? new Error('timeout') : null);
    me.startBatch(['ok', 'offline', ...failed, 'ok'], 800, 4);
    assert.equal(me.batch.ok, 1);
    assert.equal(me.batch.skipped, 1);
    assert.equal(me.batch.failed, 70);
    const retried = [];
    me.runOne = (id, delay, cb) => { retried.push(id); cb(null); };
    me.retryErrors();
    assert.deepEqual(retried, failed);
    assert.equal(me.batch.ok, 70);
    assert.equal(me.batch.delay, 800);
    me.retryErrors();
    assert.equal(retried.length, 70);
});

function kvmHarness() {
    const h = client();
    const packets = [], callbacks = [];
    let redir, stopped = 0;
    h.context.CreateAgentRemoteDesktop = () => ({ State: 0, KeyAction: { DOWN: 1, UP: 2 },
        SendKeyMsgKC(action, key) { packets.push([action, key]); } });
    h.context.CreateAgentRedirect = (server, m) => (redir = { m, State: 0,
        Start() { this.State = m.State = 3; this.onStateChanged(this, 3); },
        Stop() { stopped++; this.State = m.State = 0; this.onStateChanged(this, 0); } });
    const cancel = h.me.runOne('node', 1000, e => callbacks.push(e));
    return { ...h, packets, callbacks, cancel, redir, stopped: () => stopped,
        screen() { redir.m.onScreenSizeChange(redir.m, 1024, 768); } };
}

for (const at of [0, 500]) {
    test(`KVM cancel at ${at} ms clears all timers and sends no further keys`, () => {
        const h = kvmHarness();
        h.screen(); h.advance(at);
        assert.equal(h.packets.length, at === 0 ? 0 : 2);
        h.cancel(); h.cancel();
        const sent = h.packets.length;
        h.advance(20000);
        assert.equal(h.packets.length, sent);
        assert.equal(h.callbacks.length, 1);
        assert.equal(h.callbacks[0].code, 'CANCELLED');
        assert.equal(h.stopped(), 1);
        assert.equal(h.timers.size, 0);
    });
}

test('connected relay without initialized screen times out without sending keys', () => {
    const h = kvmHarness();
    h.advance(20000);
    assert.equal(h.packets.length, 0);
    assert.equal(h.callbacks.length, 1);
    assert.match(h.callbacks[0].message, /экран не инициализирован/);
    assert.equal(h.timers.size, 0);
});

test('keyboard send exceptions finish with an error and release the relay', () => {
    const h = kvmHarness();
    h.redir.m.SendKeyMsgKC = () => { throw new Error('closed socket'); };
    h.screen(); h.advance(1000);
    assert.equal(h.callbacks.length, 1);
    assert.match(h.callbacks[0].message, /closed socket/);
    assert.equal(h.stopped(), 1);
    assert.equal(h.timers.size, 0);
});

test('missing settings response times out once and drops a late reply', () => {
    const { me, context, advance } = client();
    let request, calls = 0;
    context.meshserver.send = r => { request = r; };
    me.requestSettings('getSettings', null, error => { calls++; assert.match(error, /не ответил/); });
    advance(8000);
    me.onSettings(null, { requestId: request.requestId, settings: { delay: 900, concurrency: 2 } });
    assert.equal(calls, 1);
});

test('session hints distinguish offline, missing, no active user and reported lock', () => {
    const { me } = client();
    assert.match(me.getSessionHint({ conn: 0, users: [] }), /неизвестно/);
    assert.match(me.getSessionHint({ conn: 1 }), /не сообщил/);
    assert.match(me.getSessionHint({ conn: 1, users: [] }), /возможен экран входа/);
    assert.match(me.getSessionHint({ conn: 1, users: ['Alice'], lusers: ['Alice'] }), /блокировке/);
    assert.match(me.getSessionHint({ conn: 1, users: ['Alice'], lusers: [] }), /не подтверждён/);
});
