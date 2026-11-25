# M10 newsletter exit review

The browser review ingests complete MIME messages through the Node pipeline and
renders their stored content in Newsletters, sandboxed originals and a generated
Brew. The fixtures are synthetic publisher templates; no private mail or external
mail provider is used.

The [20 shared cases](../packages/core/test/newsletter-corpus.ts) cover table
digests, inline/hidden/open-endpoint pixels, UTM identifiers, Mailchimp, Sendgrid,
Mandrill, Substack and Beehiiv redirects, four sponsor patterns, two footer
patterns, preheaders/active HTML, a retained publisher image, a legitimate
editorial sponsor mention and per-sender selectors. The browser envelopes add a
doctype, document head, table layout, remote CSS/background references, script and
iframe. This exposed and fixed a full-document parsing crash that fragment-only
fixtures had missed.

For every case in both themes, the test verifies readable editorial content,
removed sponsor/footer/tracking text, expected cleaning counts, normal typography,
inert DOM and zero external browser requests. The positive image loads through the
actual image proxy using local fixture bytes. Editorial sponsor discussion and
safe editorial links remain. Originals retain uncleaned text while disabling
images, links and active content. The generated full-depth Brew renders all 20
cleaned bodies; opening letters updates live read state without changing the saved
issue payload.

The four `newsletter-corpus-*.png` contact sheets in the
[exit snapshots](../web/e2e/newsletter-exit.spec.ts-snapshots/) contain captures of
the actual product body for each case. They are review artifacts, not runtime
assets.

## Figma comparison

References: [Read light](https://www.figma.com/design/NcqNdBhgeg6om2CCZwrYV8/Brew?node-id=8-2),
[letter section](https://www.figma.com/design/NcqNdBhgeg6om2CCZwrYV8/Brew?node-id=8-343)
and [Read dark](https://www.figma.com/design/NcqNdBhgeg6om2CCZwrYV8/Brew?node-id=9-270).
The light/dark section and full-page goldens use four real ingested letters in a
generated issue, with the existing native Read illustrations supplied as RSS data.

| Element        | Reviewed geometry and behavior                                              |
| -------------- | --------------------------------------------------------------------------- |
| Section        | 680px wide; 22/28 heading; actual letter/sender counts; working Open inbox  |
| Grid           | Two 332px columns, 16px gap; one column on a narrow screen                  |
| Card           | 18px padding, 1px border, 12px radius; 193px/174px fixture row heights      |
| Sender         | Native 24px Avatar, 12/16 label, right-aligned issue-relative timestamp     |
| Copy           | Newsreader 18/24 title; Instrument Sans 13/19 excerpt from cleaned text     |
| Footer         | Native 13px shield, actual frozen cleaning note, working Read letter button |
| Actions        | Keyboard-accessible Open/Star/read controls on selection/focus              |
| Native imagery | 680×340 lead and three 120×84 images; unchanged local Figma exports         |

The opt-in Brief panel is absent while AI is off, following the annotation on
`8:354`; implementing Briefs belongs to M17. Counts, issue number, reading time,
mode and navigation reflect actual fixture data. The sample's invented totals and
muted-sender count are not copied. Existing shared sidebar behavior is retained.

New v2 issue items freeze optional `newsletter.cleaning` metadata and a bounded,
escaped excerpt. Legacy issues remain readable and are not rewritten. Card dates
use the issue date and IANA time zone, including daylight-saving boundaries.
Scroll position and live read/star state remain separate from the frozen payload.
The contents observer tracks all intersecting sections so returning to the top
restores the correct rail selection. The new letter-section and full-page goldens
use exact pixel comparison; the geometry assertions also pin card and native-image
sizes.

Run `npm run test:e2e -- web/e2e/newsletter-exit.spec.ts --workers=1` for this
review. The full typecheck, lint, unit, browser and production-build gates are
recorded in [PROGRESS.md](../PROGRESS.md).
