import type { SkillEntry, SkillSourceKind } from '@mavis/skills';
import {
  SkillScope,
  SkillSourceType,
  type SkillInfo,
} from '@mavis/protocol/local';

import { frontmatterString } from './registry-family.js';

/**
 * Registry view mapping + list-paging helpers split out of
 * `registry-operations.ts` to keep it inside the local-runtime layout budget.
 * Pure projection only: no registry IO lives here.
 */

export function toSkillInfo(entry: SkillEntry, enabled = true): SkillInfo {
  // Presentation comes from the Skill file itself: an explicit frontmatter
  // title, then let the UI fall back to name.
  // Do not use entry.title because it also falls back to the markdown heading.
  const displayName = frontmatterString(entry.frontmatter.title);
  const info: SkillInfo & {
    sourceKind?: string;
    displayNames?: typeof entry.displayNames;
    descriptions?: typeof entry.descriptions;
  } = {
    name: entry.name,
    ...(displayName ? { displayName } : {}),
    description: entry.description,
    displayDescription: entry.description,
    scope: toSkillScope(entry.rootKind),
    sourceType: toSkillSourceType(entry.rootKind),
    sourceKind: toSourceKind(entry.rootKind, entry.rootScope),
    ...(entry.displayNames ? { displayNames: entry.displayNames } : {}),
    ...(entry.descriptions ? { descriptions: entry.descriptions } : {}),
    ...(entry.rootKind === 'agent' && entry.rootScope ? { agentName: entry.rootScope } : {}),
    updatedAt: Math.trunc(entry.mtimeMs),
    locationUri: entry.locationUri,
    enabled,
  };
  return info;
}

// Fine-grained physical source string consumed by the UI's
// `isLocalizableBuiltinSkill` gate. Builtin skills split by owning agent:
//   builtin + owning agent -> builtin-agent
//   builtin + no agent     -> builtin-global
// Non-builtin kinds surface their registry kind verbatim.
export function toSourceKind(kind: SkillSourceKind, rootScope?: string): string {
  if (kind === 'builtin') {
    return rootScope ? 'builtin-agent' : 'builtin-global';
  }
  return kind;
}

export function toSkillScope(kind: SkillSourceKind): SkillScope {
  switch (kind) {
    case 'agent':
      return SkillScope.AGENT;
    case 'builtin':
    case 'project':
    case 'workspace':
    case 'global':
    case 'user':
      return SkillScope.GLOBAL;
  }
}

export function toSkillSourceType(kind: SkillSourceKind): SkillSourceType {
  return kind === 'builtin' ? SkillSourceType.MINIMAX_OFFICIAL : SkillSourceType.USER_CONTRIBUTION;
}

export function parseCursor(cursor: string | undefined): number {
  const value = Number(cursor ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function normalizeLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || limit === undefined || limit <= 0) return 50;
  return Math.min(limit, 200);
}

export function normalizeOptionalNumber(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
