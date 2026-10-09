/**
 * Permission host-ports: structural interfaces the host (local-runtime today)
 * implements and injects via {@link configurePermissionHost}. Mirrors the cron
 * host-port pattern (`cron/host-ports.ts`).
 *
 * Ports: the rule store / session / agent / message resolvers.
 */

// ── Service orchestration ports (consumed by the host wiring) ──

import type { ToolPermissionContext, PermissionUpdate } from './types.js';
import type { AgentMessageProtocol } from '@mavis/agent-core/protocol/agent-message';

export type { PermissionRequestStore } from './permission-request-store.js';
export type { PermissionRequestRecord } from './permission-request-store.js';

/**
 * Rule store: builds the merged (global+agent+session) permission context and
 * applies rule mutations. Implemented by local-runtime's rule store adapter.
 */
export interface PermissionStorePort {
  getContext(agentName?: string, sessionId?: string): Promise<ToolPermissionContext>;
  applyUpdate(update: PermissionUpdate): Promise<void>;
}

/** Session lookup used to resolve workspace dir + translate framework ids. */
export interface SessionResolverPort {
  get(
    sessionId: string,
  ): Promise<{ session_id: string; workspace_dir?: string; agent_name?: string } | undefined>;
}

/** Agent lookup used to resolve the agent's source project as a fallback cwd. */
export interface AgentResolverPort {
  get(agentName: string): Promise<{ source_project?: string } | undefined>;
}

/** Recent-message lookup for classifier context + user-locale detection. */
export interface MessageStorePort {
  getRecent(
    sessionId: string,
    limit: number,
    role?: string,
    options?: { excludePermissionResponses?: boolean },
  ): Promise<AgentMessageProtocol[]>;
}

/** Config mutation used by setMode() to persist the permission mode. */
export interface ConfigWriterPort {
  updateConfigFile(patch: { permissionMode: string }): Promise<void>;
}
