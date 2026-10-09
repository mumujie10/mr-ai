import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export interface ProviderPresetRepositoryOptions {
  readonly dataDir?: string;
  readonly bundledCatalogPath?: string;
  readonly localCatalogPath?: string;
}

function resolveProviderPresetBundledCatalogPaths(
  options: ProviderPresetRepositoryOptions,
): string[] {
  if (options.bundledCatalogPath) return [options.bundledCatalogPath];
  return [
    join(MODULE_DIRECTORY, 'assets', 'models-dev-catalog.json.gz'),
    join(MODULE_DIRECTORY, '..', '..', '..', '..', '..', 'assets', 'models-dev-catalog.json.gz'),
  ];
}

function resolveProviderPresetLocalCatalogPath(
  options: ProviderPresetRepositoryOptions,
): string | undefined {
  return (
    options.localCatalogPath ??
    (options.dataDir ? join(options.dataDir, 'cache', 'models-dev-catalog.json') : undefined)
  );
}

/**
 * Snapshot bytes the distribution already owns: the bundled asset plus a
 * snapshot persisted by an earlier release. Reading is the whole contract; the
 * CLI never writes or refreshes these files.
 */
export async function readProviderPresetSnapshotCandidates(
  options: ProviderPresetRepositoryOptions,
): Promise<unknown[]> {
  const candidates = await Promise.all([
    ...resolveProviderPresetBundledCatalogPaths(options).map((filePath) =>
      readCatalogSnapshot(filePath),
    ),
    readCatalogSnapshot(resolveProviderPresetLocalCatalogPath(options)),
  ]);
  return candidates.filter((candidate) => candidate !== undefined);
}

async function readCatalogSnapshot(filePath: string | undefined): Promise<unknown> {
  if (!filePath) return undefined;
  try {
    const contents = filePath.endsWith('.gz')
      ? gunzipSync(await readFile(filePath)).toString('utf8')
      : await readFile(filePath, 'utf8');
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
}
