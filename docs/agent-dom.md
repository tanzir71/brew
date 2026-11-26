# Agent DOM implementation

M12 is in progress. Passing the core journey does not complete the nine-item DOM
checklist or the later agent-mode, OpenAPI, MCP, token/log, WebMCP and llms.txt work.
The M12 DOM acceptance checkbox stays open until the remaining work below is done.

## Current evidence

`web/e2e/agent.spec.ts` drives the actual Node API and SQLite through the UI. Its
fixture seeds a library and one Brew; subsequent triage, exports and writes use
real controls. The journey opens an article, reads/stars/tags it, creates a tag,
uses the More sheet, opens Markdown and JSON in new tabs, cancels then confirms
bulk read, undoes the actual scoped server update, saves a rule, changes a Compose
section and channel preference, and generates an issue. It asserts both visible
state/hooks and persisted results.

ESLint restricts that file's UI selectors to `getByRole` and `getByLabel`, rejecting
CSS/test-ID/text/placeholder/title selectors and injected DOM evaluation. Browser
setup, navigation, response inspection and SQL assertions remain available to
provide real fixtures and independently verify results. Other suites can inspect
metadata and geometry directly; they do not substitute for this agent journey.

## Checklist coverage

| Requirement | Implemented evidence | Remaining work before the criterion is complete |
| --- | --- | --- |
| Landmarks | Existing Brew Library/main/In this Brew; named Reader Library navigation; real article landmarks inside Reader dialogs and newsletter panes. | Audit every other implemented view and dialog, including settings and older shell variants. |
| Native controls | Reader scope/folder/feed navigation uses real hrefs and browser history. Rows offer real Open buttons; pointer convenience preserves normal card clicks. Article actions and bulk confirmation use real controls. | Convert remaining navigation-like toolbar controls and audit all icon-only labels and toggles. |
| Stable hooks | Article rows/panes share `data-brew-id`, kind and read/unread/starred/highlighted state. Newsletter rows/panes and frozen Brew letters identify as letters; rules expose identity/enablement/actions; Compose already identifies sections. | Audit the rest of each screen's actions, settings and result rows. |
| Accessible alternatives | Article actions are available directly and in a native More sheet. Existing Compose drag controls retain button/keyboard alternatives. | Add/audit More equivalents and focus/selection behavior on remaining rows and screens. |
| Polite results | Existing Compose/Brew status plus explicit Reader bulk result live region and real Undo. | Audit success/error announcements for every other mutation and error/retry path. |
| Totals and pagination | Newsletter totals/pages exist; Reader still has the existing normal virtual list. | Accurate list totals, remaining list announcements and agent-mode pagination/no-motion/no-scroll-marking. |
| Confirmation and undo | Reader bulk click and Shift+A now confirm through the same native sheet, with cancel causing no writes; actual server Undo is retained. Existing Brew/Compose behavior remains tested. | Rule apply/delete and feed/folder destructive undo, plus an audit of all other bulk/destructive paths. |
| Text twins | Frozen Brew twins/feeds plus private article twins, including letters. Selected article discovery overrides the underlying Brew twins and restores them on close; subscription links remain separate. | List/search/Compose/rules/settings and other page twins and alternate links, matching current URL state. |
| Visible state and targets | Read/star/tag changes update real controls and stable state; new article Open target is at least 24px; More/confirmation reuse existing controls. | Full target-size/focus/overlay and post-action visibility audit across every implemented screen. |

## Article twins

`GET`/`HEAD /a/:id.md` and `/a/:id.json` use portable core renderers and Hono routes,
with narrow forwarding through Node and Vite. They prefer cleaned extracted full
text, then stored content/summary. Rich HTML is sanitized again and Markdown uses
the existing safe converter. They resolve local links/proxied images with the
request origin or configured canonical origin, and omit raw newsletter originals,
cleaning details, source configuration and mutable reading state.

The responses are private/no-store/no-index with explicit media types and Link
headers. Missing or malformed IDs return JSON errors rather than a SPA/latest
fallback. Reads never mark items read, extract content or write the database.
Capabilities govern availability and discovery. Unsupported formats remain
visible with a setup path. No static publication is enabled.

Backend tests verify real SQLite read-only behavior, cleaned content, canonical
URLs, media types/HEAD and invalid identities. Browser tests verify alternate-link
precedence/restoration, direct HTML article URLs and unavailable-format discovery.
Compiled Node smoke verifies article twins and the separate HTML SPA route outside
the repository working directory. The captured v1 DTOs remain unchanged.
