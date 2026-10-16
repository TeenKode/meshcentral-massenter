/**
 * MeshCentral Mass Enter plugin
 * Sends Enter, waits, then sends Enter again to selected devices through
 * the normal MeshCentral KVM channel.
 *
 * Version: 0.3.0
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
        'updateProgress',
        'normalizeSettings',
        'requestSettings',
        'onSettings',
        'readSettings',
        'loadSettings',
        'saveSettings',
        'cancelBatch',
        'retryErrors',
        'getSessionHint',
        'checkSelectedSessions',
        'onSessionProbe'
    ];

    obj.normalizeSettings = function (settings) {
        settings = settings || {};
        function number(value, fallback, min, max) {
            if (typeof value !== 'number' && typeof value !== 'string') return fallback;
            if (value === '') return fallback;
            var n = Number(value);
            return isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
        }
        return { delay: number(settings.delay, 1000, 300, 5000), concurrency: number(settings.concurrency, 6, 1, 20) };
    };

    // userid is supplied by MeshCentral's authenticated session, never by the client.
    // Store outside the plugin directory so upgrades preserve preferences.
    obj.serveraction = function (command, session, webserver) {
        if (command && command.operation === 'probeResult') { obj.receiveSessionProbe(command, session); return; }
        if (command && command.operation === 'checkSession') { obj.checkSession(command, session, webserver); return; }
        if (!session || !session.user || typeof session.user._id !== 'string') return;
        if (!command || typeof command.requestId !== 'string' || command.requestId.length > 100) return;
        if (command.operation !== 'getSettings' && command.operation !== 'saveSettings') return;
        var userid = session.user._id;
        var key = 'massenter-settings/' + userid;
        function reply(error, settings) {
            session.send({ action: 'plugin', plugin: 'massenter', method: 'onSettings',
                requestId: command.requestId, error: error || null, settings: settings });
        }
        try {
            if (command.operation === 'getSettings') {
                obj.meshServer.db.Get(key, function (err, docs) {
                    if (err) { reply('Не удалось загрузить настройки с сервера'); return; }
                    reply(null, obj.normalizeSettings(docs && docs[0] ? docs[0].settings : null));
                });
            } else {
                var settings = obj.normalizeSettings(command.settings);
                obj.meshServer.db.Set({ _id: key, type: 'massenter-settings', userid: userid,
                    domain: session.domain.id, settings: settings }, function (err) {
                    reply(err ? 'Не удалось сохранить настройки на сервере' : null, settings);
                });
            }
        } catch (e) { reply('Серверное хранилище настроек недоступно'); }
    };

    obj.checkSession = function (command, session, webserver) {
        if (!session || !session.user || !session.domain || typeof command.requestId !== 'string' || command.requestId.length > 100) return;
        function reply(state, reason) {
            session.send({ action: 'plugin', plugin: 'massenter', method: 'onSessionProbe',
                requestId: command.requestId, nodeid: command.nodeid, result: { state: state, reason: reason, checkedAt: Date.now() } });
        }
        if (typeof command.nodeid !== 'string' || command.nodeid.length > 200 ||
            command.nodeid.indexOf('node/' + session.domain.id + '/') !== 0) { reply('unknown', 'Нет доступа к устройству'); return; }
        if (!webserver || typeof webserver.GetNodeWithRights !== 'function') { reply('unknown', 'API проверки прав недоступен'); return; }
        webserver.GetNodeWithRights(session.domain, session.user, command.nodeid, function (node, rights, visible) {
            if (!node || visible === false || (rights & 8) === 0) { reply('unknown', 'Нет права Remote Control'); return; }
            if (!node.agent || [1, 2, 3, 4, 21, 22, 34, 42, 43].indexOf(node.agent.id) < 0) { reply('unknown', 'Проверка доступна только для Windows'); return; }
            var agent = webserver.wsagents && webserver.wsagents[command.nodeid];
            if (!agent || agent.authenticated !== 2) { reply('unknown', 'Агент офлайн или недоступен на этом сервере'); return; }
            if (!obj.pendingProbes) obj.pendingProbes = Object.create(null);
            var pending = Object.values(obj.pendingProbes);
            if (pending.length >= 128 || pending.filter(function (p) { return p.userid === session.user._id; }).length >= 4) {
                reply('unknown', 'Дождитесь завершения предыдущих проверок'); return;
            }
            var token = require('crypto').randomBytes(24).toString('hex');
            var request = { agent: agent, nodeid: command.nodeid, userid: session.user._id, reply: reply };
            request.timer = setTimeout(function () {
                delete obj.pendingProbes[token];
                reply('unknown', 'Агент не ответил. После обновления плагина нажмите Refresh Agent Cores в менеджере плагинов.');
            }, 10000);
            obj.pendingProbes[token] = request;
            try {
                agent.send(JSON.stringify({ action: 'plugin', plugin: 'massenter', operation: 'probeSession', probeToken: token, rights: rights }));
            } catch (e) {
                clearTimeout(request.timer); delete obj.pendingProbes[token];
                reply('unknown', 'Не удалось отправить запрос агенту');
            }
        });
    };

    obj.receiveSessionProbe = function (command, agent) {
        if (!agent || agent.user || agent.authenticated !== 2 || typeof command.probeToken !== 'string' || !obj.pendingProbes) return;
        var pending = obj.pendingProbes[command.probeToken];
        if (!pending || pending.agent !== agent || pending.nodeid !== agent.dbNodeKey) return;
        clearTimeout(pending.timer); delete obj.pendingProbes[command.probeToken];
        var facts = command.facts;
        var state = 'unknown';
        if (facts && typeof facts === 'object' && (facts.username == null || (typeof facts.username === 'string' && facts.username.length <= 256)) &&
            (facts.desktop == null || (typeof facts.desktop === 'string' && facts.desktop.length <= 64))) {
            state = require('./modules_meshcore/massenter.js').classifyFacts(facts);
        }
        var reasons = {
            signin: 'Защищённый рабочий стол входа; в консольном сеансе нет пользователя.',
            locked: 'Windows сообщает о заблокированном консольном сеансе и защищённом рабочем столе.',
            unlocked: 'В консольном сеансе есть пользователь, сеанс разблокирован, активен Default.',
            secure: 'Пользователь вошёл; активен защищённый рабочий стол — возможен UAC или переход.',
            unknown: 'Не удалось достоверно прочитать состояние консольного сеанса и активного рабочего стола.'
        };
        if (facts && facts.error === 'not-windows') reasons.unknown = 'Проверка доступна только для Windows';
        if (facts && facts.error === 'timeout') reasons.unknown = 'Проверка Windows не завершилась за 6 секунд; повторите запрос';
        if (facts && facts.error === 'invalid-response') reasons.unknown = 'Агент вернул неполные данные о состоянии Windows';
        if (facts && facts.error === 'desktop-unavailable') reasons.unknown = 'Windows не разрешила прочитать активный рабочий стол';
        if (facts && facts.error === 'wts-unavailable') reasons.unknown = 'Windows не предоставила сведения о консольном сеансе';
        if (facts && facts.error === 'console-changed') reasons.unknown = 'Консольный сеанс изменился во время проверки';
        if (facts && facts.error === 'busy') reasons.unknown = 'Агент уже выполняет проверку; повторите позже';
        pending.reply(state, reasons[state]);
    };

    obj.checkSelectedSessions = function () {
        var me = pluginHandler.massenter;
        var panel = document.getElementById('massEnterConfirmation');
        var rows = me.sessionRows;
        if (!panel || !rows || (me.sessionCheck && me.sessionCheck.panel === panel && me.sessionCheck.running)) return;
        var button = document.getElementById('massEnterCheckSessions');
        var status = document.getElementById('massEnterSessionStatus');
        var check = { panel: panel, queue: Object.keys(rows), active: 0, done: 0, total: Object.keys(rows).length, running: true };
        me.sessionCheck = check;
        if (!me.sessionProbeRequests) me.sessionProbeRequests = {};
        button.disabled = true;
        status.textContent = 'Чтение состояния Windows через агент…';
        var pumping = false;
        function pump() {
            if (pumping) return;
            if (document.getElementById('massEnterConfirmation') !== panel) { check.running = false; return; }
            pumping = true;
            while (check.active < 4 && check.queue.length) {
                (function (id) {
                    check.active++;
                    var requestId = 'probe-' + String((me.sessionProbeId || 0) + 1);
                    me.sessionProbeId = (me.sessionProbeId || 0) + 1;
                    var pending = { nodeid: id, finish: function (result) {
                        check.active--; check.done++;
                        if (document.getElementById('massEnterConfirmation') !== panel) return;
                        var labels = { signin: 'Экран входа / приветствие', locked: 'Сеанс заблокирован',
                            unlocked: 'Пользователь вошёл, сеанс разблокирован', secure: 'Защищённый экран (UAC / переход)', unknown: 'Неизвестно' };
                        var node = me.getNode(id);
                        rows[id].textContent = (node && node.name ? node.name : id) + ' — ' + (labels[result.state] || labels.unknown) +
                            '. ' + (result.reason || '') + ' Проверено: ' + new Date(result.checkedAt || Date.now()).toLocaleTimeString();
                        pump();
                    } };
                    pending.timer = setTimeout(function () { me.onSessionProbe(null, { requestId: requestId, result: { state: 'unknown', reason: 'Сервер не ответил' } }); }, 12000);
                    me.sessionProbeRequests[requestId] = pending;
                    try { meshserver.send({ action: 'plugin', plugin: 'massenter', operation: 'checkSession', nodeid: id, requestId: requestId }); }
                    catch (e) { me.onSessionProbe(null, { requestId: requestId, result: { state: 'unknown', reason: 'Нет связи с сервером' } }); }
                })(check.queue.shift());
            }
            pumping = false;
            status.textContent = 'Проверено ' + check.done + ' из ' + check.total + '. Состояние на момент проверки; компьютеры не отфильтрованы.';
            if (check.active === 0 && check.queue.length === 0) { check.running = false; button.disabled = false; }
        }
        pump();
    };

    obj.onSessionProbe = function (server, message) {
        var me = pluginHandler.massenter;
        var pending = me.sessionProbeRequests && me.sessionProbeRequests[message.requestId];
        if (!pending) return;
        clearTimeout(pending.timer); delete me.sessionProbeRequests[message.requestId];
        pending.finish(message.result || { state: 'unknown', reason: 'Ответ без данных' });
    };

    obj.requestSettings = function (operation, settings, callback) {
        var me = pluginHandler.massenter;
        if (!me.settingsRequests) me.settingsRequests = {};
        var id = String((me.settingsRequestId || 0) + 1);
        me.settingsRequestId = Number(id);
        var timer = setTimeout(function () {
            var pending = me.settingsRequests[id];
            if (!pending) return;
            delete me.settingsRequests[id];
            pending.callback('Сервер не ответил на запрос настроек');
        }, 8000);
        me.settingsRequests[id] = { timer: timer, callback: callback };
        try {
            meshserver.send({ action: 'plugin', plugin: 'massenter', operation: operation, requestId: id, settings: settings });
        } catch (e) { me.onSettings(null, { requestId: id, error: 'Нет связи с сервером настроек' }); }
    };

    obj.onSettings = function (server, message) {
        var me = pluginHandler.massenter;
        var pending = me.settingsRequests && me.settingsRequests[message.requestId];
        if (!pending) return;
        clearTimeout(pending.timer);
        delete me.settingsRequests[message.requestId];
        pending.callback(message.error, me.normalizeSettings(message.settings));
    };

    obj.readSettings = function () {
        var d = document.getElementById('massEnterDelay');
        var c = document.getElementById('massEnterConcurrency');
        return pluginHandler.massenter.normalizeSettings({ delay: d && d.value, concurrency: c && c.value });
    };

    obj.loadSettings = function () {
        var panel = document.getElementById('massEnterConfirmation');
        var d = document.getElementById('massEnterDelay');
        var c = document.getElementById('massEnterConcurrency');
        var start = document.getElementById('massEnterConfirmButton');
        var save = document.getElementById('massEnterSaveSettings');
        var status = document.getElementById('massEnterSettingsStatus');
        d.disabled = c.disabled = start.disabled = save.disabled = true;
        status.textContent = 'Загрузка настроек с сервера…';
        pluginHandler.massenter.requestSettings('getSettings', null, function (error, settings) {
            if (document.getElementById('massEnterConfirmation') !== panel) return;
            d.disabled = c.disabled = start.disabled = save.disabled = false;
            if (!error) { d.value = settings.delay; c.value = settings.concurrency; }
            status.textContent = error ? error + '. Доступны стандартные значения.' : 'Настройки вашего пользователя загружены с сервера.';
        });
    };

    obj.saveSettings = function () {
        var panel = document.getElementById('massEnterConfirmation');
        var save = document.getElementById('massEnterSaveSettings');
        var status = document.getElementById('massEnterSettingsStatus');
        save.disabled = true;
        status.textContent = 'Сохранение…';
        pluginHandler.massenter.requestSettings('saveSettings', pluginHandler.massenter.readSettings(), function (error) {
            if (document.getElementById('massEnterConfirmation') !== panel) return;
            save.disabled = false;
            status.textContent = error || 'Настройки сохранены на сервере для вашего пользователя.';
        });
    };

    obj.getSessionHint = function (node) {
        if (!node || ((node.conn || 0) & 1) === 0) return 'офлайн — состояние неизвестно';
        if (typeof isWindowsNode !== 'function' || !isWindowsNode(node)) return 'сведения о сеансе Windows недоступны';
        if (!Array.isArray(node.users)) return 'агент не сообщил состояние сеанса';
        if (node.users.length === 0) return 'нет активных пользователей — возможен экран входа';
        if (Array.isArray(node.lusers) && node.users.every(function (u) { return node.lusers.indexOf(u) >= 0; })) {
            return 'агент сообщает о блокировке: ' + node.users.join(', ');
        }
        return 'есть пользовательский сеанс: ' + node.users.join(', ') + ' — экран входа не подтверждён';
    };

    obj.server_startup = function () {
        try { obj.meshServer.debug('plugin:massenter', 'Mass Enter plugin 0.3.0 loaded'); }
        catch (e) { console.log('MeshCentral Mass Enter plugin 0.3.0 loaded'); }
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
        html += '<br><button id="massEnterSaveSettings" type="button" onclick="pluginHandler.massenter.saveSettings()">Сохранить на сервере</button>' +
            '<div id="massEnterSettingsStatus" style="margin-top:6px" aria-live="polite"></div>';
        html += '<br><br><span style="color:#a04000"><b>Важно:</b> запускайте только для компьютеров, находящихся на экране входа Windows.</span>';
        html += '</div>';

        pluginHandler.massenter.showConfirmation(html, true);
        pluginHandler.massenter.pendingNodeIds = ids.slice();
        var list = document.createElement('div');
        list.style.cssText = 'margin:10px 0;max-height:150px;overflow:auto;font-size:12px';
        var info = document.createElement('div');
        info.textContent = 'Сведения агента (до проверки — предварительные):';
        list.appendChild(info);
        pluginHandler.massenter.sessionRows = Object.create(null);
        ids.forEach(function (id) {
            var node = pluginHandler.massenter.getNode(id);
            var line = document.createElement('div');
            line.textContent = (node && node.name ? node.name : id) + ' — ' + pluginHandler.massenter.getSessionHint(node);
            list.appendChild(line);
            pluginHandler.massenter.sessionRows[id] = line;
        });
        var panel = document.getElementById('massEnterConfirmation');
        panel.appendChild(list);
        var checkButton = document.createElement('button');
        checkButton.id = 'massEnterCheckSessions'; checkButton.type = 'button';
        checkButton.textContent = 'Проверить экран входа';
        checkButton.onclick = function () { pluginHandler.massenter.checkSelectedSessions(); };
        panel.appendChild(checkButton);
        var status = document.createElement('div');
        status.id = 'massEnterSessionStatus'; status.setAttribute('aria-live', 'polite');
        status.textContent = 'Проверка читает состояние Windows без отправки клавиш. Она не распознаёт изображение экрана.';
        panel.appendChild(status);
        pluginHandler.massenter.loadSettings();
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
        var settings = pluginHandler.massenter.readSettings();
        pluginHandler.massenter.closeConfirmation();
        pluginHandler.massenter.ensureProgressPanel();
        pluginHandler.massenter.startBatch(ids, settings.delay, settings.concurrency);
        var batch = pluginHandler.massenter.batch;
        batch.settingsStatus = 'Сохранение настроек на сервере…';
        pluginHandler.massenter.updateProgress();
        pluginHandler.massenter.requestSettings('saveSettings', settings, function (error) {
            batch.settingsStatus = error || 'Настройки сохранены на сервере.';
            if (pluginHandler.massenter.batch === batch) pluginHandler.massenter.updateProgress();
        });
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
            '</div><div id="massEnterProgress" aria-live="polite">Подготовка...</div>' +
            '<div style="margin-top:10px"><button id="massEnterStopButton" type="button" onclick="pluginHandler.massenter.cancelBatch()">Остановить выполнение</button> ' +
            '<button id="massEnterRetryButton" type="button" onclick="pluginHandler.massenter.retryErrors()">Повторить ошибки</button></div>';
        document.body.appendChild(panel);
        return panel;
    };

    obj.hideProgressPanel = function () {
        var panel = document.getElementById('massEnterProgressPanel');
        if (panel) panel.style.display = 'none';
    };

    obj.cancelBatch = function () {
        var me = pluginHandler.massenter, batch = me.batch;
        if (!batch || !batch.running || batch.cancelled) return;
        batch.cancelled = true;
        while (batch.queue.length) batch.record(batch.queue.shift(), 'cancel', 'не запущено — отменено');
        Object.keys(batch.cancellers).forEach(function (id) { batch.cancellers[id](); });
        batch.pump();
    };

    obj.retryErrors = function () {
        var batch = pluginHandler.massenter.batch;
        if (!batch || batch.running || batch.failedNodeIds.length === 0) return;
        pluginHandler.massenter.ensureProgressPanel();
        pluginHandler.massenter.startBatch(batch.failedNodeIds.slice(), batch.delay, batch.concurrency);
    };

    obj.startBatch = function (ids, delay, concurrency) {
        var me = pluginHandler.massenter;
        if (me.batch && me.batch.running) return;
        ids = Array.isArray(ids) ? ids.filter(function (id, i, all) { return typeof id === 'string' && all.indexOf(id) === i; }) : [];
        var settings = me.normalizeSettings({ delay: delay, concurrency: concurrency });
        var batch = {
            total: ids.length, done: 0, ok: 0, skipped: 0, failed: 0, cancelledCount: 0,
            active: 0, running: true, cancelled: false,
            delay: settings.delay, concurrency: settings.concurrency,
            queue: ids, results: [], failedNodeIds: [], cancellers: Object.create(null)
        };
        me.batch = batch;
        var button = document.getElementById('MassEnterButton');
        if (button) button.disabled = true;

        batch.record = function (nodeid, status, message) {
            var node = me.getNode(nodeid);
            batch.results.push({ nodeid: nodeid, name: node && node.name ? node.name : nodeid, status: status, message: message || '' });
            batch.done++;
            if (status === 'ok') batch.ok++;
            else if (status === 'skip') batch.skipped++;
            else if (status === 'cancel') batch.cancelledCount++;
            else { batch.failed++; batch.failedNodeIds.push(nodeid); }
            me.updateProgress();
        };

        var pumping = false;
        batch.pump = function () {
            if (pumping || !batch.running) return;
            pumping = true;
            while (!batch.cancelled && batch.active < batch.concurrency && batch.queue.length > 0) {
                var nodeid = batch.queue.shift();
                var eligibility = me.getEligibility(nodeid);
                if (!eligibility.ok) { batch.record(nodeid, 'skip', eligibility.reason); continue; }
                batch.active++;
                (function (id) {
                    var completed = false;
                    function complete(err) {
                        if (completed) return;
                        completed = true;
                        delete batch.cancellers[id];
                        batch.active--;
                        var status = err ? (err.code === 'CANCELLED' ? 'cancel' : 'fail') : 'ok';
                        batch.record(id, status, err ? err.message || String(err) : 'Enter → Enter отправлены (вход не подтверждён)');
                        batch.pump();
                    }
                    try {
                        var cancel = me.runOne(id, batch.delay, complete);
                        if (!completed) batch.cancellers[id] = cancel;
                    } catch (e) { complete(e); }
                })(nodeid);
            }
            pumping = false;
            if (batch.active === 0 && batch.queue.length === 0) {
                batch.running = false;
                if (button) button.disabled = false;
            }
            me.updateProgress();
        };
        batch.pump();
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
        var keyTimers = [];

        function cleanup() {
            if (timeout) clearTimeout(timeout);
            if (screenTimeout) clearTimeout(screenTimeout);
            keyTimers.forEach(function (timer) { clearTimeout(timer); });
            try { if (redir) redir.Stop(); } catch (e) { }
            try { if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas); } catch (e2) { }
        }

        function finish(err) {
            if (done) return;
            done = true;
            cleanup();
            callback(err || null);
        }

        function schedule(fn, ms) {
            keyTimers.push(setTimeout(function () {
                if (done) return;
                try { fn(); } catch (e) { finish(e); }
            }, ms));
        }

        function beginKeys() {
            if (done || started || !screenReady || !redir || redir.State !== 3 || !redir.m || redir.m.State !== 3) return;
            started = true;
            schedule(function () {
                if (!pluginHandler.massenter.sendEnter(redir)) { finish(new Error('не удалось отправить первый Enter')); return; }
                schedule(function () {
                    if (!pluginHandler.massenter.sendEnter(redir)) { finish(new Error('не удалось отправить второй Enter')); return; }
                    schedule(function () { finish(null); }, 500);
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
                if (state === 3 && !screenReady && !screenTimeout) {
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
        return function () {
            var error = new Error('выполнение отменено; уже отправленные клавиши не отменяются');
            error.code = 'CANCELLED';
            finish(error);
        };
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
            header = (b.cancelled ? 'Остановлено. Обработано ' : 'Готово. Обработано ') + b.done + ' из ' + b.total + ' — успешно: ' + b.ok + ', пропущено: ' + b.skipped + ', ошибок: ' + b.failed;
        }

        header += ', отменено: ' + b.cancelledCount;
        var lines = [header];
        if (b.settingsStatus) lines.push(b.settingsStatus);
        var stop = document.getElementById('massEnterStopButton');
        var retry = document.getElementById('massEnterRetryButton');
        if (stop) stop.disabled = !b.running || b.cancelled;
        if (retry) { retry.disabled = b.running || b.failedNodeIds.length === 0; retry.textContent = 'Повторить ошибки (' + b.failedNodeIds.length + ')'; }
        for (var i = Math.max(0, b.results.length - 60); i < b.results.length; i++) {
            var r = b.results[i];
            var prefix = r.status === 'ok' ? '[OK]' : (r.status === 'skip' ? '[SKIP]' : (r.status === 'cancel' ? '[CANCEL]' : '[ERR]'));
            lines.push(prefix + ' ' + r.name + (r.message ? ' — ' + r.message : ''));
        }
        el.textContent = lines.join('\n');
        el.style.whiteSpace = 'pre-wrap';
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '12px';
    };

    return obj;
};
