import { iconSymbols, iconViewBoxes, type IconName } from './icons.generated';

export type { IconName } from './icons.generated';
/** Mount once per document; all geometry comes from checked Figma exports. */
export function IconSprite() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="brew-icon-sprite"
      dangerouslySetInnerHTML={{ __html: iconSymbols }}
    />
  );
}
export function Icon({
  name,
  size = 20,
  label,
  className = '',
}: {
  name: IconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      className={`brew-icon ${className}`}
      width={size}
      height={size}
      viewBox={iconViewBoxes[name]}
      fill="none"
      focusable="false"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <use href={`#brew-icon-${name}`} />
    </svg>
  );
}
