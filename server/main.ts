import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Store } from "./storage.js";
import { Vault, type SecretProtector } from "./vault.js";
import { createApp } from "./app.js";
import { lockRuntime } from "./runtime-lock.js";
import { remoteConfig } from "./remote-access.js";
export async function start(
  options: {
    directory?: string;
    port?: number;
    protector?: SecretProtector;
    staticRoot?: string;
    onConnected?: () => void;
  } = {},
) {
  const remote = remoteConfig();
  if (remote && options.protector) throw new Error("Remote access is supported by the standalone server, not the desktop application");
  // Desktop encryption is supplied by its launcher. Container settings must never expose that local workspace or its callback listener.
  const host = !options.protector && process.env.OPENGEO_CONTAINER === "1" ? "0.0.0.0" : "127.0.0.1";
  const callback = { host, port: options.protector ? 0 : Number(process.env.OPENGEO_OAUTH_PORT ?? 0) } as const;
  const directory = resolve(
    options.directory ?? process.env.OPENGEO_DATA_DIR ?? ".local",
  );
  const unlock = lockRuntime(directory);
  let vault: Vault;
  try {
    vault = new Vault(directory, options.protector);
  } catch (error) {
    unlock();
    throw error;
  }
  let store: Store;
  try {
    store = new Store(directory);
  } catch (error) {
    unlock();
    throw error;
  }
  let result: Awaited<ReturnType<typeof createApp>>;
  try {
    result = await createApp(store, vault, undefined, options.staticRoot, options.onConnected, remote, callback);
  } catch (error) {
    store.close();
    unlock();
    throw error;
  }
  result.app.addHook("onClose", () => {
    store.close();
    unlock();
  });
  try {
    await result.app.listen({
      port: options.port ?? Number(process.env.OPENGEO_PORT ?? 4318),
      host,
    });
  } catch (error) {
    await result.app.close();
    throw error;
  }
  try {
    writeFileSync(resolve(directory, "local-session"), result.token, {
      mode: 0o600,
    });
    const address = result.app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing runtime address");
    writeFileSync(
      resolve(directory, "runtime.json"),
      JSON.stringify({ origin: "http://127.0.0.1:" + address.port }),
      { mode: 0o600 },
    );
    result.runner.start();
    result.scheduler.start();
    result.usage.start();
  } catch (error) {
    await result.app.close();
    throw error;
  }
  return { ...result, store };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const runtime = await start();
  process.on("SIGINT", async () => {
    await runtime.app.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await runtime.app.close();
    process.exit(0);
  });
}
