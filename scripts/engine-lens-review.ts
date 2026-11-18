import { navigate } from "./ui-navigation.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { start } from "../server/main.js";
import { comparisonKey } from "../server/analysis.js";
import { jobInput, projectInput, type Observation } from "../server/contracts.js";

// The engine lens in a real browser: All engines on the Overview, one engine picked, a topic and an engine together,
// the strip on pages that need one engine, the remembered choice, and phone widths. Synthetic example.com data;
// nothing leaves the process.
const directory = mkdtempSync(join(tmpdir(), "opengeo-engine-lens-ui-"));
const output = join(process.env.LOCALAPPDATA ?? tmpdir(), "OpenGEO", "engine-lens-review");
mkdirSync(output, { recursive: true });
const runtime = await start({ directory, port: 0, protector: { encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() } });
const original = globalThis.fetch;
globalThis.fetch = (async (url: string | URL) => { throw new Error("No network in this review: " + new URL(String(url)).hostname); }) as typeof fetch;
const browser = await chromium.launch({ ...(process.env.OPENGEO_TEST_BROWSER ? { executablePath: process.env.OPENGEO_TEST_BROWSER } : { channel: "chrome" }), headless: true });
const shots: string[] = [];
async function check(page: Page, name: string, width: number) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflows at ${width}px`);
  const file = join(output, `${name}-${width}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  shots.push(file);
}
const widths = [1360, 760, 390];
const lensLabel = (width: number) => width > 900 ? "Engine" : "Mobile engine";
async function pick(page: Page, width: number, option: RegExp) {
  await page.getByRole("button", { name: lensLabel(width), exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}
try {
  await runtime.runner.stop(); runtime.scheduler.stop();
  const prompts = Array.from({ length: 12 }, (_, i) => `Synthetic review question ${i + 1}: which example tools publish reports?`);
  const topicId = randomUUID();
  const project = runtime.store.createProject(projectInput.parse({ domain: "example.com", brand: "Example Brand", prompts,
    topics: [{ id: topicId, name: "Reports", prompts: prompts.slice(0, 3), createdAt: "2026-11-01T00:00:00.000Z" }] }));
  runtime.store.set("onboarding", { completed: true });
  const seed = (provider: string, platform: string, at: string, mentioned: number, topic = false) => {
    const asked = topic ? prompts.slice(0, 3) : prompts;
    const job = runtime.store.enqueue(jobInput.parse({ projectId: project.id, kind: "measure", provider, platform, maxCostUsd: provider === "chatgpt" ? 0 : 1, ...(topic ? { topicId } : {}) }), randomUUID());
    const observations = asked.map((prompt, i): Observation => ({ id: randomUUID(), projectId: project.id, jobId: job.id, prompt, provider: provider as Observation["provider"],
      platform: job.platform, model: "synthetic-" + provider, locale: "en-US", observedAt: at, surface: "api",
      answer: i < mentioned ? "Example Brand publishes reports at https://example.com/reports." : "Several example tools publish reports.",
      citations: i < mentioned ? [{ url: "https://example.com/reports" }] : [{ url: "https://example.org/compare" }], mentioned: i < mentioned, cited: i < mentioned, costUsd: 0 }));
    for (const observation of observations) runtime.store.put("observation", project.id, job.id, observation);
    const count = Math.min(mentioned, asked.length);
    runtime.store.updateJob(job.id, { status: "completed", requestedAnswers: asked.length, result: {
      metrics: { requested: asked.length, completed: asked.length, missing: 0, mentionRate: 100 * count / asked.length, citationRate: 100 * count / asked.length, citations: asked.length },
      comparisonKey: comparisonKey({ ...project, prompts: asked }, runtime.store.job(job.id), observations), collectionCompletedAt: at } });
  };
  seed("chatgpt", "chat_gpt", "2026-11-09T15:40:00.000Z", 1);
  seed("console", "grok", "2026-11-12T15:40:00.000Z", 2, true);
  seed("chatgpt", "chat_gpt", "2026-11-16T15:40:00.000Z", 3);
  seed("deepseek", "deepseek", "2026-11-20T15:40:00.000Z", 5);

  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  const failures: string[] = []; page.on("pageerror", error => failures.push(error.message));
  const base = "http://127.0.0.1:" + (runtime.app.server.address() as any).port;
  await page.goto(base);
  await page.locator(".topbar").waitFor();

  // First visit: All engines, side by side, with no single check's scope bar.
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 780 : 900 });
    await navigate(page, "Overview");
    await page.getByText("Each engine's latest check, side by side.", { exact: false }).waitFor();
    assert.deepEqual(await page.locator(".engine-card h2").allTextContents(), ["DeepSeek", "ChatGPT", "Grok through SurfacedBy"]);
    assert.equal(await page.getByLabel("Current measurement scope").count(), 0, "All engines shows no single check");
    assert.equal(await page.getByText("Topic checks only", { exact: true }).count() >= 1, true);
    await check(page, "overview-all-engines", width);
  }

  // The list groups the checked engines and offers another check.
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.getByRole("button", { name: "Engine", exact: true }).click();
  await page.locator(".choice-group", { hasText: "Checked" }).waitFor();
  assert.ok(await page.getByRole("option", { name: /^Check another engine/ }).isVisible());
  // Headless Chrome shows every Select popup (the website select too) at the corner until the first resize or
  // scroll places it; a resize lets the screenshot show the list where people see it.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await check(page, "engine-list-open", 1360);
  await page.getByRole("option", { name: /^DeepSeek/ }).click();

  // DeepSeek picked: its own check, labelled once, on every width.
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 780 : 900 });
    await navigate(page, "Overview");
    const scope = page.getByLabel("Current measurement scope").first();
    await scope.waitFor();
    assert.equal(await scope.getByText("DeepSeek", { exact: true }).count(), 1);
    await page.getByText("41.7%", { exact: true }).first().waitFor();
    await check(page, "overview-deepseek", width);
  }

  // ChatGPT picked on Visibility: its own trend, and the check history names each engine.
  await page.setViewportSize({ width: 1360, height: 900 });
  await navigate(page, "Visibility");
  await pick(page, 1360, /^ChatGPT/);
  await page.getByLabel("Current measurement scope").first().getByText("ChatGPT", { exact: true }).waitFor();
  await page.locator(".check-engine", { hasText: "DeepSeek" }).first().waitFor();
  await check(page, "visibility-chatgpt", 1360);

  // A topic and an engine together read that engine's answers to that topic's questions.
  const topicRead = page.waitForResponse(response => response.url().includes("/topics/" + topicId + "?engine=chatgpt%3Achat_gpt"));
  await page.getByRole("button", { name: "Topic", exact: true }).click();
  await page.getByRole("option", { name: /^Reports/ }).click();
  assert.equal((await topicRead).status(), 200);
  await check(page, "visibility-topic-and-engine", 1360);

  // The choice is remembered for this website across a reload.
  await page.reload(); await page.locator(".topbar").waitFor();
  await navigate(page, "Overview");
  await page.getByLabel("Current measurement scope").first().getByText("ChatGPT", { exact: true }).waitFor();

  // All engines on a page that needs one engine shows the strip and asks for one.
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 780 : 900 });
    await navigate(page, "Responses");
    await pick(page, width, /^All engines/);
    await page.getByText("Pick an engine to see its answers.", { exact: true }).waitFor();
    await check(page, "responses-all-engines", width);
  }

  // Check another engine opens the visibility check.
  await page.setViewportSize({ width: 1360, height: 900 });
  await pick(page, 1360, /^Check another engine/);
  // With no connection in this review the check dialog asks for one first; either way the check is one step away.
  await page.getByRole("dialog", { name: /Measure AI visibility|Connect a provider/ }).waitFor();
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ output, screenshots: shots.length, rendererErrors: failures.length }));
} finally {
  globalThis.fetch = original; await browser.close(); await runtime.app.close(); rmSync(directory, { recursive: true, force: true });
}
