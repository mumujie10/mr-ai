import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MR_CLI_MIN_NODE_VERSION = '22.19.0';
export const MR_CLI_SUPPORTED_NODE_VERSIONS = '22.19+, 24, 25, or 26';
export const TUI_BUILD_PROFILE = 'tui';
/** Identity written into `dist/package.json` by scripts/build.mjs. */
export const MR_CLI_PACKAGE_NAME = 'mr-cli';
/**
 * This package's own workspace name. A source or test run resolves the version
 * from `packages/tui/package.json`, not from the bundle, so both identities
 * have to be accepted or importing this module throws at startup.
 */
export const TUI_WORKSPACE_PACKAGE_NAME = '@mr/tui';

const PACKAGE_IDENTITIES = new Set([MR_CLI_PACKAGE_NAME, TUI_WORKSPACE_PACKAGE_NAME]);

interface PackageManifest {
  name: string;
  version: string;
}

export function resolveTuiPackageVersion(moduleUrl: string | URL = import.meta.url): string {
  for (const relativePath of ['./package.json', '../package.json']) {
    try {
      const manifest = JSON.parse(
        readFileSync(new URL(relativePath, moduleUrl), 'utf8'),
      ) as Partial<PackageManifest>;
      if (
        PACKAGE_IDENTITIES.has(manifest.name ?? '') &&
        typeof manifest.version === 'string' &&
        manifest.version.length > 0
      ) {
        return manifest.version;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Cannot resolve ${MR_CLI_PACKAGE_NAME} package version`);
}

function parseVersion(version: string): number[] | undefined {
  const parts = version.split('.');
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 10));
}

export function supportsTuiNodeVersion(version = process.versions.node): boolean {
  const currentParts = parseVersion(version);
  if (!currentParts) return false;

  const [major = -1, minor = 0] = currentParts;
  return (major === 22 && minor >= 19) || (major >= 24 && major <= 26);
}

/**
 * The package this entry point runs from, or undefined when no package.json is
 * nearby. MiniMax's internal distribution (`@minimax/code`) is the only name
 * that unlocks the managed-backend `--lane` escape hatch, so a fork build
 * resolving to `mr-cli` deliberately leaves that hatch closed.
 */
export const MINIMAX_INTERNAL_PACKAGE_NAME = '@minimax/code';

export function resolveTuiPackageName(
  moduleLocation: string | URL = import.meta.url,
): string | undefined {
  // Callers pass either an import.meta.url or a plain entry path
  // (process.argv[1]); `new URL(x, y)` rejects a bare path as the base.
  const base =
    moduleLocation instanceof URL
      ? moduleLocation
      : pathToFileURL(
          isAbsolute(moduleLocation) ? moduleLocation : resolve(moduleLocation),
        );
  for (const relativePath of ['./package.json', '../package.json']) {
    try {
      const manifest = JSON.parse(
        readFileSync(new URL(relativePath, base), 'utf8'),
      ) as Partial<PackageManifest>;
      if (typeof manifest.name === 'string' && manifest.name.length > 0) return manifest.name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return undefined;
}

export const MR_CLI_VERSION = resolveTuiPackageVersion();
