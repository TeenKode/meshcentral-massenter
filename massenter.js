/**
 * MeshCentral Mass Enter plugin
 * Sends Enter, waits, sends Enter again to selected devices over the normal
 * MeshCentral KVM relay. It does not configure Windows AutoLogon and does not
 * store or transmit account credentials.
 *
 * Target: MeshCentral classic/default web UI.
 */
"use strict";

module.exports.massenter = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;

    // These functions are serialized by MeshCentral's plugin handler and run
    // in the browser, so cross-calls must go through pluginHandler.massenter.
    obj.exports = [
        'onWebUIStartupEnd',
        'getSelectedNodeIds',
        'getNode',
        'getEligibility',
        'openDialog',
        'runSelected',
        'startBatch',
        'runOne',
        'makeKvmModule',
        'sendEnter',
        'updateProgress'
    ];

    obj.server_startup = function () {
        try { obj.meshServer.debug('plugin:massenter', 'Mass Enter plugin loaded'); }
        catch (e) { console.log('MeshCentral Mass Enter plugin loaded'); }
    };

    obj.onWebUIStartupEnd = function () {
        // Avoid duplicate buttons if the plugin handler is refreshed.
        if (document.getElementById('MassEnterButton')) return;

        var button = document.createElement('input');
        button.type = 'button';
        button.id = 'MassEnterButton';
        button.value = 'Вход (Enter×2)';
        button.title = 'Отправить Enter, затем ещё один Enter выбранным компьютерам через MeshCentral KVM';
        button.style.marginRight = '4px';
        button.onclick = function () { pluginHandler.massenter.openDialog(); };

        // Preferred placement: next to the standard Group Action button.
        var groupButton = document.getElementById('GroupActionButton');
        if (groupButton && groupButton.parentNode) {
            if (groupButton.nextSibling) {
                groupButton.parentNode.insertBefore(button, groupButton.nextSibling);
            } else {
                groupButton.parentNode.appendChild(button);
            }
            return;
        }

        // Fallback for UI variants where the classic toolbar markup differs.
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

        // Fallback: read checked device checkboxes directly.
        var out = [];
        try {
            var boxes = document.querySelectorAll('.DeviceCheckbox:checked');
            for (var i = 0; i < boxes.length; i++) {
                var v = boxes[i].value || '';
                if (v.indexOf('devid_') === 0) v = v.substring(6);
                try { v = decodeURIComponent(v); } catch (e) { }
                if (v) out.push(v);
            }
        } catch (e) { }
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
        } catch (e) { }
        return null;
    };

    obj.getEligibility = function (nodeid) {
        var node = pluginHandler.massenter.getNode(nodeid);
        if (!node) return { ok: false, reason: 'устройство не найдено' };
        if (((node.conn || 0) & 1) === 0) return { ok: false, reason: 'MeshAgent офлайн' };

        try {
            if (typeof GetNodeRights === 'function') {
                var rights = GetNodeRights(node);
                // 8 = remote control. View-only (256) is intentionally not enough,
                // because this operation injects keyboard input.
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

        var html = '';
        html += '<div style="max-width:520px;line-height:1.45">';
        html += '<b>Будет отправлено два нажатия Enter через обычный MeshCentral KVM.</b><br><br>';
        html += 'Выбрано устройств: <b>' + ids.length + '</b><br>';
        html += 'Готово к выполнению: <b>' + eligible + '</b>';
        if (skipped > 0) html += '<br>Будет пропущено: <b>' + skipped + '</b> (офлайн / нет прав / нет KVM)';
        html += '<br><br>';
        html += '<label>Пауза между Enter: <input id="massEnterDelay" type="number" min="200" max="5000" step="100" value="900" style="width:85px"> мс</label><br>';
        html += '<label>Одновременных KVM-подключений: <input id="massEnterConcurrency" type="number" min="1" max="20" value="8" style="width:60px"></label>';
        html += '<br><br><span style="color:#a04000"><b>Важно:</b> операция не проверяет содержимое экрана. Используйте её только для компьютеров, которые действительно стоят на экране входа Windows. На другом экране Enter может активировать текущий элемент.</span>';
        html += '</div>';

        if (typeof setDialogMode === 'function') {
            setDialogMode(2, 'Массовый вход: Enter → Enter', 3, pluginHandler.massenter.runSelected, html);
        } else if (confirm('Отправить Enter два раза на ' + eligible + ' устройств?')) {
            pluginHandler.massenter.startBatch(ids, 900, 8);
        }
    };

    obj.runSelected = function () {
        var ids = pluginHandler.massenter.pendingNodeIds || pluginHandler.massenter.getSelectedNodeIds();
        var delay = 900, concurrency = 8;
        try {
            var d = document.getElementById('massEnterDelay');
            var c = document.getElementById('massEnterConcurrency');
            if (d) delay = parseInt(d.value, 10);
            if (c) concurrency = parseInt(c.value, 10);
        } catch (e) { }

        if (!isFinite(delay)) delay = 900;
        if (!isFinite(concurrency)) concurrency = 8;
        delay = Math.max(200, Math.min(5000, delay));
        concurrency = Math.max(1, Math.min(20, concurrency));

        var progressHtml = '';
        progressHtml += '<div id="massEnterProgress" style="min-width:420px;max-width:650px">Подготовка...</div>';
        if (typeof setDialogMode === 'function') {
            setDialogMode(2, 'Массовый вход', 1, null, progressHtml);
        }
        pluginHandler.massenter.startBatch(ids, delay, concurrency);
    };

    obj.startBatch = function (ids, delay, concurrency) {
        ids = Array.isArray(ids) ? ids.slice() : [];
        var batch = {
            total: ids.length,
            done: 0,
            ok: 0,
            skipped: 0,
            failed: 0,
            active: 0,
            delay: delay,
            concurrency: concurrency,
            queue: ids,
            results: []
        };
        pluginHandler.massenter.batch = batch;
        pluginHandler.massenter.updateProgress();

        function record(nodeid, status, message) {
            var node = pluginHandler.massenter.getNode(nodeid);
            var name = (node && node.name) ? node.name : nodeid;
            batch.results.push({ nodeid: nodeid, name: name, status: status, message: message || '' });
            if (batch.results.length > 50) batch.results.shift();
            batch.done++;
            if (status === 'ok') batch.ok++;
            else if (status === 'skip') batch.skipped++;
            else batch.failed++;
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

            if (batch.active === 0 && batch.queue.length === 0) {
                pluginHandler.massenter.updateProgress();
            }
        }

        pump();
    };

    obj.makeKvmModule = function () {
        return {
            protocol: 2,
            State: 0,
            parent: null,
            xxStateChange: function (state) { this.State = state; },
            ProcessBinaryCommand: function () { },
            ProcessData: function () { }
        };
    };

    obj.sendEnter = function (redir) {
        if (!redir || redir.State !== 3 || typeof redir.send !== 'function') return false;
        // MeshCentral KVM keyboard packet:
        // 00 01 00 06 00 0D = Enter key down
        // 00 01 00 06 01 0D = Enter key up
        redir.send(String.fromCharCode(0x00, 0x01, 0x00, 0x06, 0x00, 0x0D));
        redir.send(String.fromCharCode(0x00, 0x01, 0x00, 0x06, 0x01, 0x0D));
        return true;
    };

    obj.runOne = function (nodeid, delay, callback) {
        var done = false;
        var started = false;
        var redir = null;
        var timeout = null;

        function finish(err) {
            if (done) return;
            done = true;
            if (timeout) clearTimeout(timeout);
            try { if (redir) redir.Stop(); } catch (e) { }
            callback(err || null);
        }

        try {
            if (typeof CreateAgentRedirect !== 'function') throw new Error('CreateAgentRedirect недоступен в этой версии UI');
            if (typeof meshserver === 'undefined' || meshserver == null) throw new Error('нет активной MeshCentral web-сессии');

            var module = pluginHandler.massenter.makeKvmModule();
            var path = window.location.pathname || '/';
            var lastSlash = path.lastIndexOf('/');
            var domainUrl = path.substring(0, lastSlash + 1);
            if (!domainUrl) domainUrl = '/';

            var authCookie = meshserver.authCookie || null;
            redir = CreateAgentRedirect(meshserver, module, null, authCookie, null, domainUrl);
            redir.attemptWebRTC = false;

            redir.onStateChanged = function (r, state) {
                if (done) return;
                if (state === 3 && !started) {
                    started = true;
                    // Give Winlogon/KVM a short moment after the relay reaches state 3.
                    setTimeout(function () {
                        if (done || !pluginHandler.massenter.sendEnter(redir)) {
                            finish(new Error('KVM закрылся до первого Enter'));
                            return;
                        }
                        setTimeout(function () {
                            if (done || !pluginHandler.massenter.sendEnter(redir)) {
                                finish(new Error('KVM закрылся до второго Enter'));
                                return;
                            }
                            setTimeout(function () { finish(null); }, 300);
                        }, delay);
                    }, 250);
                } else if (state === 0 && started && !done) {
                    finish(new Error('KVM-соединение разорвано'));
                }
            };

            redir.onConsoleMessageChange = function (r, msg) {
                // Keep useful denial/consent information if the server closes the relay.
                if (!done && msg && typeof msg === 'string') redir._massEnterLastMessage = msg;
            };

            timeout = setTimeout(function () {
                var suffix = (redir && redir._massEnterLastMessage) ? (': ' + redir._massEnterLastMessage) : '';
                finish(new Error('тайм-аут подключения KVM' + suffix));
            }, Math.max(7000, delay + 4000));

            redir.Start(nodeid);
        } catch (e) {
            finish(e instanceof Error ? e : new Error(String(e)));
        }
    };

    obj.updateProgress = function () {
        var batch = pluginHandler.massenter.batch;
        if (!batch) return;
        var root = document.getElementById('massEnterProgress');
        if (!root) return;

        while (root.firstChild) root.removeChild(root.firstChild);

        var summary = document.createElement('div');
        summary.style.marginBottom = '10px';
        var complete = (batch.done === batch.total && batch.active === 0 && batch.queue.length === 0);
        summary.textContent = (complete ? 'Готово. ' : 'Выполняется. ') +
            'Обработано ' + batch.done + ' из ' + batch.total +
            ' — успешно: ' + batch.ok +
            ', пропущено: ' + batch.skipped +
            ', ошибок: ' + batch.failed +
            (batch.active ? ', активно: ' + batch.active : '');
        root.appendChild(summary);

        var barOuter = document.createElement('div');
        barOuter.style.height = '10px';
        barOuter.style.background = '#ddd';
        barOuter.style.borderRadius = '5px';
        barOuter.style.overflow = 'hidden';
        barOuter.style.marginBottom = '12px';
        var barInner = document.createElement('div');
        barInner.style.height = '100%';
        barInner.style.width = (batch.total ? Math.round((batch.done / batch.total) * 100) : 100) + '%';
        barInner.style.background = '#4a90e2';
        barOuter.appendChild(barInner);
        root.appendChild(barOuter);

        if (batch.results.length > 0) {
            var list = document.createElement('div');
            list.style.maxHeight = '260px';
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
