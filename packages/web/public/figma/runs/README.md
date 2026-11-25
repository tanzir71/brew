# Settings assets

Local SVG exports from [Brew / Settings — Where Brew runs](https://www.figma.com/design/NcqNdBhgeg6om2CCZwrYV8/Brew?node-id=15-2010), obtained through Figma's design context.

`src/components/figmaAssets.ts` maps the export filenames to their design slots:
wordmark point, mode chip, search, library navigation, settings navigation,
current-mode icon, badge dots, and export/import buttons. SVG contents are
unchanged. Call sites use their native dimensions (6, 14, 15, 16, or 22 pixels;
the wordmark point is 5 × 10). The settings e2e verifies every rendered image
loads locally and retains its exported geometry in both themes.

There are no temporary Figma URLs in runtime code.
