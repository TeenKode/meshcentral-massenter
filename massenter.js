/**
 * MeshCentral Mass Enter plugin
 * Sends Enter, waits, then sends Enter again to selected devices through
 * the normal MeshCentral KVM channel.
 *
 * Version: 0.1.3
 */
"use strict";

module.exports.massenter = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;

    obj.exports = [
        'onWebUIStartupEnd',
        'getSelectedNodeIds',
        'getNode',
        'getEligibility',
        'openDialog',
        'showConfirmation',
        'closeConfirmation',
        'runSelected',
        'startBatch',
        'runOne',
        'sendEnter',
        'ensureProgressPanel',
        'hideProgressPanel',
        'updateProgress'
    ];

    obj.server_startup = function () {
        try { obj.meshServer.debug('plugin:massenter', 'Mass Enter plugin 0.1.3 loaded'); }
        catch (e) { console.log('MeshCentral Mass Enter plugin 0.1.3 loaded'); }
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
        if (node.agent.caps != null && ((node.agent.caps & 1) === 0)) return { ok: false, reason: 'агент без KVM' };
        return { ok: true, node: node };
    };

    obj.openDialog = function () {
        var ids = pluginHandler.massenter.getSelectedNodeIds();
        if (!ids || ids.length === 0) {
            pluginHandler.massenter.showConfirmation('Сначала отметьте компьютеры в разделе «My Devices».', false);
            return;
        }

        var eligible = 0, skipped = 0;
        for (var i = 0; i < ids.length; i++) {
            var e = pluginHandler.massenter.getEligibility(ids[i]);
            if (e.ok) eligible++; else skipped++;
        }

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

        pluginHandler.massenter.showConfirmation(html, true);
        pluginHandler.massenter.pendingNodeIds = ids.slice();
    };

    // Keep plugin confirmation independent of MeshCentral's global modal state.
    // A hidden/unsupported native dialog can otherwise disable the whole toolbar.
    obj.showConfirmation = function (html, canRun) {
        pluginHandler.massenter.closeConfirmation();
        var panel = document.createElement('section');
        panel.id = 'massEnterConfirmation';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', 'Массовый вход');
        panel.style.cssText = 'position:fixed;right:18px;top:80px;width:430px;max-width:calc(100vw - 56px);max-height:calc(100vh - 120px);overflow:auto;z-index:999;background:#fff;color:#222;border:1px solid #888;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.28);padding:10px';
        panel.innerHTML = '<b>Массовый вход</b><div style="margin:12px 0">' + html + '</div>';
        if (canRun) {
            var start = document.createElement('button');
            start.type = 'button';
            start.id = 'massEnterConfirmButton';
            start.textContent = 'Отправить Enter ×2';
            start.onclick = function () { pluginHandler.massenter.runSelected(); };
            panel.appendChild(start);
        }
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.id = 'massEnterCancelButton';
        cancel.textContent = canRun ? 'Отмена' : 'Закрыть';
        cancel.onclick = function () { pluginHandler.massenter.closeConfirmation(); };
        panel.appendChild(cancel);
        document.body.appendChild(panel);
        (canRun ? start : cancel).focus();
    };

    obj.closeConfirmation = function () {
        var panel = document.getElementById('massEnterConfirmation');
        if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
        pluginHandler.massenter.pendingNodeIds = null;
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

        pluginHandler.massenter.closeConfirmation();
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
        panel.style.pointerEvents = 'auto';
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
        if (!redir || redir.State !== 3 || !redir.m || redir.m.State !== 3 || typeof redir.m.SendKeyMsgKC !== 'function') return false;
        redir.m.SendKeyMsgKC(redir.m.KeyAction.DOWN, 13, false);
        redir.m.SendKeyMsgKC(redir.m.KeyAction.UP, 13, false);
        return true;
    };

    obj.runOne = function (nodeid, delay, callback) {
        var done = false;
        var started = false;
        var screenReady = false;
        var redir = null;
        var canvas = null;
        var timeout = null;
        var screenTimeout = null;

        function cleanup() {
            if (timeout) clearTimeout(timeout);
            if (screenTimeout) clearTimeout(screenTimeout);
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
            if (done || started || !screenReady || !redir || redir.State !== 3 || !redir.m || redir.m.State !== 3) return;
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
                    setTimeout(function () { finish(null); }, 500);
                }, delay);
            }, 300);
        }

        try {
            if (typeof CreateAgentRedirect !== 'function') throw new Error('CreateAgentRedirect недоступен');
            if (typeof CreateAgentRemoteDesktop !== 'function') throw new Error('CreateAgentRemoteDesktop недоступен');
            if (typeof meshserver === 'undefined' || meshserver == null) throw new Error('нет активной MeshCentral web-сессии');

            var node = pluginHandler.massenter.getNode(nodeid);

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
            try {
                if (typeof isWindowsNode === 'function' && node) desktopModule.UseExtendedKeyFlag = isWindowsNode(node);
            } catch (e0) { }

            desktopModule.onScreenSizeChange = function (m, width, height) {
                if (done || !redir || redir.State !== 3 || m.State !== 3) return;
                if (!(width > 0 && height > 0)) return;
                screenReady = true;
                if (screenTimeout) { clearTimeout(screenTimeout); screenTimeout = null; }
                beginKeys();
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
                    // State 3 only proves the relay is connected. Do not send keyboard
                    // input until the desktop module receives a real screen-size event.
                    screenTimeout = setTimeout(function () {
                        if (!screenReady) finish(new Error('KVM подключён, но экран не инициализирован'));
                    }, 12000);
                } else if (state === 0 && !done) {
                    finish(new Error(screenReady ? 'KVM-соединение разорвано' : 'KVM-соединение закрыто до инициализации экрана'));
                }
            };

            timeout = setTimeout(function () {
                finish(new Error('тайм-аут KVM'));
            }, Math.max(16000, delay + 14500));

            redir.Start(nodeid);
        } catch (e) {
            finish(e);
        }
    };

    obj.updateProgress = function () {
        var el = document.getElementById('massEnterProgress');
        if (!el) return;
        var b = pluginHandler.massenter.batch;
        if (!b) {
            el.textContent = 'Подготовка...';
            return;
        }

        var header;
        if (b.running) {
            header = 'Обработано ' + b.done + ' из ' + b.total + ' — успешно: ' + b.ok + ', пропущено: ' + b.skipped + ', ошибок: ' + b.failed + ', активно: ' + b.active;
        } else {
            header = 'Готово. Обработано ' + b.done + ' из ' + b.total + ' — успешно: ' + b.ok + ', пропущено: ' + b.skipped + ', ошибок: ' + b.failed;
        }

        var lines = [header];
        for (var i = 0; i < b.results.length; i++) {
            var r = b.results[i];
            var prefix = r.status === 'ok' ? '[OK]' : (r.status === 'skip' ? '[SKIP]' : '[ERR]');
            lines.push(prefix + ' ' + r.name + (r.message ? ' — ' + r.message : ''));
        }
        el.textContent = lines.join('\n');
        el.style.whiteSpace = 'pre-wrap';
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '12px';
    };

    return obj;
};
