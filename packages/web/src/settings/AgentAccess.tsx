import { useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import { Badge } from '../components/Badge';
import { useCapabilities } from '../hooks/useCapabilities';
import { usePageAlternates } from '../hooks/usePageAlternates';
import { SettingsNav } from './SettingsNav';
import { AgentPreferences } from './AgentPreferences';
import { AgentTokens } from './AgentTokens';
import { AgentActivity } from './AgentActivity';
import { AgentSetup } from './AgentSetup';
import { WebMcpPreferences } from './WebMcpPreferences';

const tools = [
  'search_items',
  'list_unread',
  'get_item',
  'mark_read',
  'star',
  'tag',
  'add_feed',
  'create_rule · dry run',
  'list_brews',
  'get_brew',
  'preview_brew',
  'undo',
];
export function AgentAccess() {
  const capabilities = useCapabilities();
  const available = Boolean(capabilities.data?.agentAccess);
  const endpoint = new URL('/mcp', location.origin).href;
  const [copy, setCopy] = useState('');
  usePageAlternates('/settings/agents', 'Agent access settings');
  return (
    <div className="runs-app agent-app">
      <AppSidebar activeHref="/settings/runs" />
      <div className="runs-panel">
        <SettingsNav current="agents" />
        <main
          id="main-content"
          aria-label="Agent access settings"
          className="runs-content agent-content"
        >
          <header className="runs-intro">
            <h1 tabIndex={-1}>Agent access</h1>
            <p>
              Let assistants read and triage your Brew through tools. Their activity is logged here
              so you can review each change, with Undo for confirmed writes.
            </p>
          </header>
          {capabilities.isError && (
            <div role="alert">
              <p>Could not check agent access on this instance.</p>
              <button
                type="button"
                className="runs-button"
                onClick={() => void capabilities.refetch()}
              >
                Retry connection
              </button>
            </div>
          )}
          <section className="agent-card" aria-labelledby="mcp-title">
            <div className="agent-card-heading">
              <div>
                <h2 id="mcp-title">MCP server</h2>
                <p>Connect Claude, Codex, ChatGPT or any MCP client.</p>
              </div>
              <Badge tone={available ? 'positive' : 'locked'}>
                {available ? 'On' : capabilities.isPending ? 'Checking' : 'Needs setup'}
              </Badge>
            </div>
            <div className="agent-endpoint">
              <span>POST</span>
              <code>{endpoint}</code>
              <button
                type="button"
                disabled={!available}
                aria-label="Copy MCP endpoint"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(endpoint);
                    setCopy('Endpoint copied.');
                  } catch {
                    setCopy('Could not copy. Select the endpoint to copy it manually.');
                  }
                }}
              >
                <span className="agent-copy-icon">
                  <img src="/figma/agents/611cd.svg" alt="" />
                </span>
              </button>
            </div>
            {copy && <p role="status">{copy}</p>}
            <ul className="agent-tool-list" aria-label="MCP tools">
              {tools.map((tool) => (
                <li key={tool}>
                  <code>{tool}</code>
                </li>
              ))}
            </ul>
          </section>
          <AgentTokens available={available} />
          <div className="agent-mode-grid">
            <WebMcpPreferences />
            <div>
              <AgentPreferences compact />
            </div>
          </div>
          <AgentActivity available={available} />
          <AgentSetup endpoint={endpoint} />
        </main>
      </div>
    </div>
  );
}
