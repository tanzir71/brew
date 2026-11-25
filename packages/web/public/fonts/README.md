# Local UI fonts

Newsreader, Instrument Sans and Geist Mono are distributed under the included
SIL Open Font License files. Latin and Latin Extended WOFF2 subsets were fetched
from the Google Fonts CSS API on 2026-11-25. `src/styles/fonts.css` references
only these local files and uses `font-display: swap`.

The app uses Instrument Sans for UI, Newsreader for reading, and Geist Mono for
code. `design/tokens.json` records the 17 Figma type styles; regenerate their
CSS variables and utilities with `npm run tokens:generate`. The foundation
fixture at `/test/type.html` exercises every style and both Latin subsets.
Browser tests verify the actual custom fonts, local WOFF2 responses, swap
loading, and zero third-party font requests across the app.
