import type { LocalMemoryScopeGates } from './types.js';

const DISABLED_VALUES = new Set(['0', 'false', 'off']);

function gateValue(raw: string | undefined): boolean {
  return !DISABLED_VALUES.has(raw?.trim().toLowerCase() ?? '');
}

/**
 * GUI-owned toggles arrive as process env (the App cannot write the CLI's
 * user-owned YAML config). Unset means enabled: the GUI only injects `0`
 * for a switch it turned off, and hosts that never set these keep today's
 * behavior. `MAVIS_MEMORY_GLOBAL` gates user-scope memory,
 * `MAVIS_MEMORY_PROJECT` gates the per-project store.
 */
export function resolveLocalMemoryScopeGates(
  env: NodeJS.ProcessEnv = process.env,
): LocalMemoryScopeGates {
  return {
    userEnabled: gateValue(env.MAVIS_MEMORY_GLOBAL),
    projectEnabled: gateValue(env.MAVIS_MEMORY_PROJECT),
  };
}
