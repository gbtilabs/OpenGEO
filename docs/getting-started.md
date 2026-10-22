# Get started with OpenGEO

You can run your first website audit without signing into an AI service. Add a connection when you want to collect AI answers or create content.

## 1. Install and add your website

[Download the app for Windows or Mac](https://github.com/surfacedby/OpenGEO/releases/tag/v0.1.0-beta.2), then follow the [installation guide](distribution.md). Source and Docker users can open their local instance at <http://localhost:4318>.

In setup, enter your website and brand name. Choose **Use local audits only** to try the audit first, or connect an eligible service. Review the optional usage-sharing checkbox before finishing setup.

OpenGEO reads your public pages and sitemaps, following robots.txt. It checks up to 100 pages by default; you can change the crawl budget for larger sites. A partial crawl is shown as partial coverage.

## 2. Read your site audit

Open **Site Audit**. Review the pages fetched and the findings for titles, descriptions, headings, canonical URLs, indexing instructions and structured data. A missing description is a concrete finding, not proof that an AI service is ignoring your business.

![A real example.com audit in OpenGEO](../assets/audit-preview.webp)

The screenshots in these guides use the reserved example.com website. They contain a real page audit and no invented AI visibility measurements.

## 3. Choose questions and collect answers

Connect a service in **Settings > Connections**. The [connection guide](connections.md) explains the choices, costs and differences between API answers and consumer-interface answers.

Use the questions your customers ask when looking for a business like yours. OpenGEO can suggest questions from the pages it has read, but you choose which ones to track. Review the wording, model, locale and any spending approval before starting a check.

In **Visibility**, inspect mention and citation rates. Use **Responses** to read full answers and **Sources** to see the pages cited. A failed check is a missing observation; it does not count as an answer that failed to mention you.

## 4. Decide what to work on

Review evidence-supported competitors before adding them to a comparison. In **Opportunities**, look at suggested existing-page updates, new resources and website changes. Read the supporting answers and pages before deciding what belongs on your site.

In **Content**, turn a useful idea into a brief and draft. Add your own expertise, check factual claims and review the sources. OpenGEO retains the draft's research and review notes; you decide whether to publish it.

Save manual edits before requesting an AI revision. Revisions preserve the original draft. After a restart, unsaved local edits can be restored, exported or discarded. Save recovered edits before exporting a project.

## 5. Recheck and keep a backup

After updating your website, recheck the same questions, model and locale. AI answers vary, so a change is useful evidence rather than proof that your edit caused it. See [how comparisons work](methodology.md#compare-checks-fairly).

Use Settings to export a backup. Project exports contain saved work and evidence, but no provider credentials. Keep backups private because they can still contain sensitive research.

Daily and weekly schedules survive restarts. The desktop app must remain running for scheduled work; closing its window leaves it in the tray, while **Quit** stops it. A Docker instance can keep running on your host. Selected paid services can charge for scheduled calls, so set a spending ceiling you are comfortable with.

## If something stops

- **A connection expires or reaches its limit:** affected work pauses. Reconnect or wait for the service's limit to reset.
- **A paid request has an uncertain result:** check the provider account before approving a retry. OpenGEO does not automatically replay it or switch providers.
- **An audit cannot fetch a page:** inspect the recorded fetch result and your site's access rules. Unread pages are not treated as successfully audited.
- **The installer is blocked:** follow the platform-specific [installation instructions](distribution.md). Do not disable your computer's security protections globally.

For a reproducible bug, [open an issue](https://github.com/surfacedby/OpenGEO/issues) with your app version, operating system and steps to reproduce it. Remove credentials and private project data first.
