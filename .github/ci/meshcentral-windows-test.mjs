import { chromium } from 'playwright';
import fs from 'node:fs';

const baseUrl = process.env.MESHCENTRAL_URL || 'https://localhost:4443/';
const keyLog = process.env.KEY_SINK_LOG;
if (!keyLog) throw new Error('KEY_SINK_LOG is required');

function countReturns() {
  if (!fs.existsSync(keyLog)) return 0;
  const s = fs.readFileSync(keyLog, 'utf8');
  return (s.match(/^RETURN$/gm) || []).length;
}

async function waitForReturnCount(minimum, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const n = countReturns();
    if (n >= minimum) return n;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return countReturns();
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const pageErrors = [];

page.on('pageerror', (err) => {
  pageErrors.push(String(err));
  console.error('PAGE ERROR:', err);
});
page.on('console', (msg) => console.log('BROWSER:', msg.type(), msg.text()));

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const username = page.locator('#username');
  if (await username.isVisible().catch(() => false)) {
    await username.fill('admin');
    await page.locator('#password').fill('MassEnter-Test-123!');
    await page.locator('#loginButton').click();
    await page.waitForLoadState('domcontentloaded');
  }

  await page.waitForSelector('#MassEnterButton', { timeout: 30000 });
  console.log('Mass Enter button loaded on real Windows MeshCentral test page');

  let devices = page.locator('.DeviceCheckbox');
  if (await devices.count() < 1) throw new Error('No Windows MeshAgent device appeared in My Devices');

  const checkboxValue = await devices.first().getAttribute('value');
  if (!checkboxValue || !checkboxValue.startsWith('devid_')) throw new Error(`Unexpected device checkbox value: ${checkboxValue}`);
  const nodeid = checkboxValue.substring(6);

  // Exercise the real module delivered inside the MeshAgent core. The hosted
  // runner has an interactive, unlocked console for the keyboard sink below.
  const sessionProbe = await page.evaluate(id => new Promise((resolve, reject) => {
    const me = pluginHandler.massenter;
    const requestId = 'ci-native-console-probe';
    if (!me.sessionProbeRequests) me.sessionProbeRequests = {};
    me.sessionProbeRequests[requestId] = {
      timer: setTimeout(() => reject(new Error('Native probe response timed out')), 15000),
      finish: resolve
    };
    meshserver.send({ action: 'plugin', plugin: 'massenter', operation: 'checkSession', nodeid: id, requestId });
  }), nodeid);
  console.log('Real Windows console probe:', JSON.stringify(sessionProbe));
  if (sessionProbe.state !== 'unlocked') {
    throw new Error('Expected unlocked interactive console; probe returned ' + JSON.stringify(sessionProbe));
  }

  // Native MeshCentral Desktop control test. This proves the Windows runner,
  // MeshAgent service and keyboard event sink are a valid KVM input path.
  await page.evaluate((id) => {
    gotoDevice(id, 11);
    window.__nativeScreenReady = false;
    connectDesktop(null, 1);
    if (!desktop || !desktop.m) throw new Error('Native desktop object was not created');
    const original = desktop.m.onScreenSizeChange;
    desktop.m.onScreenSizeChange = function () {
      window.__nativeScreenReady = true;
      if (typeof original === 'function') return original.apply(this, arguments);
    };
  }, nodeid);

  await page.waitForFunction(() => (
    window.__nativeScreenReady === true &&
    typeof desktop !== 'undefined' && desktop && desktop.State === 3 &&
    desktop.m && desktop.m.State === 3
  ), { timeout: 30000 });
  console.log('Native MeshCentral Desktop initialized on Windows');

  const nativeBefore = countReturns();
  await page.evaluate(() => {
    desktop.m.SendKeyMsgKC(desktop.m.KeyAction.DOWN, 13, false);
    desktop.m.SendKeyMsgKC(desktop.m.KeyAction.UP, 13, false);
  });
  const nativeAfter = await waitForReturnCount(nativeBefore + 1, 10000);
  console.log(`Native Windows Return count: ${nativeBefore} -> ${nativeAfter}`);
  if (nativeAfter < nativeBefore + 1) {
    throw new Error('Native MeshCentral Desktop did not deliver Return to the Windows key sink');
  }

  await page.evaluate(() => {
    try { if (desktop) desktop.Stop(); } catch (e) {}
    desktop = null;
    go(1);
  });
  await page.waitForSelector('#MassEnterButton', { timeout: 10000 });

  devices = page.locator('.DeviceCheckbox');
  await devices.first().check();
  const pluginBaseline = countReturns();

  await page.locator('#MassEnterButton').click();
  await page.waitForSelector('#massEnterDelay', { timeout: 10000 });
  await page.locator('#massEnterDelay').fill('700');
  await page.locator('#massEnterConcurrency').fill('1');
  await page.locator('#massEnterConfirmButton').click();

  await page.waitForSelector('#massEnterProgressPanel', { state: 'visible', timeout: 10000 });
  await page.waitForSelector('#dialog', { state: 'hidden', timeout: 5000 });
  console.log('MeshCentral modal is closed while Mass Enter runs');

  await page.waitForFunction(() => {
    const el = document.getElementById('massEnterProgress');
    return el && /Готово\./.test(el.textContent || '');
  }, { timeout: 30000 });

  const progress = await page.locator('#massEnterProgress').innerText();
  console.log('Mass Enter progress:', progress);
  const pluginAfter = await waitForReturnCount(pluginBaseline + 2, 10000);
  console.log(`Mass Enter Windows Return count: ${pluginBaseline} -> ${pluginAfter}`);

  if (pluginAfter < pluginBaseline + 2) {
    throw new Error(`Mass Enter delivered ${pluginAfter - pluginBaseline} of 2 Return key presses on Windows`);
  }
  if (!/успешно:\s*1/.test(progress)) throw new Error(`Mass Enter did not report success: ${progress}`);

  const groupAction = page.locator('#GroupActionButton');
  await groupAction.click({ timeout: 10000 });
  await page.waitForSelector('#dialog', { state: 'visible', timeout: 5000 });
  console.log('Group Action remains interactive after Mass Enter on Windows');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
} finally {
  await browser.close();
}
