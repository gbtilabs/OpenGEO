import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { request } from "node:http";

// The port checks need a disposable host; never claim a user's desktop ports.
assert.equal(process.env.GITHUB_ACTIONS, "true", "Use a disposable GitHub runner");
assert.equal(process.env.RUNNER_OS, "Linux");
const directory = resolve(process.argv[2]);
const image = process.argv[3];
assert(image && existsSync(join(directory, "compose.yaml")));
const secretDirectory = join(directory, ".local");
const secret = join(secretDirectory, "encryption-secret");
assert(!existsSync(secret), "Refusing to replace an existing encryption secret");
mkdirSync(secretDirectory, { recursive: true, mode: 0o700 });
writeFileSync(secret, randomBytes(48), { mode: 0o644 });
const override = join(secretDirectory, "compose-verification.json");
writeFileSync(override, JSON.stringify({ services: { opengeo: { image } } }));
const docker = (args, env) => execFileSync("docker", args, {
  cwd: directory, env, encoding: "utf8", timeout: 120000,
  maxBuffer: 8 * 1024 * 1024,
});

function get(port, path, headers = {}) {
  return new Promise((resolveRequest, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (part) => {
        body += part;
        if (body.length > 1000000) req.destroy(new Error("Unexpected response size"));
      });
      res.on("end", () => resolveRequest({ status: res.statusCode, headers: res.headers, body }));
      res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("Local request timed out")));
    req.on("error", reject);
    req.end();
  });
}

const cases = [];
for (const [name, appPort, callbackPort] of [["default", 4318, 4319], ["custom", 5318, 5319]]) {
  const env = { ...process.env };
  delete env.OPENGEO_PORT;
  delete env.OPENGEO_OAUTH_PORT;
  if (name === "custom") {
    env.OPENGEO_PORT = String(appPort);
    env.OPENGEO_OAUTH_PORT = String(callbackPort);
  }
  const project = "opengeo-ports-" + randomUUID().replaceAll("-", "");
  const compose = (...args) => docker(["compose", "--project-name", project,
    "--file", join(directory, "compose.yaml"), "--file", override, ...args], env);
  try {
    const config = JSON.parse(compose("config", "--format", "json"));
    const service = config.services.opengeo;
    assert.equal(service.environment.OPENGEO_PORT, String(appPort));
    assert.equal(service.environment.OPENGEO_OAUTH_PORT, String(callbackPort));
    assert.equal(service.ports.length, 2);
    for (const port of [appPort, callbackPort]) {
      const mapping = service.ports.find((row) => row.target === port);
      assert(mapping);
      assert.equal(mapping.host_ip, "127.0.0.1");
      assert.equal(String(mapping.published), String(port));
    }
    compose("up", "--detach", "--no-build", "--pull", "never");
    const id = compose("ps", "--quiet", "opengeo").trim();
    assert(/^[0-9a-f]{64}$/.test(id));
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      const container = JSON.parse(docker(["inspect", id], env))[0];
      state = container.State;
      assert(state.Running, "Application container stopped");
      if (state.Health?.Status === "healthy") break;
      assert.notEqual(state.Health?.Status, "unhealthy", "Image healthcheck failed");
      await new Promise((done) => setTimeout(done, 1000));
    }
    assert.equal(state.Health?.Status, "healthy", "Actual image healthcheck never became healthy");
    assert.equal((await get(appPort, "/")).status, 200);
    assert.equal((await get(appPort, "/api/projects")).status, 401);
    const bootstrap = await get(appPort, "/api/session");
    assert.equal(bootstrap.status, 200);
    const cookie = bootstrap.headers["set-cookie"]?.[0]?.split(";")[0];
    assert(cookie, "Local bootstrap did not issue a browser session");
    const projects = await get(appPort, "/api/projects", { Cookie: cookie });
    assert.equal(projects.status, 200);
    assert.deepEqual(JSON.parse(projects.body), []);
    assert.equal((await get(appPort, "/api/session", { Origin: "https://example.com" })).status, 403);
    assert.equal((await get(appPort, "/api/session", { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await get(appPort, "/api/session", { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" })).status, 403);
    assert.equal((await get(appPort, "/api/session", { Host: "server.example.com:" + appPort })).status, 403);
    assert.equal((await get(appPort, "/api/session", { Origin: "http://127.0.0.1:" + appPort })).status, 200);
    cases.push({ name, appPort, callbackPort, loopbackBindings: true,
      declaredImageHealthcheck: "healthy", staticPage: 200, apiBeforeSession: 401,
      localBootstrap: 200, apiAfterBootstrap: 200, crossOrigin: 403,
      crossSiteResource: 403, crossSiteApiNavigation: 403, remoteHost: 403 });
  } finally {
    // A unique Compose project limits cleanup to this case's containers and volumes.
    compose("down", "--volumes", "--remove-orphans");
  }
}
const record = { candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim(),
  controls: process.env.CONTROL_SHA, image, freshImageBuiltByWorkflow: true,
  actualProviderLoginAttempted: false, providerCredentialsLoaded: false, cases };
assert(process.env.RESULT_FILE, "Result path required");
writeFileSync(process.env.RESULT_FILE, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record));
