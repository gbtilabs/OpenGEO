# Security

Never report a credential or private customer payload in a public issue. Report a vulnerability privately with [Report a vulnerability](https://github.com/surfacedby/OpenGEO/security/advisories/new) on the Security tab, and allow time for a fix before disclosing it.

## Local access is the trust boundary

OpenGEO is a single-owner workspace. Its default local mode has no user login. The default desktop and source installations listen on loopback. Docker listens inside its container, while Compose publishes the application and sign-in callback ports only on the host's loopback address.

Any caller that can reach the application port with accepted request headers can obtain a session from `/api/session` and use the workspace and its connected providers. Other users on the same computer can also reach loopback. The session token and checks on Host, Origin and browser fetch context protect against cross-site browser requests; they do not authenticate a person or isolate local operating-system users.

Keep both ports private. For remote use of local mode, use an authenticated SSH connection with the forwarded ports bound to your own loopback address. Do not publish an unprotected backend to a LAN or the internet, or rely on a proxy rewriting headers to provide access control. A private VPN alone does not add an OpenGEO login.

## Optional private-network mode

Current source and Docker installations support [explicit remote setup](docs/remote-access.md) behind Tailscale Serve HTTPS. Remote mode requires an exact HTTPS origin and a separately generated 256-bit workspace access key file; incomplete configuration fails startup. The published desktop beta is unchanged.

Remote mode protects session bootstrap, APIs and private application assets. Login uses a same-origin form with a separate CSRF challenge. Browser sessions are independent random tokens, bounded to 12 hours, held in memory and set only in Secure, HttpOnly, SameSite=Strict, host-only cookies. Logout revokes the session; server restart or access-key rotation revokes all browser sessions. Invalid key files fail closed. Login attempts and stored sessions have global bounds that do not depend on trusted proxy headers.

No `Forwarded`, `X-Forwarded-*` or Tailscale identity header grants access or changes the configured origin. The backend's filesystem-only CLI token remains usable through an accepted loopback Host; it is never returned to remote browsers. Local operating-system users who can read secrets or replace the server remain trusted. Restrict the host's files and Tailscale access rules, keep the backend loopback-only and use a trusted HTTPS proxy. Remote mode does not provide separate users, project permissions or public internet hosting support.

## Untrusted content and credentials

Electron renderers have no Node access and use context isolation and sandboxing. Crawlers block private networks, including resolved addresses and redirects.

Treat crawled pages as untrusted. They cannot authorize tool calls, credential access, spending or publishing. Content drafts always require human review.

Desktop credentials use protected operating-system encryption. Docker requires a separately supplied encryption secret. Keep the folder that holds it readable only by your user; the setup script creates `.local` that way. Inside the container the unprivileged OpenGEO process must be able to read the mounted file. Credentials are not included in ordinary project backups.

## Release review

Before every release, scan source, all Git refs and unpacked distribution artifacts. Any exposed credential must be revoked and rescanned. A successful scanner run does not replace manual confidentiality review.
