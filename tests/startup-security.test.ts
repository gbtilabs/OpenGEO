import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "node:net";
import { start } from "../server/main.js";
import { lockRuntime } from "../server/runtime-lock.js";

test("desktop and OAuth listeners stay on loopback even when container settings are inherited", async () => {
  const directory = mkdtempSync(join(tmpdir(), "opengeo-desktop-boundary-"));
  const previous = { container: process.env.OPENGEO_CONTAINER, callback: process.env.OPENGEO_OAUTH_PORT };
  process.env.OPENGEO_CONTAINER = "1"; process.env.OPENGEO_OAUTH_PORT = "invalid-inherited-port";
  const listen = Server.prototype.listen, observed: unknown[][] = [];
  // Observe the real socket boundary and delegate every listen to Node; no application behavior is replaced.
  Server.prototype.listen = function (this: Server, ...args: any[]) { observed.push(args); return (listen as any).apply(this, args); } as any;
  let runtime: Awaited<ReturnType<typeof start>> | undefined;
  try {
    runtime = await start({ directory, port: 0, staticRoot: join(directory, "no-assets"), protector: { encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() } });
    const address = runtime.app.server.address(); assert.ok(address && typeof address !== "string"); assert.equal(address.address, "127.0.0.1");
    const response = await runtime.app.inject({ method: "POST", url: "/api/connections/chatgpt/start", headers: { host: "127.0.0.1", authorization: "Bearer " + runtime.token }, payload: {} });
    assert.equal(response.statusCode, 200);
    const redirect = new URL(new URL(response.json().url).searchParams.get("redirect_uri")!);
    assert.equal(redirect.hostname, "127.0.0.1"); assert.ok(Number(redirect.port) > 0);
    assert.ok(observed.some(args => args[0] === 0 && args[1] === "127.0.0.1"));
    assert.ok(!observed.some(args => args.includes("0.0.0.0")));
  } finally {
    await runtime?.app.close(); Server.prototype.listen = listen;
    for (const [key, value] of Object.entries({ OPENGEO_CONTAINER: previous.container, OPENGEO_OAUTH_PORT: previous.callback })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime publication errors close the listener and release the workspace lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "opengeo-startup-failure-"));
  mkdirSync(join(directory, "local-session"));
  try {
    await assert.rejects(start({ directory, port: 0, staticRoot: join(directory, "no-assets"), protector: { encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() } }));
    const unlock = lockRuntime(directory); unlock();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
