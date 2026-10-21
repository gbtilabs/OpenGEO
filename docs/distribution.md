# Install OpenGEO

The easiest way to try OpenGEO is the desktop app. It includes the runtime and browser, so you do not need developer tools or an Apple developer account.

## Desktop downloads

Download from the [official GitHub release](https://github.com/surfacedby/OpenGEO/releases/tag/v0.1.0-beta.1).

| Computer | File |
| --- | --- |
| Windows x64 | `OpenGEO-0.1.0-beta.1-windows-x64.exe` |
| Mac with an Apple M-series chip | `OpenGEO-0.1.0-beta.1-macos-arm64.dmg` |
| Mac with an Intel processor | `OpenGEO-0.1.0-beta.1-macos-x64.dmg` |

This beta has no Linux desktop download. Use [Docker](#docker) or [run from source](development.md#run-from-source) instead. Store listings are optional future distribution channels.

## Verify your download

Download `SHA256SUMS.txt` and `release-manifest.json` from the same release. The manifest records the application source, file hashes and actual verification scope.

On Windows, run this in PowerShell from your Downloads folder:

```powershell
Get-FileHash .\OpenGEO-0.1.0-beta.1-windows-x64.exe -Algorithm SHA256
```

On a Mac, run this in Terminal, using `x64` instead of `arm64` for Intel:

```sh
shasum -a 256 ~/Downloads/OpenGEO-0.1.0-beta.1-macos-arm64.dmg
```

Compare the complete result with `SHA256SUMS.txt`. A matching hash confirms you received the published file. It is not a publisher certificate or a guarantee that software is safe.

## Install on Windows

Run the installer, then open OpenGEO from the Start menu. It installs for your current user and does not launch automatically when installation finishes.

**The Windows beta is unsigned.** Windows may show an unknown-publisher or SmartScreen warning. Some managed computers will block it. `Get-AuthenticodeSignature` is expected to report `NotSigned`. Do not disable antivirus or SmartScreen globally, or install a self-signed root certificate for OpenGEO.

## Install on a Mac

1. Choose **Apple menu > About This Mac**. An Apple M-series chip needs the arm64 download; an Intel processor needs x64.
2. Open the DMG and drag OpenGEO to **Applications**.
3. Eject the disk image, then open OpenGEO from Applications.

**The Mac previews are ad hoc signed, not Developer ID signed or notarized.** macOS may block first launch. If you trust the official download and have checked its hash, follow [Apple's per-app Open Anyway instructions](https://support.apple.com/102445): attempt to open the app, then use **System Settings > Privacy & Security > Open Anyway** if offered. Organization policies may still prevent installation. Do not disable Gatekeeper globally.

An ad hoc signature detects changes to the sealed app; it does not verify the publisher or establish an Apple malware review. Both architectures passed actual mounted-and-copied installer workflow tests on macOS 15. Older macOS versions, browser-quarantine installation and clean-machine installation are not certified.

## Updates, workspace and uninstalling

There is no automatic updater in this beta. Export a backup in Settings before installing a future version. Quit OpenGEO before updating; closing the window leaves it running in the tray. Cross-version migration still needs verification for each future release.

| System | Workspace location | Remove the application |
| --- | --- | --- |
| Windows | `%APPDATA%\OpenGEO` | Settings > Apps > Installed apps > OpenGEO |
| macOS | `~/Library/Application Support/OpenGEO` | Quit, then move OpenGEO from Applications to Trash |

The workspace is separate from the application. Keep it private and review it before deleting anything. Uninstalling the app does not certify data erasure. Project exports exclude credentials, but can contain private research and drafts.

## Docker

Docker runs the same application on your own host. The beta does not publish a prebuilt container image; Compose builds the checked-out source.

With Docker Compose and Node.js available, run from a checkout:

```sh
node scripts/setup.mjs
docker compose up --build -d
```

Open <http://localhost:4318>, or the port you set in `OPENGEO_PORT`. The setup script creates an encryption secret in `.local/encryption-secret`. Keep the `.local` directory owner-only (mode 700); the mounted secret file must be readable by the container's unprivileged user (mode 644). If Node.js is unavailable, create the file with at least 32 random bytes using your operating system's secure random generator and apply those permissions.

Keep the Docker data volume and encryption secret when updating. Source and Docker backups require you to preserve both separately. Do not expose the backend directly to the internet; see [remote access](#remote-access) for reaching it from another machine. For ChatGPT sign-in, the browser must reach the callback on the OpenGEO host; see [connections](connections.md#chatgpt).

## Remote access

The backend accepts only requests whose `Host` header is loopback (`127.0.0.1`, `localhost` or `[::1]`), so publishing it on a hostname, or putting a reverse proxy in front of it, is refused with 403. Forward the ports over SSH instead and keep the browser on loopback:

```sh
ssh -N -L 4318:127.0.0.1:4318 -L 4319:127.0.0.1:4319 you@your-host
```

Then open <http://localhost:4318> on your own machine.

The application forward can use any free local port. The browser sends that same port in both `Host` and `Origin`, and the backend only requires the two to agree, so `-L 8318:127.0.0.1:4318` also works and is reached at <http://localhost:8318>.

The sign-in forward is different. Keep its local port equal to `OPENGEO_OAUTH_PORT`, because sign-in sends the browser to that exact loopback address.

A forward is not access control. Anyone who can reach the forwarded port can use the workspace and the providers connected to it, so the SSH credential is the boundary.

## Build or contribute

See [development](development.md) for source setup, CLI, MCP and packaging. Maintainers must follow the [release checklist](release.md) before publishing a new binary. It covers signing, exact package review and platform tests; a successful source build alone does not qualify an installer.
