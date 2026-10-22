import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/app.js";
import { Store } from "../server/storage.js";
import { Vault } from "../server/vault.js";
import { remoteConfig } from "../server/remote-access.js";
import { api, RequestError } from "../src/api.js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const origin = "https://opengeo.example.test", host = new URL(origin).host;
function hidden(html: string) { return /name="csrf" value="([^"]+)"/.exec(html)![1]; }
function cookie(response: { headers: Record<string, unknown> }) { return String(response.headers["set-cookie"]).split(";")[0]; }
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "opengeo-remote-test-"));
  const key = randomBytes(32).toString("hex"), keyFile = join(directory, "remote-key"), assets = join(directory, "assets");
  writeFileSync(keyFile, key); mkdirSync(assets); writeFileSync(join(assets, "index.html"), "<h1>Synthetic private workspace</h1>");
  const store = new Store(directory), vault = new Vault(directory, { encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() });
  const localToken = randomBytes(32).toString("hex");
  const runtime = await createApp(store, vault, localToken, assets, undefined, { origin, keyFile });
  const request = (url: string, extra: any = {}) => runtime.app.inject({ url, ...extra, headers: { host, ...extra.headers } });
  async function login() {
    const page = await request("/login");
    const response = await request("/login", { method: "POST", headers: { origin, cookie: cookie(page) }, payload: { key, csrf: hidden(page.body) } });
    assert.equal(response.statusCode, 303); assert.equal(response.headers.location, "/");
    return { response, cookie: cookie(response) };
  }
  return { ...runtime, key, keyFile, directory, store, vault, localToken, request, login,
    async close() { await runtime.app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("remote configuration fails closed for partial settings, unsafe origins and invalid secret files", () => {
  const directory = mkdtempSync(join(tmpdir(), "opengeo-remote-config-")), file = join(directory, "key");
  writeFileSync(file, randomBytes(32).toString("hex"));
  try {
    assert.equal(remoteConfig({}), undefined);
    for (const env of [{ OPENGEO_REMOTE_ORIGIN: origin }, { OPENGEO_REMOTE_KEY_FILE: file }]) assert.throws(() => remoteConfig(env));
    for (const value of ["http://opengeo.example.test", origin + "/", origin + "/app", origin + "?key=unsafe", "https://user:pass@opengeo.example.test", "https://127.0.0.1", "https://localhost", "https://[::1]", "https://*.example.test"]) {
      assert.throws(() => remoteConfig({ OPENGEO_REMOTE_ORIGIN: value, OPENGEO_REMOTE_KEY_FILE: file }), value);
    }
    assert.equal(remoteConfig({ OPENGEO_REMOTE_ORIGIN: origin, OPENGEO_REMOTE_KEY_FILE: file })?.origin, origin);
    writeFileSync(file, "short"); assert.throws(() => remoteConfig({ OPENGEO_REMOTE_ORIGIN: origin, OPENGEO_REMOTE_KEY_FILE: file }));
    writeFileSync(file, "x".repeat(10000)); assert.throws(() => remoteConfig({ OPENGEO_REMOTE_ORIGIN: origin, OPENGEO_REMOTE_KEY_FILE: file }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("remote mode protects bootstrap, private assets, APIs and mutations even on the loopback Host", async () => {
  const f = await fixture();
  try {
    for (const url of ["/api/session", "/api/session?renew=1", "/api/backup", "/api/providers", "/api/projects", "/logo.svg", "/"]) {
      const response = await f.request(url); assert.equal(response.statusCode, 401, url);
      assert.equal(response.headers["set-cookie"], undefined); assert.ok(!response.body.includes("Synthetic private"));
    }
    assert.equal((await f.request("/api/projects", { method: "POST", headers: { origin }, payload: { domain: "example.com", brand: "Example" } })).statusCode, 401);
    assert.equal(f.store.projects().length, 0);
    assert.equal((await f.request("/", { headers: { accept: "text/html" } })).headers.location, "/login");
    for (const url of ["/api/session", "/api/backup", "/login"]) assert.equal((await f.request(url, { headers: { host: "127.0.0.1" } })).statusCode, 401);
    assert.equal((await f.request("/healthz", { headers: { host: "127.0.0.1" } })).statusCode, 200);
    const local = await f.request("/api/session", { headers: { host: "127.0.0.1", authorization: "Bearer " + f.localToken } });
    assert.equal(local.statusCode, 200); assert.equal(local.headers["set-cookie"], undefined);
    assert.ok(!local.body.includes(f.localToken));
    assert.equal((await f.request("/api/projects", { headers: { authorization: "Bearer " + f.localToken } })).statusCode, 401);
  } finally { await f.close(); }
});

test("browser login issues a separate secure session; logout revokes copied cookies and requires CSRF", async () => {
  const f = await fixture();
  try {
    const session = await f.login();
    assert.match(session.cookie, /^__Host-opengeo_remote_/);
    assert.match(String(session.response.headers["set-cookie"]), /Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200/);
    assert.ok(!session.cookie.includes(f.key)); assert.ok(!session.cookie.includes(f.localToken));
    const options = { headers: { cookie: session.cookie } };
    assert.equal((await f.request("/", options)).body, "<h1>Synthetic private workspace</h1>");
    const bootstrap = await f.request("/api/session", options); assert.equal(bootstrap.statusCode, 200); assert.equal(bootstrap.headers["set-cookie"], undefined);
    assert.equal((await f.request("/api/projects", options)).statusCode, 200);
    const page = await f.request("/logout", options); assert.equal(page.statusCode, 200);
    assert.equal((await f.request("/logout", { method: "POST", headers: { ...options.headers, origin }, payload: { csrf: "wrong" } })).statusCode, 403);
    const logout = await f.request("/logout", { method: "POST", headers: { ...options.headers, origin }, payload: { csrf: hidden(page.body) } });
    assert.equal(logout.statusCode, 303); assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
    assert.equal((await f.request("/api/projects", options)).statusCode, 401);
    assert.equal(f.store.jobs().length, 0);
  } finally { await f.close(); }
});

test("unknown hosts, forged proxy headers, cross-origin forms and login CSRF cannot grant access", async () => {
  const f = await fixture();
  try {
    const page = await f.request("/login"), form = { key: f.key, csrf: hidden(page.body) }, cookies = cookie(page);
    for (const headers of [
      { host: "evil.example.test", "x-forwarded-host": host, "x-forwarded-proto": "https" },
      { host: "evil.example.test", "tailscale-user-login": "owner@example.test" },
      { host: "evil.example.test", forwarded: `host=${host};proto=https` },
      { host: "opengeo.example.test.evil.test" }, { host: "user@" + host },
    ]) assert.equal((await f.request("/login", { headers })).statusCode, 403);
    for (const suppliedOrigin of ["https://evil.example.test", "null", origin + ".evil.test", "http://" + host, ""]) {
      assert.equal((await f.request("/login", { method: "POST", headers: { origin: suppliedOrigin, cookie: cookies }, payload: form })).statusCode, 403);
    }
    assert.equal((await f.request("/login", { method: "POST", headers: { origin }, payload: form })).statusCode, 403);
    assert.equal((await f.request("/login", { method: "POST", headers: { origin, cookie: cookies }, payload: { ...form, csrf: "forged" } })).statusCode, 403);
    assert.equal((await f.request("/api/session", { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } })).statusCode, 403);
    const session = await f.login();
    assert.equal((await f.request("/api/projects", { headers: { cookie: session.cookie, "sec-fetch-site": "cross-site" } })).statusCode, 403);
    assert.equal((await f.request("/api/projects", { method: "POST", headers: { cookie: session.cookie }, payload: { brand: "Example", domain: "example.com" } })).statusCode, 403);
    assert.equal((await f.request("/api/projects", { method: "POST", headers: { cookie: session.cookie, origin }, payload: { brand: "Example", domain: "example.com" } })).statusCode, 200);
  } finally { await f.close(); }
});

test("rotation, key removal, expiry and a server restart invalidate browser sessions", async () => {
  const f = await fixture(), originalNow = Date.now;
  try {
    const session = await f.login();
    Date.now = () => originalNow() + 43200001;
    assert.equal((await f.request("/api/projects", { headers: { cookie: session.cookie } })).statusCode, 401);
    Date.now = originalNow;
    const second = await f.login();
    writeFileSync(f.keyFile, randomBytes(32).toString("hex"));
    assert.equal((await f.request("/api/projects", { headers: { cookie: second.cookie } })).statusCode, 401);
    writeFileSync(f.keyFile, f.key);
    const third = await f.login();
    rmSync(f.keyFile);
    assert.equal((await f.request("/api/projects", { headers: { cookie: third.cookie } })).statusCode, 503);
    writeFileSync(f.keyFile, f.key);
    const other = await createApp(f.store, new Vault(f.directory, { encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() }), f.localToken, join(f.directory, "assets"), undefined, { origin, keyFile: f.keyFile });
    try { assert.equal((await other.app.inject({ url: "/api/projects", headers: { host, cookie: third.cookie } })).statusCode, 401); }
    finally { await other.app.close(); }
  } finally { Date.now = originalNow; await f.close(); }
});

test("login rate bound cannot be bypassed with spoofed IPs and invalid submissions do not echo keys", async () => {
  const f = await fixture();
  try {
    const page = await f.request("/login"), csrf = hidden(page.body), cookies = cookie(page), wrong = randomBytes(32).toString("hex");
    for (let i = 0; i < 10; i++) {
      const denied = await f.request("/login", { method: "POST", headers: { origin, cookie: cookies, "x-forwarded-for": `192.0.2.${i}` }, payload: { key: wrong, csrf } });
      assert.equal(denied.statusCode, 401); assert.ok(!denied.body.includes(wrong));
    }
    const throttled = await f.request("/login", { method: "POST", headers: { origin, cookie: cookies }, payload: { key: f.key, csrf } });
    assert.equal(throttled.statusCode, 429); assert.ok(Number(throttled.headers["retry-after"]) > 0);
  } finally { await f.close(); }
});

test("expired remote authorization preserves the browser's explicit retry flow instead of bootstrapping access", async () => {
  const f = await fixture(), originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input, options) => {
    requests++;
    const response = await f.request(String(input), { method: options?.method ?? "GET", headers: options?.headers, payload: options?.body });
    return new Response(response.body, { status: response.statusCode, headers: { "Content-Type": "application/json" } });
  };
  try {
    await assert.rejects(api("/projects"), (error: unknown) => error instanceof RequestError && error.message.includes("Open /login in another tab"));
    assert.equal(requests, 2); assert.equal(f.store.projects().length, 0);
  } finally { globalThis.fetch = originalFetch; await f.close(); }
});

test("remote connections use manual provider completion while keeping ChatGPT's exact loopback redirect", async () => {
  const f = await fixture();
  try {
    const session = await f.login(), headers = { cookie: session.cookie, origin };
    const router = await f.request("/api/connections/openrouter/start", { method: "POST", headers, payload: {} });
    assert.equal(router.statusCode, 200); assert.equal(router.json().headless, true);
    assert.equal(new URL(router.json().url).searchParams.has("callback_url"), false);
    const chat = await f.request("/api/connections/chatgpt/start", { method: "POST", headers, payload: {} });
    assert.equal(chat.statusCode, 200); assert.equal(chat.json().manualCallback, true);
    const callback = new URL(new URL(chat.json().url).searchParams.get("redirect_uri")!);
    assert.equal(callback.hostname, "127.0.0.1"); assert.equal(callback.protocol, "http:");
    callback.searchParams.set("state", chat.json().state); callback.searchParams.set("error", "access_denied");
    const forged = new URL(callback); forged.hostname = "evil.example.test";
    assert.equal((await f.request("/api/connections/chatgpt/finish", { method: "POST", headers, payload: { state: chat.json().state, callback: forged.href } })).statusCode, 400);
    assert.equal((await f.request("/api/connections/chatgpt/status?state=" + chat.json().state, { headers })).json().status, "pending");
    assert.equal((await f.request("/api/connections/chatgpt/finish", { method: "POST", headers, payload: { state: chat.json().state, callback: callback.href } })).statusCode, 400);
    assert.equal((await f.request("/api/connections/chatgpt/status?state=" + chat.json().state, { headers })).json().status, "failed");
    assert.equal(f.store.jobs().length, 0); assert.equal(f.vault.status().chatgpt, false);
  } finally { await f.close(); }
});

test("a pasted ChatGPT callback verifies the real signed identity, consumes PKCE once and preserves the loopback redirect", async () => {
  const f = await fixture(), originalFetch = globalThis.fetch;
  const { privateKey, publicKey } = await generateKeyPair("ES256"), jwk = await exportJWK(publicKey);
  let exchanges = 0, redirected = "", verifier = "";
  try {
    const session = await f.login(), headers = { cookie: session.cookie, origin };
    const start = await f.request("/api/connections/chatgpt/start", { method: "POST", headers, payload: {} });
    const auth = new URL(start.json().url), callback = new URL(auth.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", start.json().state); callback.searchParams.set("code", "synthetic-once-only-code");
    callback.searchParams.set("client_id", "synthetic-remote-client");
    const signed = await new SignJWT({ nonce: auth.searchParams.get("nonce"), email: "reader@example.test" })
      .setProtectedHeader({ alg: "ES256", kid: "synthetic-remote-key" }).setIssuer("https://auth.openai.com")
      .setAudience("synthetic-remote-client").setSubject("synthetic-owner").setIssuedAt().setExpirationTime("5m").sign(privateKey);
    globalThis.fetch = async (input, options) => {
      const url = String(input);
      if (url === "https://auth.openai.com/api/accounts/oauth/token") {
        exchanges++; const params = new URLSearchParams(options?.body as URLSearchParams);
        redirected = params.get("redirect_uri")!; verifier = params.get("code_verifier")!;
        assert.equal(params.get("code"), "synthetic-once-only-code");
        return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, id_token: signed, scope: "openid chatgpt.tokens.use.direct" });
      }
      if (url === "https://auth.openai.com/.well-known/openid-configuration") return Response.json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/synthetic-jwks" });
      assert.equal(url, "https://auth.openai.com/synthetic-jwks");
      return Response.json({ keys: [{ ...jwk, kid: "synthetic-remote-key", alg: "ES256", use: "sig" }] });
    };
    const completed = await f.request("/api/connections/chatgpt/finish", { method: "POST", headers, payload: { state: start.json().state, callback: callback.href } });
    assert.equal(completed.statusCode, 200); assert.equal(f.vault.status().chatgpt, true);
    assert.equal(redirected, callback.origin + callback.pathname); assert.ok(verifier.length >= 43);
    const { createHash } = await import("node:crypto");
    assert.equal(createHash("sha256").update(verifier).digest("base64url"), auth.searchParams.get("code_challenge"));
    assert.equal((await f.request("/api/connections/chatgpt/finish", { method: "POST", headers, payload: { state: start.json().state, callback: callback.href } })).statusCode, 400);
    assert.equal(exchanges, 1); assert.equal(f.store.jobs().length, 0);
    assert.equal((await f.request("/api/connections/chatgpt/status?state=" + start.json().state, { headers })).json().status, "connected");
  } finally { globalThis.fetch = originalFetch; await f.close(); }
});
