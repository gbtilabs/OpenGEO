import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import identity from "../brand/identity.json";
import { escapeHtml } from "./export.js";

export type RemoteConfig = { origin: string; keyFile: string };
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const sessionLifetime = 12 * 60 * 60 * 1000;
const loginWindow = 60 * 1000;

function equal(a: string, b: string) {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function securityHeaders(res: FastifyReply) {
  res.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.header("X-Content-Type-Options", "nosniff");
  res.header("Referrer-Policy", "no-referrer");
}

/** Read only a bounded regular file; accidental mounts must not block startup or consume memory. */
function readKey(file: string) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 64 || stat.size > 66) throw new Error("Invalid remote access key file");
    const bytes = Buffer.alloc(67), size = readSync(fd, bytes, 0, bytes.length, 0);
    const key = bytes.subarray(0, size).toString("utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Generate a remote access key with scripts/setup-remote.mjs");
    return digest(key);
  } finally { closeSync(fd); }
}

export function remoteConfig(env: NodeJS.ProcessEnv = process.env): RemoteConfig | undefined {
  const origin = env.OPENGEO_REMOTE_ORIGIN, keyFile = env.OPENGEO_REMOTE_KEY_FILE;
  if (!origin && !keyFile) return;
  if (!origin || !keyFile) throw new Error("Remote access requires both OPENGEO_REMOTE_ORIGIN and OPENGEO_REMOTE_KEY_FILE");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password ||
      loopbackHosts.has(url.hostname) || isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".") ||
      url.hostname.length > 253 || !url.hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
    throw new Error("OPENGEO_REMOTE_ORIGIN must be one exact HTTPS hostname origin without a path");
  const config = { origin, keyFile: resolve(keyFile) };
  readKey(config.keyFile);
  return config;
}

/** Remote sessions never reuse the filesystem-only CLI token or local bootstrap cookie. */
export class RemoteAccess {
  private keyHash: string;
  private sessions = new Map<string, { expires: number; csrf: string }>();
  private failures = 0;
  private windowEnds = 0;
  private cookie: string;
  private csrfCookie: string;
  constructor(readonly config: RemoteConfig, private localToken: string) {
    // Validate programmatic callers too, so bypassing the environment loader cannot relax setup.
    remoteConfig({ OPENGEO_REMOTE_ORIGIN: config.origin, OPENGEO_REMOTE_KEY_FILE: config.keyFile });
    this.keyHash = readKey(config.keyFile);
    this.cookie = "__Host-opengeo_remote_" + digest(config.origin + localToken).slice(0, 16);
    this.csrfCookie = this.cookie + "_login";
  }
  private cookies(req: FastifyRequest, name: string) {
    const matches = String(req.headers.cookie ?? "").split(";").map(value => value.trim())
      .filter(value => value.startsWith(name + "="));
    return matches.length === 1 ? matches[0].slice(name.length + 1) : "";
  }
  private setCookie(res: FastifyReply, name: string, value: string, seconds: number) {
    res.header("Set-Cookie", `${name}=${value}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}`);
  }
  private refreshKey() {
    try {
      const next = readKey(this.config.keyFile);
      if (next !== this.keyHash) { this.sessions.clear(); this.keyHash = next; }
      return true;
    } catch { this.sessions.clear(); return false; }
  }
  private session(req: FastifyRequest) {
    const id = digest(this.cookies(req, this.cookie)), session = this.sessions.get(id);
    if (session && session.expires > Date.now()) return { id, ...session };
    this.sessions.delete(id);
  }
  private csrf() {
    const value = `${Date.now() + 600000}.${randomBytes(24).toString("hex")}`;
    return value + "." + createHmac("sha256", this.localToken).update(value + this.keyHash).digest("hex");
  }
  private validCsrf(req: FastifyRequest, supplied: unknown) {
    if (typeof supplied !== "string" || supplied.length > 150 || !equal(this.cookies(req, this.csrfCookie), supplied)) return false;
    const parts = supplied.split("."), value = parts.slice(0, 2).join(".");
    return parts.length === 3 && Number(parts[0]) > Date.now() &&
      equal(parts[2], createHmac("sha256", this.localToken).update(value + this.keyHash).digest("hex"));
  }
  private cli(req: FastifyRequest) {
    // Forwarded headers never establish authority. CLI/MCP additionally need the private runtime token.
    const host = new URL("http://" + req.headers.host).hostname;
    return loopbackHosts.has(host) && equal(String(req.headers.authorization ?? ""), "Bearer " + this.localToken);
  }
  async guard(req: FastifyRequest, res: FastifyReply) {
    res.header("Cache-Control", "no-store");
    // Native form POSTs get an opaque Origin under no-referrer. Keep their same-origin check verifiable without sending referrers to other sites.
    res.header("Referrer-Policy", "same-origin");
    const host = req.headers.host, remoteHost = new URL(this.config.origin).host;
    if (host === remoteHost) res.header("Strict-Transport-Security", "max-age=31536000");
    let local = false;
    try {
      const parsed = new URL("http://" + host);
      if (parsed.host !== host) throw new Error("Invalid host");
      local = loopbackHosts.has(parsed.hostname);
    } catch { return res.code(403).send({ error: "Invalid host" }); }
    if (host !== remoteHost && !local) return res.code(403).send({ error: "Untrusted host" });
    // A local Host is only for health and filesystem-authorized tools, never a proxy login fallback.
    if (req.headers.origin && (req.headers.origin !== this.config.origin || host !== remoteHost))
      return res.code(403).send({ error: "Cross-origin request refused" });
    const path = req.url.split("?")[0];
    const navigation = req.method === "GET" && !path.startsWith("/api/") &&
      req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document";
    if (req.headers["sec-fetch-site"] === "cross-site" && !navigation)
      return res.code(403).send({ error: "Cross-site request refused" });
    if (path === "/healthz" && req.method === "GET") return;
    if (!this.refreshKey()) return res.code(503).send({ error: "Remote access key unavailable; contact the workspace owner" });
    const cli = this.cli(req);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !cli && req.headers.origin !== this.config.origin)
      return res.code(403).send({ error: "Same-origin request required" });
    if (host === remoteHost && path === "/login" && ["GET", "POST"].includes(req.method)) return;
    if (cli || (host === remoteHost && this.session(req))) return;
    if (req.method === "GET" && !path.startsWith("/api/") && (navigation || req.headers.accept?.includes("text/html")))
      return res.redirect("/login");
    return res.code(401).send({ error: "Workspace sign-in required", code: "REMOTE_AUTH_REQUIRED" });
  }
  register(app: FastifyInstance) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 }, (_req, body, done) => {
      const params = new URLSearchParams(String(body));
      if ([...params.keys()].length !== new Set(params.keys()).size) return done(new Error("Duplicate form fields"));
      done(null, Object.fromEntries(params));
    });
    app.get("/login", (_req, res) => {
      const csrf = this.csrf();
      this.setCookie(res, this.csrfCookie, csrf, 600);
      return res.type("text/html").send(accessPage("login", csrf));
    });
    app.post("/login", { bodyLimit: 4096 }, (req, res) => {
      const body = req.body as { key?: unknown; csrf?: unknown } | null;
      if (!this.validCsrf(req, body?.csrf)) return res.code(403).send({ error: "Sign-in expired. Reload the sign-in page." });
      const now = Date.now();
      if (now >= this.windowEnds) { this.failures = 0; this.windowEnds = now + loginWindow; }
      // One global bound remains effective behind proxies without trusting client-supplied IP headers.
      if (this.failures >= 10) return res.header("Retry-After", Math.ceil((this.windowEnds - now) / 1000)).code(429)
        .type("text/html").send(accessPage("login", body!.csrf as string, "Too many attempts. Wait a minute, then try again."));
      this.failures++;
      if (typeof body?.key !== "string" || body.key.length !== 64 || !equal(digest(body.key), this.keyHash))
        return res.code(401).type("text/html").send(accessPage("login", body!.csrf as string, "That access key did not match. Try again."));
      for (const [id, session] of this.sessions) if (session.expires <= now) this.sessions.delete(id);
      if (this.sessions.size >= 128) this.sessions.delete(this.sessions.keys().next().value!);
      const old = this.session(req); if (old) this.sessions.delete(old.id);
      const token = randomBytes(32).toString("hex");
      this.sessions.set(digest(token), { expires: now + sessionLifetime, csrf: randomBytes(32).toString("hex") });
      this.setCookie(res, this.cookie, token, sessionLifetime / 1000);
      return res.code(303).redirect("/");
    });
    app.get("/logout", (req, res) => res.type("text/html").send(accessPage("logout", this.session(req)?.csrf ?? "")));
    app.post("/logout", { bodyLimit: 4096 }, (req, res) => {
      const session = this.session(req), csrf = (req.body as any)?.csrf;
      if (!session || typeof csrf !== "string" || !equal(session.csrf, csrf)) return res.code(403).send({ error: "Invalid sign-out request" });
      this.sessions.delete(session.id);
      this.setCookie(res, this.cookie, "", 0);
      return res.code(303).redirect("/login");
    });
    app.addHook("onClose", async () => { this.sessions.clear(); });
  }
}

function accessPage(mode: "login" | "logout", csrf: string, error = "") {
  const login = mode === "login", name = escapeHtml(identity.name);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${login ? "Sign in" : "Lock workspace"} | ${name}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f9fc;color:#0f172a;font:16px/1.6 system-ui,sans-serif;padding:24px}main{width:min(100%,420px)}.brand{font-size:22px;font-weight:650;margin-bottom:24px}.card{padding:32px;background:white;border:1px solid #e2e8f0;border-radius:16px}h1{font-size:26px;line-height:1.2;margin:0 0 16px}p{color:#475569;margin:0 0 24px}label{display:block;font-weight:600}input{width:100%;font:inherit;border:1px solid #94a3b8;border-radius:8px;padding:10px;margin:8px 0 20px}button{width:100%;border:0;border-radius:8px;background:${identity.primary};color:white;padding:12px;font:600 16px system-ui;cursor:pointer}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}[role=alert]{color:#9f1239}a{color:#1166df}.return{display:block;margin-top:16px}@media(max-width:440px){.card{padding:24px}}
</style></head><body><main><div class="brand">${name}</div><section class="card"><h1>${login ? "Open your workspace" : "Lock this browser"}</h1><p>${login ? "Enter the access key provided by the workspace owner. Anyone with this key can use the shared projects and connections." : "Your projects and running tasks stay on the server. This browser will need the access key to sign in again."}</p>${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<form method="post" action="/${mode}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${login ? '<label for="key">Workspace access key</label><input id="key" name="key" type="password" autocomplete="current-password" required minlength="64" maxlength="64" spellcheck="false" autocapitalize="none">' : ""}<button>${login ? "Sign in" : "Lock workspace"}</button></form>${login ? "" : '<a class="return" href="/">Return to workspace</a>'}</section></main></body></html>`;
}
