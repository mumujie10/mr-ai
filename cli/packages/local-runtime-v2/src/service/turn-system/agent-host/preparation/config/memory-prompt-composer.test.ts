import { MEMORY_TAIL_INJECTION_CAP_CHARS } from '@mavis/shared';

import { describe, expect, it, vi } from 'vitest';

import { collectMemoryBlocks, type LocalPromptMemoryReader } from './memory-prompt-composer.js';

const WORKSPACE = '/tmp/workspace';
const SOURCES = [{ agentName: 'mavis', canonical: true }];

function stubReader(
  overrides: { user?: string; project?: string | Error } = {},
): LocalPromptMemoryReader {
  return {
    ...(overrides.user !== undefined
      ? { getUserMemory: async () => ({ content: overrides.user! }) }
      : {}),
    ...(overrides.project !== undefined
      ? {
          getProjectMemory: async () => {
            if (overrides.project instanceof Error) throw overrides.project;
            return { content: overrides.project! };
          },
        }
      : {}),
    collectReminderMemory: async () => ({
      main: '',
      mainPath: '/data/agents/mavis/memory/MEMORY.md',
      user: '',
      userPath: '/data/memory/user.md',
      summary: '',
      topics: [],
    }),
    getDaily: async () => ({ content: '' }),
  };
}

describe('collectMemoryBlocks project memory', () => {
  it('injects the project block in the custom-agent path (includeAgentMemory=false)', async () => {
    const reader = stubReader({ user: 'likes brevity', project: 'Uses pnpm workspaces' });
    const blocks = await collectMemoryBlocks(reader, SOURCES, () => 0, {
      includeAgentMemory: false,
      workspacePath: WORKSPACE,
    });
    const project = blocks.find((block) => block.startsWith('<project_memory>'));
    expect(project).toBeDefined();
    expect(project).toContain('Uses pnpm workspaces');
    expect(project).toContain(WORKSPACE);
    expect(project).toContain('target=project');
    expect(blocks.some((block) => block.startsWith('<user_profile>'))).toBe(true);
    expect(blocks.some((block) => block.includes('agent_memory'))).toBe(false);
  });

  it('injects the project block in the canonical agent path (includeAgentMemory=true)', async () => {
    const reader = stubReader({ project: 'Uses pnpm workspaces' });
    const blocks = await collectMemoryBlocks(reader, SOURCES, () => 0, {
      includeAgentMemory: true,
      workspacePath: WORKSPACE,
    });
    const project = blocks.find((block) => block.startsWith('<project_memory>'));
    expect(project).toContain('Uses pnpm workspaces');
    expect(project).toContain(WORKSPACE);
    expect(blocks.some((block) => block.startsWith('<agent_memory_tail'))).toBe(false);
  });

  it('omits the project block when the host disabled project memory (read throws)', async () => {
    const reader = stubReader({ project: new Error('MEMORY_PROJECT_DISABLED') });
    for (const includeAgentMemory of [false, true]) {
      const blocks = await collectMemoryBlocks(reader, SOURCES, () => 0, {
        includeAgentMemory,
        workspacePath: WORKSPACE,
      });
      expect(blocks.some((block) => block.startsWith('<project_memory>'))).toBe(false);
    }
  });

  it('omits the project block when project memory is empty', async () => {
    const projectSpy = vi.fn(async () => ({ content: '   ' }));
    const reader: LocalPromptMemoryReader = { ...stubReader(), getProjectMemory: projectSpy };
    const blocks = await collectMemoryBlocks(reader, SOURCES, () => 0, {
      includeAgentMemory: false,
      workspacePath: WORKSPACE,
    });
    expect(blocks.some((block) => block.startsWith('<project_memory>'))).toBe(false);
    expect(projectSpy).toHaveBeenCalledTimes(1);
  });

  it('skips the project read entirely without a workspace path', async () => {
    const projectSpy = vi.fn(async () => ({ content: 'note' }));
    const reader: LocalPromptMemoryReader = { ...stubReader(), getProjectMemory: projectSpy };
    const blocks = await collectMemoryBlocks(reader, SOURCES, () => 0, {
      includeAgentMemory: false,
    });
    expect(blocks.some((block) => block.startsWith('<project_memory>'))).toBe(false);
    expect(projectSpy).not.toHaveBeenCalled();
  });

  it('caps oversized project memory to the latest slice with a truncation note', async () => {
    const oversized = `old-${'x'.repeat(MEMORY_TAIL_INJECTION_CAP_CHARS)}-RECENT_HEAD`;
    const reader = stubReader({ project: oversized });
    const blocks = await collectMemoryBlocks(reader, SOURCES, () => 0, {
      includeAgentMemory: false,
      workspacePath: WORKSPACE,
    });
    const project = blocks.find((block) => block.startsWith('<project_memory>'));
    expect(project).toBeDefined();
    expect(project).toContain('Content truncated');
    expect(project).toContain('RECENT_HEAD');
    expect(project).not.toContain('old-');
  });

  it('drops target=project write guidance when write guidance is disabled', async () => {
    const reader = stubReader({ project: 'note' });
    const blocks = await collectMemoryBlocks(reader, SOURCES, () => 0, {
      includeAgentMemory: false,
      workspacePath: WORKSPACE,
      prompt: { includeWriteGuidance: false },
    });
    const project = blocks.find((block) => block.startsWith('<project_memory>'));
    expect(project).toBeDefined();
    expect(project).not.toContain('target=project');
  });
});
