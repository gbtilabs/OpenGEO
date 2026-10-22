import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('upgrade verification refuses to seed an existing profile before launching any application', () => {
  const directory = mkdtempSync(join(tmpdir(), 'opengeo-profile-safety-'));
  try {
    const marker = join(directory, 'existing-data'); writeFileSync(marker, 'keep existing workspace');
    const result = spawnSync(process.execPath, ['scripts/desktop-smoke.mjs', 'must-not-launch', '--profile', directory, '--phase', 'seed', '--receipt', join(directory, 'must-not-write.json')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Upgrade seeding requires an empty, regular test directory/);
    assert.equal(readFileSync(marker, 'utf8'), 'keep existing workspace');
    assert.deepEqual(readdirSync(directory), ['existing-data']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
