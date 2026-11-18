import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/storage.js';
import { Vault } from '../server/vault.js';
import { createApp } from '../server/app.js';
import { comparisonKey } from '../server/analysis.js';
import { jobInput, projectInput, type Observation } from '../server/contracts.js';
import { reportMarkdown } from '../server/export.js';

// The engine lens: one brand checked by several engines. Synthetic example.com data; nothing leaves the process.
const session = 'synthetic-engine-session';
const headers = { host: '127.0.0.1:4318', authorization: 'Bearer ' + session };
const prompts = ['Which example tools publish reports?', 'Which example dashboards are free?'];

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'opengeo-engines-')), store = new Store(dir);
  const vault = new Vault(dir, { encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() });
  const { app } = await createApp(store, vault, session);
  const topicId = randomUUID();
  const project = store.createProject(projectInput.parse({ domain: 'example.com', brand: 'Example', prompts,
    topics: [{ id: topicId, name: 'Reports', prompts: [prompts[0]], createdAt: '2026-11-01T00:00:00.000Z' }] }));
  /** A completed check from one engine, with a real comparison key so trends and comparisons behave as in use. */
  const seed = (provider: string, platform: string, at: string, mentioned: number, options: { topicId?: string; cites?: string[] } = {}) => {
    const asked = options.topicId ? [prompts[0]] : prompts;
    const job = store.enqueue(jobInput.parse({ projectId: project.id, kind: 'measure', provider, platform, maxCostUsd: provider === 'chatgpt' ? 0 : 1,
      ...(options.topicId ? { topicId: options.topicId } : {}) }), randomUUID());
    const observations = asked.map((prompt, index): Observation => ({ id: randomUUID(), projectId: project.id, jobId: job.id, prompt, provider: provider as Observation['provider'],
      platform: job.platform, model: 'synthetic-' + provider, locale: 'en-US', observedAt: at, answer: 'Example answer.', surface: 'api',
      citations: (options.cites ?? []).map(url => ({ url })), mentioned: index < mentioned, cited: index < mentioned, costUsd: 0 }));
    for (const observation of observations) store.put('observation', project.id, job.id, observation);
    const count = observations.filter(answer => answer.mentioned).length;
    store.updateJob(job.id, { status: 'completed', requestedAnswers: asked.length, result: {
      metrics: { requested: asked.length, completed: asked.length, missing: 0, mentionRate: 100 * count / asked.length, citationRate: 100 * count / asked.length,
        citations: observations.reduce((total, answer) => total + answer.citations.length, 0) },
      comparisonKey: comparisonKey({ ...project, prompts: asked }, store.job(job.id), observations), collectionCompletedAt: at } });
    return store.job(job.id);
  };
  const read = async (url: string) => {
    const response = await app.inject({ url, headers });
    return { status: response.statusCode, body: response.json() };
  };
  return { dir, store, app, project, topicId, seed, read, async close() { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

/** ChatGPT checked twice, DeepSeek once (newest), and Grok through SurfacedBy only for the Reports topic. */
async function seeded() {
  const f = await fixture();
  const older = f.seed('chatgpt', 'chat_gpt', '2026-11-09T15:40:00.000Z', 1);
  const grok = f.seed('console', 'grok', '2026-11-12T15:40:00.000Z', 1, { topicId: f.topicId });
  const latest = f.seed('chatgpt', 'chat_gpt', '2026-11-16T15:40:00.000Z', 2, { cites: ['https://example.com/reports', 'https://example.org/compare'] });
  const deepseek = f.seed('deepseek', 'deepseek', '2026-11-20T15:40:00.000Z', 0, { cites: ['https://example.org/compare'] });
  return { ...f, older, grok, latest, deepseek };
}

test('the workspace lists each engine on its own, newest first, and never adds engines together', async () => {
  const f = await seeded();
  try {
    const { status, body } = await f.read(`/api/projects/${f.project.id}/workspace`);
    assert.equal(status, 200);
    assert.equal(body.measurement.id, f.deepseek.id, 'the default brand view is unchanged: the newest check');
    assert.equal(body.engineChoice, null);
    assert.deepEqual(body.engines.map((engine: any) => engine.key), ['deepseek:deepseek', 'chatgpt:chat_gpt', 'console:grok']);
    for (const engine of body.engines)
      assert.deepEqual(Object.keys(engine).sort(), ['key', 'latest', 'nextRunAt', 'platform', 'preparesRecommendations', 'provider', 'topicCheck']);
    const [deepseek, chatgpt, grok] = body.engines;
    assert.deepEqual([chatgpt.latest.jobId, chatgpt.latest.mentioned, chatgpt.latest.completed, chatgpt.preparesRecommendations], [f.latest.id, 2, 2, true]);
    assert.deepEqual(chatgpt.latest.topCited.map((row: any) => row.domain), ['example.com', 'example.org']);
    assert.deepEqual([deepseek.latest.jobId, deepseek.latest.mentioned, deepseek.preparesRecommendations, deepseek.topicCheck], [f.deepseek.id, 0, false, null]);
    assert.equal(grok.latest, null, 'an engine with only topic checks has no brand reading');
    assert.deepEqual([grok.topicCheck.jobId, grok.topicCheck.topic, grok.topicCheck.mentioned], [f.grok.id, 'Reports', 1]);
    assert.match(reportMarkdown(f.store, f.project.id), /Engine: DeepSeek\n\nChecked: 2026-11-20/, 'the report names the engine and date it uses');
  } finally { await f.close(); }
});

test("an engine view holds only that engine's answers, trend and comparison", async () => {
  const f = await seeded();
  try {
    const gpt = await f.read(`/api/projects/${f.project.id}/engines/chatgpt:chat_gpt`);
    assert.equal(gpt.status, 200);
    assert.equal(gpt.body.measurement.id, f.latest.id);
    assert.ok(gpt.body.observations.length === 2 && gpt.body.observations.every((answer: any) => answer.provider === 'chatgpt'));
    assert.deepEqual(gpt.body.metrics.mentionRate, 100);
    assert.deepEqual(gpt.body.presentation.history.filter((point: any) => !point.topic).map((point: any) => point.jobId), [f.older.id, f.latest.id]);
    assert.ok(gpt.body.presentation.history.every((point: any) => point.jobId !== f.grok.id), "another engine's topic check never enters this trend");
    assert.deepEqual([gpt.body.comparison.status, gpt.body.comparison.previousJobId], ['comparable', f.older.id]);
    const deepseek = await f.read(`/api/projects/${f.project.id}/engines/deepseek:deepseek`);
    assert.equal(deepseek.body.measurement.id, f.deepseek.id);
    assert.deepEqual(deepseek.body.presentation.history.map((point: any) => point.jobId), [f.deepseek.id]);
    assert.notEqual(deepseek.body.comparison.status, 'comparable', 'a single DeepSeek check has nothing of its own to compare with');
    const unchecked = await f.read(`/api/projects/${f.project.id}/engines/dataforseo:gemini`);
    assert.deepEqual([unchecked.status, unchecked.body.measurement, unchecked.body.observations], [200, null, []]);
    assert.ok((await f.read(`/api/projects/${f.project.id}/engines/Not-An-Engine`)).status >= 400);
  } finally { await f.close(); }
});

test('a topic view can be kept to one engine', async () => {
  const f = await seeded();
  try {
    const url = `/api/projects/${f.project.id}/topics/${f.topicId}`;
    assert.equal((await f.read(url)).body.measurement.id, f.deepseek.id, 'without an engine the topic reads its newest covering check, as before');
    const gpt = await f.read(url + '?engine=chatgpt:chat_gpt');
    assert.equal(gpt.body.measurement.id, f.latest.id);
    assert.ok(gpt.body.checks.every((check: any) => check.provider === 'chatgpt'));
    assert.equal((await f.read(url + '?engine=console:grok')).body.measurement.id, f.grok.id);
    assert.ok((await f.read(url + '?engine=chatgpt:chat_gpt&extra=1')).status >= 400);
  } finally { await f.close(); }
});

test('the engine choice is remembered per website, refused when malformed and removed with the website', async () => {
  const f = await seeded();
  try {
    const before = await f.read(`/api/projects/${f.project.id}/workspace`);
    const save = (engine: unknown, project = f.project.id) => f.app.inject({ method: 'PUT', url: `/api/projects/${project}/engine-choice`, headers, payload: { engine } });
    assert.deepEqual((await save('deepseek:deepseek')).json(), { engine: 'deepseek:deepseek' });
    const after = await f.read(`/api/projects/${f.project.id}/workspace`);
    assert.equal(after.body.engineChoice, 'deepseek:deepseek');
    assert.deepEqual([after.body.measurement.id, after.body.findings], [before.body.measurement.id, before.body.findings], 'the choice changes no evidence or advice');
    const other = f.store.createProject(projectInput.parse({ domain: 'example.org', brand: 'Other', prompts }));
    assert.equal((await f.read(`/api/projects/${other.id}/workspace`)).body.engineChoice, null);
    assert.equal((await save('everything')).statusCode >= 400, true);
    assert.equal((await save('all')).json().engine, 'all');
    f.store.deleteProject(f.project.id, 'example.com');
    assert.equal(f.store.setting('engineChoice:' + f.project.id, null), null);
  } finally { await f.close(); }
});
