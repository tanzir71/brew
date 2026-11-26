import type { AgentToolDefinition, AgentToolResult } from '@brew/core/agent-tools';

export interface ToolScope {
  names: string[];
  ids?: number[];
  urls?: string[];
  fixed?: Record<string, unknown>;
}
type Port = {
  registerTool(
    tool: AgentToolDefinition & {
      execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<AgentToolResult>;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
  unregisterTool?: (name: string) => void;
};
type Surface = { owner: () => HTMLElement | null; scope: ToolScope; controller: AbortController };
type Registration = { controller: AbortController; signature: string; owned: boolean };
export type RuntimeState = {
  status: 'off' | 'loading' | 'native' | 'polyfill' | 'error';
  count: number;
  error: string;
};
export const toolError = (message: string, status = 409): AgentToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
  structuredContent: { error: message, status },
});
export async function browserJson<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'The in-page tool could not complete.');
  return value;
}
export class WebMcpRuntime {
  private state: RuntimeState = { status: 'off', count: 0, error: '' };
  private listeners = new Set<() => void>();
  private surfaces = new Map<string, Surface>();
  private registrations = new Map<string, Registration>();
  private catalog: AgentToolDefinition[] = [];
  private port?: Port;
  private session?: AbortController;
  private observer?: MutationObserver;
  private pending = Promise.resolve();
  private epoch = 0;
  private resized = () => this.schedule();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(
    private invoke: (
      name: string,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<AgentToolResult>,
  ) {}
  private emit(state: RuntimeState) {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  mount(key: string, owner: () => HTMLElement | null, scope: ToolScope) {
    const surface = { owner, scope, controller: new AbortController() };
    this.surfaces.set(key, surface);
    this.schedule();
    return () => {
      surface.controller.abort();
      if (this.surfaces.get(key) === surface) this.surfaces.delete(key);
      this.schedule();
    };
  }
  async start() {
    this.stop();
    const session = new AbortController();
    this.session = session;
    this.emit({ status: 'loading', count: 0, error: '' });
    try {
      if (!isSecureContext) throw new Error('In-page tools need HTTPS or localhost.');
      let port =
        (document as Document & { modelContext?: Port }).modelContext ??
        (navigator as Navigator & { modelContext?: Port }).modelContext;
      const native = Boolean(port);
      if (!port) {
        const { installWebMCP } = await import('@w3c/webmcp-polyfill');
        if (session.signal.aborted) return;
        installWebMCP();
        port = (document as Document & { modelContext?: Port }).modelContext;
      }
      if (!port || typeof port.registerTool !== 'function')
        throw new Error('This browser cannot register in-page tools.');
      const catalog = await browserJson<AgentToolDefinition[]>('/api/webmcp/tools', session.signal);
      if (session.signal.aborted) return;
      this.port = port;
      this.catalog = catalog;
      this.emit({ status: native ? 'native' : 'polyfill', count: 0, error: '' });
      this.observer = new MutationObserver((records) => {
        if (
          records.some(
            (record) =>
              record.type === 'attributes' ||
              [...record.addedNodes, ...record.removedNodes].some(
                (node) =>
                  node instanceof Element &&
                  (node.matches('dialog') || node.querySelector('dialog')),
              ),
          )
        )
          this.schedule();
      });
      this.observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'inert'],
      });
      window.addEventListener('resize', this.resized);
      this.schedule();
    } catch (failure) {
      if (!session.signal.aborted)
        this.fail(failure instanceof Error ? failure.message : 'Could not enable in-page tools.');
    }
  }
  stop() {
    this.session?.abort();
    this.session = undefined;
    this.observer?.disconnect();
    window.removeEventListener('resize', this.resized);
    this.observer = undefined;
    for (const [name, entry] of this.registrations) this.release(name, entry);
    this.registrations.clear();
    this.catalog = [];
    this.emit({ status: 'off', count: 0, error: '' });
  }
  private fail(message: string) {
    this.stop();
    this.emit({ status: 'error', count: 0, error: message });
  }
  private release(name: string, entry: Registration) {
    entry.controller.abort();
    if (entry.owned && this.port?.unregisterTool) this.port.unregisterTool(name);
  }
  private visible(surface: Surface) {
    const owner = surface.owner();
    if (!owner?.isConnected || owner.closest('[hidden],[inert]') || !owner.getClientRects().length)
      return false;
    const modal = [...document.querySelectorAll('dialog[open]')]
      .filter((dialog) => dialog.matches(':modal'))
      .at(-1);
    return !modal || modal.contains(owner);
  }
  private available(name: string) {
    return [...this.surfaces.values()].filter(
      (surface) => surface.scope.names.includes(name) && this.visible(surface),
    );
  }
  private schedule() {
    const epoch = ++this.epoch;
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        if (
          epoch !== this.epoch ||
          !this.session ||
          !this.port ||
          !['native', 'polyfill'].includes(this.state.status)
        )
          return;
        const session = this.session,
          port = this.port;
        const desired = new Map<string, { tool: AgentToolDefinition; signature: string }>();
        for (const definition of this.catalog) {
          const scopes = this.available(definition.name).map((surface) => surface.scope);
          if (!scopes.length) continue;
          const tool = structuredClone(definition);
          const properties = tool.inputSchema.properties as
            Record<string, Record<string, unknown>> | undefined;
          const ids = [...new Set(scopes.flatMap((scope) => scope.ids ?? []))];
          const urls = [...new Set(scopes.flatMap((scope) => scope.urls ?? []))];
          const idKey = definition.name === 'undo' ? 'undo_id' : 'id';
          if (properties?.[idKey] && ids.length)
            properties[idKey] = { ...properties[idKey], enum: ids };
          if (properties?.url && urls.length) properties.url = { ...properties.url, enum: urls };
          if (scopes.length === 1)
            for (const [key, value] of Object.entries(scopes[0]!.fixed ?? {}))
              if (properties?.[key]) {
                properties[key] = { ...properties[key], const: value, default: value };
                tool.inputSchema.required = (
                  tool.inputSchema.required as string[] | undefined
                )?.filter((name) => name !== key);
              }
          desired.set(definition.name, { tool, signature: JSON.stringify({ tool, scopes }) });
        }
        for (const [name, entry] of this.registrations)
          if (desired.get(name)?.signature !== entry.signature) {
            this.release(name, entry);
            this.registrations.delete(name);
          }
        try {
          for (const [name, { tool, signature }] of desired) {
            if (session.signal.aborted || epoch !== this.epoch) break;
            if (this.registrations.has(name)) continue;
            const entry = { controller: new AbortController(), signature, owned: false };
            this.registrations.set(name, entry);
            await port.registerTool(
              {
                ...tool,
                execute: (input, options) =>
                  entry.controller.signal.aborted
                    ? Promise.resolve(
                        toolError('This tool registration has expired. Reopen the matching view.'),
                      )
                    : this.execute(name, input, options?.signal),
              },
              { signal: entry.controller.signal },
            );
            entry.owned = true;
            if (session.signal.aborted || entry.controller.signal.aborted)
              this.release(name, entry);
          }
          if (!session.signal.aborted) this.emit({ ...this.state, count: this.registrations.size });
        } catch {
          if (!session.signal.aborted)
            this.fail('This browser refused in-page tool registration. Retry to reconnect.');
        }
      });
  }
  private async execute(
    name: string,
    value: unknown,
    signal?: AbortSignal,
  ): Promise<AgentToolResult> {
    if (!this.session || this.session.signal.aborted) return toolError('In-page tools are off.');
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return toolError('Choose valid tool arguments.', 400);
    const input = value as Record<string, unknown>;
    const surface = this.available(name).find(({ scope }) => {
      const itemId = input[name === 'undo' ? 'undo_id' : 'id'];
      const takesId = ['get_item', 'star', 'tag', 'get_brew', 'preview_brew', 'undo'].includes(
        name,
      );
      return (
        (!scope.ids || !takesId || scope.ids.includes(Number(itemId))) &&
        (!scope.urls || scope.urls.includes(String(input.url))) &&
        Object.entries(scope.fixed ?? {}).every(
          ([key, expected]) =>
            input[key] === undefined || canonical(input[key]) === canonical(expected),
        )
      );
    });
    if (!surface)
      return toolError(
        'This tool is no longer available for the visible controls. Reopen the matching view.',
      );
    const controller = new AbortController();
    const signals = [this.session.signal, surface.controller.signal, signal].filter(
      (signal): signal is AbortSignal => Boolean(signal),
    );
    const cancel = () => controller.abort();
    for (const source of signals) {
      if (source.aborted) cancel();
      else source.addEventListener('abort', cancel, { once: true });
    }
    try {
      if (controller.signal.aborted) return toolError('The tool was cancelled.');
      return await this.invoke(name, { ...surface.scope.fixed, ...input }, controller.signal);
    } catch (failure) {
      return toolError(
        controller.signal.aborted
          ? 'The tool was cancelled.'
          : failure instanceof Error
            ? failure.message
            : 'Could not complete the in-page tool.',
      );
    } finally {
      for (const source of signals) source.removeEventListener('abort', cancel);
    }
  }
}
function canonical(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
