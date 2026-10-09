/**
 * Wires the permission system into pi-agent local-runtime.
 *
 * Builds a thin facade (`LocalPermissionFacade`) backed by:
 *   - the deterministic decision pipeline (Permission Core by default,
 *     `PermissionEngine` as checker registry and explicit rollback, plus the
 *     `evaluateBashStatic` / `decideUnknownToolPathCapabilities` primitives —
 *     see `permission/tools/`)
 *
 * Facade surface:
 *   - `checkPermission(params): Promise<{behavior, reason, requestId?, ruleContents?, …}>`
 *     — consumed by `api/routes/permissions.ts` and the
 *     `beforeLocalToolCall` hook. Routes own the pending-request map + waiter
 *     + permission.ask Global Event flow; the facade is a pure decision function
 *     from their POV.
 *   - `runStartupAliasSeed(): Promise<void>` — seeds acceptEdits allow rules.
 *
 * Wire surface:
 *   - HTTP endpoints (`/permission/{rules,check,update,requests,batch-reply}`).
 *   - UI `'allowOnce'` / `'allowAlways'` / `'deny'` decision strings.
 *   - PermissionMode (`default` / `auto` / `bypassPermissions`); the facade
 *     maps these internally to an `AskForApproval` policy. This fork has no
 *     cloud classifier, so `auto` never leaves the machine.
 */

import path from 'node:path';
import { statSync } from 'node:fs';

import {
  configurePermissionHost,
  type PermissionHostUtils,
} from '@mavis/permission';

import type { LocalRuntimeConfig } from '../config/types.js';
import type { LocalRuntimeAuthContext } from '../runtime/model-resolver.js';
import type { MetricsClient } from '../common/metrics.js';
import { logger as runtimeLogger } from '../common/logger.js';
import { readLocalPermissionMode } from '../api/host-helpers.js';
import type { LocalPermissionRuleStore } from './rules.js';
import { LocalPluginHookPermissionStore } from './plugin-hook-permissions.js';
import type { LocalSessionRecord } from '../sessions/controller.js';
import type { AgentReferenceReadScope } from '../agent/port.js';
import {
  LocalPermissionFacade,
  type LocalPermissionCheckParams,
  type LocalPermissionCheckResult,
} from './facade.js';

export interface LocalPermissionAgentResolver {
  resolveAgentReadScope(requestedName: string): Promise<AgentReferenceReadScope>;
  resolveAgentWriteTarget(requestedName: string): Promise<string>;
}

export function isLocalAgentResolverError(
  err: unknown,
): err is { status: number; code: string; message: string; details?: Record<string, unknown> } {
  if (!err || typeof err !== 'object') return false;
  const value = err as Record<string, unknown>;
  return typeof value.status === 'number' && typeof value.code === 'string';
}

export interface LocalPermissionServiceDeps {
  configGetter: () => LocalRuntimeConfig;
  authContextGetter?: () => LocalRuntimeAuthContext | undefined;
  ruleStore: LocalPermissionRuleStore;
  getSessionById: (sessionId: string) => Promise<LocalSessionRecord | undefined>;
  getLocalAgent: (agentName: string) => Promise<{ defaultWorkspaceDir?: string } | undefined>;
  configUpdater: (body: Record<string, unknown>) => Promise<unknown>;
  /** Explicit shell family from the host executor; never inferred from command text. */
  shellFamily?: 'cmd' | 'powershell';
  metricsClient?: MetricsClient;
}

type PermissionHostLogger = NonNullable<PermissionHostUtils['logger']>;

function createPermissionHostLogger(
  bindings: Readonly<Record<string, unknown>> = {},
): PermissionHostLogger {
  const fields = (arg: unknown): Record<string, unknown> =>
    arg !== null && typeof arg === 'object' && !Array.isArray(arg)
      ? (arg as Record<string, unknown>)
      : { value: arg };
  const write = (
    level: 'info' | 'warn' | 'error',
    arg: unknown,
    message?: string,
    args: readonly unknown[] = [],
  ): void => {
    runtimeLogger[level](
      {
        ...bindings,
        ...fields(arg),
        ...(args.length > 0 ? { args } : {}),
      },
      message ?? 'permission.internal',
    );
  };
  return {
    trace: () => undefined,
    debug: () => undefined,
    info: (arg, message, ...args) => write('info', arg, message, args),
    warn: (arg, message, ...args) => write('warn', arg, message, args),
    error: (arg, message, ...args) => write('error', arg, message, args),
    fatal: (arg, message, ...args) => write('error', arg, message, args),
    child: (extra) => createPermissionHostLogger({ ...bindings, ...extra }),
  };
}

const permissionHostLogger = createPermissionHostLogger();

/**
 * Public type for callers — re-exported from the facade. The permission
 * engine now lives in `local-runtime/src/permission`; callers depend on the
 * facade surface (`.checkPermission`) rather than the engine module directly.
 */
export type LocalPermissionService = LocalPermissionFacade;

/**
 * Build a LocalPermissionService (= LocalPermissionFacade) wired to local-
 * runtime adapters, and register the permission host ports. Idempotent host
 * registration (last-write-wins per field), so calling this alongside cron's
 * `configureCronHost({ datetimeHelpers })` is safe.
 */
export function createLocalPermissionService(
  deps: LocalPermissionServiceDeps,
): LocalPermissionService {
  configurePermissionHost({
    logger: permissionHostLogger,
  });

  const service = new LocalPermissionFacade({
    ruleStore: deps.ruleStore,
    pluginHookPermissionStore: new LocalPluginHookPermissionStore({
      dataDir: deps.configGetter().dataDir,
    }),
    configGetter: deps.configGetter,
    getSessionById: deps.getSessionById,
    getLocalAgent: deps.getLocalAgent,
    shellFamily: deps.shellFamily,
    metricsClient: deps.metricsClient,
  });
  // Fire-and-forget: when the persisted permissionMode is `acceptEdits`, seed
  // the global edit/write/apply_patch allow rules so the rest of the runtime
  // can treat the effective mode as `default`.
  void service.runStartupAliasSeed().catch(() => {
    // Swallow — startup seed is non-critical; the next check will surface
    // any persistent rule store failure.
  });
  return service;
}

export interface LocalPermissionHostHandle {
  configGetter: () => LocalRuntimeConfig;
  authContextGetter?: () => LocalRuntimeAuthContext | undefined;
  permissionRules: LocalPermissionRuleStore;
  getSessionById: (sessionId: string) => Promise<LocalSessionRecord | undefined>;
  agentRoutes: {
    getLocalAgent: (agentName: string) => Promise<{ defaultWorkspaceDir?: string } | undefined>;
  };
  configUpdater: (body: Record<string, unknown>) => Promise<unknown>;
  shellFamily?: 'cmd' | 'powershell';
  metricsClient?: MetricsClient;
}

const _serviceCache = new WeakMap<object, LocalPermissionService>();

export function resolveLocalPermissionService(
  host: LocalPermissionHostHandle,
): LocalPermissionService {
  let service = _serviceCache.get(host.permissionRules);
  if (!service) {
    service = createLocalPermissionService({
      configGetter: host.configGetter,
      authContextGetter: host.authContextGetter,
      ruleStore: host.permissionRules,
      getSessionById: (sessionId) => host.getSessionById(sessionId),
      getLocalAgent: (agentName) => host.agentRoutes.getLocalAgent(agentName),
      configUpdater: (body) => host.configUpdater(body),
      shellFamily: host.shellFamily,
      metricsClient: host.metricsClient,
    });
    _serviceCache.set(host.permissionRules, service);
  }
  return service;
}

// Silence unused warnings for helpers reserved for facade future use.
void statSync;
export type { LocalPermissionCheckParams, LocalPermissionCheckResult };
