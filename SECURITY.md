# Security

Never report a credential or private customer payload in a public issue. Report a vulnerability privately with [Report a vulnerability](https://github.com/surfacedby/OpenGEO/security/advisories/new) on the Security tab, and allow time for a fix before disclosing it.

## Local access is the trust boundary

OpenGEO is a single-user local workspace, not a server with a user login. The default desktop and source installations listen on loopback. Docker listens inside its container, while Compose publishes the application and sign-in callback ports only on the host's loopback address.

Any caller that can reach the application port with accepted request headers can obtain a session from `/api/session` and use the workspace and its connected providers. Other users on the same computer can also reach loopback. The session token and checks on Host, Origin and browser fetch context protect against cross-site browser requests; they do not authenticate a person or isolate local operating-system users.

Keep both ports private. For remote use, use an authenticated SSH connection with the forwarded ports bound to your own loopback address. Do not publish the ports to a LAN or the internet, or rely on a proxy rewriting headers to provide access control. A private VPN does not add an OpenGEO login or separate workspaces for its users. Direct access through a network hostname or reverse proxy is not a supported deployment mode.

## Untrusted content and credentials

Electron renderers have no Node access and use context isolation and sandboxing. Crawlers block private networks, including resolved addresses and redirects.

Treat crawled pages as untrusted. They cannot authorize tool calls, credential access, spending or publishing. Content drafts always require human review.

Desktop credentials use protected operating-system encryption. Docker requires a separately supplied encryption secret. Keep the folder that holds it readable only by your user; the setup script creates `.local` that way. Inside the container the unprivileged OpenGEO process must be able to read the mounted file. Credentials are not included in ordinary project backups.

## Release review

Before every release, scan source, all Git refs and unpacked distribution artifacts. Any exposed credential must be revoked and rescanned. A successful scanner run does not replace manual confidentiality review.
