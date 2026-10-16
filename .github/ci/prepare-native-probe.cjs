'use strict';
const fs = require('node:fs');
const source = fs.readFileSync('modules_meshcore/massenter.js', 'utf8');
const program = 'var resultCode = 0; try { addModule("massenter", ' + JSON.stringify(source) + '); ' +
    'var p = require("massenter"); ' +
    'console.log("Module loaded: " + typeof p.probe); ' +
    'var sid = require("user-sessions").consoleUid(); ' +
    'var facts = p.nativeSnapshot(sid); ' +
    'console.log("Direct native API snapshot: " + JSON.stringify(facts)); ' +
    '} catch (e) { console.log("Direct native API error: " + String(e.stack || e)); resultCode = 1; } process.exit(resultCode);';
fs.writeFileSync('.ci-native-probe.b64', Buffer.from(program).toString('base64'));
