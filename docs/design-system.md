# Interface design system

OpenGEO uses a shared visual foundation across the workspace, setup, settings and task dialogs. Keep business rules and evidence calculations in their existing server modules.

## Foundation

`src/ui/tokens.css` owns colors, typography, spacing, radii, shadows and responsive page spacing. Use semantic names such as `--citation`, `--muted` and `--panel-space` instead of choosing a new color or padding for each screen. Blue identifies primary actions and mentions; teal identifies citations. Pair status colors with words or icons.

The interface uses Inter, Lucide icons, quiet borders and a pale canvas. Cards group related evidence or a task. Avoid putting every label inside another card.

## Shared components

| Component | Use |
| --- | --- |
| `PageHeader` | Every workspace screen: icon, title, short explanation and contextual action |
| `MetricCard` | A measured value, its denominator and an optional comparable-check change |
| `CoverageRing` | A real count and denominator, with an accessible text equivalent |
| `EmptyState` | Explain what is missing and offer a useful next step |
| `Dialog` | Confirmations and task forms; `variant="drawer"` for full answer evidence |
| `Select` | Searchable keyboard selection, including inside native dialogs |

Panels, buttons, form controls, tabs and responsive tables share the base styles in `styles.css`. Feature styles own layout, not alternate themes. Dialog dropdowns portal into their nearest dialog so they remain interactive in its modal layer. Escape closes the dropdown first; closing a dialog returns focus to its opener.

## Screen patterns

| Area | Pattern |
| --- | --- |
| Overview | Evidence summary, citation coverage, comparable history and next action |
| Visibility | Trends, readable chart data, questions and check history |
| Responses | Search and mutually exclusive outcome filters, then a full-answer drawer |
| Sources | Domain/page views with citation counts and supporting answers |
| Competitors | Saved comparison websites, citation comparison and supporting evidence |
| Site Audit | Coverage, page findings and audit actions |
| Opportunities | Prioritized groups, supporting evidence and content handoff |
| Content | Draft library, document editor, review and unsaved-change protection |
| Reports | Export the saved project evidence |
| Settings | Connections, schedules, privacy and app information |
| Setup | The same controls and surfaces with a short, explicit progress sequence |

## Evidence and scope

The overview summary and response filters use existing saved observations. They do not request new answers or spend provider credits. Missing data stays missing; an empty history is not a zero score. Deltas use the server's comparable measurement. Charts mark incomplete checks with shaded gaps and retain an accessible data table.

Traffic attribution, market-wide rankings, outreach and sentiment scores require additional collection or analysis. Do not add placeholder versions of these features to fill a layout. Existing audits, answers, citations, findings and drafts supply the visuals.

## Local verification

Build before browser checks. `scripts/analytics-ui-review.ts` covers all ten screens at desktop, tablet and mobile widths, then checks evidence navigation, filters, answer drawers and saved draft navigation. `scripts/workflow-ui-review.ts` checks task dialogs, dropdowns, keyboard isolation and submission safety. Connection and recheck review scripts cover provider availability and retained run settings.

These scripts use isolated local test records and keep paid work stopped. Their labelled screenshots are regression evidence, not public product claims. Public screenshots follow `SCREENSHOT_PROFILE.md`.
