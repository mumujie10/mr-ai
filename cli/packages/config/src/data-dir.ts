import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * This fork's own data directory.
 *
 * It used to be `~/.minimax` — the same directory the official MiniMax Code CLI
 * writes. One directory shared by two products means one product reads,
 * overwrites and deletes the other's channels, sessions and grants, so the
 * bundled runtime got a home of its own. Nothing in this module probes, moves or
 * links any other directory: `~/.minimax` is MiniMax Code's business, and an
 * older install is left exactly where it is.
 */
export const NEW_DATA_DIR_BASENAME = '.mireai';

/**
 * Directory name this fork's upstream used before the current layout. It only
 * takes part in lexical read-only alias matching (a session workspace recorded
 * under the old name still resolves to the same session); it is never a
 * migration target and this module never creates or links it.
 */
export const LEGACY_DATA_DIR_BASENAME = '.mavis';

export type DataDirMigrationLogger = Pick<Console, 'error' | 'info' | 'warn'>;

export interface ResolveDataDirOptions {
  homeDir?: string;
  profile?: string | null;
  logger?: DataDirMigrationLogger;
}

function resolveHomeDir(homeDir?: string): string {
  return homeDir ?? os.homedir();
}

function basenameForProfile(base: string, profile?: string | null): string {
  return profile ? `${base}-${profile}` : base;
}

export function getPrimaryDataDirPath(homeDir?: string, profile?: string | null): string {
  return path.join(resolveHomeDir(homeDir), basenameForProfile(NEW_DATA_DIR_BASENAME, profile));
}

export function getLegacyDataDirPath(homeDir?: string, profile?: string | null): string {
  return path.join(resolveHomeDir(homeDir), basenameForProfile(LEGACY_DATA_DIR_BASENAME, profile));
}

/** The fork's data directory, created if absent. */
export function resolveDataDir(options: ResolveDataDirOptions = {}): string {
  const dataDir = getPrimaryDataDirPath(options.homeDir, options.profile ?? null);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    options.logger?.warn(`Failed to create data dir ${dataDir}: ${String(error)}`);
  }
  return dataDir;
}
