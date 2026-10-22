import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer as httpsServer, request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

// A disposable hosted runner owns these ports and services; never use a developer's running workspace.
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_OS, "Linux");
const image = process.argv[2]; assert(image);
const project = "opengeo-remote-" + randomUUID().replaceAll("-", "");
const directory = mkdtempSync(join(tmpdir(), "opengeo-https-"));
const output = resolve(process.env.RESULT_DIRECTORY ?? "remote-verification");
mkdirSync(output, { recursive: true });
const keyFile = resolve(".local/remote-access-key"), backendPort = 6318;
assert(!existsSync(keyFile), "Refusing to replace an existing key");
assert(existsSync(".local/encryption-secret"), "Run the local Compose smoke first");
const key = randomBytes(32).toString("hex");
writeFileSync(keyFile, key, { mode: 0o644, flag: "wx" });
const proxy = httpsServer();
let browser;
const browserPosts = [];
const docker = args => execFileSync("docker", args, { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
let compose;
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"), "-days", "1", "-subj", "/CN=opengeo.example.test", "-addext", "subjectAltName=DNS:opengeo.example.test,DNS:evil.example.test"], { stdio: "ignore", timeout: 30000 });
  proxy.setSecureContext({ key: readFileSync(join(directory, "key.pem")), cert: readFileSync(join(directory, "cert.pem")) });
  proxy.on("request", (req, res) => {
    if (req.headers.host?.startsWith("evil.example.test:")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>Synthetic untrusted origin</title>"); return; }
    const upstream = httpRequest({ hostname: "127.0.0.1", port: backendPort, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await new Promise(resolveListen => proxy.listen(0, "127.0.0.1", resolveListen));
  const port = proxy.address().port, origin = `https://opengeo.example.test:${port}`;
  const override = resolve(".local/remote-verification.json");
  writeFileSync(override, JSON.stringify({ services: { opengeo: { image } } }));
  const env = { ...process.env, OPENGEO_PORT: String(backendPort), OPENGEO_OAUTH_PORT: "6319", OPENGEO_REMOTE_ORIGIN: origin };
  compose = (...args) => execFileSync("docker", ["compose", "--project-name", project, "-f", "compose.yaml", "-f", "compose.remote.yaml", "-f", override, ...args], { env, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const config = JSON.parse(compose("config", "--format", "json"));
  assert.equal(config.services.opengeo.environment.OPENGEO_REMOTE_ORIGIN, origin);
  assert.equal(config.services.opengeo.environment.OPENGEO_REMOTE_KEY_FILE, "/run/secrets/opengeo_remote_key");
  assert(config.services.opengeo.ports.every(row => row.host_ip === "127.0.0.1"));
  compose("up", "--detach", "--no-build", "--pull", "never");
  const id = compose("ps", "--quiet", "opengeo").trim(); assert(/^[a-f0-9]{64}$/.test(id));
  let health;
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = JSON.parse(docker(["inspect", id]))[0];
    if (state.State.Health?.Status === "healthy") { health = "healthy"; break; }
    assert.equal(state.State.Running, true);
    await new Promise(resolveWait => setTimeout(resolveWait, 2000));
  }
  assert.equal(health, "healthy");
  function request(path, { method = "GET", headers = {}, body = "" } = {}) {
    return new Promise((resolveRequest, reject) => {
      const req = httpsRequest({ hostname: "127.0.0.1", servername: "opengeo.example.test", port, path, method, rejectUnauthorized: false,
        headers: { host: new URL(origin).host, ...headers } }, res => {
        let text = ""; res.on("data", part => { text += part; if (text.length > 1000000) req.destroy(new Error("Response too large")); });
        res.on("end", () => resolveRequest({ status: res.statusCode, headers: res.headers, body: text })); res.on("error", reject);
      });
      req.setTimeout(5000, () => req.destroy(new Error("Request timed out"))); req.on("error", reject); req.end(body);
    });
  }
  assert.equal((await request("/api/session")).status, 401);
  assert.equal((await request("/api/backup")).status, 401);
  assert.equal((await request("/api/projects", { headers: { "x-forwarded-host": "localhost", "x-forwarded-proto": "https", "tailscale-user-login": "owner@example.test" } })).status, 401);
  browser = await chromium.launch({ args: ["--host-resolver-rules=MAP opengeo.example.test 127.0.0.1, MAP evil.example.test 127.0.0.1", "--no-proxy-server"] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("request", req => {
    const url = new URL(req.url());
    if (req.method() === "POST" && ["/login", "/logout"].includes(url.pathname))
      browserPosts.push({ path: url.pathname, origin: req.headers().origin ?? null });
  });
  await page.goto(origin); await page.waitForURL(origin + "/login");
  await page.getByLabel("Workspace access key").waitFor();
  assert.equal(await page.getByLabel("Workspace access key").inputValue(), "");
  await page.locator("main").screenshot({ path: join(output, "login-desktop.png") });
  const mobile = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mobilePage = await mobile.newPage(); await mobilePage.goto(origin + "/login");
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobilePage.locator("main").screenshot({ path: join(output, "login-mobile.png") }); await mobile.close();
  await page.getByLabel("Workspace access key").fill(randomBytes(32).toString("hex"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.getByRole("alert").waitFor();
  await page.getByLabel("Workspace access key").fill(key);
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(origin + "/");
  await page.getByRole("heading", { name: "Power your AI visibility workspace", exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await page.evaluate(async () => (await fetch("/api/projects")).status), 200);
  const savedCookies = await context.cookies(), session = savedCookies.find(row => row.name.startsWith("__Host-opengeo_remote_") && !row.name.endsWith("_login"));
  assert(session && session.secure && session.httpOnly && session.sameSite === "Strict");
  const backup = await request("/api/backup", { headers: { cookie: session.name + "=" + session.value } });
  assert.equal(backup.status, 200); assert(!backup.body.includes(key)); assert(!backup.body.includes(session.value));
  assert.equal((await request("/api/projects", { method: "POST", headers: { cookie: session.name + "=" + session.value, origin: "https://evil.example.test" } })).status, 403);
  assert.equal((await request("/api/projects", { headers: { cookie: session.name + "=" + session.value, "sec-fetch-site": "cross-site" } })).status, 403);
  const hostile = await context.newPage(); await hostile.goto(`https://evil.example.test:${port}/`);
  await hostile.evaluate(target => {
    const form = document.createElement("form"); form.action = target + "/logout"; form.method = "POST";
    document.body.append(form); form.submit();
  }, origin);
  await hostile.waitForURL(origin + "/logout"); await hostile.getByText("Cross-origin request refused", { exact: false }).waitFor(); await hostile.close();
  assert.equal((await request("/api/projects", { headers: { cookie: session.name + "=" + session.value } })).status, 200);
  await page.goto(origin + "/logout"); await page.getByRole("button", { name: "Lock workspace", exact: true }).click(); await page.waitForURL(origin + "/login");
  assert.equal((await request("/api/projects", { headers: { cookie: session.name + "=" + session.value } })).status, 401);
  await page.getByLabel("Workspace access key").fill(key); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(origin + "/");
  writeFileSync(keyFile, randomBytes(32).toString("hex"));
  assert.equal(await page.evaluate(async () => (await fetch("/api/session")).status), 401);
  await page.reload(); await page.waitForURL(origin + "/login");
  await context.close();
  const receipt = { source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), image, remoteCompose: true, actualImageHealthcheck: health,
    realTlsProxy: true, realChromium: true, desktopAnd390pxLogin: true, anonymousBootstrap: 401, anonymousBackup: 401,
    forgedHeadersGrantedAccess: false, browserLogin: true, secureHostOnlyHttpOnlyStrictCookie: true, realAppLoaded: true,
    crossOriginAndCrossSiteDenied: true, browserCrossSiteLogoutDenied: true, copiedCookieRevokedAfterLogout: true, keyRotationRevokedAccess: true,
    providerCredentialsLoaded: false, realProviderSignInAttempted: false, actualTailscaleTailnetTested: false };
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
} catch (error) {
  // Keep useful transport evidence without form bodies, cookies, keys or provider payloads.
  writeFileSync(join(output, "failure.json"), JSON.stringify({ errorType: error.name, browserPosts }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolveClose => proxy.close(resolveClose));
  if (compose) compose("down", "--volumes", "--remove-orphans");
  assert.equal(dirname(directory), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true });
}
