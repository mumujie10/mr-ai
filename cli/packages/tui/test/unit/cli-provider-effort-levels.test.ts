import { describe, expect, it, vi } from 'vitest';
import type { Command } from 'commander';

import { createTuiProgram } from '../../src/cli/program.js';
import { runMcodeProviderCommand } from '../../src/cli/provider-command.js';
import type { McodeProviderCliRequest } from '../../src/cli/provider-command.js';
import type { McodeProviderApplication } from '../../src/provider/application.js';

/**
 * `--effort-levels` is the only way a BYOK channel can say which reasoning
 * levels it has. The runtime already persists and validates
 * `thinking.effortOptions` for custom providers — without this flag on the CLI
 * surface the field stays undeclared, ACP advertises no effort knob for the
 * channel, and `--effort` rejects every level.
 */

function programWith(runProvider: (request: McodeProviderCliRequest) => Promise<void>) {
  const program = createTuiProgram({
    version: '0.0.0-test',
    launchTui: async () => {},
    runExec: async () => {},
    runProvider,
  });
  return silenceOutput(rejectInsteadOfExit(program));
}

/** Commander exits the process on a bad argument; tests need the throw and the
 *  message instead of a killed worker and console noise. */
function rejectInsteadOfExit(command: Command): Command {
  command.exitOverride();
  for (const child of command.commands) rejectInsteadOfExit(child);
  return command;
}

function silenceOutput(command: Command): Command {
  command.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  for (const child of command.commands) silenceOutput(child);
  return command;
}

describe('provider add --effort-levels', () => {
  it('parses a comma list into trimmed, de-duplicated levels', async () => {
    const runProvider = vi.fn(async () => {});
    await programWith(runProvider).parseAsync([
      'node',
      'mr',
      'provider',
      'add',
      '--name',
      'Kimi',
      '--base-url',
      'https://api.example.com/v1',
      '--model',
      'kimi-k2',
      '--effort-levels',
      ' low, high,,low ',
    ]);

    expect(runProvider).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'add', effortLevels: ['low', 'high'] }),
    );
  });

  it('leaves the request undeclared when the flag is absent', async () => {
    const runProvider = vi.fn(async () => {});
    await programWith(runProvider).parseAsync([
      'node',
      'mr',
      'provider',
      'add',
      '--name',
      'Kimi',
      '--base-url',
      'https://api.example.com/v1',
      '--model',
      'kimi-k2',
    ]);

    expect(runProvider).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'add', effortLevels: undefined }),
    );
  });

  it('rejects an empty list instead of declaring zero levels', async () => {
    const runProvider = vi.fn(async () => {});
    await expect(
      programWith(runProvider).parseAsync([
        'node',
        'mr',
        'provider',
        'add',
        '--name',
        'Kimi',
        '--base-url',
        'https://api.example.com/v1',
        '--model',
        'kimi-k2',
        '--effort-levels',
        ' , ',
      ]),
    ).rejects.toThrow(/comma-separated list/);
    expect(runProvider).not.toHaveBeenCalled();
  });
});

function providerRequest(
  overrides: Partial<Extract<McodeProviderCliRequest, { action: 'add' }>> = {},
): McodeProviderCliRequest {
  return {
    action: 'add',
    name: 'Kimi',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'openai-completions',
    models: ['kimi-k2', 'kimi-k2-long'],
    effortLevels: ['low', 'high'],
    ...overrides,
  };
}

async function runAdd(request: McodeProviderCliRequest) {
  const create = vi.fn(async () => undefined);
  const saveCandidate = vi.fn(async () => ({
    success: true,
    status: { lastErrorMessage: null, state: 'ok' },
  }));
  const application = { create, saveCandidate } as unknown as McodeProviderApplication;
  const output = await runMcodeProviderCommand({
    version: '0.0.0-test',
    request,
    environment: { MCODE_PROVIDER_API_KEY: 'never-printed' },
    createContext: async () => ({ application, shutdown: async () => {} }),
  });
  return { create, saveCandidate, output };
}

describe('provider add writes the levels onto every model', () => {
  it('declares effortOptions on create', async () => {
    const { create, output } = await runAdd(providerRequest());

    expect(output).toBe('Provider added: Kimi');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [
          expect.objectContaining({ modelId: 'kimi-k2', effortOptions: ['low', 'high'] }),
          expect.objectContaining({ modelId: 'kimi-k2-long', effortOptions: ['low', 'high'] }),
        ],
      }),
    );
  });

  it('declares effortOptions on the save-and-use path too', async () => {
    const { saveCandidate } = await runAdd(providerRequest({ saveAndUse: true }));

    expect(saveCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'kimi-k2',
        saveAndUse: true,
        models: [
          expect.objectContaining({ modelId: 'kimi-k2', effortOptions: ['low', 'high'] }),
          expect.objectContaining({ modelId: 'kimi-k2-long', effortOptions: ['low', 'high'] }),
        ],
      }),
    );
  });

  it('omits the field entirely when no levels were given', async () => {
    const { create } = await runAdd(providerRequest({ effortLevels: undefined }));

    const [input] = create.mock.calls[0] as [
      { models: { modelId: string; effortOptions?: string[] }[] },
    ];
    expect(input.models.map((model) => 'effortOptions' in model)).toEqual([false, false]);
  });
});
