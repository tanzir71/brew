# Brew website

The design source is [Brew / Landing, frame 18:2](https://www.figma.com/design/NcqNdBhgeg6om2CCZwrYV8/Brew?node-id=18-2). The thirteen section components retain Figma node IDs so rendered elements can be checked against their design layers. Decorative product illustrations are HTML and original exported artwork, never screenshots of the design.

`assets.json` records the source section, export name, SHA-256 and original SVG dimensions. Exports live in `docs/assets/figma`. The wordmark, fonts and palette come from the actual app's shared components and tokens.

Run `npm run website:build` to generate `docs/index.html`, styles and the demo. Edit `website/` source rather than the generated pages. Run `npm run website:og` after landing changes to capture the rendered page's social image.

The demo builds the real app with an isolated transport. Its sample responses and text exports come from an in-memory Node instance using the same native fixtures as the app's browser checks. Changes and preferences live only in the current tab. Server actions unavailable in the demo report that limitation. Compose preview uses the shared core renderer.

Verification:

- `npm run website:verify`: local links at root and project bases, export hashes and SVG root dimensions.
- `npm run website:browser`: 1440px Figma section geometry, each image's design slot and rendered dimensions, responsive landing, actual demo interactions and absence of third-party requests or page errors.
- `npm run website:lighthouse`: mobile and desktop reports in `test-results/website/lighthouse`.

The landing states which runtimes and AI features remain in development. Changes to those claims require implementation evidence; a design illustration does not make a feature available.
