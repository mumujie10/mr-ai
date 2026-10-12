import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelOption } from "@/components/application/ai-chat/cli-menu";
import type { ChannelOption } from "@/components/application/ai-chat/engine-model-panel";
import {
  ipc,
  type CliConfig,
  type EngineCatalog,
  type EngineInfo,
  type MrChannelSlug,
} from "@/lib/ipc";
import { modelSettingFor, useModelSettings } from "../model-settings";
import {
  BUNDLED_ENGINE_ID,
  CLI_CONFIG_CHANGED_EVENT,
  isPseudoProvider,
  providerEntries,
  providerFamilyModels,
  providerModel,
  PSEUDO_LOCAL,
  type EngineId,
} from "@/features/settings/providers";

// Stable fallbacks: a fresh `{}` per render would re-run every effect and
// memo keyed on `catalogs`/`pending` below.
const EMPTY_CATALOGS: Record<string, EngineCatalog> = {};
const EMPTY_PENDING: Record<string, true> = {};

/** Probe identity: an engine whose availability flips (CLI installed or
 *  removed) is worth one fresh probe even in the same workspace. */
const probeKey = (engine: EngineInfo) => `${engine.id}:${engine.available ? 1 : 0}`;

/** What the composer's model picker consumes from [`useEngineModels`]. */
export interface EngineModelsState {
  catalogs: Record<string, EngineCatalog>;
  modelsByEngine: Record<string, ModelOption[]>;
  /** The same rows grouped per channel (keyed by channel id, 官方配置 under
   *  `PSEUDO_LOCAL`), with nothing filtered out — 模型设置 lists every channel. */
  modelsByChannel: Record<string, Record<string, ModelOption[]>>;
  channelsByEngine: Record<string, ChannelOption[]>;
  refresh: () => Promise<void>;
  pendingEngines: Record<string, true>;
}

/** Provider configs and per-engine model catalogs feeding the CLI menu's
 * per-engine model flyouts, plus the pin effect that repairs unset or stale
 * stored model picks. */

/** Raw record of a channel. `channelId` empty → engine `section.current`. */
function channelRaw(
  engineId: string,
  cliConfig: CliConfig | null,
  channelId?: string,
): unknown {
  const section = cliConfig?.[engineId as EngineId];
  const id = (channelId || section?.current || "").trim();
  if (!id || isPseudoProvider(id)) return undefined;
  return section?.providers?.[id];
}

function configuredModel(
  engineId: string,
  cliConfig: CliConfig | null,
  channelId?: string,
): string {
  const raw = channelRaw(engineId, cliConfig, channelId);
  return raw ? providerModel(engineId as EngineId, raw).trim() : "";
}

/** Catalog ids can be `provider/model` composites (DSH's session/modelCatalog
 *  flattens to them) while the channel's configured model is stored bare —
 *  the same model then listed twice: once raw, once catalogued. Resolve a
 *  bare id to its unique composite catalog entry so the two collapse into
 *  one row. */
function resolveCompositeId(id: string, catalogIds: string[]): string {
  if (!id || id.includes("/")) return id;
  const matches = catalogIds.filter((cid) => cid.endsWith(`/${id}`));
  return matches.length === 1 ? matches[0] : id;
}

/** The rows one channel of the bundled runtime can actually serve.
 *
 *  The CLI advertises its whole model menu in one go — every channel's rows
 *  arrive together, each prefixed with the CLI's own provider slug — so the
 *  channel that is in use decides which rows stay. Without this filter picking
 *  another channel left the list showing the previous channel's models.
 *
 *  `null` means "cannot be answered" (no slug table yet, a channel the CLI does
 *  not list) and the caller then keeps the full menu: an unreadable CLI must not
 *  blank a picker, and 官方配置 legitimately comes back empty when the runtime
 *  has no models of its own. */
function channelCatalog<T extends { provider?: string }>(
  catalog: T[],
  channelId: string,
  channelName: string,
  slugs: MrChannelSlug[],
): T[] | null {
  if (slugs.length === 0) return null;
  const providerSlugs = new Set(slugs.map((row) => row.slug));
  if (isPseudoProvider(channelId)) {
    // 官方配置 = whatever the CLI files outside its `custom_provider:` namespace.
    return catalog.filter((row) => !providerSlugs.has(row.provider ?? ""));
  }
  // A same-name re-save makes the CLI fork the slug (`llm` → `llm-2`), so one
  // name can own several; all of them are this channel's models.
  const mine = new Set(
    slugs.filter((row) => row.name === channelName).map((row) => row.slug),
  );
  if (mine.size === 0) return null;
  return catalog.filter((row) => mine.has(row.provider ?? ""));
}

export function useEngineModels(
  engines: EngineInfo[],
  models: Record<string, string>,
  pinModels: (updates: Record<string, string>, persist?: boolean) => Promise<void>,
  /** Session-resolved channel per engine; falls back to `section.current`. */
  providers: Record<string, string> = {},
  workspacePath?: string,
): EngineModelsState {
  const { t } = useTranslation();
  const [cliConfig, setCliConfig] = useState<CliConfig | null>(null);
  // A catalog is a property of the *context*, not of every workspace: the
  // backend answers from the local CLIs unless the workspace is a remote one
  // (a WSL distro's CLIs answer differently), so all local workspaces share
  // one catalog while each remote workspace carries its own. Caching per
  // workspace instead made refresh act on the active workspace alone — every
  // other (already cached) workspace kept serving its stale list until the
  // user refreshed it there too.
  const [localCatalogs, setLocalCatalogs] = useState<Record<string, EngineCatalog>>(
    {},
  );
  const [remoteCatalogsByWs, setRemoteCatalogsByWs] = useState<
    Record<string, Record<string, EngineCatalog>>
  >({});
  // Which context a workspace's probes answered from. Until a workspace has
  // answered once it stays unresolved and gets probed (its context cannot be
  // guessed from the shared local bucket).
  const [contextByWs, setContextByWs] = useState<Record<string, "local" | "remote">>(
    {},
  );
  const wsKey = workspacePath ?? "";
  // Engine-level custom models (设置 → CLI → 自定义模型): user-added ids
  // merged into the picker next to the CLI's catalog.
  const [customModels, setCustomModels] = useState<Record<string, string[]>>({});
  // Engines whose catalog probe is still in flight: the picker shows whatever
  // it already knows (usually just the configured model) until it lands, so
  // the panel needs to say "still loading" instead of looking truncated.
  const [pendingByWs, setPendingByWs] = useState<Record<string, Record<string, true>>>({});
  // The bundled runtime's channel → slug table (see `ipc.mireaiChannelSlugs`).
  // Empty means nothing was read, and then the model menu is left unfiltered —
  // guessing a slug from a channel name would hide that channel's own models.
  const [channelSlugs, setChannelSlugs] = useState<MrChannelSlug[]>([]);
  const readChannelSlugs = useCallback((force: boolean) => {
    ipc
      .mireaiChannelSlugs(force)
      .then(setChannelSlugs)
      // An unreadable CLI leaves the previous table in place: the picker stays
      // as good as it was rather than dropping to no filter at all.
      .catch(() => {});
  }, []);
  // Probes already dispatched, keyed by workspace — see the probe effect.
  const probedByWs = useRef<Record<string, Set<string>>>({});

  // Provider configs feed the model picker's per-engine model lists.
  useEffect(() => {
    ipc.getCliConfig().then(setCliConfig).catch(() => {});
  }, []);
  // The settings CLI page mutates provider config and custom models outside
  // this tree; refetch so the picker tracks both immediately.
  useEffect(() => {
    const reload = () => {
      ipc.getCliConfig().then(setCliConfig).catch(() => {});
      ipc
        .getAppSettings()
        .then((s) => setCustomModels(s.customModels ?? {}))
        .catch(() => {});
      // The CLI mints a fresh slug when a same-name channel is re-saved, so
      // the table is re-read with every channel mutation (cached: this is the
      // same listing the flyout's 刷新 forces).
      readChannelSlugs(true);
    };
    reload();
    window.addEventListener(CLI_CONFIG_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CLI_CONFIG_CHANGED_EVENT, reload);
  }, [readChannelSlugs]);
  // 模型设置 rows (hidden / effort / context window) live in their own store so
  // the dialog and the picker read one source; writes update both at once.
  const modelSettings = useModelSettings((s) => s.byKey);
  // Catalog for the active workspace. Until the workspace's context is known
  // the shared local catalog proves nothing about it (it may be a remote one),
  // so the picker starts empty there and fills as the workspace's probes land.
  const context = wsKey === "" ? "local" : contextByWs[wsKey];
  const catalogs =
    context === "remote"
      ? (remoteCatalogsByWs[wsKey] ?? EMPTY_CATALOGS)
      : context === "local"
        ? localCatalogs
        : EMPTY_CATALOGS;
  const pending = pendingByWs[wsKey] ?? EMPTY_PENDING;
  // File one probe answer. A `remote` flag means the answer came from a distro
  // CLI: that workspace is a remote context and keeps its own bucket — which is
  // exactly what stops a distro list from leaking into the shared local one.
  // Everything else is local data for the one catalog every local workspace
  // shares, flag cleared (an engine-derived catalog is blank for a remote
  // workspace by contract, so its flag is local information).
  const applyCatalog = useCallback(
    (engineId: string, ws: string, list: EngineCatalog) => {
      if (list.remote === true && ws !== "") {
        setContextByWs((prev) => (prev[ws] === "remote" ? prev : { ...prev, [ws]: "remote" }));
        setRemoteCatalogsByWs((prev) => ({
          ...prev,
          [ws]: { ...(prev[ws] ?? {}), [engineId]: list },
        }));
        return;
      }
      if (ws !== "") {
        setContextByWs((prev) => (prev[ws] === "local" ? prev : { ...prev, [ws]: "local" }));
      }
      setLocalCatalogs((prev) => ({
        ...prev,
        [engineId]: list.remote ? { ...list, remote: false } : list,
      }));
    },
    [],
  );
  // Live pending flags, keyed by workspace: the picker shows what it already
  // knows (usually just the configured model) until a probe lands, so the panel
  // says "still loading" instead of looking truncated. Both directions go
  // through here so a probe's start and settle can never disagree (a set flag
  // replaced rather than merged would outlive its probe).
  const markPending = useCallback(
    (ws: string, engineId: string, running: boolean) =>
      setPendingByWs((prev) => {
        const bucket = prev[ws] ?? {};
        if (running === (engineId in bucket)) return prev;
        const next = { ...bucket };
        if (running) next[engineId] = true;
        else delete next[engineId];
        return { ...prev, [ws]: next };
      }),
    [],
  );
  // Model catalogs for every engine (pi/omp probe their CLI; others return
  // empty and fall back to provider-config models below). The CLI menu's
  // per-engine model flyouts all read from this map.
  const probeCatalog = useCallback(
    (engineId: string) => {
      markPending(wsKey, engineId, true);
      return ipc
        .listEngineModels(engineId, workspacePath)
        .then((list) => applyCatalog(engineId, wsKey, list))
        .catch(() => {})
        .finally(() => markPending(wsKey, engineId, false));
    },
    [wsKey, workspacePath, applyCatalog, markPending],
  );
  useEffect(() => {
    // One probe per engine (per workspace, per availability state). A probe
    // that resolves without a catalog — a down DSH host, for instance —
    // must not be re-dispatched by a re-render: with `pending` in the deps
    // the flag leaving the map re-ran this effect and refired the probe, so
    // a dead host got one `session/modelCatalog` call per render (~200/s).
    // Retrying is explicit (`refresh`) or follows an availability flip.
    const probed = (probedByWs.current[wsKey] ??= new Set<string>());
    engines
      .filter((engine) => !(engine.id in catalogs) && !probed.has(probeKey(engine)))
      .forEach((engine) => {
        probed.add(probeKey(engine));
        probeCatalog(engine.id);
      });
  }, [engines, catalogs, wsKey, probeCatalog]);

  // Per-engine model lists for the CLI menu flyouts: the backend catalog
  // plus the session (or engine-default) channel's configured model — spawn
  // injects that channel's env, including claude; native files stay official.
  //
  // `modelsByEngine` is what a picker shows: the channel in use only.
  // `modelsByChannel` is the same rows per channel with nothing dropped, which
  // is what 模型设置 needs — it lists every channel side by side, and a view that
  // hides channels cannot be the source for that.
  const [modelsByEngine, modelsByChannel] = useMemo(() => {
    // 模型设置 can hide a row, but never the one the engine is currently
    // running: a hidden selection would blank the pill and strand the session.
    const visible = (engineId: string, rows: ModelOption[], currentId: string) =>
      rows.filter(
        (row) =>
          row.id === currentId ||
          !modelSettingFor(modelSettings, engineId, row.id)?.hidden,
      );
    const result: Record<string, ModelOption[]> = {};
    const byChannel: Record<string, Record<string, ModelOption[]>> = {};
    for (const engine of engines) {
      const catalog = catalogs[engine.id]?.models ?? [];
      const catalogIds = catalog.map((m) => m.id);
      const section = cliConfig?.[engine.id as EngineId];
      const entries = providerEntries(engine.id as EngineId, section);
      // The channel whose models this list is showing: the session's own when it
      // carries one, otherwise the engine default (the same pair `channelRaw`
      // resolves). Unset means 官方配置 — the same reading `engineCurrents` uses.
      const channelId =
        (providers[engine.id] || section?.current || "").trim() || PSEUDO_LOCAL;
      const channelName = entries.find((entry) => entry.id === channelId)?.name ?? "";
      // 内置运行时:一次上报的菜单含所有渠道的行,按当前渠道收窄;问不到 slug
      // 时保持整表,宁可不收窄也不把渠道自己的模型藏掉。
      const scoped = (id: string, name: string) =>
        engine.id === BUNDLED_ENGINE_ID
          ? channelCatalog(catalog, id, name, channelSlugs) ?? catalog
          : catalog;
      const rowsFor = (menu: typeof catalog, forChannel: string) => {
        const configured = resolveCompositeId(
          configuredModel(engine.id, cliConfig, forChannel),
          catalogIds,
        );
        const families = providerFamilyModels(
          engine.id,
          channelRaw(engine.id, cliConfig, forChannel),
        );
        const providerModels = configured ? [configured] : [];
        const current = resolveCompositeId(models[engine.id]?.trim() ?? "", catalogIds);
        // Channel model leads (it is what the CLI would run unprompted), the
        // current channel's catalog rows follow, then engine-level custom models,
        // and the current-override append last so the selection never vanishes.
        const known = [
          ...new Set([
            ...providerModels,
            ...menu.map((m) => m.id),
            ...(customModels[engine.id] ?? []),
            ...(current ? [current] : []),
          ]),
        ];
        const byId = new Map(catalog.map((m) => [m.id, m]));
        return known.map((m) => {
          const entry = byId.get(m);
          // The CLI's alias rows (Default/Opus/…) describe the CLI's OWN
          // settings — the official channel's. Under another channel the alias
          // runs that channel's mapped id (spawn injects its env), so the row
          // has to name it; without this the list kept showing the official
          // mapping after a channel switch.
          const mapped = families[m];
          return {
            id: m,
            label: mapped ?? (entry?.name || m),
            description: mapped
              ? // The CLI menu's own row shape ("Custom Opus model"): family is
                // the alias id, capitalized the way the CLI displays it.
                t("chat.customFamilyModel", {
                  family: m.charAt(0).toUpperCase() + m.slice(1),
                })
              : entry?.description ?? undefined,
            // Channel/override ids keep the "provider/model" shape, so the
            // prefix stands in when the catalog doesn't name the provider.
            provider: entry?.provider ?? (m.includes("/") ? m.slice(0, m.indexOf("/")) : undefined),
          };
        });
      };
      // Remote workspace (WSL distro): local channel/custom models cannot
      // run there — the distro CLI's own list is the entire menu.
      if (catalogs[engine.id]?.remote) {
        const remote = catalog.map((m) => ({
          id: m.id,
          label: m.name || m.id,
          description: m.description ?? undefined,
          provider: m.provider,
        }));
        result[engine.id] = visible(
          engine.id,
          remote,
          resolveCompositeId(models[engine.id]?.trim() ?? "", catalogIds),
        );
        continue;
      }
      // Only the bundled runtime's menu is a per-channel list, so only it gets
      // grouped rows. Under another engine every channel runs the same alias
      // rows (default / opus / … resolved from that CLI's own settings), and
      // repeating them under each channel caption would read as different
      // models. The dialog falls back to one flat list when there is no map.
      if (engine.id === BUNDLED_ENGINE_ID) {
        byChannel[engine.id] = {
          [PSEUDO_LOCAL]: rowsFor(scoped(PSEUDO_LOCAL, ""), PSEUDO_LOCAL),
          ...Object.fromEntries(
            entries.map((entry) => [
              entry.id,
              rowsFor(scoped(entry.id, entry.name), entry.id),
            ]),
          ),
        };
      }
      // The picker shows the channel in use. An id the app no longer has a
      // record for (deleted elsewhere) falls back to the **whole** menu rather
      // than to 官方配置: showing another channel's models would silently
      // misattribute what the user is about to run.
      result[engine.id] = visible(
        engine.id,
        byChannel[engine.id]?.[channelId] ??
          rowsFor(scoped(channelId, channelName), channelId),
        resolveCompositeId(models[engine.id]?.trim() ?? "", catalogIds),
      );
    }
    return [result, byChannel] as const;
  }, [
    engines,
    cliConfig,
    catalogs,
    wsKey,
    models,
    customModels,
    providers,
    modelSettings,
    channelSlugs,
    t,
  ]);
  // Selectable ids WITHOUT the current-override append: what the channel,
  // the backend catalog, and the custom model list can actually serve.
  const knownIdsByEngine = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const engine of engines) {
      // Pin/invalidation follows the engine default, not the session channel —
      // opening a session on another channel must not rewrite defaultModels.
      const configured = configuredModel(engine.id, cliConfig);
      const ids = new Set((catalogs[engine.id]?.models ?? []).map((m) => m.id));
      // Remote workspace: only the distro CLI's list is selectable — no
      // local channel/custom ids. Custom ids stay selectable past the
      // authoritative-catalog reset on local workspaces only.
      if (!catalogs[engine.id]?.remote) {
        if (configured) ids.add(configured);
        for (const id of customModels[engine.id] ?? []) ids.add(id);
      }
      result[engine.id] = ids;
    }
    return result;
  }, [engines, cliConfig, catalogs, wsKey, customModels]);
  // Official + custom channels for the flyout. The two are different things and
  // neither one is switched off by the other existing: 官方配置 is what the
  // runtime itself is configured with, the rest are channels entered here, and
  // the caption only says where each group starts. Engines with no in-app
  // channels still skip the list — a lone 官方配置 row is noise — but the
  // bundled runtime always shows its own, because "官方配置 下面是空的" is a fact
  // the picker has to be able to show.
  const channelsByEngine = useMemo(() => {
    const result: Record<string, ChannelOption[]> = {};
    for (const engine of engines) {
      const customs: ChannelOption[] = providerEntries(
        engine.id as EngineId,
        cliConfig?.[engine.id as EngineId],
      ).map((entry) => ({ id: entry.id, label: entry.name, kind: "custom" }));
      const officialRow: ChannelOption = {
        id: PSEUDO_LOCAL,
        label: t("settings.cliOfficial"),
        kind: "official",
      };
      result[engine.id] =
        customs.length > 0 || engine.id === BUNDLED_ENGINE_ID
          ? [officialRow, ...customs]
          : [];
    }
    return result;
  }, [engines, cliConfig, t]);
  // No "default" pseudo entry: an unset selection would hide which model
  // actually runs. Pin it to the first entry — the CLI's effective default.
  // An authoritative catalog also invalidates stale stored picks (leftovers
  // from older, broader catalogs) that the CLI's model flag cannot resolve.
  // All engines' pins are computed first and written in ONE store action:
  useEffect(() => {
    const updates: Record<string, string> = {};
    for (const engine of engines) {
      // Remote catalogs (WSL 发行版) are display-only: `models` is a single
      // global record, so a pin from a distro catalog would (a) put a
      // distro-only id into every local tab's picker and (b) on returning
      // to a local workspace, trip the authoritative-catalog reset below
      // and persist that id over the user's saved default. 远端 catalog
      // 永不触发 pin;用户在远端的模型选择走引擎端 resume,不落地。
      if (catalogs[engine.id]?.remote === true) continue;
      const stored = models[engine.id]?.trim();
      const fallback =
        configuredModel(engine.id, cliConfig) ||
        catalogs[engine.id]?.models[0]?.id ||
        customModels[engine.id]?.[0];
      if (!fallback) continue;
      if (!stored) {
        updates[engine.id] = fallback;
        continue;
      }
      const catalog = catalogs[engine.id];
      if (
        catalog?.authoritative &&
        catalog.models.length > 0 &&
        !knownIdsByEngine[engine.id]?.has(stored)
      ) {
        updates[engine.id] = fallback;
      }
    }
    if (Object.keys(updates).length > 0) void pinModels(updates);
  }, [engines, models, cliConfig, catalogs, wsKey, customModels, knownIdsByEngine, pinModels]);

  // Manual refresh from the flyout: re-read provider configs and re-probe the
  // catalogs. The probe effect skips engines already probed, so settings edits
  // otherwise only land after an app restart. Scope = the active workspace's
  // context plus every remote context already cached: all local workspaces
  // share one catalog, so refreshing any of them covers the rest, while each
  // remote (distro) workspace keeps its own and would otherwise stay stale.
  const refresh = useCallback(async () => {
    await ipc.getCliConfig().then(setCliConfig).catch(() => {});
    readChannelSlugs(true);
    // Local context first — probed with the active workspace when that one is
    // local, so the spinner lands in the bucket the picker reads — then every
    // cached remote context, each of which owns its own catalog.
    const targets = [
      context === "remote" ? "" : wsKey,
      ...Object.keys(contextByWs).filter((ws) => contextByWs[ws] === "remote"),
    ];
    // Collect every probe before awaiting: the requests must all be in flight
    // at once. (An await inside the building loops would serialize them.)
    const probes: Promise<void>[] = [];
    for (const ws of targets) {
      for (const engine of engines) {
        markPending(ws, engine.id, true);
        probes.push(
          ipc
            .listEngineModels(engine.id, ws || undefined)
            .then((list) => applyCatalog(engine.id, ws, list))
            .catch(() => {
              // A failed probe keeps the stale catalog rather than blanking the
              // flyout.
            })
            .finally(() => markPending(ws, engine.id, false)),
        );
      }
    }
    await Promise.all(probes);
  }, [engines, wsKey, context, applyCatalog, markPending, contextByWs, readChannelSlugs]);

  return {
    catalogs,
    modelsByEngine,
    modelsByChannel,
    channelsByEngine,
    refresh,
    pendingEngines: pending,
  };
}
