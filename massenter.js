/**
 * MeshCentral Mass Enter plugin
 * Sends Enter, waits, then sends Enter again to selected devices through
 * the normal MeshCentral KVM channel.
 *
 * Version: 0.1.1
 */
"use strict";

module.exports.massenter = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;

    // Exported functions are serialized into MeshCentral's browser plugin handler.
    obj.exports = [
        'onWebUIStartupEnd',
        'getSelectedNodeIds',
        'getNode',
        'getEligibility',
        'openDialog',
        'runSelected',
        'startBatch',
        'runOne',
        'sendEnter',
        'ensureProgressPanel',
        'hideProgressPanel',
        'updateProgress'
    ];

    obj.server_startup = function () {
        try { obj.meshServer.debug('plugin:massenter', 'Mass Enter plugin 0.1.1 loaded'); }
        catch (e) { console.log('MeshCentral Mass Enter plugin 0.1.1 loaded'); }
    };

    obj.onWebUIStartupEnd = function () {
        if (document.getElementById('MassEnterButton')) return;

        var button = document.createElement('input');
        button.type = 'button';
        button.id = 'MassEnterButton';
        button.value = 'Вход (Enter×2)';
        button.title = 'Отправить Enter, затем ещё один Enter выбранным компьютерам через MeshCentral KVM';
        button.style.marginRight = '4px';
        button.onclick = function () { pluginHandler.massenter.openDialog(); };

        var groupButton = document.getElementById('GroupActionButton');
        if (groupButton && groupButton.parentNode) {
            if (groupButton.nextSibling) groupButton.parentNode.insertBefore(button, groupButton.nextSibling);
            else groupButton.parentNode.appendChild(button);
            return;
        }

        button.style.position = 'fixed';
        button.style.right = '18px';
        button.style.bottom = '18px';
        button.style.zIndex = '10000';
        button.style.padding = '6px 10px';
        document.body.appendChild(button);
    };

    obj.getSelectedNodeIds = function () {
        try {
            if (typeof getCheckedDevices === 'function') {
                var ids = getCheckedDevices();
                if (Array.isArray(ids)) return ids.slice();
            }
        } catch (e) { }

        var out = [];
        try {
            var boxes = document.querySelectorAll('.DeviceCheckbox:checked');
            for (var i = 0; i < boxes.length; i++) {
                var v = boxes[i].value || '';
                if (v.indexOf('devid_') === 0) v = v.substring(6);
                try { v = decodeURIComponent(v); } catch (e2) { }
                if (v) out.push(v);
            }
        } catch (e3) { }
        return out;
    };

    obj.getNode = function (nodeid) {
        try {
            if (typeof getNodeFromId === 'function') {
                var n = getNodeFromId(nodeid);
                if (n) return n;
            }
        } catch (e) { }

        try {
            if (typeof nodes !== 'undefined' && nodes != null) {
                if (nodes[nodeid]) return nodes[nodeid];
                for (var k in nodes) {
                    if (nodes[k] && nodes[k]._id === nodeid) return nodes[k];
                }
            }
        } catch (e2) { }
        return null;
    };

    obj.getEligibility = function (nodeid) {
        var node = pluginHandler.massenter.getNode(nodeid);
        if (!node) return { ok: false, reason: 'устройство не найдено' };
        if (((node.conn || 0) & 1) === 0) return { ok: false, reason: 'MeshAgent офлайн' };

        try {
            if (typeof GetNodeRights === 'function') {
                var rights = GetNodeRights(node);
                if ((rights & 8) === 0) return { ok: false, reason: 'нет права Remote Control' };
            }
        } catch (e) { }

        if (!node.agent) return { ok: false, reason: 'нет данных MeshAgent' };
        if (node.agent.caps != null && ((node.agent.caps & 1) === 0)) {
            return { ok: false, reason: 'агент без KVM' };
        }
        return { ok: true, node: node };
    };

    obj.openDialog = function () {
        var ids = pluginHandler.massenter.getSelectedNodeIds();
        if (!ids || ids.length === 0) {
            if (typeof setDialogMode === 'function') {
                setDialogMode(2, 'Массовый вход', 1, null, 'Сначала отметьте компьютеры в разделе «My Devices».');
            } else {
                alert('Сначала отметьте компьютеры.');
            }
            return;
        }

        var eligible = 0, skipped = 0;
        for (var i = 0; i < ids.length; i++) {
            var e = pluginHandler.massenter.getEligibility(ids[i]);
            if (e.ok) eligible++; else skipped++;
        }

        pluginHandler.massenter.pendingNodeIds = ids.slice();

        var html = '<div style="max-width:520px;line-height:1.45">';
        html += '<b>Будет отправлено два нажатия Enter через обычный MeshCentral KVM.</b><br><br>';
        html += 'Выбрано устройств: <b>' + ids.length + '</b><br>';
        html += 'Готово к выполнению: <b>' + eligible + '</b>';
        if (skipped > 0) html += '<br>Будет пропущено: <b>' + skipped + '</b> (офлайн / нет прав / нет KVM)';
        html += '<br><br>';
        html += '<label>Пауза между Enter: <input id="massEnterDelay" type="number" min="300" max="5000" step="100" value="1000" style="width:85px"> мс</label><br>';
        html += '<label>Одновременных KVM-подключений: <input id="massEnterConcurrency" type="number" min="1" max="20" value="6" style="width:60px"></label>';
        html += '<br><br><span style="color:#a04000"><b>Важно:</b> запускайте только для компьютеров, находящихся на экране входа Windows.</span>';
        html += '</div>';

        if (typeof setDialogMode === 'function') {
            setDialogMode(2, 'Массовый вход: Enter → Enter', 3, pluginHandler.massenter.runSelected, html);
        } else if (confirm('Отправить Enter два раза на ' + eligible + ' устройств?')) {
            pluginHandler.massenter.startBatch(ids, 1000, 6);
        }
    };

    obj.runSelected = function () {
        var ids = pluginHandler.massenter.pendingNodeIds || pluginHandler.massenter.getSelectedNodeIds();
        var delay = 1000, concurrency = 6;

        try {
            var d = document.getElementById('massEnterDelay');
            var c = document.getElementById('massEnterConcurrency');
            if (d) delay = parseInt(d.value, 10);
            if (c) concurrency = parseInt(c.value, 10);
        } catch (e) { }

        if (!isFinite(delay)) delay = 1000;
        if (!isFinite(concurrency)) concurrency = 6;
        delay = Math.max(300, Math.min(5000, delay));
        concurrency = Math.max(1, Math.min(20, concurrency));

        // IMPORTANT: close MeshCentral's modal before starting. Leaving it open
        // blocks all other controls in the web UI.
        try { if (typeof setDialogMode === 'function') setDialogMode(0); } catch (e2) { }

        pluginHandler.massenter.ensureProgressPanel();
        pluginHandler.massenter.startBatch(ids, delay, concurrency);
    };

    obj.ensureProgressPanel = function () {
        var panel = document.getElementById('massEnterProgressPanel');
        if (panel) {
            panel.style.display = 'block';
            return panel;
        }

        panel = document.createElement('div');
        panel.id = 'massEnterProgressPanel';
        panel.style.position = 'fixed';
        panel.style.right = '18px';
        panel.style.bottom = '18px';
        panel.style.width = '430px';
        panel.style.maxWidth = 'calc(100vw - 36px)';
        panel.style.maxHeight = '55vh';
        panel.style.overflow = 'auto';
        panel.style.zIndex = '10001';
        panel.style.background = '#fff';
        panel.style.color = '#222';
        panel.style.border = '1px solid #888';
        panel.style.borderRadius = '6px';
        panel.style.boxShadow = '0 4px 18px rgba(0,0,0,.28)';
        panel.style.padding = '10px';
        panel.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<b>Mass Enter</b>' +
            '<button type="button" onclick="pluginHandler.massenter.hideProgressPanel()" style="cursor:pointer">×</button>' +
            '</div><div id="massEnterProgress">Подготовка...</div>';
        document.body.appendChild(panel);
        return panel;
    };

    obj.hideProgressPanel = function () {
        var panel = document.getElementById('massEnterProgressPanel');
        if (panel) panel.style.display = 'none';
    };

    obj.startBatch = function (ids, delay, concurrency) {
        ids = Array.isArray(ids) ? ids.slice() : [];

        // Prevent two overlapping batches from the same browser tab.
        if (pluginHandler.massenter.batch && pluginHandler.massenter.batch.running) return;

        var batch = {
            total: ids.length,
            done: 0,
            ok: 0,
            skipped: 0,
            failed: 0,
            active: 0,
            running: true,
            delay: delay,
            concurrency: concurrency,
            queue: ids,
            results: []
        };
        pluginHandler.massenter.batch = batch;

        var button = document.getElementById('MassEnterButton');
        if (button) button.disabled = true;
        pluginHandler.massenter.updateProgress();

        function record(nodeid, status, message) {
            var node = pluginHandler.massenter.getNode(nodeid);
            var name = (node && node.name) ? node.name : nodeid;
            batch.results.push({ nodeid: nodeid, name: name, status: status, message: message || '' });
            if (batch.results.length > 60) batch.results.shift();
            batch.done++;
            if (status === 'ok') batch.ok++;
            else if (status === 'skip') batch.skipped++;
            else batch.failed++;
            pluginHandler.massenter.updateProgress();
        }

        function finishBatch() {
            if (!batch.running) return;
            batch.running = false;
            if (button) button.disabled = false;
            pluginHandler.massenter.updateProgress();
        }

        function pump() {
            while (batch.active < batch.concurrency && batch.queue.length > 0) {
                var nodeid = batch.queue.shift();
                var eligibility = pluginHandler.massenter.getEligibility(nodeid);

                if (!eligibility.ok) {
                    record(nodeid, 'skip', eligibility.reason);
                    continue;
                }

                batch.active++;
                (function (id) {
                    pluginHandler.massenter.runOne(id, batch.delay, function (err) {
                        batch.active--;
                        if (err) record(id, 'fail', err.message || String(err));
                        else record(id, 'ok', 'Enter → Enter отправлены');
                        pump();
                    });
                })(nodeid);
            }

            if (batch.active === 0 && batch.queue.length === 0) finishBatch();
        }

        pump();
    };

    obj.sendEnter = function (redir) {
        if (!redir || redir.State !== 3 || !redir.m || typeof redir.m.SendKeyMsgKC !== 'function') return false;
        redir.m.SendKeyMsgKC(redir.m.KeyAction.DOWN, 13, false);
        redir.m.SendKeyMsgKC(redir.m.KeyAction.UP, 13, false);
        return true;
    };

    obj.runOne = function (nodeid, delay, callback) {
        var done = false;
        var started = false;
        var redir = null;
        var canvas = null;
        var timeout = null;
        var fallbackStart = null;

        function cleanup() {
            if (timeout) clearTimeout(timeout);
            if (fallbackStart) clearTimeout(fallbackStart);
            try { if (redir) redir.Stop(); } catch (e) { }
            try { if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas); } catch (e2) { }
        }

        function finish(err) {
            if (done) return;
            done = true;
            cleanup();
            callback(err || null);
        }

        function beginKeys() {
            if (done || started || !redir || redir.State !== 3) return;
            started = true;

            setTimeout(function () {
                if (done || !pluginHandler.massenter.sendEnter(redir)) {
                    finish(new Error('не удалось отправить первый Enter'));
                    return;
                }

                setTimeout(function () {
                    if (done || !pluginHandler.massenter.sendEnter(redir)) {
                        finish(new Error('не удалось отправить второй Enter'));
                        return;
                    }
                    setTimeout(function () { finish(null); }, 350);
                }, delay);
            }, 250);
        }

        try {
            if (typeof CreateAgentRedirect !== 'function') throw new Error('CreateAgentRedirect недоступен');
            if (typeof CreateAgentRemoteDesktop !== 'function') throw new Error('CreateAgentRemoteDesktop недоступен');
            if (typeof meshserver === 'undefined' || meshserver == null) throw new Error('нет активной MeshCentral web-сессии');

            canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            canvas.style.position = 'fixed';
            canvas.style.left = '-10000px';
            canvas.style.top = '-10000px';
            canvas.style.width = '16px';
            canvas.style.height = '16px';
            canvas.style.pointerEvents = 'none';
            document.body.appendChild(canvas);

            var desktopModule = CreateAgentRemoteDesktop(canvas);
            desktopModule.stopInput = false;

            // Start sending only after the KVM stream has actually initialized.
            desktopModule.onScreenSizeChange = function () {
                if (redir && redir.State === 3) beginKeys();
            };

            var publicNamePort = (typeof serverPublicNamePort !== 'undefined') ? serverPublicNamePort : null;
            var cookie = (typeof authCookie !== 'undefined') ? authCookie : null;
            var relayCookie = (typeof authRelayCookie !== 'undefined') ? authRelayCookie : null;
            var durl;
            if (typeof domainUrl !== 'undefined' && domainUrl) {
                durl = domainUrl;
            } else {
                var path = window.location.pathname || '/';
                durl = path.substring(0, path.lastIndexOf('/') + 1) || '/';
            }

            redir = CreateAgentRedirect(meshserver, desktopModule, publicNamePort, cookie, relayCookie, durl);
            redir.attemptWebRTC = false;
            redir.options = {};

            redir.onStateChanged = function (r, state) {
                if (done) return;
                if (state === 3) {
                    // Screen-size initialization normally fires first; this is a
                    // fallback for agents that do not emit it quickly.
                    fallbackStart = setTimeout(beginKeys, 1400);
                } else if (state === 0 && started) {
                    finish(new Error('KVM-соединение разорвано'));
                }
            };

            redir.onConsoleMessageChange = function (r, msg) {
                if (!done && msg && typeof msg === 'string') redir._massEnterLastMessage = msg;
            };

            timeout = setTimeout(function () {
                var suffix = (redir && redir._massEnterLastMessage) ? (': ' + redir._massEnterLastMessage) : '';
                finish(new Error('тайм-аут KVM' + suffix));
            }, Math.max(10000, delay + 6500));

            redir.Start(nodeid);
        } catch (e) {
            finish(e instanceof Error ? e : new Error(String(e)));
        }
    };

    obj.updateProgress = function () {
        var batch = pluginHandler.massenter.batch;
        if (!batch) return;

        pluginHandler.massenter.ensureProgressPanel();
        var root = document.getElementById('massEnterProgress');
        if (!root) return;
        while (root.firstChild) root.removeChild(root.firstChild);

        var complete = (!batch.running && batch.done === batch.total && batch.active === 0 && batch.queue.length === 0);

        var summary = document.createElement('div');
        summary.style.marginBottom = '8px';
        summary.textContent =
            (complete ? 'Готово. ' : 'Выполняется. ') +
            'Обработано ' + batch.done + ' из ' + batch.total +
            ' — успешно: ' + batch.ok +
            ', пропущено: ' + batch.skipped +
            ', ошибок: ' + batch.failed +
            (batch.active ? ', активно: ' + batch.active : '');
        root.appendChild(summary);

        var barOuter = document.createElement('div');
        barOuter.style.height = '8px';
        barOuter.style.background = '#ddd';
        barOuter.style.borderRadius = '4px';
        barOuter.style.overflow = 'hidden';
        barOuter.style.marginBottom = '10px';

        var barInner = document.createElement('div');
        barInner.style.height = '100%';
        barInner.style.width = (batch.total ? Math.round((batch.done / batch.total) * 100) : 100) + '%';
        barInner.style.background = '#4a90e2';
        barOuter.appendChild(barInner);
        root.appendChild(barOuter);

        if (batch.results.length > 0) {
            var list = document.createElement('div');
            list.style.maxHeight = '230px';
            list.style.overflow = 'auto';
            list.style.fontFamily = 'monospace';
            list.style.fontSize = '12px';

            for (var i = batch.results.length - 1; i >= 0; i--) {
                var item = batch.results[i];
                var line = document.createElement('div');
                var mark = item.status === 'ok' ? 'OK' : (item.status === 'skip' ? 'SKIP' : 'ERR');
                line.textContent = '[' + mark + '] ' + item.name + (item.message ? ' — ' + item.message : '');
                list.appendChild(line);
            }
            root.appendChild(list);
        }
    };

    return obj;
};
