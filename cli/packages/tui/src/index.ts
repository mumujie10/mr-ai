#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import {
  configureTuiRuntimeEnvironment,
  resolveTuiStartupEnvironmentOption,
} from './cli/environment.js';
import { MINIMAX_INTERNAL_PACKAGE_NAME, resolveTuiPackageName } from './build-info.js';

async function main(): Promise<void> {
  const packageName = resolveTuiPackageName(fileURLToPath(import.meta.url));
  const internalPackage = packageName === MINIMAX_INTERNAL_PACKAGE_NAME;
  let startupBuildEnvironment: ReturnType<typeof resolveTuiStartupEnvironmentOption>;
  try {
    startupBuildEnvironment = resolveTuiStartupEnvironmentOption(
      process.argv.slice(2),
      internalPackage,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const { getTuiDataDirPath } = await import('./runtime/data-dir.js');
  configureTuiRuntimeEnvironment({
    dataDir: getTuiDataDirPath(),
    ...(startupBuildEnvironment ? { startupBuildEnvironment } : {}),
  });
  const { runTuiCli } = await import('./cli/main.js');
  await runTuiCli({ allowStartupEnvironmentSelection: internalPackage });
}

await main();
