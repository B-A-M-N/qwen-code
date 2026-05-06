import { describe, it, expect, beforeEach, vi } from 'vitest';
import { modelCommand } from './modelCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  AuthType,
  type ContentGeneratorConfig,
  type Config,
  type ContentGenerator,
} from '@qwen-code/qwen-code-core';

// Mock the core module so tests control its return value.
vi.mock('@qwen-code/qwen-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@qwen-code/qwen-code-core')>();
  return {
    ...actual,
    getOrCreateSharedDispatcher: vi.fn().mockReturnValue(undefined),
    isPrivateIp: vi.fn().mockReturnValue(false),
  };
});

// Helper function to create a mock config
function createMockConfig(
  contentGeneratorConfig: ContentGeneratorConfig | null,
  generator?: Partial<ContentGenerator>,
): Partial<Config> {
  return {
    getContentGeneratorConfig: vi.fn().mockReturnValue(contentGeneratorConfig),
    getContentGenerator: vi.fn().mockReturnValue(generator),
    getAvailableModels: vi.fn().mockReturnValue([]),
    getModelsConfig: vi.fn().mockReturnValue({
      hasModel: vi.fn().mockReturnValue(true),
    }),
  };
}

describe('modelCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = createMockCommandContext();
    vi.clearAllMocks();
  });

  it('should have the correct name and description', () => {
    expect(modelCommand.name).toBe('model');
    expect(modelCommand.description).toBe(
      'Switch the model for this session (--fast for suggestion model, [model-id] to switch immediately).',
    );
  });

  it('should return error when config is not available', async () => {
    mockContext.services.config = null;

    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available.',
    });
  });

  it('should return error when content generator config is not available', async () => {
    const mockConfig = createMockConfig(null);
    mockContext.services.config = mockConfig as Config;

    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Content generator configuration not available.',
    });
  });

  describe('non-interactive mode', () => {
    it('should return current model without triggering dialog when no args', async () => {
      mockContext = createMockCommandContext({
        executionMode: 'non_interactive',
        services: {
          config: {
            getContentGeneratorConfig: vi.fn().mockReturnValue({
              model: 'qwen-max',
              authType: AuthType.QWEN_OAUTH,
            }),
            getModel: vi.fn().mockReturnValue('qwen-max'),
          },
        },
      });

      const result = await modelCommand.action!(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('qwen-max'),
      });
    });
  });

  describe('list subcommand', () => {
    let mockContext: CommandContext;

    function getListAction() {
      const cmd = modelCommand.subCommands?.find((c) => c.name === 'list');
      if (!cmd) throw new Error('list subcommand not found');
      return cmd.action!;
    }

    beforeEach(() => {
      mockContext = createMockCommandContext();
      vi.restoreAllMocks();
    });

    it('should return error when config is missing', async () => {
      mockContext.services.config = null;

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available.',
      });
    });

    it('should return model list on success', async () => {
      const mockGenerator = {
        listModels: vi.fn().mockResolvedValue(['model-1', 'model-2']),
      };
      const mockConfig = createMockConfig(
        { model: 'test', authType: AuthType.USE_OPENAI },
        mockGenerator as unknown as ContentGenerator,
      );
      mockContext.services.config = mockConfig as Config;

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'model-1\nmodel-2',
      });
    });

    it('should filter models based on args', async () => {
      const mockGenerator = {
        listModels: vi
          .fn()
          .mockResolvedValue(['qwen-max', 'deepseek-chat', 'qwen-plus']),
      };
      const mockConfig = createMockConfig(
        { model: 'test', authType: AuthType.USE_OPENAI },
        mockGenerator as unknown as ContentGenerator,
      );
      mockContext.services.config = mockConfig as Config;

      const result = await getListAction()(mockContext, 'qwen');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'qwen-max\nqwen-plus',
      });
    });

    it('should handle errors from generator', async () => {
      const mockGenerator = {
        listModels: vi.fn().mockRejectedValue(new Error('API error')),
      };
      const mockConfig = createMockConfig(
        { model: 'test', authType: AuthType.USE_OPENAI },
        mockGenerator as unknown as ContentGenerator,
      );
      mockContext.services.config = mockConfig as Config;

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Failed to fetch models: API error'),
      });
    });
  });
});
