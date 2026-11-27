import type { AgentToolResult as CallToolResult } from '../../core/src/agent-tools.js';
import type { AgentToolDefinition } from '../../core/src/agent-tools.js';
import * as z from 'zod/v4';
import type { ApiServices } from './ports.js';
import { ActionError, type ActionInput } from '../../core/src/actions.js';
import { agentRuleDraft } from '../../core/src/agent-writes.js';
import { renderArticleMarkdown } from '../../core/src/article-outputs.js';
import { brewOutputSnapshot } from '../../core/src/brew-output-snapshot.js';
import { renderBrewJson, renderBrewMarkdown } from '../../core/src/brew-outputs.js';
import type { AgentConnection } from '../../core/src/agent-access.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const limit = z.number().int().min(1).max(100).default(50);
const requestId = z
  .string()
  .regex(/^[a-z\d_-]{16,80}$/i)
  .optional()
  .describe('Required for writes. Preserve this identity when retrying a lost acknowledgement.');
const confirmation = { confirm: z.boolean().default(false), request_id: requestId };
const condition = z.strictObject({
  field: z.enum(['title', 'content', 'author', 'url', 'feed', 'folder']),
  operator: z.enum([
    'contains',
    'not_contains',
    'equals',
    'starts_with',
    'ends_with',
    'matches_regex',
  ]),
  value: z.string().min(1).max(4000),
});
const ruleAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('highlight'), color: z.string().min(1).max(100) }),
  z.strictObject({ type: z.literal('webhook'), url: z.string().min(1).max(8000) }),
  ...(['add_tag', 'remove_tag'] as const).map((type) =>
    z.strictObject({ type: z.literal(type), tag: z.string().min(1).max(100) }),
  ),
  ...(['star', 'mark_read', 'hide', 'feature_in_brew', 'exclude_from_brew', 'notify'] as const).map(
    (type) => z.strictObject({ type: z.literal(type) }),
  ),
]);
const draft = z.strictObject({
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  matchType: z.enum(['all', 'any']),
  scope: z.strictObject({
    feedIds: z.array(id).max(500).optional(),
    folderIds: z.array(id).max(500).optional(),
  }),
  conditions: z.array(condition).max(10),
  actions: z.array(ruleAction).min(1).max(20),
  stopProcessing: z.boolean(),
});
const target = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('items'), ids: z.array(id).min(1).max(50_000) }),
  z.strictObject({
    kind: z.literal('reader'),
    view: z.enum(['all', 'today', 'starred']),
    feedId: id.optional(),
    folderId: id.optional(),
  }),
]);
const success = (data: Record<string, unknown>, text = JSON.stringify(data)): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: data,
});
const safe = async (run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
  try {
    return await run();
  } catch (error) {
    const status = error instanceof ActionError ? error.status : 500;
    const message =
      error instanceof ActionError
        ? error.message
        : 'Could not complete this tool. For a write, retry with the same request_id.';
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
      structuredContent: { error: message, status },
    };
  }
};

export type AgentToolServices = Pick<
  ApiServices,
  'agentAccess' | 'actions' | 'search' | 'reader' | 'articles' | 'rules' | 'brews' | 'outputBaseUrl'
>;

/** One catalog for both transports. It defaults to read-only until the ingress grants writes. */
export function brewToolCatalog(
  services: AgentToolServices,
  access: AgentConnection & { signal?: AbortSignal } = { write: false },
) {
  const tools: BrewTool[] = [];
  const server = {
    registerTool<T extends z.ZodType>(
      name: string,
      config: { description: string; inputSchema: T; annotations: Record<string, boolean> },
      execute: (input: z.output<T>) => Promise<CallToolResult>,
    ) {
      tools.push({
        name,
        ...config,
        execute: (input) => {
          const parsed = config.inputSchema.safeParse(input);
          return parsed.success
            ? execute(parsed.data)
            : Promise.resolve({
                isError: true,
                content: [{ type: 'text', text: 'Invalid tool arguments.' }],
                structuredContent: { error: 'Invalid tool arguments.', status: 400 },
              });
        },
      });
    },
  };
  const tracked = (tool: string) => async (run: () => Promise<CallToolResult>) => {
    const result = await safe(async () => {
      if (access.tokenId !== undefined && !(await services.agentAccess?.current(access.tokenId)))
        throw new ActionError(403, 'This token has expired or been revoked.');
      return run();
    });
    // Durable writes already have one authoritative receipt; log reads, previews and failures.
    return safe(async () => {
      if (
        services.agentAccess &&
        (!(result.structuredContent as Record<string, unknown> | undefined)?.receipt ||
          result.isError ||
          tool === 'undo')
      )
        await services.agentAccess.record(access, tool, result.isError ? 'failed' : 'complete');
      return result;
    });
  };
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const write = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  };
  const actions = () => {
    if (!services.actions)
      throw new ActionError(501, 'Durable actions need setup on this instance.');
    return services.actions;
  };
  const commit = async (input: ActionInput, confirm: boolean, identity?: string) => {
    if (!access.write) throw new ActionError(403, 'This connection is read-only.');
    if (access.tokenId !== undefined && input.kind === 'create_rule')
      throw new ActionError(403, 'Tokens can preview rules. Save reviewed rules in Brew.');
    if (!confirm) throw new ActionError(428, 'Explicit confirm: true is required.');
    if (!identity) throw new ActionError(400, 'Choose a request_id before writing.');
    const receipt = await actions().run(
      { ...input, confirm: true, requestId: identity },
      {
        agent: access.agent ?? 'mcp',
        tokenId: access.tokenId,
        name: access.name,
        signal: access.signal,
      },
    );
    return success({ undo_id: receipt.id, receipt });
  };
  server.registerTool(
    'search_items',
    {
      description:
        'Search retained visible articles without marking them read. Returns exact totals and next_offset.',
      inputSchema: z.strictObject({
        query: z.string().max(4000),
        scope: z.enum(['all', 'folder', 'starred']).default('all'),
        folder_id: id.optional(),
        unread: z.boolean().default(false),
        sort: z.enum(['newest', 'oldest']).default('newest'),
        limit,
        offset: z.number().int().min(0).max(50_000_000).default(0),
      }),
      annotations: read,
    },
    (input) =>
      tracked('search_items')(async () => {
        const page = await services.search.search(input.query, input.scope, {
          folderId: input.folder_id,
          unread: input.unread,
          sort: input.sort,
          limit: input.limit,
          offset: input.offset,
          includeTotal: true,
        });
        return success({ ...page, next_offset: page.nextOffset });
      }),
  );
  server.registerTool(
    'list_unread',
    {
      description:
        'List unread articles, with exact total and next_cursor. Reading this result does not mark anything read.',
      inputSchema: z.strictObject({
        view: z.enum(['all', 'today', 'starred']).default('all'),
        feed_id: id.optional(),
        folder_id: id.optional(),
        limit,
        cursor: z.string().max(200).optional(),
      }),
      annotations: read,
    },
    (input) =>
      tracked('list_unread')(async () => {
        const page = await services.reader.articles({
          view: input.view,
          feedId: input.feed_id,
          folderId: input.folder_id,
          limit: input.limit,
          cursor: input.cursor,
          unread: true,
          includeTotal: true,
        });
        return success({ ...page, next_cursor: page.nextCursor });
      }),
  );
  server.registerTool(
    'get_item',
    {
      description:
        'Read an article as sanitized Markdown, with current read/star/tag state. Does not mark it read, fetch full text, or return a raw newsletter original.',
      inputSchema: z.strictObject({ id }),
      annotations: read,
    },
    ({ id }) =>
      tracked('get_item')(async () => {
        const article = await services.articles.get(id);
        if (!article) throw new ActionError(404, 'Article not found.');
        const markdown = renderArticleMarkdown(article, services.outputBaseUrl);
        return success(
          {
            id,
            markdown,
            read_at: article.readAt,
            starred_at: article.starredAt,
            tags: article.tags,
          },
          markdown,
        );
      }),
  );
  server.registerTool(
    'mark_read',
    {
      description:
        'Bulk-read review and write. First call without confirm to obtain revision/count without writes. Submit that revision with confirm:true and request_id to mark the reviewed set read. Returns undo_id.',
      inputSchema: z.strictObject({
        target,
        revision: z
          .string()
          .regex(/^[a-f\d]{64}$/)
          .optional(),
        ...confirmation,
      }),
      annotations: write,
    },
    (input) =>
      tracked('mark_read')(async () => {
        if (!input.confirm)
          return success({
            ...(await actions().previewRead(input.target)),
            requires_confirmation: true,
          });
        if (!input.revision)
          throw new ActionError(400, 'Review the target and supply its revision first.');
        return commit(
          { kind: 'mark_read', target: input.target, revision: input.revision },
          input.confirm,
          input.request_id,
        );
      }),
  );
  server.registerTool(
    'star',
    {
      description:
        'Set an article starred or unstarred. Requires confirm:true and request_id. Returns a durable undo_id.',
      inputSchema: z.strictObject({ id, starred: z.boolean().default(true), ...confirmation }),
      annotations: write,
    },
    (input) =>
      tracked('star')(() =>
        commit(
          { kind: 'star_item', id: input.id, starred: input.starred },
          input.confirm,
          input.request_id,
        ),
      ),
  );
  server.registerTool(
    'tag',
    {
      description:
        'Add/remove named article tags. Missing added tags are created; Undo removes a new tag only if unused elsewhere. Requires confirm:true and request_id. Returns undo_id.',
      inputSchema: z.strictObject({
        id,
        add: z.array(z.string().min(1).max(100)).max(50).default([]),
        remove: z.array(z.string().min(1).max(100)).max(50).default([]),
        ...confirmation,
      }),
      annotations: write,
    },
    (input) =>
      tracked('tag')(() =>
        commit(
          { kind: 'tag_item', id: input.id, add: input.add, remove: input.remove },
          input.confirm,
          input.request_id,
        ),
      ),
  );
  server.registerTool(
    'add_feed',
    {
      description:
        'Subscribe to an RSS, Atom or JSON feed URL. Fetches feed metadata, then atomically journals insertion. Requires confirm:true and request_id. Returns undo_id; Undo protects later articles/references.',
      inputSchema: z.strictObject({
        url: z.string().min(1).max(8000),
        folder_id: id.nullable().default(null),
        ...confirmation,
      }),
      annotations: { ...write, openWorldHint: true },
    },
    (input) =>
      tracked('add_feed')(() =>
        commit(
          { kind: 'add_feed', url: input.url, folderId: input.folder_id },
          input.confirm,
          input.request_id,
        ),
      ),
  );
  server.registerTool(
    'create_rule',
    {
      description:
        'Dry run by default: validate a rule and count matches without saving or running actions. Set dry_run:false, confirm:true and request_id to save it and obtain undo_id. Enabled rules can run their configured actions on future ingestion.',
      inputSchema: z.strictObject({ draft, dry_run: z.boolean().default(true), ...confirmation }),
      annotations: write,
    },
    (input) =>
      tracked('create_rule')(async () => {
        let value;
        try {
          value = agentRuleDraft(input.draft);
        } catch {
          throw new ActionError(400, 'Invalid rule definition.');
        }
        if (input.dry_run)
          return success({ dry_run: true, ...(await services.rules.previewSummary(value)) });
        return commit({ kind: 'create_rule', draft: value }, input.confirm, input.request_id);
      }),
  );
  server.registerTool(
    'list_brews',
    {
      description:
        'List Brew IDs and names for get_brew and preview_brew. Does not generate or deliver issues.',
      inputSchema: z.strictObject({}),
      annotations: read,
    },
    () =>
      tracked('list_brews')(async () =>
        success({
          items: (await services.brews.listConfigs()).map(({ id, name, enabled }) => ({
            id,
            name,
            enabled,
          })),
        }),
      ),
  );
  server.registerTool(
    'get_brew',
    {
      description:
        'Read a saved Brew configuration and its latest frozen issue, or a chosen issue belonging to that Brew. Omits delivery destinations and never generates or marks read.',
      inputSchema: z.strictObject({ id, issue_id: id.optional() }),
      annotations: read,
    },
    ({ id, issue_id }) =>
      tracked('get_brew')(async () => {
        const config = await services.brews.composition(id);
        if (!config) throw new ActionError(404, 'Brew not found.');
        const issue = issue_id
          ? await services.brews.snapshot(issue_id)
          : (await services.brews.history(id))[0];
        if (issue_id && (!issue || issue.brewConfigId !== id))
          throw new ActionError(404, 'Issue not found for this Brew.');
        const options = { baseUrl: services.outputBaseUrl };
        const snapshot = issue ? brewOutputSnapshot(issue) : null;
        return success(
          {
            brew: {
              id,
              name: config.name,
              enabled: config.enabled,
              timezone: config.timezone,
              schedule: config.schedule,
              sections: config.sections.map(({ id, kind, title, layout, depth }) => ({
                id,
                kind,
                title,
                layout,
                depth,
              })),
            },
            issue: snapshot ? JSON.parse(renderBrewJson(snapshot, options)) : null,
          },
          snapshot ? renderBrewMarkdown(snapshot, options) : config.name,
        );
      }),
  );
  server.registerTool(
    'preview_brew',
    {
      description:
        'Preview a saved Brew at an optional ISO time with explicit offset. Returns unsaved content and warnings; never saves an issue, runs actions, delivers, or marks read.',
      inputSchema: z.strictObject({ id, at: z.iso.datetime({ offset: true }).optional() }),
      annotations: read,
    },
    ({ id, at }) =>
      tracked('preview_brew')(async () => {
        const preview = await services.brews.previewBrew(id, at);
        if (!preview) throw new ActionError(404, 'Brew not found.');
        return success(
          {
            snapshot: JSON.parse(
              renderBrewJson(preview.snapshot, { baseUrl: services.outputBaseUrl }),
            ),
            warnings: preview.warnings,
          },
          renderBrewMarkdown(preview.snapshot, { baseUrl: services.outputBaseUrl }),
        );
      }),
  );
  server.registerTool(
    'undo',
    {
      description:
        'Restore the actual change identified by undo_id within its 30-second window. Requires confirm:true. Refuses conflicting later work and is safe to retry after acknowledgement loss.',
      inputSchema: z.strictObject({ undo_id: id, confirm: z.boolean().default(false) }),
      annotations: write,
    },
    ({ undo_id, confirm }) =>
      tracked('undo')(async () => {
        if (!access.write) throw new ActionError(403, 'This connection is read-only.');
        if (!confirm) throw new ActionError(428, 'Explicit confirm:true is required.');
        return success({ undo_id, receipt: await actions().undo(undo_id, access.tokenId) });
      }),
  );
  return tools;
}

export interface BrewTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  annotations: Record<string, boolean>;
  execute(input: unknown): Promise<CallToolResult>;
}
export const toolDefinition = (tool: BrewTool): AgentToolDefinition => ({
  name: tool.name,
  description: tool.description,
  inputSchema: z.toJSONSchema(tool.inputSchema, { io: 'input', target: 'draft-2020-12' }),
  annotations: {
    readOnlyHint: tool.annotations.readOnlyHint === true,
    untrustedContentHint: true,
    consequentialHint: tool.annotations.readOnlyHint !== true,
  },
});
