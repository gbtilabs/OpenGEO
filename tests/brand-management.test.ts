import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/storage.js';
import { Vault } from '../server/vault.js';
import { createApp } from '../server/app.js';
import { jobInput, projectInput } from '../server/contracts.js';

test('partial brand edits preserve prompts, locale, competitors and knowledge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opengeo-brand-'));
  const store = new Store(dir);
  const vault = new Vault(dir, { encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() });
  const { app } = await createApp(store, vault, 'synthetic-brand-session');
  try {
    const project = store.createProject(projectInput.parse({ domain: 'example.com', brand: 'Example', prompts: ['Which example is best?'], competitors: ['example.org'], aliases: ['Examples'], locale: 'fr-FR', knowledge: 'Original knowledge' }));
    const result = await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}`, headers: { host: '127.0.0.1:4318', authorization: 'Bearer synthetic-brand-session' }, payload: { brand: 'New name' } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), { ...project, brand: 'New name' });
  } finally { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('deleting a brand requires confirmation and removes only its settled work and schedules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opengeo-brand-'));
  const store = new Store(dir);
  try {
    const a = store.createProject(projectInput.parse({ domain: 'example.com', brand: 'Example' }));
    const b = store.createProject(projectInput.parse({ domain: 'example.org', brand: 'Other' }));
    const job = store.enqueue(jobInput.parse({ projectId: a.id, kind: 'audit', maxCostUsd: 0 }), 'brand-audit');
    store.set('schedules', [{ id: 'a', job: { projectId: a.id } }, { id: 'b', job: { projectId: b.id } }]);
    store.set('scheduleRequest:deleted', { id: 'a', input: { job: { projectId: a.id } } });
    store.set('scheduleRequest:retained', { id: 'b', input: { job: { projectId: b.id } } });
    store.set('scheduleBudgetApprovals', { 'a:pending': 1, 'b:pending': 2 });
    assert.throws(() => store.deleteProject(a.id, 'wrong'), /exactly/);
    assert.throws(() => store.deleteProject(a.id, a.domain), /unfinished/);
    store.updateJob(job.id, { status: 'cancelled', error: 'cancel_remote' });
    assert.throws(() => store.deleteProject(a.id, a.domain), /unfinished/);
    store.updateJob(job.id, { status: 'cancelled', error: null });
    store.setStep(job.id, 'receipt', 'done', { settled: true });
    store.deleteProject(a.id, a.domain);
    assert.deepEqual(store.projects(), [b]);
    assert.deepEqual(store.jobs(), []);
    assert.equal(store.setting('scheduleRequest:deleted', null), null);
    assert.deepEqual(store.setting('scheduleRequest:retained', null), { id: 'b', input: { job: { projectId: b.id } } });
    assert.deepEqual(store.setting('scheduleBudgetApprovals', {}), { 'b:pending': 2 });
    assert.deepEqual(store.setting('schedules', []), [{ id: 'b', job: { projectId: b.id } }]);
    assert.equal((store.db.prepare('SELECT count(*) AS count FROM steps').get() as { count: number }).count, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
