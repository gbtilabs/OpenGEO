# Use OpenGEO over Tailscale

Run OpenGEO on your server and open it from another device on your private network. Remote mode adds a workspace access key and browser sign-in. It is available when running the current source with Docker or Node.js; the existing desktop beta downloads do not include it.

This is one shared workspace. Anyone with network access and its key can use all projects, connected providers and approved spending controls. It does not create separate accounts, permissions or private projects for each visitor.

## Before you start

- Install Tailscale on the server and the devices you will use. Limit access to the server's HTTPS service with your tailnet's access rules.
- Enable HTTPS for [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). This guide uses Serve for private access, not Funnel for public exposure.
- Use a dedicated HTTPS hostname for OpenGEO. Serve must preserve the original `Host` header and proxy the whole site to the application. Subpath hosting and HTTP access are not supported.
- Keep the application and OAuth callback ports bound to the server's loopback address. Keep the workspace, encryption secret and access key private. Do not put the key in a URL, environment variable, screenshot or issue.

## Docker setup

From the current checkout on your server:

```sh
node scripts/setup.mjs
node scripts/setup-remote.mjs
```

The second command creates `.local/remote-access-key`. It does not print the key or enable network access. Read that file locally when you need to sign in, and transfer it to your own password manager securely. The `.local` directory must remain owner-only. Its mounted secret files are readable by Docker's unprivileged user inside the container.

Set the exact HTTPS origin in `.env`, using your server's actual Tailscale DNS name:

```dotenv
OPENGEO_REMOTE_ORIGIN=https://your-server.your-tailnet.ts.net
```

Do not include a path or trailing slash. If Serve uses a non-default HTTPS port, include it in the origin. Then start the remote configuration:

```sh
docker compose -f compose.yaml -f compose.remote.yaml up --build -d
```

On the host, configure [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) to proxy to OpenGEO's loopback port:

```sh
tailscale serve --bg http://127.0.0.1:4318
tailscale serve status
```

If you set `OPENGEO_PORT`, substitute that port. Check the displayed HTTPS address against `OPENGEO_REMOTE_ORIGIN`. Review any existing Serve configuration before changing it, and grant administrator access only if your installation requires it.

Open the HTTPS address from your other device. Enter the workspace access key at the sign-in page. Unknown hostnames and origins are rejected; proxy identity and forwarded headers are not accepted as OpenGEO credentials.

## Node.js setup

Follow the [source installation guide](development.md#run-from-source), then generate the remote key with `node scripts/setup-remote.mjs`. In the server's process environment, set:

```sh
export OPENGEO_REMOTE_ORIGIN="https://your-server.your-tailnet.ts.net"
export OPENGEO_REMOTE_KEY_FILE="$(pwd)/.local/remote-access-key"
```

PowerShell equivalents:

```powershell
$env:OPENGEO_REMOTE_ORIGIN = "https://your-server.your-tailnet.ts.net"
$env:OPENGEO_REMOTE_KEY_FILE = (Resolve-Path .local/remote-access-key).Path
```

Start the server with its encryption secret configured and use Serve as above. The standalone server continues to listen on loopback. Remote settings are rejected by the desktop application.

## Connect AI services

Provider API keys work through the signed-in workspace as usual. No provider credential is needed just to open projects or run a local audit.

**ChatGPT:** start sign-in from Connections. ChatGPT still redirects to its required `http://127.0.0.1:PORT/auth/callback` address. On another computer this may show a page-unavailable error. Copy the full redirect URL from the address bar, return to the original workspace tab and paste it into **Sign-in redirect URL**. OpenGEO accepts only the exact pending loopback callback and matching state; it does not fetch the pasted address. The one-time code expires with the sign-in attempt. Never share it or paste it into an issue. If a local OpenGEO instance handles that port instead, use a separate browser device or the existing SSH callback forward.

**OpenRouter:** remote mode uses its authorization-code flow. Complete the provider's consent, then paste the supplied code into Connections. Alternatively, connect an existing API key.

You do not need to expose or proxy the callback port. The [SSH forwarding approach](distribution.md#remote-access) remains available for a browser that can forward the exact callback port.

## Locking, expiry and rotation

- Use **Settings > Lock this browser**, or open `/logout`. Confirm locking to revoke that browser session. Closing a tab does not sign it out.
- A browser session expires after 12 hours and is lost when the server restarts. If it expires while editing, sign in at `/login` in another tab and retry; the original tab's unsaved work is preserved.
- Running tasks continue when a browser locks or disconnects. Locking does not cancel provider work or revoke provider credentials.
- To revoke every remote browser session, run `node scripts/setup-remote.mjs --rotate` on the server. Source installations detect the changed file on the next request. For Docker, recreate the service so the secret mount is refreshed: `docker compose -f compose.yaml -f compose.remote.yaml up -d --force-recreate opengeo`.
- Protect the new key and update your password manager. Do not rotate the encryption secret as part of access-key rotation.

Failed sign-in attempts are limited across the whole server, including requests with forged IP headers. A burst can temporarily block sign-in for one minute. Missing, malformed or unreadable key files refuse workspace access rather than switching to local bootstrap.

## Disable remote access

Disable the OpenGEO Serve endpoint using the command appropriate to your existing configuration, such as `tailscale serve --https=443 off`. Remove both remote environment variables and restart the source server, or start Docker with only `compose.yaml`. Ensure the old remote service was recreated and no proxy still publishes the local-mode backend. Local mode does not require an access key.

Keep the access key out of project exports and backups. Preserve the data volume and the separate encryption secret. See [Security](../SECURITY.md) for the local-user boundary and [Connections](connections.md) for provider eligibility and costs.
