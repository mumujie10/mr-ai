import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeLocalMemoryTool } from '../../src/memory/local-memory-tool.js';
import { LocalMemoryFacade } from '../../src/memory/local-memory-facade.js';
import {
  projectMemorySlug,
} from '../../src/memory/local-memory-store-utils.js';
import { resolveLocalMemoryScopeGates } from '../../src/memory/local-memory-env-gates.js';
import { LocalMemoryError } from '../../src/memory/types.js';

function workspaceFacade(
  dataDir: string,
  gates?: { userEnabled: boolean; projectEnabled: boolean },
) {
  return new LocalMemoryFacade({
    config: () => ({ dataDir, enabled: true }),
    nowMs: () => 1_700_000_000_000,
    ...(gates ? { scopeGates: () => gates } : {}),
  });
}

const toolContext = { sessionId: 'ses_project', turnId: 'turn_project', agentName: 'mavis' };

describe('project memory slug encoding', () => {
  it('keeps alphanumerics and makes every other character injective', () => {
    expect(projectMemorySlug('/Users/mumujie/www/mr-ai')).toBe('-Users-mumujie-www-mr--ai');
    expect(projectMemorySlug('/a-b')).not.toBe(projectMemorySlug('/a/b'));
    expect(projectMemorySlug('/a b/c')).toBe('-a-b-c');
    expect(projectMemorySlug('/a-b/c')).toBe('-a--b-c');
    expect(projectMemorySlug('/a-b-c')).toBe('-a--b--c');
    expect(projectMemorySlug('/a b/c')).not.toBe(projectMemorySlug('/a-b/c'));
  });

  it('resolves relative paths against cwd so both spellings share one store', () => {
    expect(projectMemorySlug('proj')).toBe(projectMemorySlug(resolve('proj')));
  });

  it('rejects an empty workspace path', () => {
    expect(() => projectMemorySlug('   ')).toThrowError(
      expect.objectContaining({ code: 'INVALID_WORKSPACE' }),
    );
  });
});

describe('memory scope env gates', () => {
  const cases: Array<[Record<string, string>, boolean]> = [
    [{ MAVIS_MEMORY_GLOBAL: '0' }, false],
    [{ MAVIS_MEMORY_GLOBAL: 'false' }, false],
    [{ MAVIS_MEMORY_GLOBAL: ' OFF ' }, false],
    [{ MAVIS_MEMORY_GLOBAL: '1' }, true],
    [{ MAVIS_MEMORY_GLOBAL: 'on' }, true],
  ];
  it.each(cases)('reads MAVIS_MEMORY_GLOBAL=%j as %s', (env, expected) => {
    vi.stubEnv('MAVIS_MEMORY_GLOBAL', env.MAVIS_MEMORY_GLOBAL!);
    expect(resolveLocalMemoryScopeGates().userEnabled).toBe(expected);
  });

  it('treats unset variables as enabled', () => {
    vi.stubEnv('MAVIS_MEMORY_GLOBAL', '');
    vi.stubEnv('MAVIS_MEMORY_PROJECT', '');
    vi.unstubAllEnvs();
    expect(resolveLocalMemoryScopeGates({})).toEqual({
      userEnabled: true,
      projectEnabled: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe('project memory store', () => {
  it('round-trips under memory/projects/<slug>/MEMORY.md', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'local-memory-project-'));
    const workspace = join(dataDir, 'my workspace');
    try {
      const facade = workspaceFacade(dataDir);
      await facade.writeProjectMemory(workspace, '# Project notes');
      await facade.appendProjectMemory(workspace, 'first observation');
      await facade.appendProjectMemory(workspace, 'second observation');
      await facade.editProjectMemory(workspace, 'second', 'corrected', false);

      const slug = projectMemorySlug(workspace);
      const raw = await readFile(join(dataDir, 'memory', 'projects', slug, 'MEMORY.md'), 'utf8');
      expect(raw).toContain('# Project notes');
      expect(raw).toContain('first observation');
      expect(raw).toContain('corrected');
      expect(raw).not.toContain('second observation');

      await expect(facade.getProjectMemory(workspace)).resolves.toMatchObject({
        content: expect.stringContaining('corrected'),
      });
      const hits = await facade.searchProjectMemory(workspace, 'first');
      expect(hits.length).toBeGreaterThan(0);

      const other = await facade.getProjectMemory(join(dataDir, 'other'));
      expect(other.content).toBe('');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('enforces the host scope gates at the facade boundary', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'local-memory-project-gates-'));
    try {
      const gates = { userEnabled: false, projectEnabled: true };
      const facade = workspaceFacade(dataDir, gates);
      await expect(facade.getUserMemory()).rejects.toMatchObject({
        code: 'MEMORY_GLOBAL_DISABLED',
      });
      await expect(facade.appendUserMemory('x', 'why')).rejects.toMatchObject({
        code: 'MEMORY_GLOBAL_DISABLED',
      });
      await facade.writeProjectMemory(join(dataDir, 'ws'), 'still allowed');
      await expect(facade.collectReminderMemory('mavis')).resolves.toMatchObject({ user: '' });

      const closed = workspaceFacade(dataDir, { userEnabled: true, projectEnabled: false });
      await expect(closed.getProjectMemory(join(dataDir, 'ws'))).rejects.toMatchObject({
        code: 'MEMORY_PROJECT_DISABLED',
      });
      await expect(closed.writeProjectMemory(join(dataDir, 'ws'), 'x')).rejects.toMatchObject({
        code: 'MEMORY_PROJECT_DISABLED',
      });
      await expect(closed.getUserMemory()).resolves.toBeDefined();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe('memory tool target=project', () => {
  it('writes and reads project memory through the session workspace', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'local-memory-project-tool-'));
    try {
      const facade = workspaceFacade(dataDir);
      const access = { agentScopeEnabled: true, projectWorkspacePath: dataDir };
      const write = await executeLocalMemoryTool(facade, toolContext, {
        target: 'project',
        operation: 'append',
        content: 'PROJECT_TOOL_SENTINEL',
      } as never, undefined, undefined, undefined, access);
      expect(write.details).toMatchObject({ ok: true });

      const read = await executeLocalMemoryTool(facade, toolContext, {
        target: 'project',
        operation: 'read',
      } as never, undefined, undefined, undefined, access);
      expect(read.text).toContain('PROJECT_TOOL_SENTINEL');

      const search = await executeLocalMemoryTool(facade, toolContext, {
        target: 'project',
        operation: 'search',
        query: 'SENTINEL',
      } as never, undefined, undefined, undefined, access);
      expect(JSON.parse(search.text)).toEqual(
        expect.arrayContaining([expect.objectContaining({ line: expect.stringContaining('SENTINEL') })]),
      );

      const edit = await executeLocalMemoryTool(facade, toolContext, {
        target: 'project',
        operation: 'edit',
        oldString: 'PROJECT_TOOL_SENTINEL',
        newString: 'EDITED_SENTINEL',
      } as never, undefined, undefined, undefined, access);
      expect(edit.details).toMatchObject({ ok: true });
      await expect(facade.getProjectMemory(dataDir)).resolves.toMatchObject({
        content: expect.stringContaining('EDITED_SENTINEL'),
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('refuses project operations without a session workspace', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'local-memory-project-nows-'));
    try {
      const facade = workspaceFacade(dataDir);
      const result = await executeLocalMemoryTool(facade, toolContext, {
        target: 'project',
        operation: 'read',
      } as never, undefined, undefined, undefined, { agentScopeEnabled: true });
      expect(result.details).toMatchObject({ ok: false, code: 'PROJECT_CONTEXT_REQUIRED' });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('leaves project operations usable when the Agent profile has no agent Memory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'local-memory-project-noscope-'));
    try {
      const facade = workspaceFacade(dataDir);
      const access = { agentScopeEnabled: false, projectWorkspacePath: dataDir };
      const read = await executeLocalMemoryTool(facade, toolContext, {
        target: 'project',
        operation: 'read',
      } as never, undefined, undefined, undefined, access);
      expect(read.details).toMatchObject({ ok: true });

      const main = await executeLocalMemoryTool(facade, toolContext, {
        target: 'main',
        operation: 'append',
        content: 'blocked',
      } as never, undefined, undefined, undefined, access);
      expect(main.details).toMatchObject({ ok: false, code: 'AGENT_SCOPE_DISABLED' });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('surfaces disabled host gates as tool errors', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'local-memory-project-gated-'));
    try {
      const facade = workspaceFacade(dataDir, { userEnabled: true, projectEnabled: false });
      const result = await executeLocalMemoryTool(facade, toolContext, {
        target: 'project',
        operation: 'append',
        content: 'blocked',
      } as never, undefined, undefined, undefined, {
        agentScopeEnabled: true,
        projectWorkspacePath: dataDir,
      });
      expect(result.details).toMatchObject({ ok: false, code: 'MEMORY_PROJECT_DISABLED' });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('still blocks project writes when the session forbids memory writes', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'local-memory-project-readonly-'));
    try {
      const facade = workspaceFacade(dataDir);
      const result = await executeLocalMemoryTool(facade, toolContext, {
        target: 'project',
        operation: 'write',
        content: 'blocked',
      } as never, undefined, undefined, undefined, {
        agentScopeEnabled: true,
        projectWorkspacePath: dataDir,
        writeEnabled: false,
      });
      expect(result.details).toMatchObject({ ok: false, code: 'MEMORY_WRITE_DISABLED' });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('blocks user reads when the global memory gate is off', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'local-memory-user-gated-'));
    try {
      const facade = workspaceFacade(dataDir, { userEnabled: false, projectEnabled: true });
      const result = await executeLocalMemoryTool(facade, toolContext, {
        target: 'user',
        operation: 'read',
      } as never);
      expect(result.details).toMatchObject({ ok: false, code: 'MEMORY_GLOBAL_DISABLED' });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
