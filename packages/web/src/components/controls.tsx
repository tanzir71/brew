import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { Icon, type IconName } from './Icon';
import { ExportedIcon } from './ExportedIcon';
import { avatarTone } from './avatarTone';
import { agentPageHref } from '../agentLocation';

type ButtonBase = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'accent';
  size?: 'md' | 'sm';
  icon?: ReactNode;
  buttonRef?: Ref<HTMLButtonElement>;
};
type ButtonProps = ButtonBase &
  ({ children: ReactNode } | { children?: never; 'aria-label': string; icon: ReactNode });
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  buttonRef,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={buttonRef}
      type={type}
      className={`brew-button brew-button--${variant} brew-button--${size} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
export function IconButton({
  icon,
  label,
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string }) {
  return (
    <button type="button" aria-label={label} className={`brew-icon-button ${className}`} {...props}>
      <Icon name={icon} size={15} />
    </button>
  );
}
export function Toggle({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  hideLabel = false,
  id,
  className = '',
  action,
  descriptionId,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  id?: string;
  className?: string;
  action?: string;
  descriptionId?: string;
}) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <span className="brew-toggle-label">
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        aria-describedby={descriptionId}
        data-brew-action={action}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={`brew-toggle ${className}`}
      >
        <span />
      </button>
      <label htmlFor={controlId} className={hideLabel ? 'sr-only' : ''}>
        {label}
      </label>
    </span>
  );
}
export type SegmentOption = { value: string; label: string; disabled?: boolean };
export function Segment({
  selected,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role'> & { selected: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      className="brew-segment"
      {...props}
    >
      {children}
    </button>
  );
}
export function SegmentedControl({
  label,
  options,
  value,
  onValueChange,
  className = '',
}: {
  label: string;
  options: readonly SegmentOption[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const enabled = options.filter((option) => !option.disabled);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`brew-segmented ${className}`}
      onKeyDown={(event) => {
        const index = enabled.findIndex((option) => option.value === value);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? enabled.length - 1
              : ['ArrowRight', 'ArrowDown'].includes(event.key)
                ? (index + 1) % enabled.length
                : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                  ? (index - 1 + enabled.length) % enabled.length
                  : -1;
        if (next < 0 || !enabled[next]) return;
        event.preventDefault();
        onValueChange(enabled[next].value);
        const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]:not(:disabled)',
        );
        radios.item(next)?.focus();
      }}
    >
      {options.map((option) => (
        <Segment
          key={option.value}
          selected={value === option.value}
          disabled={option.disabled}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </Segment>
      ))}
    </div>
  );
}
export function NavItem({
  href,
  active = false,
  count,
  calm = false,
  icon,
  children,
  className = '',
}: {
  href: string;
  active?: boolean;
  count?: number;
  calm?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={agentPageHref(href)}
      className={`brew-nav-item ${className}`}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span className="brew-nav-label">{children}</span>
      {!calm && count !== undefined && count > 0 && <span className="brew-nav-count">{count}</span>}
    </a>
  );
}
export function Checkbox({
  label,
  hideLabel = false,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
  hideLabel?: boolean;
}) {
  return (
    <label className={`brew-checkbox-label ${className}`}>
      <span className="brew-checkbox-box">
        <input type="checkbox" {...props} />
        <Icon name="check" size={12} />
      </span>
      <span className={hideLabel ? 'sr-only' : ''}>{label}</span>
    </label>
  );
}
export function Avatar({
  id,
  initial,
  size = 24,
  tone,
}: {
  id: string | number;
  initial: string;
  size?: 24 | 32;
  tone?: number;
}) {
  return (
    <span
      className={`brew-avatar brew-avatar--${size}`}
      aria-hidden="true"
      style={{ background: `var(--brew-art-${tone ?? avatarTone(id)})` }}
    >
      {Array.from(initial)[0]?.toLocaleUpperCase()}
    </span>
  );
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="brew-kbd">{children}</kbd>;
}
export function Input({
  label,
  hideLabel = false,
  inputRef,
  icon,
  endAdornment,
  className = '',
  id,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label: string;
  hideLabel?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  icon?: ReactNode;
  endAdornment?: ReactNode;
}) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <label className={`brew-input-label ${className}`} htmlFor={controlId}>
      <span className={hideLabel ? 'sr-only' : ''}>{label}</span>
      <span className="brew-input-shell">
        {icon}
        <input id={controlId} ref={inputRef} aria-label={label} {...props} />
        {endAdornment}
      </span>
    </label>
  );
}
export function Chip({
  children,
  icon = <ExportedIcon name="folder" />,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span className="brew-chip">
      {icon}
      {children}
    </span>
  );
}
export function Wordmark() {
  return (
    <span className="brew-wordmark">
      Brew
      <ExportedIcon name="point" />
    </span>
  );
}
