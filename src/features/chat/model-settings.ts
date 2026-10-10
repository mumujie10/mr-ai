/**
 * Per-model overrides the user sets in 输入框 → 引擎 → 模型设置: a default
 * reasoning level, a context window, and whether the model appears in the
 * picker. Stored in `AppSettings.modelSettings`, keyed
 * `<engine>::<picker model id>` — the picker id already carries the channel
 * (`llm/MiniMax-M3` for a BYOK channel, `minimax/MiniMax-M3` for the bundled
 * runtime's own), so 官方配置 and a vendor channel are separate rows without a
 * third key part.
 *
 * An explicit user value outranks everything the app would otherwise infer,
 * including a live engine report: the whole point of the dialog is "this CLI
 * reports no window (or reports the wrong one) and I know what my relay
 * serves". It stays BELOW the session's own choice, because continuing a
 * conversation must keep running what that conversation already ran.
 */
import { create } from "zustand";
import { ipc, type AppSettings, type ModelSetting } from "@/lib/ipc";
import { persistSettings } from "./store/settings-persist";

export type { ModelSetting };

/** Model ids carry `/` and channel names can carry anything but `::`, and
 *  engine ids never do — so the separator cannot be forged by a model id. */
export const modelSettingKey = (engine: string, model: string) =>
  `${engine}::${model || "default"}`;

export function modelSettingFor(
  byKey: Record<string, ModelSetting> | undefined,
  engine: string,
  model: string | null | undefined,
): ModelSetting | undefined {
  if (!byKey || !engine) return undefined;
  return byKey[modelSettingKey(engine, model ?? "")];
}

/** Apply one row edit. Falsy values are dropped rather than stored (`hidden:
 *  false` says nothing — the absence of the key does), and a row left with no
 *  field at all is DELETED: the map then only ever holds a real override, and
 *  恢复默认 is the same code path as clearing a single field. */
export function withModelSetting(
  byKey: Record<string, ModelSetting>,
  engine: string,
  model: string,
  patch: ModelSetting,
): Record<string, ModelSetting> {
  const key = modelSettingKey(engine, model);
  const merged: ModelSetting = { ...byKey[key], ...patch };
  if (!merged.effort) delete merged.effort;
  if (!merged.contextWindow) delete merged.contextWindow;
  if (!merged.hidden) delete merged.hidden;
  const next = { ...byKey };
  if (Object.keys(merged).length === 0) {
    delete next[key];
    return next;
  }
  next[key] = merged;
  return next;
}

/** Model ids the user hid on one engine. The picker drops them, so 模型设置
 *  rebuilds its rows from these keys — a control that can only hide would be
 *  impossible to undo otherwise. Labels fall back to the id. */
export function hiddenModelIds(
  byKey: Record<string, ModelSetting> | undefined,
  engine: string,
): string[] {
  if (!byKey) return [];
  const prefix = `${engine}::`;
  return Object.entries(byKey)
    .filter(([key, value]) => key.startsWith(prefix) && value?.hidden)
    .map(([key]) => key.slice(prefix.length));
}

interface ModelSettingsState {
  byKey: Record<string, ModelSetting>;
  loaded: boolean;
  /** Idempotent: the first subscriber loads, the rest reuse it. */
  load: () => Promise<void>;
  update: (engine: string, model: string, patch: ModelSetting) => void;
}

export const useModelSettings = create<ModelSettingsState>((set, get) => ({
  byKey: {},
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const settings = await ipc.getAppSettings();
      set({ byKey: settings.modelSettings ?? {}, loaded: true });
    } catch {
      // Unreadable settings: the picker keeps following the engine's own
      // values, which is what it did before this feature existed.
    }
  },
  update: (engine, model, patch) => {
    const byKey = withModelSetting(get().byKey, engine, model, patch);
    set({ byKey, loaded: true });
    void persistSettings(() => ({ modelSettings: byKey }) satisfies Partial<AppSettings>);
  },
}));
