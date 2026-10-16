import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { X509Certificate, createHash } from 'node:crypto';

let certSpki = process.env.TEST_CERT_SPKI;
if (process.env.TEST_CA_CERT) {
  const cert = new X509Certificate(fs.readFileSync(process.env.TEST_CA_CERT));
  certSpki = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', ...(certSpki ? [`--ignore-certificate-errors-spki-list=${certSpki}`] : [])]
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(process.env.MASSENTER_TEST_URL || 'https://localhost/');
  await page.locator('#MassEnterButton').waitFor({ state: 'visible' });

  // The plugin must remain usable even when a native modal cannot be opened.
  await page.evaluate(() => {
    window.savedSetDialogMode = setDialogMode;
    window.savedMassEnterSelection = pluginHandler.massenter.getSelectedNodeIds;
    window.savedMassEnterNode = pluginHandler.massenter.getNode;
    setDialogMode = () => { throw new Error('Plugin used shared modal'); };
    pluginHandler.massenter.getSelectedNodeIds = () => [];
  });
  await page.locator('#MassEnterButton').click();
  await page.getByText('Сначала отметьте компьютеры в разделе «My Devices».', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => !!xxdialogMode), false);
  await page.locator('#massEnterCancelButton').click();
  assert.equal(await page.locator('#massEnterConfirmation').count(), 0);

  await page.evaluate(() => {
    pluginHandler.massenter.getSelectedNodeIds = () => ['node//confirmation-test'];
    pluginHandler.massenter.getNode = () => ({ _id: 'node//confirmation-test', name: 'Offline test', conn: 0 });
  });
  await page.locator('#MassEnterButton').click();
  await page.locator('#massEnterDelay').fill('700');
  assert.equal(await page.evaluate(() => !!xxdialogMode), false);
  await page.locator('#massEnterCancelButton').click();
  assert.equal(await page.evaluate(() => pluginHandler.massenter.batch), undefined);
  assert.equal(await page.evaluate(() => pluginHandler.massenter.pendingNodeIds), null);
  await page.locator('#MassEnterButton').click();
  await page.locator('#massEnterConfirmButton').click();
  await page.waitForFunction(() => !pluginHandler.massenter.batch.running);
  assert.match(await page.locator('#massEnterProgress').innerText(), /пропущено: 1/);
  assert.equal(await page.locator('#MassEnterButton').isEnabled(), true);
  assert.equal(await page.evaluate(() => !!xxdialogMode), false);

  // Exercise the real Desktop module with a controlled transport: no keyboard
  // packet before screen initialization, two key pairs after it, then cleanup.
  const kvm = await page.evaluate(async () => {
    const originalRedirect = CreateAgentRedirect;
    const packets = [];
    let transport;
    CreateAgentRedirect = (server, m) => {
      transport = { State: 0, m,
        Start() { this.State = 3; m.parent = this; m.xxStateChange(3); this.onStateChanged(this, 3); },
        Stop() { this.State = 0; m.xxStateChange(0); this.onStateChanged(this, 0); },
        send(data) { packets.push(Array.from(data, c => c.charCodeAt(0))); }
      };
      return transport;
    };
    const before = document.querySelectorAll('canvas').length;
    try {
      const result = new Promise(resolve => pluginHandler.massenter.runOne('node//confirmation-test', 300, e => resolve(e ? e.message : null)));
      await new Promise(resolve => setTimeout(resolve, 400));
      const premature = packets.length;
      transport.m.onScreenSizeChange(transport.m, 1024, 768);
      const error = await result;
      return { premature, packets, error, cleaned: document.querySelectorAll('canvas').length === before, state: transport.State };
    } finally { CreateAgentRedirect = originalRedirect; }
  });
  assert.equal(kvm.premature, 0);
  assert.equal(kvm.error, null);
  assert.deepEqual(kvm.packets, [[0, 1, 0, 6, 0, 13], [0, 1, 0, 6, 1, 13], [0, 1, 0, 6, 0, 13], [0, 1, 0, 6, 1, 13]]);
  assert.equal(kvm.cleaned, true);
  assert.equal(kvm.state, 0);

  await page.evaluate(() => {
    setDialogMode = window.savedSetDialogMode;
    pluginHandler.massenter.getSelectedNodeIds = window.savedMassEnterSelection;
    pluginHandler.massenter.getNode = window.savedMassEnterNode;
    messagebox('Toolbar check', 'Native dialog still works');
  });
  await page.getByText('Native dialog still works', { exact: true }).waitFor({ state: 'visible' });
  await page.locator('#idx_dlgOkButton').click();
  assert.equal(await page.evaluate(() => !!xxdialogMode), false);
  assert.deepEqual(errors, []);
  console.log('PASS: empty selection, cancellation, confirmation, skip completion, native dialogs, KVM screen readiness, two Enter pairs, transport/canvas cleanup; no browser errors.');
} finally {
  await browser.close();
}
