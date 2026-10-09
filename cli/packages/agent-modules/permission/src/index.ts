/**
 * Permission subsystem — public surface.
 *
 * The public surface is:
 *
 *   - `PermissionEngine` + deterministic checkers in `tools/*` — checker
 *     dispatch and the explicit legacy rollback path used by
 *     `LocalPermissionFacade`.
 *   - `permission-core.ts` — the default production policy reducer plus the
 *     structured CommandIntent / ExecutionPlan contract.
 *   - HARD/SOFT dangerous-pattern registries in `classifier/dangerous-patterns.ts`
 *     consumed internally by the tool checkers.
 *   - `reason-format.ts` — localized DecisionReason formatter shared by
 *     decision callers.
 *   - `ask-policy.ts` — the `PermissionMode` → `AskForApproval` mapping the
 *     facade uses to route `auto` mode. This fork has no cloud classifier: an
 *     inconclusive local decision always becomes a user ask.
 *
 * Hosts must call `configurePermissionHost(...)` once at startup to wire the
 * concrete ports declared in `host-ports.ts`. Cross-cutting helpers (logger,
 * region/build-env, datetime) flow through `configurePermissionHost`.
 */

// ── Core types ──
export type {
  PermissionBehavior,
  PermissionMode,
  PermissionRule,
  PermissionRuleValue,
  PermissionRuleAction,
  PermissionRuleMatcher,
  PermissionRuleSource,
  ShellPermissionRule,
  DecisionReason,
  SubcommandResult,
  PermissionDecision,
  ToolCheckResult,
  CandidateScope,
  CandidateScopeGroup,
  PathCheckContext,
  PermissionUpdate,
  PermissionFileConfig,
  ToolPermissionContext,
} from './types.js';

// ── Deterministic safety registries (verbatim regex source of truth) ──
export {
  HARD_BLOCKED_REGISTRY,
  SOFT_RISK_REGISTRY,
  SUBCOMMAND_DANGEROUS_PATTERNS,
  ALL_DANGEROUS_COMMAND_PATTERNS,
  DESTRUCTIVE_STANDALONE_COMMANDS,
  CROSS_PLATFORM_CODE_EXEC,
  DANGEROUS_BASH_PATTERNS,
  PIPE_TO_SHELL_PATTERN,
  LOCAL_SCRIPT_INTERPRETERS_RE,
  hardBlockedCategoryIsFinalDeny,
  matchHardBlockedBash,
  matchHardBlockedFsRead,
  matchSecretReadForm,
  allPipeToShellAreInlineLiteralC,
  isDangerousBashPermission,
  type HardBlockedMatch,
  type HardBlockedCategory,
  type SoftRiskCategory,
  type ClassifierRule,
  type ClassifierRuleValue,
} from './classifier/dangerous-patterns.js';

// ── Decision engine ──
export { PermissionEngine } from './engine.js';
export { registerDefaultCheckers } from './tools/index.js';
export { unwrapCommandWrappers } from './tools/bash-wrapper-unwrap.js';
export { isRmCommand, parseRmTargets, splitCommand } from './tools/bash-permission.js';
export {
  parseScriptPlainCommands,
  parseShellLcPlainCommands,
  parseShellLcSingleCommandPrefix,
} from './tools/bash-ast.js';
export {
  parseWindowsNativeDelete,
  type WindowsNativeDeleteCommand,
} from './tools/windows-native-delete.js';
export {
  readWindowsTrashExecution,
  withWindowsTrashExecution,
  type WindowsTrashExecution,
} from './windows-trash-execution.js';
export { snapshotPermissionEffectiveInput, snapshotPermissionInput } from './effective-input.js';
export {
  createPermissionExecutionPlan,
  validatePermissionExecutionPlan,
} from './execution-plan.js';
export type { CreatePermissionExecutionPlanInput } from './execution-plan.js';
export { isKnownSafeCommand } from './tools/safe-command.js';
export { isKnownSafePowerShellCommand } from './tools/safe-command.js';
export { isSameResolvedPath } from './tools/path-identity.js';
export type { ToolPermissionChecker } from './engine.js';
export { createToolPermissionContext } from './context.js';
export { resolvePermissionPath } from './path-resolver.js';
export { extractBashPathIntents } from './tools/path-capability.js';
export type { PermissionPathResolutionContext } from './path-resolver.js';

// ── Permission Core contract / reducer ──
export {
  reducePermissionClassifierDecision,
  reducePermissionDecision,
  reducePermissionEvaluation,
  permissionModeToProfile,
} from './permission-core.js';
export type {
  PermissionPolicyOwner,
  PermissionCheckOptions,
  PermissionCheckerDecisionTrace,
  PermissionCoreDecisionInput,
  PermissionAction,
  ShellFamily,
  PathValue,
  CommandIntent,
  PermissionEvidence,
  ExecutionTransform,
  ExecutionPlan,
  PermissionModeProfile,
  PermissionEvaluationInput,
  PermissionApprovalRequest,
  PermissionEvaluation,
} from './permission-core.js';

export {
  adaptLegacyPermissionResult,
  evaluateLegacyPermission,
} from './legacy-permission-adapter.js';
export type {
  LegacyAdapterInput,
  LegacyEvaluationInput,
  LegacyParserAdapterResult,
} from './legacy-permission-adapter.js';

// ── Host-port surface (consumed by hosts to wire concrete deps) ──
export {
  configurePermissionHost,
  resetPermissionHostForTesting,
  type PermissionHostUtils,
} from './host-utils.js';
export type {
  PermissionStorePort,
  SessionResolverPort,
  AgentResolverPort,
  MessageStorePort,
  ConfigWriterPort,
  PermissionRequestStore,
  PermissionRequestRecord,
} from './host-ports.js';

// ── Localized reason formatter (shared wire output) ──
export {
  formatDecisionReason,
  formatBlockedToolReason,
  localeOrDefault,
  type Lang,
  type ToolDenialSource,
  type BlockedToolReasonInput,
} from './reason-format.js';

// ── User-locale detection (used by hosts to pick zh/en templates) ──
export { detectTextLocale, detectMessagesLocale, type UserLocaleHint } from './locale-detect.js';

// ── Ask-policy ──
export { modeToAskPolicy } from './ask-policy.js';
export type { AskForApproval, ProposedRule, ProposedRuleScope } from './ask-policy.js';
