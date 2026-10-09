import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricsBatchReporter } from '@mavis/shared/local-runtime-logging';

import { buildLocalRuntimeMetricsClient } from '../../src/runtime/host-metrics.js';
import type { MetricsClient } from '../../src/common/metrics.js';

const clients: MetricsClient[] = [];
const fetchRequest = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv('__MAVIS_RUNTIME_MANAGED', '1');
  vi.stubEnv('MAVIS_BUILD_ENV', 'prod');
  vi.stubEnv('MAVIS_REGION', 'en');
  fetchRequest.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchRequest);
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('runtime metrics stay in-process', () => {
  it('posts nothing even in a managed production build', async () => {
    const client = buildLocalRuntimeMetricsClient({
      runtimeOwnerKind: 'tui',
      appVersion: '0.4.12',
    });
    clients.push(client);
    client.counter('started_total', 1);
    await client.flush();
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it('delivers metrics only to an explicitly injected reporter', async () => {
    const batches: number[] = [];
    const reporter: MetricsBatchReporter = {
      reportBatch: async (request) => {
        batches.push(request.metrics.length);
        return { accepted: request.metrics.length };
      },
    };
    const client = buildLocalRuntimeMetricsClient({
      runtimeOwnerKind: 'tui',
      appVersion: '0.4.12',
      metricsReporter: reporter,
    });
    clients.push(client);
    client.counter('started_total', 1);
    await client.flush();
    expect(batches).toEqual([1]);
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});
