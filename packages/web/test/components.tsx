import { StrictMode, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppSidebar } from '../src/components/AppSidebar';
import { ExportedIcon } from '../src/components/ExportedIcon';
import { Icon, IconSprite, type IconName } from '../src/components/Icon';
import { Badge, type BadgeTone } from '../src/components/Badge';
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  Input,
  Kbd,
  NavItem,
  Segment,
  SegmentedControl,
  Toggle,
  Wordmark,
} from '../src/components/controls';
import {
  ArticleRow,
  CapabilityRow,
  CodeBlock,
  LetterCard,
  SectionCard,
  Select,
  SentenceToken,
  Stepper,
  TopBar,
} from '../src/components/patterns';
import { ModalSheet, SideSheet } from '../src/components/Sheet';
import icons from '../../../design/icons.json';
import '../src/styles.css';
import './components.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.resolvedTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const options = (values: string[]) => values.map((value) => ({ value, label: value }));
const svg = (name: string) => <ExportedIcon name={name === '82232' ? 'folder' : 'search'} />;

export function PrimitiveFoundations() {
  const [toggle, setToggle] = useState(true);
  const [otherToggle, setOtherToggle] = useState(false);
  const [checked, setChecked] = useState(true);
  const [otherChecked, setOtherChecked] = useState(false);
  const [segment, setSegment] = useState('first');
  return (
    <main className="component-foundations" aria-label="Component foundations">
      <div className="foundation-variants" aria-label="Buttons">
        {(['primary', 'secondary', 'ghost', 'accent'] as const).flatMap((variant) =>
          (['md', 'sm'] as const).map((size) => (
            <Button key={`${variant}-${size}`} variant={variant} size={size}>
              Button
            </Button>
          )),
        )}
      </div>
      <div className="foundation-variants" aria-label="Badges">
        {(['positive', 'warning', 'locked', 'neutral', 'accent'] as BadgeTone[]).map((tone) => (
          <Badge tone={tone} key={tone}>
            Works here
          </Badge>
        ))}
      </div>
      <div className="foundation-variants">
        <Toggle label="On toggle" hideLabel checked={toggle} onCheckedChange={setToggle} />
        <Toggle
          label="Off toggle"
          hideLabel
          checked={otherToggle}
          onCheckedChange={setOtherToggle}
        />
      </div>
      <div className="foundation-variants" role="radiogroup" aria-label="Segments">
        <Segment selected={segment === 'first'} onClick={() => setSegment('first')}>
          Segment
        </Segment>
        <Segment selected={segment === 'second'} onClick={() => setSegment('second')}>
          Segment
        </Segment>
      </div>
      <div className="foundation-variants">
        <NavItem href="#active" active count={12} icon={<Icon name="newspaper" size={16} />}>
          Item
        </NavItem>
        <NavItem href="#default" count={12} icon={<Icon name="newspaper" size={16} />}>
          Item
        </NavItem>
      </div>
      <div className="foundation-variants">
        <Checkbox
          label="Checked checkbox"
          hideLabel
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <Checkbox
          label="Unchecked checkbox"
          hideLabel
          checked={otherChecked}
          onChange={(e) => setOtherChecked(e.target.checked)}
        />
      </div>
      <div className="foundation-variants">
        <Avatar id="foundation" initial="F" tone={1} />
        <Avatar id="foundation" initial="F" size={32} tone={1} />
      </div>
      <Kbd>K</Kbd>
      <Input
        label="Foundation input"
        hideLabel
        placeholder="Placeholder"
        icon={svg('872aa')}
        className="foundation-input"
      />
      <Chip icon={svg('82232')}>Design</Chip>
      <Wordmark />
    </main>
  );
}

export function IconFoundations({ reference = false }: { reference?: boolean }) {
  return (
    <section
      className="icon-foundations"
      aria-label={reference ? 'Original icon exports' : 'Icon foundations'}
    >
      {icons.icons.map((icon) =>
        reference ? (
          <img src={`/figma/icons/${icon.name}.svg`} alt="" key={icon.name} />
        ) : (
          <Icon key={icon.name} name={icon.name as IconName} label={icon.name} />
        ),
      )}
    </section>
  );
}
const exampleCode =
  '{\n  "mcpServers": {\n    "brew": {\n      "type": "http",\n      "url": "https://brew.example/mcp",\n      "headers": { "Authorization": "Bearer brew_ro_••••••••" }\n    }\n  }\n}';
const source = <Chip icon={<Icon name="inbox" size={14} />}>All senders</Chip>;
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="brew-field">
      <span className="brew-field-label">{label}</span>
      <div className="brew-field-value">{children}</div>
    </div>
  );
}
export function CompositeFoundations() {
  const [view, setView] = useState<'read' | 'compose'>('read');
  const [brew, setBrew] = useState('morning');
  const [message, setMessage] = useState('');
  const [layout, setLayout] = useState('Lead');
  const [depth, setDepth] = useState('Excerpt');
  const [items, setItems] = useState(4);
  const [images, setImages] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [order, setOrder] = useState('newest');
  const [operator, setOperator] = useState('contains');
  const [field, setField] = useState('title');
  const [term, setTerm] = useState('figma');
  const [expanded, setExpanded] = useState('design');
  const [cards, setCards] = useState(['design', 'letters']);
  const [selected, setSelected] = useState(true);
  const [unread, setUnread] = useState(true);
  const [starred, setStarred] = useState(false);
  const [modal, setModal] = useState(false);
  const [side, setSide] = useState(false);
  const [name, setName] = useState('');
  const focus = useRef<HTMLInputElement>(null);
  const dragged = useRef<string>();
  const move = (id: string, delta: number) =>
    setCards((current) => {
      const next = [...current];
      const index = next.indexOf(id);
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  return (
    <main className="composite-foundations" aria-label="Composite foundations">
      <TopBar
        brews={[
          { id: 'morning', name: 'Morning' },
          { id: 'weekend', name: 'Weekend' },
        ]}
        brewId={brew}
        onBrewChange={setBrew}
        view={view}
        onViewChange={setView}
        date="Wed 25 Nov"
        onPrevious={() => setMessage('Previous Brew')}
        onNext={() => setMessage('Next Brew')}
        onMarkAllRead={() => setMessage('Marked all read')}
        onMore={() => setSide(true)}
      />
      <div className="composite-grid">
        <div className="composite-column">
          {cards.map((id, index) => (
            <SectionCard
              key={id}
              title={id === 'design' ? 'Design & craft' : 'From your newsletters'}
              expanded={expanded === id}
              onExpandedChange={(open) => setExpanded(open ? id : '')}
              onMoveUp={index ? () => move(id, -1) : undefined}
              onMoveDown={index < cards.length - 1 ? () => move(id, 1) : undefined}
              onDragStart={(event) => {
                dragged.current = id;
                event.dataTransfer.setData('text/plain', id);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged.current && dragged.current !== id)
                  setCards((current) => [...current].reverse());
                dragged.current = undefined;
              }}
              summary={
                <>
                  {source}
                  <span>Brief, then grid · up to 8</span>
                </>
              }
            >
              <Field label="From">
                <Chip icon={svg('82232')}>Design</Chip>
                <Chip icon={svg('82232')}>Independent</Chip>
                <button type="button" className="foundation-link" onClick={() => setModal(true)}>
                  + Source
                </button>
              </Field>
              <Field label="Layout">
                <SegmentedControl
                  label="Layout"
                  options={options(['Lead', 'Magazine', 'Grid', 'Headlines']).map((option) => ({
                    ...option,
                    disabled: params.has('disabled') && option.value === 'Magazine',
                  }))}
                  value={layout}
                  onValueChange={setLayout}
                />
              </Field>
              <Field label="Items">
                <Stepper label="Items" value={items} onValueChange={setItems} />
                <span className="foundation-caption">at most</span>
              </Field>
              <Field label="Show">
                <SegmentedControl
                  label="Show"
                  options={options(['Title', 'Excerpt', 'Full text', 'Brief'])}
                  value={depth}
                  onValueChange={setDepth}
                />
              </Field>
              <Field label="Options">
                <Toggle label="Images" checked={images} onCheckedChange={setImages} />
                <Toggle label="Unread only" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
              </Field>
              <Field label="Order">
                <Select
                  label="Order"
                  hideLabel
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </Select>
              </Field>
              <div className="brew-filter">
                <div className="brew-filter-sentence">
                  Only items where{' '}
                  <SentenceToken
                    label="Filter field"
                    size="sm"
                    options={options(['title', 'content', 'author'])}
                    value={field}
                    onValueChange={setField}
                  />
                  <SentenceToken
                    label="Filter operator"
                    size="sm"
                    value={operator}
                    options={options(['contains', 'is'])}
                    onValueChange={setOperator}
                  />
                  <SentenceToken
                    label="Filter value"
                    size="sm"
                    value={term}
                    onValueChange={setTerm}
                    kind="value"
                  />
                </div>
                <footer>
                  <button
                    className="foundation-link"
                    type="button"
                    onClick={() => setMessage('Condition added')}
                  >
                    + Condition
                  </button>
                  <span className="brew-spacer" />
                  Matches 4 of 11 unread now
                </footer>
              </div>
            </SectionCard>
          ))}
        </div>
        <div className="composite-column">
          <LetterCard
            senderId="interface"
            initial="I"
            sender="Interface Letters"
            avatarColor={5}
            time="06:12"
            title="Forms should declare their tools"
            excerpt="If an agent can fill your checkout, it shouldn’t have to guess what each field means. A short case for declaring intent in markup."
            trackersRemoved={3}
            href="#letter"
            onRead={() => setMessage('Letter opened')}
          />
          <ArticleRow
            title="Figma’s variables panel, a month in"
            source="Interface Letters"
            time="08:40"
            unread={unread}
            selected={selected}
            onSelect={() => setSelected(!selected)}
            highlightColor="var(--brew-highlight-sage)"
            ruleLabel="Figma mentions"
            starred={starred}
            onStar={() => setStarred(!starred)}
            onRead={() => setUnread(!unread)}
            href="https://example.test/article"
          />
          <div className="foundation-capabilities">
            <CapabilityRow
              icon={<Icon name="browser" size={18} />}
              title="In Brew"
              description="Always on. Each issue is kept for 30 days."
              badge={{ tone: 'positive', label: 'Works here' }}
            />
            <CapabilityRow
              icon={<Icon name="mail" size={18} />}
              title="Email"
              description="Connect a mail service to send your Brew."
              badge={{ tone: 'warning', label: 'Needs mail add-on' }}
              setup={{ label: 'Set up', href: '#mail' }}
              control={
                <Toggle
                  label="Email delivery"
                  hideLabel
                  checked={false}
                  disabled
                  onCheckedChange={() => undefined}
                />
              }
            />
          </div>
          <CodeBlock label="MCP setup" code={exampleCode} copyable />
          <div className="foundation-actions">
            <Button variant="secondary" onClick={() => setModal(true)}>
              Open modal sheet
            </Button>
            <Button onClick={() => setSide(true)}>Open side sheet</Button>
            <Button disabled>Unavailable action</Button>
            <NavItem href="#calm" calm count={23} icon={<Icon name="folder" size={16} />}>
              Calm navigation
            </NavItem>
          </div>
          <p role="status">{message}</p>
        </div>
      </div>
      <ModalSheet
        open={modal}
        title="Add a source"
        description="Choose a source for this section."
        onClose={() => setModal(false)}
        initialFocusRef={focus}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setMessage(`Added ${name || 'source'}`);
                setModal(false);
              }}
            >
              Add source
            </Button>
          </>
        }
      >
        <label className="brew-input-label">
          Source URL
          <span className="brew-input-shell">
            <Icon name="link" size={16} />
            <input ref={focus} value={name} onChange={(e) => setName(e.target.value)} />
          </span>
        </label>
        <p className="foundation-sheet-copy">Paste a feed or website address.</p>
      </ModalSheet>
      <SideSheet
        open={side}
        title="Schedule & delivery"
        description="When Morning is made, and where it goes."
        onClose={() => setSide(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMessage('Test sent')}>
              Send a test now
            </Button>
            <span className="brew-spacer" />
            <Button onClick={() => setSide(false)}>Save</Button>
          </>
        }
      >
        <Select label="Time zone" defaultValue="Asia/Dhaka">
          <option>Asia/Dhaka</option>
          <option>Europe/London</option>
        </Select>
        <div className="foundation-sheet-copy">
          <Toggle label="Skip small issues" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
        </div>
        <CapabilityRow
          icon={<Icon name="mail" size={18} />}
          title="Email"
          description="Connect a mail service."
          badge={{ tone: 'locked', label: 'Needs setup' }}
          control={
            <Toggle
              label="Send email"
              hideLabel
              checked={false}
              disabled
              onCheckedChange={() => undefined}
            />
          }
          setup={{ label: 'Set up', href: '#mail' }}
        />
      </SideSheet>
    </main>
  );
}
const view = params.get('view');
const client = new QueryClient();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconSprite />
    {view === 'sidebar' ? (
      <QueryClientProvider client={client}>
        <div className="runs-app sidebar-foundations">
          <AppSidebar activeHref="/?view=brew&brew=1" />
        </div>
      </QueryClientProvider>
    ) : view === 'icons' ? (
      <>
        <IconFoundations />
        <IconFoundations reference />
      </>
    ) : view === 'composites' ? (
      <CompositeFoundations />
    ) : (
      <PrimitiveFoundations />
    )}
  </StrictMode>,
);
