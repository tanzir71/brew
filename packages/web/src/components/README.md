# Brew components

Figma source nodes are recorded in `design/components.json`. Import controls
from `controls.tsx`, composites from `patterns.tsx`, and sheets from `Sheet.tsx`.
The shared stylesheet is loaded by the web entry. These components read the
generated color, type, space, radius and elevation variables.

Mount `IconSprite` once per document (the app already does). `Icon` accepts a
typed name, a rendered size and an optional accessible label; decorative icons
are hidden from assistive technology. `IconButton` always needs a label.
The 53 original Figma SVGs remain in `public/figma/icons`; their normalized
checksums, node IDs and unmodified viewBoxes are in `design/icons.json`.
`npm run icons:generate` rebuilds the symbols. `npm run icons:check` rejects
changed sources or stale generated output, and runs with lint/build.

| Control                    | Contract                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button                     | Native button; `variant` primary/secondary/ghost/accent, `size` md/sm, optional icon. Default type is button. Icon-only buttons require an accessible label. Use at most one accent button per product view. |
| Badge                      | Positive, warning, locked, neutral or accent; status is always written as text.                                                                                                                              |
| Toggle, Checkbox           | Native keyboard interaction; explicit labels and disabled state. Toggle is a button with switch semantics.                                                                                                   |
| Segment, SegmentedControl  | Radio semantics; group supplies roving focus, arrows, Home/End and disabled-option skipping.                                                                                                                 |
| NavItem                    | Real link, active page state, optional icon/count; `calm` suppresses the count.                                                                                                                              |
| Avatar                     | Stable ID hash picks art/1–8; 24/32 sizes. `tone` allows a fixed artwork fill in editorial fixtures.                                                                                                         |
| Kbd, Input, Chip, Wordmark | Semantic keyboard label, labelled input, source chip, Newsreader brand with the original copper point export.                                                                                                |
| TopBar                     | Controlled Brew selector and Read/Compose segment, date navigation, mark-all and more callbacks.                                                                                                             |
| SectionCard                | Controlled expansion, visible drag handle, Move up/down buttons and Alt+Arrow alternatives. Parent owns ordering and drag/drop updates.                                                                      |
| SentenceToken              | Labelled native select or editable value; copper field and bordered value styles; regular and compact sizes.                                                                                                 |
| Stepper, Select            | Labelled native numeric/select controls. Stepper clamps changes and disables boundary buttons.                                                                                                               |
| LetterCard, ArticleRow     | Sender metadata and reading link; selected article actions stay visible with independent accessible controls.                                                                                                |
| CapabilityRow              | Visible badge, setup link and control. Callers derive state from capabilities; unavailable controls remain visible and disabled.                                                                             |
| SideSheet, ModalSheet      | Controlled native modal dialog; labelled header, footer slot, scroll locking, Tab wrapping, Escape/backdrop dismissal and opener focus restoration.                                                          |
| CodeBlock                  | Inverse colors and exact whitespace; optional copy button with success/failure feedback.                                                                                                                     |

Preview `/test/components.html` for the primitive catalog. Add `?view=icons`,
`?view=composites` or `?view=sidebar`; add `&theme=dark` for dark mode.
Fixtures exercise real controls with local state and stay outside production
entry points. Browser checks cover both palettes, all source icon geometry,
keyboard and pointer interactions, Calm counts, gating and accessibility.
