import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { containedArtifactLink } from '../scripts/audit-links.mjs';

test('artifact links require an existing physical target inside the audited tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengeo-link-audit-'));
  try {
    const payload = join(root, 'payload'); mkdirSync(payload);
    const actual = join(payload, 'physical'); mkdirSync(actual); writeFileSync(join(actual, 'file'), 'audited bytes');
    symlinkSync('physical', join(payload, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    // Windows junctions are absolute reparse targets and intentionally need manual review.
    if (process.platform !== 'win32') assert.equal(containedArtifactLink(payload, join(payload, 'alias')).resolved, 'physical');
    symlinkSync(root, join(payload, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(containedArtifactLink(payload, join(payload, 'escape')), null);
    if (process.platform !== 'win32') {
      symlinkSync('missing', join(payload, 'broken'));
      symlinkSync('cycle', join(payload, 'cycle'));
      assert.equal(containedArtifactLink(payload, join(payload, 'broken')), null);
      assert.equal(containedArtifactLink(payload, join(payload, 'cycle')), null);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
