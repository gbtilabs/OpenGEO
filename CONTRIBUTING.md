# Contribute to OpenGEO

Bug reports, documentation fixes, accessibility improvements and code contributions are welcome.

## Report a bug or suggest a change

[Open an issue](https://github.com/surfacedby/OpenGEO/issues) with your app version, operating system, steps to reproduce the problem and what you expected. Remove credentials, private project data and account screenshots. Report security problems [privately](SECURITY.md).

For a substantial feature, describe the user problem and any migration implications before implementing it. Keep changes focused and explain how you verified them.

## Work on the app

Follow the [development guide](docs/development.md) to run from source. Read the implementation and relevant tests before changing behavior, then run `npm test` and `npm run build`.

- Keep local audits and projects useful without a managed account.
- Keep workflow, evidence and budget decisions in the backend. Provider adapters describe capabilities and costs; the interface displays the results.
- Add meaningful tests for isolation, evidence calculations, security boundaries and paid-call recovery. Never weaken assertions to hide a failure.
- Provider fixtures must cite the documented schema and exclude tracking IDs, credentials and personal data.
- New providers need explicit budgets, capability checks and interrupted-request handling. Never add automatic paid fallback.

## Write and share safely

Use clear language and ASCII punctuation in documentation and source comments. Use example.com and clearly labelled synthetic fixtures in tests. Public product screenshots must follow the [screenshot profile](SCREENSHOT_PROFILE.md).

Do not commit credentials, populated configuration, customer evidence or private account screenshots. Preserve third-party licenses and notices. Public releases require the full [release review](docs/release.md), including the exact packaged files.
