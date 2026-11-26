import { useId } from 'react';
import { Toggle } from '../components/controls';
import { useBrowserPreferences } from '../hooks/useBrowserPreferences';
import { PreferenceFeedback } from './BrowserPreferences';

export function AgentPreferences({ compact = false }: { compact?: boolean }) {
  const preferences = useBrowserPreferences();
  const descriptionId = useId();
  const flagged = new URLSearchParams(location.search).get('agent') === '1';
  const savedHref = new URL(location.href);
  savedHref.searchParams.delete('agent');
  return (
    <>
      <section className="agent-mode-card" aria-label="Agent-friendly mode settings">
        <div className="agent-mode-card-heading">
          <div>
            <h3>Agent-friendly mode</h3>
            <p id={descriptionId}>
              No virtual scrolling, no animation, no mark-as-read on scroll. Every list gets page
              numbers. Links with the agent flag turn it on too.
            </p>
          </div>
          <Toggle
            label="Agent-friendly mode"
            hideLabel
            checked={preferences.values.agentMode === 'true'}
            className="agent-mode-toggle"
            action="set-agent-mode"
            descriptionId={descriptionId}
            onCheckedChange={(checked) =>
              preferences.save('agentMode', String(checked), 'Agent-friendly mode')
            }
          />
        </div>
      </section>
      {!compact && <p className="text-sm text-soft">Changes save immediately in this browser.</p>}
      {flagged && (
        <p role="status" className="text-sm text-soft">
          This URL enables agent-friendly mode, even when the saved setting is off.{' '}
          <a className="underline" href={savedHref.pathname + savedHref.search + savedHref.hash}>
            Use saved preference
          </a>
        </p>
      )}
      <PreferenceFeedback preferences={preferences} name="Agent preferences result" visible />
    </>
  );
}
