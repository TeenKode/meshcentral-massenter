import { chromium } from 'playwright';
import fs from 'node:fs';

function countReturns() {
  const s = fs.readFileSync('.ci-xev.log', 'utf8');
  return (s.match(/KeyPress event[\s\S]*?keysym 0xff0d, Return/g) || []).length;
}

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox']
});

const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const pageErrors = [];

page.on('pageerror', (err) => {
  pageErrors.push(String(err));
  console.error('PAGE ERROR:', err);
});
page.on('console', (msg) => console.log('BROWSER:', msg.type(), msg.text()));

try {
  await page.goto('https://localhost/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const username = page.locator('#username');
  if (await username.isVisible().catch(() => false)) {
    await username.fill('admin');
    await page.locator('#password').fill('MassEnter-Test-123!');
    await page.locator('#loginButton').click();
    await page.waitForLoadState('domcontentloaded');
  }

  await page.waitForSelector('#MassEnterButton', { timeout: 30000 });
  console.log('Mass Enter button loaded on real MeshCentral page');

  let devices = page.locator('.DeviceCheckbox');
  const count = await devices.count();
  if (count < 1) throw new Error('No MeshAgent device appeared in My Devices');

  const checkboxValue = await devices.first().getAttribute('value');
  if (!checkboxValue || !checkboxValue.startsWith('devid_')) throw new Error(`Unexpected device checkbox value: ${checkboxValue}`);
  const nodeid = checkboxValue.substring(6);

  // CONTROL TEST: use MeshCentral's own Desktop implementation against the exact
  // same real agent. If native KVM cannot deliver Return to X11, the Linux/Xvfb
  // harness itself is not a valid keyboard-injection oracle for the plugin.
  await page.evaluate((id) => {
    gotoDevice(id, 11);
    connectDesktop(null, 1);
  }, nodeid);

  await page.waitForFunction(() => (
    typeof desktop !== 'undefined' && desktop && desktop.State === 3 &&
    desktop.m && desktop.m.State === 3
  ), { timeout: 20000 });

  // The real test desktop is 1024x768. Waiting for the Desk canvas to reach that
  // size proves that KVM screen traffic, not just the relay handshake, initialized.
  await page.waitForFunction(() => {
    const c = document.getElementById('Desk');
    return c && c.width === 1024 && c.height === 768;
  }, { timeout: 20000 });
  console.log('Native MeshCentral Desktop KVM initialized at 1024x768');

  const nativeBefore = countReturns();
  await page.evaluate(() => {
    desktop.m.SendKeyMsgKC(desktop.m.KeyAction.DOWN, 13, false);
    desktop.m.SendKeyMsgKC(desktop.m.KeyAction.UP, 13, false);
  });
  await page.waitForTimeout(800);
  const nativeAfter = countReturns();
  console.log(`Native MeshCentral Return count: ${nativeBefore} -> ${nativeAfter}`);
  if (nativeAfter < nativeBefore + 1) {
    throw new Error('Native MeshCentral Desktop did not deliver Return to X11; Linux/Xvfb cannot validate Mass Enter keyboard injection');
  }

  // Return to My Devices and close the native desktop connection.
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

  const dialogMode = await page.evaluate(() => (typeof xxdialogMode === 'undefined' ? null : xxdialogMode));
  if (dialogMode) {
    throw new Error(`MeshCentral modal remained active after Mass Enter start: xxdialogMode=${dialogMode}`);
  }

  await page.waitForFunction(() => {
    const el = document.getElementById('massEnterProgress');
    return el && /Готово\./.test(el.textContent || '');
  }, { timeout: 25000 });

  const progress = await page.locator('#massEnterProgress').innerText();
  console.log('Mass Enter progress:', progress);

  await page.waitForTimeout(800);
  const pluginAfter = countReturns();
  console.log(`Mass Enter Return count: ${pluginBaseline} -> ${pluginAfter}`);
  if (pluginAfter < pluginBaseline + 2) {
    throw new Error(`Mass Enter reported completion but delivered ${pluginAfter - pluginBaseline} of 2 Return key presses`);
  }
  if (!/успешно:\s*1/.test(progress)) {
    throw new Error(`Mass Enter did not report one successful device: ${progress}`);
  }

  // Prove the normal MeshCentral toolbar is still interactive after Mass Enter.
  const groupAction = page.locator('#GroupActionButton');
  await groupAction.click({ timeout: 10000 });
  await page.waitForFunction(() => !!xxdialogMode, { timeout: 5000 });
  console.log('Standard Group Action dialog opened after Mass Enter; UI is not blocked');
  const cancel = page.locator('#idx_dlgCancelButton');
  if (await cancel.isVisible()) await cancel.click();

  if (pageErrors.length) {
    throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  }
} finally {
  await browser.close();
}
