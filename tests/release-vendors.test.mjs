import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('package provenance pins use the locked desktop runtime on every release target', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const vendors = JSON.parse(readFileSync(new URL('../scripts/release-vendors.json', import.meta.url), 'utf8'));
  const version = lock.packages['node_modules/electron'].version;
  const targets = { 'windows-x64': 'win32-x64', 'macos-arm64': 'darwin-arm64', 'macos-x64': 'darwin-x64' };
  assert.deepEqual(Object.keys(vendors).sort(), Object.keys(targets).sort());
  for (const [target, platform] of Object.entries(targets)) {
    const electron = vendors[target].filter(([kind]) => kind === 'electron');
    assert.equal(electron.length, 1, target);
    assert.equal(electron[0][1], `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-${platform}.zip`, target);
    assert.match(electron[0][2], /^[a-f0-9]{64}$/);
  }
});
