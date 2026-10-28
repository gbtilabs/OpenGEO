import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createUpdates } = createRequire(import.meta.url)('../desktop/updates.cjs');
const { CancellationToken } = createRequire(import.meta.url)('builder-util-runtime');
function fixture({ automatic = true, reason = null, installed = true } = {}) {
  const updater = new EventEmitter();
  let downloads = 0, installs = 0, preference = automatic;
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '0.2.0' });
  updater.downloadUpdate = async () => { downloads++; updater.emit('update-downloaded'); };
  const updates = createUpdates({ updater, installed, version: '0.1.0-beta.3', canInstall: () => reason, install: async () => { installs++; }, publish: () => {}, readPreference: () => preference, savePreference: value => { preference = value; } });
  return { updater, updates, counts: () => ({ downloads, installs, preference }) };
}
test('downloads automatically but never installs without explicit approval', async () => {
  const f = fixture();
  await f.updates.command('check');
  assert.equal(f.updates.snapshot().status, 'ready');
  assert.deepEqual(f.counts(), { downloads: 1, installs: 0, preference: true });
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false);
  await f.updates.command('install');
  assert.equal(f.counts().installs, 1);
});
test('metered preference prevents automatic downloads and persists explicit changes', async () => {
  const f = fixture({ automatic: false });
  await f.updates.command('check');
  assert.equal(f.counts().downloads, 0);
  assert.equal(f.updates.snapshot().status, 'available');
  await f.updates.command('preference', true);
  assert.equal(f.counts().preference, true);
  await f.updates.command('download');
  assert.equal(f.counts().downloads, 1);
});
test('unsaved work blocks restart without losing downloaded update', async () => {
  const f = fixture({ reason: 'Save your draft before restarting.' });
  await f.updates.command('check');
  await f.updates.command('install');
  assert.equal(f.counts().installs, 0);
  assert.equal(f.updates.snapshot().status, 'ready');
  assert.match(f.updates.snapshot().message, /Save your draft/);
});
test('development builds perform no network or download work', async () => {
  const f = fixture({ installed: false });
  await f.updates.command('check');
  assert.equal(f.updates.snapshot().status, 'unavailable');
  assert.equal(f.counts().downloads, 0);
});

test('stopping an in-flight download disables automatic downloads and allows a fresh check', async () => {
  const f = fixture({ automatic: false });
  let token;
  f.updater.checkForUpdates = async () => {
    token = new CancellationToken();
    f.updater.emit('update-available', { version: '0.2.0' });
    return { cancellationToken: token };
  };
  f.updater.downloadUpdate = async received => received.createPromise(() => {});
  await f.updates.command('check');
  const download = f.updates.command('download');
  assert.equal(f.updates.snapshot().status, 'downloading');
  await f.updates.command('cancel');
  await download;
  assert.equal(token.cancelled, true);
  assert.equal(f.updates.snapshot().status, 'idle');
  assert.equal(f.updates.snapshot().autoDownload, false);
  await f.updates.command('check');
  assert.equal(token.cancelled, false);
  assert.equal(f.updates.snapshot().status, 'available');
});

test('download errors release the command lock so a later check can succeed', async () => {
  const f = fixture();
  f.updater.downloadUpdate = async () => { throw new Error('offline'); };
  await f.updates.command('check');
  assert.equal(f.updates.snapshot().status, 'error');
  f.updater.downloadUpdate = async () => f.updater.emit('update-downloaded');
  await f.updates.command('check');
  assert.equal(f.updates.snapshot().status, 'ready');
});
