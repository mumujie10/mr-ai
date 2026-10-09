import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { providerCompletionUrl, providerModelsUrls } from '../../connectivity/provider-request.js';
import { ProviderPresetCatalog } from './provider-presets.service.js';
import { modelsFromInputs } from '../../management/service-input.js';
import { buildModelEntry } from '../list-models.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

/**
 * The registry is offline-only, so every test installs this hook: any request
 * is recorded and fails loudly instead of being tolerated. It replaces the
 * former per-catalog fetch seams.
 */
function recordNetworkAttempts(): string[] {
  const attempts: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
    attempts.push(String(input instanceof Request ? input.url : input));
    throw new Error(`Unexpected network access: ${String(input)}`);
  }) as unknown as typeof fetch);
  return attempts;
}

function rawCatalog(modelId: string) {
  return {
    compatible: {
      name: 'Compatible API',
      npm: '@ai-sdk/openai-compatible',
      api: 'https://api.example.test/v1',
      models: { [modelId]: { name: modelId, tool_call: true } },
    },
  };
}

function snapshot(updatedAt: number, modelId: string, iconBaseUrl?: string) {
  return {
    version: 1,
    source: 'https://models.dev/api.json',
    updatedAt,
    ...(iconBaseUrl ? { iconBaseUrl } : {}),
    catalog: rawCatalog(modelId),
  };
}

async function catalogPaths() {
  const root = await mkdtemp(join(tmpdir(), 'mavis-provider-presets-'));
  temporaryDirectories.push(root);
  const dataDir = join(root, 'data');
  const bundledCatalogPath = join(root, 'bundled.json.gz');
  await mkdir(join(dataDir, 'cache'), { recursive: true });
  return {
    dataDir,
    bundledCatalogPath,
    localCatalogPath: join(dataDir, 'cache', 'models-dev-catalog.json'),
  };
}

function providerCatalog(providerIds: readonly string[]) {
  return Object.fromEntries(
    providerIds.map((providerId) => [
      providerId,
      {
        name: providerId,
        npm: '@ai-sdk/openai-compatible',
        api: `https://${providerId}.example/v1`,
        models: { model: { name: 'Model', tool_call: true } },
      },
    ]),
  );
}

async function writeBundled(contents: unknown, filePath: string) {
  await writeFile(filePath, gzipSync(Buffer.from(JSON.stringify(contents), 'utf8')));
}

async function orderingCatalog(providerIds: readonly string[], region: 'cn' | 'en') {
  const paths = await catalogPaths();
  await writeBundled(
    {
      version: 1,
      source: 'https://models.dev/api.json',
      updatedAt: 1,
      catalog: providerCatalog(providerIds),
    },
    paths.bundledCatalogPath,
  );
  return new ProviderPresetCatalog({ ...paths, regionGetter: () => region });
}

async function parsePresetsForTest(catalog: Record<string, unknown>, iconBaseUrl?: string) {
  const paths = await catalogPaths();
  await writeBundled(
    {
      version: 1,
      source: 'https://models.dev/api.json',
      updatedAt: 1,
      ...(iconBaseUrl ? { iconBaseUrl } : {}),
      catalog,
    },
    paths.bundledCatalogPath,
  );
  return new ProviderPresetCatalog({ ...paths, regionGetter: () => 'cn' }).listProviderPresets();
}

describe('models.dev Provider Presets', () => {
  it('distinguishes all Z.AI and Zhipu plans without changing catalog IDs or endpoints', async () => {
    const plans = [
      ['zai', 'Z.AI API', 'https://api.z.ai/api/paas/v4'],
      ['zai-coding-plan', 'Z.AI Coding Plan', 'https://api.z.ai/api/coding/paas/v4'],
      ['zhipuai', 'Zhipu AI API', 'https://open.bigmodel.cn/api/paas/v4'],
      [
        'zhipuai-coding-plan',
        'Zhipu AI Coding Plan',
        'https://open.bigmodel.cn/api/coding/paas/v4',
      ],
    ];
    const presets = await parsePresetsForTest(
      Object.fromEntries(
        plans.map(([id, , api]) => [
          id,
          {
            name: 'Ambiguous upstream label',
            npm: '@ai-sdk/openai-compatible',
            api,
            models: { 'glm-5.3': { name: 'GLM-5.3', tool_call: true } },
          },
        ]),
      ),
    );
    expect(presets).toHaveLength(4);
    for (const [providerId, name, baseUrl] of plans) {
      const preset = presets.find((item) => item.providerId === providerId);
      expect(preset).toMatchObject({
        providerId,
        name,
        baseUrl,
        apiFormat: 'openai-completions',
        models: [{ modelId: 'glm-5.3' }],
      });
      expect(providerCompletionUrl('openai-completions', preset!.baseUrl)).toBe(
        `${baseUrl}/chat/completions`,
      );
    }
  });

  it('builds each Provider icon URL from the catalog snapshot prefix', async () => {
    const [preset] = await parsePresetsForTest(
      providerCatalog(['vendor.with.dots']),
      'https://cdn.example/catalog/release/logos/',
    );

    expect(preset?.iconUrl).toBe('https://cdn.example/catalog/release/logos/vendor.with.dots.svg');
  });

  it('omits the icon URL when the snapshot carries no icon base URL', async () => {
    const [preset] = await parsePresetsForTest(providerCatalog(['compatible']));

    expect(preset).not.toHaveProperty('iconUrl');
  });

  it('excludes MiniMax providers from the preset catalog', async () => {
    const presets = await parsePresetsForTest(
      providerCatalog([
        'minimax',
        'minimax-cn',
        'minimax-coding-plan',
        'minimax-cn-coding-plan',
        'compatible',
      ]),
    );

    expect(presets.map((preset) => preset.providerId)).toEqual(['compatible']);
  });

  it('maps the three supported transports and normalizes their request bases', async () => {
    const messagesProviderId = 'anthropic';
    const presets = await parsePresetsForTest({
      openai: {
        name: 'OpenAI',
        npm: '@ai-sdk/openai',
        models: { gpt: { name: 'GPT', tool_call: true } },
      },
      compatible: {
        name: 'Compatible',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://compatible.example/v1/chat/completions',
        models: { chat: { name: 'Chat', tool_call: true } },
      },
      [messagesProviderId]: {
        name: 'Messages API',
        npm: '@ai-sdk/anthropic',
        models: { chat: { name: 'Chat', tool_call: true } },
      },
    });

    // Display order follows the region pin table and is asserted by the
    // "Provider Preset ordering" suite; here the mapping is the subject, so the
    // presets are compared in a stable provider-id order.
    const byId = [...presets].sort((left, right) =>
      left.providerId.localeCompare(right.providerId),
    );
    expect(
      byId.map(({ providerId, baseUrl, apiFormat }) => ({
        providerId,
        baseUrl,
        apiFormat,
      })),
    ).toEqual([
      {
        providerId: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiFormat: 'anthropic-messages',
      },
      {
        providerId: 'compatible',
        baseUrl: 'https://compatible.example/v1',
        apiFormat: 'openai-completions',
      },
      {
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiFormat: 'openai-responses',
      },
    ]);
    const messagesApiHost = 'https://api.anthropic.com';
    expect(
      byId.map((preset) => ({
        completion: providerCompletionUrl(preset.apiFormat, preset.baseUrl),
        models: providerModelsUrls(preset.apiFormat, preset.baseUrl),
      })),
    ).toEqual([
      {
        completion: `${messagesApiHost}/v1/messages`,
        models: [`${messagesApiHost}/v1/models`, `${messagesApiHost}/models`],
      },
      {
        completion: 'https://compatible.example/v1/chat/completions',
        models: ['https://compatible.example/v1/models'],
      },
      {
        completion: 'https://api.openai.com/v1/responses',
        models: ['https://api.openai.com/v1/models'],
      },
    ]);
  });

  it('keeps non-native transports only when they declare an API base', async () => {
    const presets = await parsePresetsForTest({
      meta: {
        name: 'Meta',
        npm: '@ai-sdk/openai',
        api: 'https://openai.meta.example/v1/responses',
        models: { llama: { name: 'Llama', tool_call: true } },
      },
      'openai-missing-api': {
        name: 'OpenAI-compatible without API',
        npm: '@ai-sdk/openai',
        models: { model: { tool_call: true } },
      },
      'messages-proxy': {
        name: 'Messages proxy',
        npm: '@ai-sdk/anthropic',
        api: 'https://messages.example/v1/messages',
        models: { chat: { name: 'Chat', tool_call: true } },
      },
      'messages-missing-api': {
        name: 'Messages-compatible without API',
        npm: '@ai-sdk/anthropic',
        models: { model: { tool_call: true } },
      },
    });

    expect(
      presets.map(({ providerId, baseUrl, apiFormat }) => ({
        providerId,
        baseUrl,
        apiFormat,
      })),
    ).toEqual([
      {
        providerId: 'messages-proxy',
        baseUrl: 'https://messages.example',
        apiFormat: 'anthropic-messages',
      },
      {
        providerId: 'meta',
        baseUrl: 'https://openai.meta.example/v1',
        apiFormat: 'openai-responses',
      },
    ]);
  });

  it('keeps opaque Provider IDs and only complete tool-capable presets', async () => {
    const presets = await parsePresetsForTest({
      'vendor.with.dots': {
        name: 'Vendor',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://vendor.example/v1',
        models: {
          unsupported: { name: 'Unsupported', tool_call: false },
          supported: {
            name: 'Supported',
            tool_call: true,
            attachment: true,
            reasoning: true,
            temperature: true,
            modalities: { input: ['text', 'image'], output: ['text'] },
            limit: { context: 128_000, output: 8_192 },
          },
        },
      },
      unsupportedNpm: {
        name: 'Unsupported npm',
        npm: '@ai-sdk/google',
        api: 'https://google.example',
        models: { model: { tool_call: true } },
      },
      unsafe: {
        name: 'Unsafe URL',
        npm: '@ai-sdk/openai-compatible',
        api: 'file:///tmp/provider',
        models: { model: { tool_call: true } },
      },
      empty: {
        name: 'No models',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://empty.example',
        models: {},
      },
    });

    expect(presets).toEqual([
      {
        providerId: 'vendor.with.dots',
        name: 'Vendor',
        baseUrl: 'https://vendor.example/v1',
        apiFormat: 'openai-completions',
        models: [
          {
            modelId: 'supported',
            displayName: 'Supported',
            attachment: true,
            reasoning: true,
            toolCall: true,
            temperature: true,
            modalities: { input: ['text', 'image'], output: ['text'] },
            limit: { context: 128_000, output: 8_192 },
          },
        ],
      },
    ]);
  });

  it('parses declared reasoning effort options for Kimi K3 on both Moonshot providers', async () => {
    const k3 = {
      name: 'Kimi K3',
      tool_call: true,
      attachment: true,
      reasoning: true,
      reasoning_options: [
        { type: 'toggle' },
        { type: 'effort', values: ['low', 'high', 'max'] },
      ],
      temperature: false,
      modalities: { input: ['text', 'image', 'video'], output: ['text'] },
      limit: { context: 1_048_576, output: 131_072 },
    };
    const presets = await parsePresetsForTest({
      moonshotai: {
        name: 'Moonshot AI',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://api.moonshot.ai/v1',
        models: {
          'kimi-k3': k3,
          'kimi-k2.6': {
            name: 'Kimi K2.6',
            tool_call: true,
            reasoning: true,
            reasoning_options: [{ type: 'toggle' }],
          },
          'kimi-k2.7-code': {
            name: 'Kimi K2.7 Code',
            tool_call: true,
            reasoning: true,
            reasoning_options: [],
          },
        },
      },
      'moonshotai-cn': {
        name: 'Moonshot AI China',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://api.moonshot.cn/v1',
        models: { 'kimi-k3': k3 },
      },
    });

    for (const providerId of ['moonshotai', 'moonshotai-cn'] as const) {
      const preset = presets.find((candidate) => candidate.providerId === providerId);
      expect(preset?.models.find((model) => model.modelId === 'kimi-k3')).toMatchObject({
        reasoning: true,
        effortOptions: ['low', 'high', 'max'],
      });
      if (!preset) throw new Error(`Missing preset ${providerId}`);
      const savedModel = modelsFromInputs(preset.models)['kimi-k3'];
      expect(savedModel?.thinking).toEqual({ effortOptions: ['low', 'high', 'max'] });
      expect(buildModelEntry({
        providerId: `custom_provider:${providerId}`,
        modelId: 'kimi-k3',
        model: savedModel,
        selected: false,
        providerSource: 'custom_provider',
        providerKind: 'custom',
        providerName: preset.name,
      }).effortOptions).toEqual(['low', 'high', 'max']);
    }
    const moonshot = presets.find((candidate) => candidate.providerId === 'moonshotai');
    // A toggle-only or bare reasoning model can think, but declares no
    // selectable effort levels, so it must not gain effortOptions.
    for (const modelId of ['kimi-k2.6', 'kimi-k2.7-code'] as const) {
      const model = moonshot?.models.find((candidate) => candidate.modelId === modelId);
      expect(model).toMatchObject({ reasoning: true });
      expect(model).not.toHaveProperty('effortOptions');
    }
  });

  it('normalizes effort metadata without inventing or dropping declared levels', async () => {
    const [preset] = await parsePresetsForTest({
      compatible: {
        name: 'Compatible API',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://api.example.test/v1',
        models: {
          custom: {
            name: 'Custom',
            tool_call: true,
            reasoning: true,
            reasoning_options: [null, {}, { type: 'effort', values: 'high' },
              { type: 'effort', values: [' light ', 'light', '', ' ', 7, null, 'max'] }],
          },
          'empty-effort': {
            name: 'Empty effort',
            tool_call: true,
            reasoning: true,
            reasoning_options: [{ type: 'effort', values: [] }],
          },
          'budget-only': {
            name: 'Budget only',
            tool_call: true,
            reasoning: true,
            reasoning_options: [{ type: 'budget_tokens', min: 128, max: 32_768 }],
          },
        },
      },
    });

    const model = (modelId: string) =>
      preset?.models.find((candidate) => candidate.modelId === modelId);
    // Unknown levels are preserved verbatim; blanks, duplicates and
    // non-strings never reach the roster.
    expect(model('custom')).toMatchObject({ effortOptions: ['light', 'max'] });
    expect(model('empty-effort')).not.toHaveProperty('effortOptions');
    expect(model('budget-only')).not.toHaveProperty('effortOptions');
  });
});

describe('models.dev Provider Preset snapshots', () => {
  it('lists the newest valid snapshot with zero network I/O', async () => {
    const attempts = recordNetworkAttempts();
    const paths = await catalogPaths();
    await writeBundled(snapshot(20, 'bundled-new'), paths.bundledCatalogPath);
    await writeFile(paths.localCatalogPath, JSON.stringify(snapshot(10, 'local-old')));
    const catalog = new ProviderPresetCatalog({ ...paths, regionGetter: () => 'cn' });

    await expect(catalog.listProviderPresets()).resolves.toMatchObject([
      { models: [{ modelId: 'bundled-new' }] },
    ]);

    await writeFile(paths.localCatalogPath, JSON.stringify(snapshot(30, 'local-new')));
    await expect(catalog.listProviderPresets()).resolves.toMatchObject([
      { models: [{ modelId: 'local-new' }] },
    ]);

    await writeFile(paths.localCatalogPath, '{not json');
    await expect(catalog.listProviderPresets()).resolves.toMatchObject([
      { models: [{ modelId: 'bundled-new' }] },
    ]);
    expect(attempts).toEqual([]);
  });

  it('serves the persisted snapshot when the bundled asset is corrupt, without a request', async () => {
    const attempts = recordNetworkAttempts();
    const paths = await catalogPaths();
    await writeFile(paths.bundledCatalogPath, Buffer.from('not gzip at all'));
    await writeFile(paths.localCatalogPath, JSON.stringify(snapshot(5, 'persisted')));

    await expect(
      new ProviderPresetCatalog({ ...paths, regionGetter: () => 'cn' }).listProviderPresets(),
    ).resolves.toMatchObject([{ models: [{ modelId: 'persisted' }] }]);
    expect(attempts).toEqual([]);
  });

  it.each([
    ['absent snapshot asset', null],
    ['corrupt gzip payload', '{not json'],
    ['snapshot from another source', { ...snapshot(10, 'stale'), source: 'https://example.test' }],
    ['snapshot without supported providers', { ...snapshot(10, 'stale'), catalog: {} }],
  ])(
    'reports the %s as an unavailable snapshot instead of reaching the network',
    async (_label, contents) => {
      const attempts = recordNetworkAttempts();
      const paths = await catalogPaths();
      if (typeof contents === 'string') {
        await writeFile(paths.bundledCatalogPath, Buffer.from(contents));
      } else if (contents) {
        await writeBundled(contents, paths.bundledCatalogPath);
      }

      await expect(
        new ProviderPresetCatalog({ ...paths, regionGetter: () => 'cn' }).listProviderPresets(),
      ).rejects.toThrow('No valid models.dev catalog snapshot is available');
      expect(attempts).toEqual([]);
    },
  );

  it('treats the snapshot directory as read-only while constructing and listing', async () => {
    const attempts = recordNetworkAttempts();
    const paths = await catalogPaths();
    await writeBundled(snapshot(20, 'bundled'), paths.bundledCatalogPath);

    const catalog = new ProviderPresetCatalog({ ...paths, regionGetter: () => 'cn' });
    await expect(catalog.listProviderPresets()).resolves.toMatchObject([
      { models: [{ modelId: 'bundled' }] },
    ]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(existsSync(paths.localCatalogPath)).toBe(false);
    expect(attempts).toEqual([]);
  });

  it.each(['cn', 'en'] as const)(
    'constructing the catalog in the %s region issues no request',
    async (region) => {
      const attempts = recordNetworkAttempts();
      const paths = await catalogPaths();
      await writeBundled(snapshot(20, 'bundled'), paths.bundledCatalogPath);

      new ProviderPresetCatalog({ ...paths, regionGetter: () => region });
      await new Promise((resolve) => setImmediate(resolve));

      expect(attempts).toEqual([]);
    },
  );

  it('serves a legacy snapshot without an icon base URL with no request and no write', async () => {
    // The shipped bundled asset is exactly this shape: `source`, `updatedAt` and
    // a stale `etag`, but no `iconBaseUrl`. It used to force a full refresh.
    const attempts = recordNetworkAttempts();
    const paths = await catalogPaths();
    await writeBundled({ ...snapshot(20, 'bundled'), etag: '"old-etag"' }, paths.bundledCatalogPath);

    const catalog = new ProviderPresetCatalog({ ...paths, regionGetter: () => 'cn' });
    await expect(catalog.listProviderPresets()).resolves.toMatchObject([
      { models: [{ modelId: 'bundled' }] },
    ]);
    const [preset] = await catalog.listProviderPresets();
    expect(preset).not.toHaveProperty('iconUrl');
    expect(existsSync(paths.localCatalogPath)).toBe(false);
    expect(attempts).toEqual([]);
  });

  it('rejects a snapshot whose icon base URL is unusable without any request', async () => {
    const attempts = recordNetworkAttempts();
    const paths = await catalogPaths();
    await writeBundled(
      {
        ...snapshot(20, 'bundled'),
        iconBaseUrl: 'ftp://icons.example',
        catalog: providerCatalog(['compatible']),
      },
      paths.bundledCatalogPath,
    );

    await expect(
      new ProviderPresetCatalog({ ...paths, regionGetter: () => 'cn' }).listProviderPresets(),
    ).rejects.toThrow('No valid models.dev catalog snapshot is available');
    expect(attempts).toEqual([]);
  });
});

describe('Provider Preset ordering', () => {
  it('uses the region-local CN pin order', async () => {
    const cnIds = [
      'minimax-cn',
      'zhipuai-coding-plan',
      'zhipuai',
      'deepseek',
      'moonshotai-cn',
      'openai',
      'anthropic',
      'aaa',
      'tencent-coding-plan',
      'zzz',
    ];
    const catalog = await orderingCatalog(cnIds, 'cn');

    await expect(
      catalog.listProviderPresets().then((items) => items.map((item) => item.providerId)),
    ).resolves.toEqual(cnIds.slice(1));
  });

  it('uses the region-local Global pin order', async () => {
    const globalIds = [
      'minimax',
      'zai-coding-plan',
      'zai',
      'deepseek',
      'moonshotai',
      'openai',
      'anthropic',
      'aaa',
      'tencent-coding-plan',
    ];
    const catalog = await orderingCatalog(globalIds, 'en');

    await expect(
      catalog.listProviderPresets().then((items) => items.map((item) => item.providerId)),
    ).resolves.toEqual(globalIds.slice(1));
  });

  it('skips pinned ids the snapshot does not contain', async () => {
    const catalog = await orderingCatalog(['openai', 'anthropic', 'aaa'], 'cn');

    await expect(
      catalog.listProviderPresets().then((items) => items.map((item) => item.providerId)),
    ).resolves.toEqual(['openai', 'anthropic', 'aaa']);
  });

  it('orders from the region table alone, even when the network would answer', async () => {
    const attempts = recordNetworkAttempts();
    const catalog = await orderingCatalog(['openai', 'anthropic', 'aaa'], 'cn');

    await expect(
      catalog.listProviderPresets().then((items) => items.map((item) => item.providerId)),
    ).resolves.toEqual(['openai', 'anthropic', 'aaa']);
    expect(attempts).toEqual([]);
  });
});
