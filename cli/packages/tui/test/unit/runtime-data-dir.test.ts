import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getTuiDataDirPath,
  prepareTuiDataDir,
  resolveDefaultTuiDataDir,
} from '../../src/runtime/data-dir.js';

describe('TUI data directory', () => {
  it.each(['dev', 'test', 'staging', 'prod'] as const)(
    'uses the shared user directory for %s builds',
    (buildEnv) => {
      expect(resolveDefaultTuiDataDir(buildEnv, undefined, () => null)).toBe(
        join(homedir(), '.mireai'),
      );
    },
  );

  it('keeps the shared profile suffix', () => {
    expect(resolveDefaultTuiDataDir('prod', undefined, () => 'smoke')).toBe(
      join(homedir(), '.mireai-smoke'),
    );
  });

  const precedenceCases: Array<{ environment: Record<string, string>; expected: string }> = [
    { environment: {}, expected: '/default' },
    { environment: { MIREAI_DATA_DIR: '  ' }, expected: '/default' },
    { environment: { MIREAI_DATA_DIR: ' /selected ' }, expected: '/selected' },
    // MiniMax Code's own override variables must not redirect this CLI into
    // another install's data directory.
    { environment: { MINIMAX_DATA_DIR: '/vendor' }, expected: '/default' },
    { environment: { MAVIS_DATA_DIR: '/vendor' }, expected: '/default' },
  ];

  it.each(precedenceCases)(
    'resolves $environment to $expected',
    ({ environment, expected }) => {
      expect(getTuiDataDirPath(environment, () => '/default')).toBe(expected);
    },
  );

  it('passes the selected directory to runtime initialization', async () => {
    const configureRuntimeEnvironment = vi.fn();
    await expect(prepareTuiDataDir({
      environment: { MIREAI_DATA_DIR: ' /selected ' },
      getBuildEnv: () => 'prod',
      configureRuntimeEnvironment,
    })).resolves.toBe('/selected');
    expect(configureRuntimeEnvironment).toHaveBeenCalledWith({ dataDir: '/selected' });
  });
});
