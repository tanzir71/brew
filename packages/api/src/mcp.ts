import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { ApiServices } from './ports.js';
import { ActionError } from '../../core/src/actions.js';
import type { AgentConnection } from '../../core/src/agent-access.js';
import { brewToolCatalog } from './agent-tools.js';

/** One validated service catalog for the Node transports and browser session. */
export function createBrewMcpServer(
  services: ApiServices,
  access: AgentConnection = { write: false },
) {
  const server = new McpServer(
    { name: 'brew', version: '0.1.0' },
    { maxToolInputElements: 51_500 },
  );
  for (const tool of brewToolCatalog(services, access))
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (input) => tool.execute(input),
    );
  return server;
}

export function createBrewMcpHandler(services: ApiServices, access?: AgentConnection) {
  return createMcpHandler(({ requestInfo }) => {
    const connection =
      access ??
      services.agentAccess?.authenticate(requestInfo?.headers.get('authorization') ?? null);
    if (services.agentAccess && !connection) throw new ActionError(401, 'Use a valid Brew token.');
    return createBrewMcpServer(services, connection ?? { write: false });
  });
}
