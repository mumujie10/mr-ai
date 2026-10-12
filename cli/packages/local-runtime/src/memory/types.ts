export const LOCAL_MEMORY_TOPIC_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface LocalMemoryConfig {
  dataDir: string;
  enabled?: boolean;
}

export interface LocalMemoryScopeGates {
  /** Global (user.md) memory: read + update across every project. */
  readonly userEnabled: boolean;
  /** Per-project memory under memory/projects/<slug>/. */
  readonly projectEnabled: boolean;
}

export type LocalMemoryScope = 'user' | 'agent' | 'project';

/**
 * How a local-runtime memory call is addressed. Local agents have no i64
 * snowflake — only their on-disk directory name — so agent scope is keyed by
 * `agentName` (the `agents/<agentName>/` directory) rather than a numeric id.
 * Project scope is keyed by the session's absolute workspace path and stores
 * one MEMORY.md per project under `memory/projects/<slug>/`.
 */
export type LocalMemoryTarget =
  | { scope: 'user' }
  | { scope: 'agent'; agentName: string }
  | { scope: 'project'; workspacePath: string };

export interface LocalMemoryLocation {
  scope: LocalMemoryScope;
  agentName?: string;
  memoryDir: string;
  mainPath: string;
}

export interface LocalMemoryReadResult {
  content: string;
  sizeBytes: number;
  updatedAt?: string;
  brief?: string;
}

export interface LocalMemorySearchResult {
  lineNumber: number;
  line: string;
  context?: string[];
}

export interface LocalMemoryTopicEntry {
  name: string;
  description: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface LocalMemoryDailyEntry {
  date: string;
  sizeBytes: number;
  brief?: string;
  archived: boolean;
}

export interface LocalMemoryArchiveEntry {
  snapshotDate: string;
  fileName: string;
  sizeBytes: number;
}

export interface LocalMemoryUnremindedEntry {
  sessionId: string;
  agentName: string;
  wroteMemory: boolean;
  reminded: boolean;
  checkedAt: string;
  lastReflectedAt?: string;
}

export class LocalMemoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LocalMemoryError';
  }
}

export type LocalMemoryEventEmitter = (type: string, payload: Record<string, unknown>) => void;
