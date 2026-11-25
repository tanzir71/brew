const exports = {
  folder: { src: '/figma/components/82232.svg', width: 14, height: 14 },
  search: { src: '/figma/components/872aa.svg', width: 16, height: 16 },
  lock: { src: '/figma/components/291ba.svg', width: 11, height: 11 },
  point: { src: '/figma/components/fb52b.svg', width: 5, height: 10 },
} as const;

/** The original SVG alpha geometry at its exported size, painted by the theme. */
export function ExportedIcon({ name }: { name: keyof typeof exports }) {
  const asset = exports[name];
  return (
    <span
      className="brew-exported-icon"
      aria-hidden="true"
      data-figma-asset={asset.src}
      style={{ width: asset.width, height: asset.height, maskImage: `url("${asset.src}")` }}
    />
  );
}
