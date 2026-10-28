import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Route } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.js";
import { Store } from "../server/storage.js";
import { Vault } from "../server/vault.js";

test("setup waits for the actual privacy preference to load and save before completing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "opengeo-consent-browser-"));
  const store = new Store(directory), previousSecret = process.env.OPENGEO_SECRET_FILE;
  writeFileSync(join(directory, "test-secret"), randomBytes(32), { mode: 0o600 });
  let vault: Vault;
  try { process.env.OPENGEO_SECRET_FILE = join(directory, "test-secret"); vault = new Vault(directory); }
  finally {
    if (previousSecret === undefined) delete process.env.OPENGEO_SECRET_FILE;
    else process.env.OPENGEO_SECRET_FILE = previousSecret;
  }
  const { app } = await createApp(store, vault, undefined, resolve("dist"));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let release: (() => void) | undefined;
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address(); assert.ok(address && typeof address !== "string");
    browser = await chromium.launch({ executablePath: process.env.OPENGEO_TEST_BROWSER || undefined });
    const page = await browser.newPage();
    const origin = "http://127.0.0.1:" + address.port;
    await page.goto(origin);
    await page.getByRole("button", { name: "Continue without AI", exact: true }).click();
    await page.getByRole("textbox", { name: "Website", exact: true }).fill("example.com");
    await page.getByRole("textbox", { name: "Brand name", exact: true }).fill("Example Domain");
    let held: Route | undefined;
    let setupRequests = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/onboarding/start") setupRequests++; });
    const delayed = async (route: Route) => {
      held = route;
      await new Promise<void>(resolveWait => { release = resolveWait; });
      await route.continue();
    };
    await page.route("**/api/settings/usage-sharing", delayed);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect.poll(() => held?.request().method()).toBe("GET");
    const finish = page.getByRole("button", { name: "Check website health", exact: true });
    await expect(finish).toBeDisabled();
    release!();
    await expect(finish).toBeEnabled();
    await page.unroute("**/api/settings/usage-sharing", delayed);
    const refuseSave = (route: Route) => route.request().method() === "PUT" ? route.abort() : route.continue();
    await page.route("**/api/settings/usage-sharing", refuseSave);
    await page.getByRole("checkbox", { name: "Help improve OpenGEO by sharing usage", exact: true }).uncheck();
    await expect(page.getByRole("alert")).toHaveText("The change was not saved. Try again.");
    await expect(finish).toBeDisabled();
    assert.equal(setupRequests, 0);
    assert.equal(store.setting<any>("usageConsent", null), null);
    await page.unroute("**/api/settings/usage-sharing", refuseSave);
    held = undefined;
    await page.route("**/api/settings/usage-sharing", delayed);
    await page.getByRole("checkbox", { name: "Help improve OpenGEO by sharing usage", exact: true }).uncheck();
    await expect.poll(() => held?.request().method()).toBe("PUT");
    await expect(finish).toBeDisabled();
    assert.equal(setupRequests, 0);
    assert.equal(store.setting<any>("usageConsent", null), null);
    release!();
    await expect(finish).toBeEnabled();
    assert.deepEqual(store.setting("usageConsent", null), { enabled: false });
    await page.unroute("**/api/settings/usage-sharing", delayed);
    await finish.click();
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    assert.equal(setupRequests, 1);
    assert.deepEqual(store.setting("usageConsent", null), { enabled: false });
    assert.equal((store.db.prepare("SELECT count(*) AS n FROM usage_outbox").get() as { n: number }).n, 0);
  } finally {
    release?.(); await browser?.close(); await app.close(); store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
