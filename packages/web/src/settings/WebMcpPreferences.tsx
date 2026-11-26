import { useContext } from 'react';
import { Badge } from '../components/Badge';
import { Toggle } from '../components/controls';
import { agentPageHref } from '../agentLocation';
import { useBrowserPreferences } from '../hooks/useBrowserPreferences';
import { useCapabilities } from '../hooks/useCapabilities';
import { WebMcpContext } from '../webmcp/context';
import { PreferenceFeedback } from './BrowserPreferences';

export function WebMcpPreferences() {
  const caps = useCapabilities();
  const preferences = useBrowserPreferences();
  const context = useContext(WebMcpContext);
  const available = caps.data?.webmcp === true && isSecureContext;
  const state = context?.state;
  return (
    <section className="agent-card" aria-labelledby="webmcp-title">
      <div className="agent-card-heading">
        <div>
          <h2 id="webmcp-title">In-page tools (WebMCP)</h2>
          <p id="webmcp-description">
            Registers the same tools on this page so browser agents act with your session. Off where
            the browser doesn’t support it.
          </p>
        </div>
        <Toggle
          label="In-page tools (WebMCP)"
          hideLabel
          checked={available && preferences.values.webmcp === 'true'}
          disabled={!available}
          descriptionId="webmcp-description"
          action="set-webmcp"
          onCheckedChange={(checked) =>
            preferences.save('webmcp', String(checked), 'In-page tools')
          }
        />
      </div>
      <p>
        <Badge tone="accent">Experimental</Badge>
        {!available && (
          <>
            {' '}
            <a href={agentPageHref('/settings/runs#setup-agents')}>Needs setup</a>
          </>
        )}
      </p>
      {available && state && state.status !== 'off' && (
        <p
          role="status"
          className={
            state.status === 'native' || state.status === 'polyfill' ? 'sr-only' : undefined
          }
        >
          {state.status === 'loading'
            ? 'Connecting in-page tools…'
            : state.status === 'error'
              ? state.error
              : `${state.count} ${state.count === 1 ? 'tool is' : 'tools are'} available for the visible controls.`}
        </p>
      )}
      {available && state?.status === 'error' && (
        <button type="button" className="runs-button" onClick={() => context?.retry()}>
          Retry in-page tools
        </button>
      )}
      <PreferenceFeedback
        preferences={preferences}
        name="In-page tools preference result"
        visible
      />
    </section>
  );
}
