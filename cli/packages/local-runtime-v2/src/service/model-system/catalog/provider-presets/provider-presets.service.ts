import { getRuntimeRegion } from '@mavis/config';
import { MODELS_DEV_CATALOG_SOURCE_URL } from '@mavis/shared/models-dev';

import type { ByokProviderPresetView, UserModelInputView } from '../../contracts.js';
import { normalizeProviderBaseUrl } from '../../connectivity/provider-request.js';
import type { ModelProviderApi } from '../../identity.js';
import {
  readProviderPresetSnapshotCandidates,
  type ProviderPresetRepositoryOptions,
} from './provider-presets.repository.js';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const MESSAGES_API_BASE_URL = 'https://api.anthropic.com';
const DISABLED_PROVIDER_IDS = new Set([
  'minimax',
  'minimax-cn',
  'minimax-coding-plan',
  'minimax-cn-coding-plan',
]);
const REGION_PINNED_PROVIDER_IDS = {
  cn: ['zhipuai-coding-plan', 'zhipuai', 'deepseek', 'moonshotai-cn', 'openai', 'anthropic'],
  en: ['zai-coding-plan', 'zai', 'deepseek', 'moonshotai', 'openai', 'anthropic'],
} as const;
// These IDs belong to models.dev, not the bundled inference registry. Keep their
// URLs and IDs intact, and make the billing plan explicit at selection time.
const PROVIDER_PLAN_NAMES = new Map([
  ['zai', 'Z.AI API'],
  ['zai-coding-plan', 'Z.AI Coding Plan'],
  ['zhipuai', 'Zhipu AI API'],
  ['zhipuai-coding-plan', 'Zhipu AI Coding Plan'],
]);

export interface ProviderPresetCatalogOptions extends ProviderPresetRepositoryOptions {
  readonly regionGetter?: () => 'cn' | 'en';
}

interface ModelsDevCatalogSnapshot {
  readonly version: 1;
  readonly source: typeof MODELS_DEV_CATALOG_SOURCE_URL;
  readonly updatedAt: number;
  readonly iconBaseUrl?: string;
  readonly catalog: Record<string, unknown>;
}

interface ParsedModelsDevCatalogSnapshot {
  readonly snapshot: ModelsDevCatalogSnapshot;
  readonly presets: readonly ByokProviderPresetView[];
}

/**
 * Reads the bundled models.dev snapshot (plus any snapshot already persisted by
 * an earlier release) entirely from disk. Construction and listing perform no
 * network I/O, and there is no code path in this fork that can fetch the
 * registry: the distribution owns the snapshot bytes.
 */
export class ProviderPresetCatalog {
  constructor(private readonly options: ProviderPresetCatalogOptions = {}) {}

  async listProviderPresets(): Promise<ByokProviderPresetView[]> {
    const latest = await latestCatalogSnapshot(this.options);
    if (!latest) throw new Error('No valid models.dev catalog snapshot is available');
    const region = (this.options.regionGetter ?? getRuntimeRegion)();
    return orderProviderPresets(latest.presets, REGION_PINNED_PROVIDER_IDS[region]);
  }
}

function parseModelsDevProviderPresets(
  value: unknown,
  iconBaseUrl?: string,
): ByokProviderPresetView[] {
  if (!isRecord(value)) throw new Error('models.dev returned an invalid catalog');
  const presets: ByokProviderPresetView[] = [];
  for (const [providerId, rawProvider] of Object.entries(value)) {
    const preset = parseProvider(providerId, rawProvider, iconBaseUrl);
    if (preset) presets.push(preset);
  }
  return presets.sort((left, right) => left.name.localeCompare(right.name));
}

function parseProvider(
  providerId: string,
  value: unknown,
  iconBaseUrl?: string,
): ByokProviderPresetView | undefined {
  if (
    DISABLED_PROVIDER_IDS.has(providerId) ||
    !providerId.trim() ||
    !isRecord(value) ||
    !isRecord(value.models)
  ) {
    return undefined;
  }
  const transport = resolveTransport(providerId, value);
  if (!transport) return undefined;
  const models = Object.entries(value.models)
    .map(([modelId, model]) => parseModel(modelId, model))
    .filter((model): model is UserModelInputView => model !== undefined)
    .sort((left, right) =>
      (left.displayName ?? left.modelId).localeCompare(right.displayName ?? right.modelId),
    );
  if (models.length === 0) return undefined;
  return {
    providerId,
    name: PROVIDER_PLAN_NAMES.get(providerId) ?? stringValue(value.name) ?? providerId,
    ...transport,
    models,
    ...(iconBaseUrl ? { iconUrl: resolveProviderIconUrl(iconBaseUrl, providerId) } : {}),
  };
}

function resolveTransport(
  providerId: string,
  provider: Record<string, unknown>,
): { baseUrl: string; apiFormat: ModelProviderApi } | undefined {
  const npm = stringValue(provider.npm);
  let apiFormat: ModelProviderApi;
  let baseUrl: string | undefined;
  if (npm === '@ai-sdk/openai') {
    apiFormat = 'openai-responses';
    baseUrl =
      providerId === 'openai' && provider.api === undefined
        ? OPENAI_BASE_URL
        : stringValue(provider.api);
  } else if (npm === '@ai-sdk/openai-compatible') {
    apiFormat = 'openai-completions';
    baseUrl = stringValue(provider.api);
  } else if (npm === '@ai-sdk/anthropic') {
    apiFormat = 'anthropic-messages';
    baseUrl =
      providerId === 'anthropic' && provider.api === undefined
        ? MESSAGES_API_BASE_URL
        : stringValue(provider.api);
  } else {
    return undefined;
  }
  if (!baseUrl || !isHttpUrl(baseUrl)) return undefined;
  return { baseUrl: normalizeProviderBaseUrl(apiFormat, baseUrl), apiFormat };
}

function parseModel(modelId: string, value: unknown): UserModelInputView | undefined {
  if (!modelId.trim() || !isRecord(value) || value.tool_call !== true) return undefined;
  return {
    modelId,
    displayName: stringValue(value.name) ?? modelId,
    ...parseModelCapabilities(value),
    ...parseModelEffortOptions(value),
    ...parseModelModalities(value),
    ...parseModelLimit(value),
  };
}

function parseModelCapabilities(value: Record<string, unknown>): Partial<UserModelInputView> {
  return {
    attachment: value.attachment === true,
    reasoning: value.reasoning === true,
    toolCall: true,
    temperature: value.temperature === true,
  };
}

/**
 * Reads the catalog's declared reasoning-effort levels. models.dev describes
 * reasoning controls as `reasoning_options` entries; only an explicit
 * `{ type: 'effort', values: [...] }` entry means the model accepts effort
 * selection. A bare `reasoning: true` or a `toggle` entry only means the model
 * can think, so neither one produces `effortOptions` here. Declared strings
 * are preserved as-is (trimmed, de-duplicated, in catalog order) so levels the
 * CLI does not know about still reach validation and the wire unchanged.
 */
function parseModelEffortOptions(value: Record<string, unknown>): Partial<UserModelInputView> {
  if (!Array.isArray(value.reasoning_options)) return {};
  for (const option of value.reasoning_options) {
    if (!isRecord(option) || option.type !== 'effort' || !Array.isArray(option.values)) continue;
    const effortOptions: string[] = [];
    const seen = new Set<string>();
    for (const candidate of option.values) {
      if (typeof candidate !== 'string') continue;
      const effort = candidate.trim();
      if (!effort || seen.has(effort)) continue;
      seen.add(effort);
      effortOptions.push(effort);
    }
    if (effortOptions.length > 0) return { effortOptions };
  }
  return {};
}

function parseModelModalities(value: Record<string, unknown>): Partial<UserModelInputView> {
  const modalities = isRecord(value.modalities) ? value.modalities : undefined;
  const input = stringArray(modalities?.input);
  const output = stringArray(modalities?.output);
  if (!input && !output) return {};
  return { modalities: { ...(input ? { input } : {}), ...(output ? { output } : {}) } };
}

function parseModelLimit(value: Record<string, unknown>): Partial<UserModelInputView> {
  const limit = isRecord(value.limit) ? value.limit : undefined;
  const context = positiveInteger(limit?.context);
  const output = positiveInteger(limit?.output);
  if (!context && !output) return {};
  return { limit: { ...(context ? { context } : {}), ...(output ? { output } : {}) } };
}

function orderProviderPresets(
  presets: readonly ByokProviderPresetView[],
  pinnedProviderIds: readonly string[],
): ByokProviderPresetView[] {
  const byId = new Map(presets.map((preset) => [preset.providerId, preset]));
  const pinned = pinnedProviderIds.flatMap((providerId) => {
    const preset = byId.get(providerId);
    if (!preset) return [];
    byId.delete(providerId);
    return [preset];
  });
  return [
    ...pinned,
    ...[...byId.values()].sort((left, right) => left.name.localeCompare(right.name)),
  ];
}

async function latestCatalogSnapshot(
  options: ProviderPresetCatalogOptions,
): Promise<ParsedModelsDevCatalogSnapshot | undefined> {
  const parsed: ParsedModelsDevCatalogSnapshot[] = [];
  for (const candidate of await readProviderPresetSnapshotCandidates(options)) {
    try {
      parsed.push(parseCatalogSnapshot(candidate));
    } catch {
      // A corrupt candidate must not hide another valid local snapshot.
    }
  }
  return parsed.sort((left, right) => right.snapshot.updatedAt - left.snapshot.updatedAt)[0];
}

function parseCatalogSnapshot(value: unknown): ParsedModelsDevCatalogSnapshot {
  const updatedAt = isRecord(value) ? positiveInteger(value.updatedAt) : undefined;
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.source !== MODELS_DEV_CATALOG_SOURCE_URL ||
    !updatedAt ||
    !isRecord(value.catalog)
  ) {
    throw new Error('Invalid models.dev catalog snapshot');
  }
  const iconBaseUrl = parseSnapshotIconBaseUrl(value.iconBaseUrl);
  const presets = parseModelsDevProviderPresets(value.catalog, iconBaseUrl);
  if (presets.length === 0) {
    throw new Error('models.dev catalog snapshot has no supported providers');
  }
  return {
    snapshot: {
      version: 1,
      source: MODELS_DEV_CATALOG_SOURCE_URL,
      updatedAt,
      ...(iconBaseUrl ? { iconBaseUrl } : {}),
      catalog: value.catalog,
    },
    presets,
  };
}

function parseSnapshotIconBaseUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const iconBaseUrl = stringValue(value);
  if (!iconBaseUrl || !isHttpUrl(iconBaseUrl)) {
    throw new Error('Invalid models.dev icon base URL');
  }
  return iconBaseUrl;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function resolveProviderIconUrl(iconBaseUrl: string, providerId: string): string {
  const prefix = iconBaseUrl.endsWith('/') ? iconBaseUrl : `${iconBaseUrl}/`;
  return `${prefix}${encodeURIComponent(providerId)}.svg`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && Boolean(item));
  return strings.length > 0 ? strings : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
