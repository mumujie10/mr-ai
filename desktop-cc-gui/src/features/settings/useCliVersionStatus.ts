import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ipc, type CliVersionStatus } from "@/lib/ipc";
import type { EngineId } from "./providers";

/**
 * Session-local store for managed-CLI version status, one entry per engine.
 * The CLI 管理 header and the DSH host card both read it, so probes are
 * deduped: switching engine pages repaints from cache instantly and only
 * soft-refreshes in the background, and concurrent consumers share one
 * in-flight probe. No polling — refresh happens on page mount and explicit
 * user action only (each probe spawns `<bin> --version` + `npm view`).
 */

interface Entry {
  status: CliVersionStatus | null;
  /** A probe is in flight; a cached status stays visible meanwhile. */
  loading: boolean;
  error: string | null;
  updating: boolean;
  inflight: Promise<void> | null;
}

const EMPTY: Entry = {
  status: null,
  loading: false,
  error: null,
  updating: false,
  inflight: null,
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function patch(engine: EngineId, partial: Partial<Entry>) {
  entries.set(engine, { ...(entries.get(engine) ?? EMPTY), ...partial });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Probe (or share the in-flight probe for) an engine's version status. */
function refresh(engine: EngineId): Promise<void> {
  const current = entries.get(engine) ?? EMPTY;
  if (current.inflight) return current.inflight;
  const task = (async () => {
    try {
      const status = await ipc.cliVersionStatus(engine);
      patch(engine, { status, loading: false, error: null });
    } catch (e) {
      patch(engine, {
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
  patch(engine, { loading: true, inflight: task });
  return task.finally(() => patch(engine, { inflight: null }));
}

/** Install/update an engine, then re-probe so badges reflect the result.
 *  `runId` scopes the streamed `cli://update-progress` events to this run. */
async function update(engine: EngineId, runId: string): Promise<void> {
  patch(engine, { updating: true, error: null });
  try {
    await ipc.cliUpdate(engine, runId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    patch(engine, { updating: false, error: message });
    throw e;
  }
  patch(engine, { updating: false });
  await refresh(engine);
}

/** What the hook hands to components: latest probe state + actions. */
export interface CliVersionStatusView {
  status: CliVersionStatus | null;
  loading: boolean;
  error: string | null;
  updating: boolean;
  refresh: () => void;
  update: (runId: string) => Promise<void>;
}

export function useCliVersionStatus(engine: EngineId): CliVersionStatusView {
  useEffect(() => {
    void refresh(engine);
  }, [engine]);
  const entry = useSyncExternalStore(subscribe, () => entries.get(engine) ?? EMPTY);
  return {
    status: entry.status,
    loading: entry.loading,
    error: entry.error,
    updating: entry.updating,
    refresh: useCallback(() => void refresh(engine), [engine]),
    update: useCallback((runId: string) => update(engine, runId), [engine]),
  };
}
