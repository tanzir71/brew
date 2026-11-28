import {
  useId,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
  type DragEventHandler,
} from 'react';
import { Icon } from './Icon';
import { Badge, type BadgeTone } from './Badge';
import { Avatar, Chip, IconButton, SegmentedControl, type SegmentOption } from './controls';

export function TopBar({
  brews,
  brewId,
  onBrewChange,
  view,
  onViewChange,
  date,
  onPrevious,
  onNext,
  onMarkAllRead,
  markAllDisabled = false,
  onMore,
  rightActions,
}: {
  brews: readonly { id: string; name: string }[];
  brewId: string;
  onBrewChange: (id: string) => void;
  view: 'read' | 'compose';
  onViewChange: (view: 'read' | 'compose') => void;
  date: string;
  onPrevious?: () => void;
  onNext?: () => void;
  onMarkAllRead?: () => void;
  markAllDisabled?: boolean;
  onMore?: () => void;
  rightActions?: ReactNode;
}) {
  return (
    <header className="brew-topbar">
      <div className="brew-topbar-left">
        <Icon name="brew" size={18} />
        <label className="brew-brew-switcher">
          <span className="sr-only">Brew</span>
          <select value={brewId} onChange={(e) => onBrewChange(e.target.value)}>
            {brews.map((brew) => (
              <option key={brew.id} value={brew.id}>
                {brew.name}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
      </div>
      <SegmentedControl
        label="Brew view"
        options={[
          { value: 'read', label: 'Read' },
          { value: 'compose', label: 'Compose' },
        ]}
        value={view}
        onValueChange={(value) => onViewChange(value as 'read' | 'compose')}
      />
      <div className="brew-topbar-right">
        {rightActions ?? (
          <>
            <IconButton
              icon="chevron-left"
              label="Previous Brew"
              disabled={!onPrevious}
              onClick={onPrevious}
            />
            <span>{date}</span>
            <IconButton
              icon="chevron-right"
              label="Next Brew"
              disabled={!onNext}
              onClick={onNext}
            />
            {onMarkAllRead && (
              <>
                <span className="brew-topbar-divider" />
                <button
                  type="button"
                  className="brew-topbar-mark"
                  data-brew-action="mark-all-read"
                  disabled={markAllDisabled}
                  onClick={onMarkAllRead}
                >
                  <Icon name="check" size={14} />
                  Mark all read
                </button>
              </>
            )}
            {onMore && <IconButton icon="more" label="More actions" onClick={onMore} />}
          </>
        )}
      </div>
    </header>
  );
}
export function SectionCard({
  title,
  expanded,
  onExpandedChange,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  summary,
  children,
  titleEditor,
  sectionId,
  headingLevel = 3,
}: {
  title: string;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart?: DragEventHandler<HTMLButtonElement>;
  onDragOver?: DragEventHandler<HTMLElement>;
  onDrop?: DragEventHandler<HTMLElement>;
  summary?: ReactNode;
  children: ReactNode;
  titleEditor?: ReactNode;
  sectionId?: string;
  headingLevel?: 2 | 3;
}) {
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      className="brew-section-card"
      data-expanded={expanded}
      aria-label={title}
      data-brew-kind="section"
      data-brew-id={sectionId}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={(event) => {
        if (!event.altKey) return;
        const move =
          event.key === 'ArrowUp' ? onMoveUp : event.key === 'ArrowDown' ? onMoveDown : undefined;
        if (move) {
          event.preventDefault();
          move();
        }
      }}
    >
      <header>
        <button
          type="button"
          className="brew-drag-handle"
          draggable={Boolean(onDragStart)}
          onDragStart={onDragStart}
          aria-label={`Drag ${title} to reorder`}
          title="Drag to reorder, or use Move up/down and Alt+Arrow keys"
        >
          <Icon name="grip" size={16} />
        </button>
        <Heading>{titleEditor ?? title}</Heading>
        <span className="brew-spacer" />
        <IconButton
          icon="arrow-up"
          label={`Move ${title} up`}
          onClick={onMoveUp}
          disabled={!onMoveUp}
        />
        <IconButton
          icon="arrow-down"
          label={`Move ${title} down`}
          onClick={onMoveDown}
          disabled={!onMoveDown}
        />
        <button
          type="button"
          className="brew-icon-button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => onExpandedChange(!expanded)}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={15} />
        </button>
      </header>
      <div id={id} hidden={!expanded} className="brew-section-body">
        {children}
      </div>
      {!expanded && summary && <div className="brew-section-summary">{summary}</div>}
    </section>
  );
}
function SentenceTokenFrame({
  label,
  kind,
  size,
  children,
}: {
  label: string;
  kind: 'field' | 'value';
  size: 'sm' | 'md';
  children: ReactNode;
}) {
  return (
    <label className={`brew-token brew-token--${kind} brew-token--${size}`}>
      <span className="sr-only">{label}</span>
      {children}
    </label>
  );
}
export function SentenceTokenSelect({
  'aria-label': label,
  kind = 'field',
  size = 'md',
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  'aria-label': string;
  kind?: 'field' | 'value';
  size?: 'sm' | 'md';
}) {
  return (
    <SentenceTokenFrame label={label} kind={kind} size={size}>
      <select {...props} aria-label={label}>
        {children}
      </select>
      <Icon name="chevron-down" size={size === 'sm' ? 11 : 12} />
    </SentenceTokenFrame>
  );
}
export function SentenceToken({
  label,
  value,
  onValueChange,
  options,
  kind = 'field',
  size = 'md',
  disabled = false,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options?: readonly SegmentOption[];
  kind?: 'field' | 'value';
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  return (
    <SentenceTokenFrame label={label} kind={kind} size={size}>
      {options ? (
        <>
          <select
            aria-label={label}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={disabled}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={size === 'sm' ? 11 : 12} />
        </>
      ) : (
        <input
          aria-label={label}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={disabled}
          style={{ width: `${Math.max(3, Array.from(value).length + 1)}ch` }}
        />
      )}
    </SentenceTokenFrame>
  );
}
export function Stepper({
  label,
  value,
  onValueChange,
  min = 1,
  max = 20,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const change = (next: number) => {
    if (Number.isFinite(next)) onValueChange(Math.min(max, Math.max(min, next)));
  };
  return (
    <span className="brew-stepper" role="group" aria-label={label}>
      <button
        type="button"
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
        onClick={() => change(value - step)}
      >
        −
      </button>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => change(e.currentTarget.valueAsNumber)}
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        aria-label={`Increase ${label}`}
        onClick={() => change(value + step)}
      >
        +
      </button>
    </span>
  );
}
export function Select({
  label,
  hideLabel = false,
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: boolean }) {
  const labelId = useId();
  return (
    <label className={`brew-select-label ${className}`}>
      <span id={labelId} className={hideLabel ? 'sr-only' : ''}>
        {label}
      </span>
      <span className="brew-select">
        <select aria-labelledby={props['aria-label'] ? undefined : labelId} {...props}>
          {children}
        </select>
        <Icon name="chevron-down" size={14} />
      </span>
    </label>
  );
}
export function LetterCard({
  senderId,
  sender,
  initial,
  time,
  title,
  excerpt,
  trackersRemoved,
  href,
  onRead,
  avatarColor,
}: {
  senderId: string | number;
  sender: string;
  initial: string;
  time: string;
  title: string;
  excerpt: string;
  trackersRemoved: number;
  href: string;
  onRead?: () => void;
  avatarColor?: number;
}) {
  const id = useId();
  return (
    <article className="brew-letter-card" aria-labelledby={id}>
      <header>
        <Avatar id={senderId} initial={initial} tone={avatarColor} />
        <span>{sender}</span>
        <time>{time}</time>
      </header>
      <h3 id={id}>{title}</h3>
      <p>{excerpt}</p>
      <footer>
        <Icon name="shield" size={13} />
        <span>{trackersRemoved} trackers removed</span>
        <a href={href} onClick={onRead}>
          Read letter
        </a>
      </footer>
    </article>
  );
}
export function ArticleRow({
  title,
  source,
  time,
  unread = true,
  selected = false,
  highlightColor,
  ruleLabel,
  starred = false,
  onSelect,
  onStar,
  onRead,
  href,
}: {
  title: string;
  source: string;
  time: string;
  unread?: boolean;
  selected?: boolean;
  highlightColor?: string;
  ruleLabel?: string;
  starred?: boolean;
  onSelect: () => void;
  onStar: () => void;
  onRead: () => void;
  href: string;
}) {
  return (
    <article
      className="brew-article-row"
      data-selected={selected}
      data-read={!unread}
      style={
        highlightColor ? { borderLeft: `3px solid ${highlightColor}`, paddingLeft: 17 } : undefined
      }
    >
      <button
        type="button"
        className="brew-article-select"
        onClick={onSelect}
        aria-pressed={selected}
      >
        <span className="brew-unread-dot" data-unread={unread} />
        <span>{title}</span>
        <time>{time}</time>
      </button>
      <div className="brew-article-meta">
        <span>{source}</span>
        {ruleLabel && <Chip icon={<Icon name="rules" size={14} />}>{ruleLabel}</Chip>}
        <span className="brew-spacer" />
        {selected && (
          <>
            <IconButton
              icon="star"
              label={starred ? 'Unstar article' : 'Star article'}
              aria-pressed={starred}
              onClick={onStar}
            />
            <IconButton
              icon="check"
              label={unread ? 'Mark article read' : 'Mark article unread'}
              onClick={onRead}
            />
            <a
              href={href}
              className="brew-icon-button"
              aria-label="Open original"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" size={15} />
            </a>
          </>
        )}
      </div>
    </article>
  );
}
export function CapabilityRow({
  icon,
  title,
  description,
  badge,
  setup,
  control,
  appearance = 'default',
  id,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  badge: { tone: BadgeTone; label: string };
  setup?: { label: string; href: string };
  control?: ReactNode;
  appearance?: 'default' | 'table';
  id?: string;
}) {
  return (
    <div
      className={appearance === 'table' ? 'runs-capability-row' : 'brew-capability-row'}
      data-brew-kind="capability"
      data-brew-state={badge.tone}
      data-capability={id}
    >
      {icon}
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {setup && (
        <a
          className={appearance === 'default' ? 'brew-compact-control' : undefined}
          href={setup.href}
          aria-label={`${setup.label} ${title}`}
        >
          {setup.label}
        </a>
      )}
      <Badge tone={badge.tone}>{badge.label}</Badge>
      {control}
    </div>
  );
}
export function CodeBlock({
  code,
  label = 'Code',
  copyable = false,
}: {
  code: string;
  label?: string;
  copyable?: boolean;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className="brew-code-block">
      <pre aria-label={label} tabIndex={0}>
        <code>
          {code.split('\n').map((line, index) => (
            <span key={index}>{line || '\u00a0'}</span>
          ))}
        </code>
      </pre>
      {copyable && (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopyState('copied');
            } catch {
              setCopyState('failed');
            }
          }}
        >
          {copyState === 'copied' ? 'Copied' : 'Copy code'}
        </button>
      )}
      {copyState === 'failed' && (
        <span role="alert">Could not copy. Select the code to copy it manually.</span>
      )}
    </div>
  );
}
