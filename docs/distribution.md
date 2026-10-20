# Desktop distribution

OpenGEO does not require users to buy a developer membership, certificate or API account. Signing is a maintainer release concern. Source and Docker distribution do not require a commercial signing certificate.

## GitHub beta downloads

The first release is distributed through [GitHub Releases](https://github.com/surfacedby/OpenGEO/releases/tag/v0.1.0-beta.1). Store listings are optional future distribution channels. Version 0.1.0-beta.1 provides a Windows x64 installer and separate Apple Silicon (arm64) and Intel (x64) Mac DMGs, plus source installation and Docker instructions. Linux desktop binaries are not included. No prebuilt container image is published with this beta; Compose builds the reviewed source locally.

The Windows installer bundles the application, its runtime and Chromium. End users do not need Node.js, Python or compiler tools. It is unsigned. Windows can show an unknown-publisher or SmartScreen warning, and organizational policy may prevent installation. This beta is intended for users comfortable evaluating that limitation. Do not disable antivirus, SmartScreen or Gatekeeper globally, or install a self-signed root certificate for OpenGEO.

### Verify a Windows download

1. Download the installer, `SHA256SUMS.txt` and `release-manifest.json` from the same official release page.
2. In PowerShell, run `Get-FileHash .\OpenGEO-0.1.0-beta.1-windows-x64.exe -Algorithm SHA256` and compare the complete result with `SHA256SUMS.txt`.
3. Optionally run `Get-AuthenticodeSignature .\OpenGEO-0.1.0-beta.1-windows-x64.exe`. This beta is expected to report `NotSigned`. A matching hash proves that your download matches the published bytes; it is not a publisher certificate or proof that software is safe.
4. Read the release limitations before running the installer. The application does not launch automatically when installation finishes; open OpenGEO from the Start menu.

### Install and verify on a Mac

Choose Apple menu > About This Mac: an Apple M-series chip needs `macos-arm64.dmg`; an Intel processor needs `macos-x64.dmg`. Both packages include the runtime and browser. No Apple membership, Node.js or compiler tools are needed. Both architectures were tested on native macOS 15 runners. Older macOS versions are not verified.

1. Download the matching DMG, `SHA256SUMS.txt` and `release-manifest.json` from the official release page.
2. In Terminal, run `shasum -a 256 ~/Downloads/OpenGEO-0.1.0-beta.1-macos-arm64.dmg` (substitute `x64` for Intel) and compare the complete hash with `SHA256SUMS.txt`.
3. Open the DMG, drag OpenGEO to Applications, eject the disk image, then open OpenGEO from Applications.
4. These previews have complete ad hoc resource signatures, but no Apple Developer ID signature or notarization. macOS can block first launch. Only if you trust the official download and have verified its checksum, follow [Apple's per-app Open Anyway instructions](https://support.apple.com/102445): attempt to open the app, then use System Settings > Privacy & Security > Open Anyway if offered. Organization policies may still block it. Do not disable Gatekeeper globally.

An ad hoc signature detects changes to the sealed application; it does not establish a verified publisher or Apple malware review. Native mounted-installer and local-workflow tests passed for both packages, but clean-machine and browser-quarantine installation are not certified.

### Data, updates and uninstalling

The Windows installer installs for the current user. OpenGEO stores its workspace under `%APPDATA%\OpenGEO`, separately from application binaries. Keep this folder private. Use Settings to export a backup before replacing an installation, and preserve the backup until the new version is verified. Project exports exclude provider credentials.

This beta has no automatic updater. Download updates from the official release page, quit OpenGEO using its tray menu, then run the new installer. Closing the main window keeps the application in the tray. Keep the same application identity and data folder when updating; cross-version migration acceptance must be checked for each future release.

Uninstall through Windows Settings > Apps > Installed apps > OpenGEO. Uninstalling removes the application; retained workspace data must be reviewed separately before deletion. Removing a data folder can permanently remove saved work and connections. On macOS, the workspace is under `~/Library/Application Support/OpenGEO`. Quit OpenGEO before replacing the application in Applications. To uninstall, quit and move the application to Trash; keep or remove the workspace separately only after reviewing your backups. Removing the application does not certify data erasure. Source/Docker users must separately preserve their data volume and encryption secret.

## Windows

Microsoft Store **MSIX** is a possible later route. Microsoft provides registration, hosting and signing for eligible MSIX submissions. The publisher must select the appropriate Individual or Company account and complete the required identity or business verification. EXE/MSI submissions do not receive the same MSIX signing service. Store enrollment is not a prerequisite for GitHub downloads.

For direct downloadable installers, apply to SignPath Foundation after the public repository and release satisfy its open source conditions. Its program is free but approval is not guaranteed or immediate. Do not publish a download as signed until its exact binary signature is verified.

An unsigned beta may be distributed after its exact confidentiality and installation checks pass, with published hashes and explicit limitations. It is not the signed stable v1 installer.

## macOS

Apple's normal Developer ID signing and notarization route requires Apple Developer Program membership, currently USD 99 per year, plus a macOS build runner. Apple's fee waiver covers qualifying nonprofits, accredited educational institutions and government entities; an MIT license alone does not qualify.

The GitHub beta now includes ad hoc signed Mac previews without a commercial certificate. They do not provide the same trust or installation experience as notarized downloads. Both advertised architectures passed actual native mounted-and-copied installer workflow checks and strict resource-seal verification on macOS 15. A signed stable download still requires Developer ID signing, notarization and clean-machine acceptance. Docker and source remain separate installation options. An individual Apple Developer Program membership covers all Apple platforms; separate per-platform memberships are not required.

## Build authenticity

The repository verification workflow checks the application on Windows x64, macOS x64/arm64 and Linux x64/arm64. A manual run also builds unsigned desktop packages and native Docker images on matching runners. This avoids mixing the architecture of SQLite with the bundled browser. The workflow has read-only repository permissions, does not load provider or signing credentials, and does not upload packages or publish releases. A configured workflow is not evidence that its platform jobs have passed; retain the actual run results before approving a target.

For a local package on a matching machine, use `node scripts/clean-build.mjs --desktop-installer --platform=win --arch=x64`. Substitute `mac` and the machine's `x64` or `arm64` architecture on macOS. Build output must remain below `release/`. These are unsigned verification builds; the signing and clean installation gates still apply.

Record the reviewed source commit, lockfile, platform/architecture, artifact hashes and confidentiality receipt. GitHub build attestations or Sigstore can establish build provenance, but do not replace Windows Authenticode or Apple notarization.

No signing credentials belong in source, Docker build arguments or frontend bundles. Configure them only through the release runner's protected secret store. Release workflows must not publish automatically before manual confidentiality review. The separate Mac candidate workflow encrypts review bundles to a local maintainer recipient and waits for approval of the exact source, architecture, byte count and SHA256 before uploading that same DMG to the existing beta. Its ad hoc sealing step explicitly disables packaging-tool publication. No Apple or provider credentials are loaded into packaging. The binary source remains the release tag; subsequent commits add release tooling and instructions.

## Sources checked 2026-09-30

- [Microsoft free registration and MSIX signing](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)
- [SignPath Foundation eligibility](https://signpath.org/terms.html)
- [Apple enrollment](https://developer.apple.com/help/account/membership/program-enrollment)
- [Apple fee waivers](https://developer.apple.com/help/account/membership/fee-waivers/)
- [Electron signing and notarization](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Sigstore build authenticity](https://docs.sigstore.dev/)
