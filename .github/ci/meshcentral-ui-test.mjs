import { chromium } from 'playwright';

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
  await page.waitForSelector('#MassEnterButton', { timeout: 30000 });

  console.log('Mass Enter button loaded on real MeshCentral page');

  const devices = page.locator('.DeviceCheckbox');
  const count = await devices.count();
  if (count < 1) throw new Error('No MeshAgent device appeared in My Devices');

  await devices.first().check();
  await page.locator('#MassEnterButton').click();
  await page.waitForSelector('#massEnterDelay', { timeout: 10000 });
  await page.locator('#massEnterDelay').fill('700');
  await page.locator('#massEnterConcurrency').fill('1');

  await page.locator('#idx_dlgOkButton').click();

  await page.waitForSelector('#massEnterProgressPanel', { state: 'visible', timeout: 10000 });

  const dialogMode = await page.evaluate(() => (typeof xxdialogMode === 'undefined' ? null : xxdialogMode));
  if (dialogMode !== 0) {
    throw new Error(`MeshCentral modal remained active after Mass Enter start: xxdialogMode=${dialogMode}`);
  }

  await page.waitForFunction(() => {
    const el = document.getElementById('massEnterProgress');
    return el && /Готово\./.test(el.textContent || '');
  }, { timeout: 20000 });

  const progress = await page.locator('#massEnterProgress').innerText();
  console.log('Mass Enter progress:', progress);
  if (!/успешно:\s*1/.test(progress)) {
    throw new Error(`Mass Enter did not report one successful device: ${progress}`);
  }

  // Prove the normal MeshCentral toolbar is still interactive after Mass Enter.
  const groupAction = page.locator('#GroupActionButton');
  await groupAction.click({ timeout: 10000 });
  await page.waitForFunction(() => typeof xxdialogMode !== 'undefined' && xxdialogMode !== 0, { timeout: 5000 });
  console.log('Standard Group Action dialog opened after Mass Enter; UI is not blocked');
  const cancel = page.locator('#idx_dlgCancelButton');
  if (await cancel.isVisible()) await cancel.click();

  if (pageErrors.length) {
    throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  }
} finally {
  await browser.close();
}
