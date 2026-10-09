/**
 * Ask-policy + proposed-rule types for the permission decision flow.
 *
 *   PermissionMode (UI / config wire)  ──modeToAskPolicy──▶  AskForApproval
 *
 * `AskForApproval` is the internal policy the facade branches on; `ProposedRule`
 * is the optional rule suggestion a decision can carry (engine-derived).
 */

import type { PermissionMode, PermissionRule, PermissionRuleSource } from './types.js';

// ===========================================================================
// AskForApproval — when do we interrupt the human
// ===========================================================================

/**
 * The three user-facing permission policies, expressed as wire strings.
 *
 * Mapping to the UI mode selector:
 * - 'on-request'     → Ask (PermissionMode 'default')
 * - 'on-request-llm' → Auto (PermissionMode 'auto'). The tag predates the fork:
 *                      there is no cloud classifier any more, so an
 *                      inconclusive local decision asks.
 * - 'never'          → Always allow (PermissionMode 'bypassPermissions' / 'off')
 * - 'deny'           → Do not ask; deny unless preauthorized (PermissionMode 'dontAsk')
 */
export type AskForApproval = 'on-request' | 'on-request-llm' | 'never' | 'deny';

/**
 * Adapter: `PermissionMode` (UI / config wire) → `AskForApproval` (internal
 * decision policy). The facade translates once near the top of its check so the
 * rest of the flow never branches on PermissionMode directly.
 */
export function modeToAskPolicy(mode: PermissionMode): AskForApproval {
  switch (mode) {
    case 'bypassPermissions':
    case 'off':
      return 'never';
    case 'auto':
      return 'on-request-llm';
    case 'dontAsk':
      return 'deny';
    case 'default':
    case 'acceptEdits':
      // acceptEdits is an alias for default + pre-seeded edit/write allow rules;
      // the alias seeding runs at startup, the runtime treats the mode as default.
      return 'on-request';
    default: {
      // exhaustiveness guard
      const _exhaustive: never = mode;
      void _exhaustive;
      return 'on-request';
    }
  }
}

// ===========================================================================
// ProposedRule — the optional rule suggestion attached to a decision
// ===========================================================================

/**
 * A rule suggestion attached to a decision, surfaced to the UI as the
 * "always allow" pre-filled value.
 *
 * A plain (toolName, ruleContent, scope) triple compatible with the rule store
 * schema.
 */
export interface ProposedRule {
  toolName: string;
  /** Rule body, interpreted by the per-tool checker (bash prefix, fs glob). */
  ruleContent: string;
  /** Suggested persistence scope; UI may override before commit. */
  defaultScope: 'session' | 'global';
  /**
   * Provenance — engine-derived suggestions come from the tool call. The
   * `'cloud-gateway'` member is retained for wire/type compatibility only; no
   * verdict produces it in this fork.
   */
  source: 'engine' | 'cloud-gateway';
}

/**
 * The narrow scope subset (`'session' | 'global'`) a ProposedRule can target,
 * versus the full `PermissionRuleSource` (`'global' | 'agent' | 'session'`).
 */
export type ProposedRuleScope = ProposedRule['defaultScope'];
export type { PermissionRule, PermissionRuleSource };
