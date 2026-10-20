# Screenshot profile

Capture the local candidate app from a fresh installation. Use the public reserved example.com domain and its real page audit. Do not seed invented observations, metrics, customers or testimonials.

The automation creates a disposable data directory outside the repository, signs into only the local session, runs the real audit and captures at 2x. It uses a fresh browser context with no personal browser state.

Capture the application shell without browser chrome. Ensure fonts are loaded, the expected audit is visible and the screenshot fits the layout. Inspect the actual pixels for keys, account email, customer domains, internal identifiers, clipping and empty loading states before using the asset.

The current guides use `assets/workspace-preview.webp`, `assets/audit-preview.webp` and `assets/provider-preview.webp`. Use descriptive alt text and identify the example.com audit in captions. Keep raw PNG captures outside the repository and compress public WebP images without obscuring text. Aim for less than 400 KB combined for these three images so the README remains practical on a mobile connection.

No remote upload is required for local review. Never capture private dashboard accounts as OpenGEO examples. A screenshot must not imply that unconnected AI features produced measured results.
