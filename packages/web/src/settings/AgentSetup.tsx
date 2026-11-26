import { useState } from 'react';
import { SegmentedControl } from '../components/controls';
import { CodeBlock } from '../components/patterns';
import { Badge } from '../components/Badge';

export function AgentSetup({ endpoint }: { endpoint: string }) {
  const [client, setClient] = useState('Claude');
  const code =
    client === 'Codex'
      ? `[mcp_servers.brew]\nurl = ${JSON.stringify(endpoint)}\nbearer_token_env_var = "BREW_TOKEN"`
      : `{
  "mcpServers": {
    "brew": {
      "type": "http",
      "url": ${JSON.stringify(endpoint)},
      "headers": { "Authorization": "Bearer <YOUR_BREW_TOKEN>" }
    }
  }
}`;
  return (
    <section className="agent-card" aria-labelledby="agent-setup-title">
      <div className="agent-card-heading">
        <h2 id="agent-setup-title">Copy setup</h2>
        <SegmentedControl
          label="Agent client"
          options={['Claude', 'Codex', 'ChatGPT'].map((value) => ({ value, label: value }))}
          value={client}
          onValueChange={setClient}
        />
      </div>
      {client === 'ChatGPT' ? (
        <>
          <p>
            <Badge tone="warning">Needs OAuth</Badge>
          </p>
          <p>
            ChatGPT custom connections require OAuth for private servers and cannot send a custom
            Brew token. This instance provides bearer-token access. Use Claude Code, Codex or
            another client that accepts an Authorization header.
          </p>
          <p>
            <a
              href="https://developers.openai.com/plugins/build/auth"
              target="_blank"
              rel="noreferrer"
            >
              ChatGPT authentication guide
            </a>
          </p>
        </>
      ) : (
        <>
          <CodeBlock key={client} code={code} label={`${client} MCP setup`} copyable />
          <p>
            {client === 'Codex'
              ? 'Add this to your Codex config.toml. Set BREW_TOKEN in the environment of the process that starts Codex, then restart it.'
              : 'Add this to your Claude Code MCP configuration. Replace <YOUR_BREW_TOKEN> with your new token and keep the file private.'}
          </p>
        </>
      )}
    </section>
  );
}
