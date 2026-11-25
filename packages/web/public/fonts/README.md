# Local UI fonts

Newsreader, Instrument Sans and Geist Mono are distributed under the included
SIL Open Font License files. Latin and Latin Extended WOFF2 subsets were fetched
from the Google Fonts CSS API on 2026-11-25. `src/styles/fonts.css` references
only these local files and uses `font-display: swap`.

The settings page uses these fonts now. The remaining v1 views move to this
type system in M8. The app never requests a font from a third-party host.
