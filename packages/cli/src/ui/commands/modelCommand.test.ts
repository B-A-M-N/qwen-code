/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { modelCommand, fetchModels } from './modelCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  AuthType,
  type ContentGeneratorConfig,
  type Config,
} from '@qwen-code/qwen-code-core';

// Helper function to create a mock config
function createMockConfig(
  contentGeneratorConfig: ContentGeneratorConfig | null,
): Partial<Config> {
  return {
    getContentGeneratorConfig: vi.fn().mockReturnValue(contentGeneratorConfig),
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
      'Switch the model for this session (--fast for suggestion model)',
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

  it('should return error when auth type is not available', async () => {
    const mockConfig = createMockConfig({
      model: 'test-model',
      authType: undefined,
    });
    mockContext.services.config = mockConfig as Config;

    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Authentication type not available.',
    });
  });

  it('should return dialog action for QWEN_OAUTH auth type', async () => {
    const mockConfig = createMockConfig({
      model: 'test-model',
      authType: AuthType.QWEN_OAUTH,
    });
    mockContext.services.config = mockConfig as Config;

    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'dialog',
      dialog: 'model',
    });
  });

  it('should return dialog action for USE_OPENAI auth type', async () => {
    const mockConfig = createMockConfig({
      model: 'test-model',
      authType: AuthType.USE_OPENAI,
    });
    mockContext.services.config = mockConfig as Config;

    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'dialog',
      dialog: 'model',
    });
  });

  it('should return dialog action for unsupported auth types', async () => {
    const mockConfig = createMockConfig({
      model: 'test-model',
      authType: 'UNSUPPORTED_AUTH_TYPE' as AuthType,
    });
    mockContext.services.config = mockConfig as Config;

    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'dialog',
      dialog: 'model',
    });
  });

  it('should handle undefined auth type', async () => {
    const mockConfig = createMockConfig({
      model: 'test-model',
      authType: undefined,
    });
    mockContext.services.config = mockConfig as Config;

    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Authentication type not available.',
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
      expect((result as { type: string }).type).toBe('message');
    });

    it('should return current fast model without triggering dialog for --fast no args', async () => {
      mockContext = createMockCommandContext({
        executionMode: 'non_interactive',
        invocation: { args: '--fast' },
        services: {
          config: {
            getContentGeneratorConfig: vi.fn().mockReturnValue({
              model: 'qwen-max',
              authType: AuthType.QWEN_OAUTH,
            }),
            getModel: vi.fn().mockReturnValue('qwen-max'),
          },
          settings: {
            merged: { fastModel: 'qwen-turbo' } as Record<string, unknown>,
          },
        },
      });

      const result = await modelCommand.action!(mockContext, '--fast');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('qwen-turbo'),
      });
    });
  });

  describe('fetchModels', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should parse standard OpenAI response with data array', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'qwen-plus' }, { id: 'qwen-max' }],
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await fetchModels('https://api.openai.com/v1', 'key');
      expect(result).toEqual(['qwen-plus', 'qwen-max']);
    });

    it('should parse response with object field (DeepSeek style)', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          object: 'list',
          data: [
            { id: 'deepseek-chat', owned_by: 'deepseek' },
            { id: 'deepseek-coder', owned_by: 'deepseek' },
          ],
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await fetchModels('https://api.deepseek.com', 'key');
      expect(result).toEqual(['deepseek-chat', 'deepseek-coder']);
    });

    it('should parse bare array response (some providers)', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue([{ id: 'model-1' }, { id: 'model-2' }]),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await fetchModels('https://api.example.com/v1', 'key');
      expect(result).toEqual(['model-1', 'model-2']);
    });

    it('should ignore extra fields (owned_by, created, permission)', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'model-1',
              owned_by: 'org',
              created: 1234567890,
              permission: [],
            },
            { id: 'model-2', owned_by: 'org', created: 1234567891 },
          ],
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await fetchModels('https://api.example.com/v1', 'key');
      expect(result).toEqual(['model-1', 'model-2']);
    });

    it('should skip entries with missing id field', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }, { owned_by: 'org' }, { id: 'model-2' }],
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await fetchModels('https://api.example.com/v1', 'key');
      expect(result).toEqual(['model-1', 'model-2']);
    });

    it('should skip entries with empty id', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }, { id: '' }, { id: 'model-2' }],
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await fetchModels('https://api.example.com/v1', 'key');
      expect(result).toEqual(['model-1', 'model-2']);
    });

    it('should skip entries with whitespace-only id', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }, { id: '   ' }, { id: 'model-2' }],
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await fetchModels('https://api.example.com/v1', 'key');
      expect(result).toEqual(['model-1', 'model-2']);
    });

    it('should throw on non-ok HTTP response', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      await expect(
        fetchModels('https://api.example.com/v1', 'key'),
      ).rejects.toThrow('Request failed (401): Unauthorized');
    });

    it('should throw on missing data array in object response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          object: 'list',
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      await expect(
        fetchModels('https://api.example.com/v1', 'key'),
      ).rejects.toThrow('Unexpected response format: missing data array');
    });

    it('should throw on non-object, non-array response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue('just a string'),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      await expect(
        fetchModels('https://api.example.com/v1', 'key'),
      ).rejects.toThrow(
        'Unexpected response format: response is not an object or array',
      );
    });

    it('should normalize baseUrl with trailing slash', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockResponse as unknown as Response);

      await fetchModels('https://api.example.com/v1/', 'key');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.any(Object),
      );
    });

    it('should return empty array when data array is empty', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [],
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await fetchModels('https://api.example.com/v1', 'key');
      expect(result).toEqual([]);
    });

    it('should include Authorization header when apiKey is provided', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockResponse as unknown as Response);

      await fetchModels('https://api.example.com/v1', 'my-key');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-key',
          }),
        }),
      );
    });

    it('should not include Authorization header when apiKey is not provided', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockResponse as unknown as Response);

      await fetchModels('https://api.example.com/v1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.anything(),
          }),
        }),
      );
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

    it('should return error when contentGeneratorConfig is missing', async () => {
      const mockConfig = createMockConfig(null);
      mockContext.services.config = mockConfig as Config;

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Content generator configuration not available.',
      });
    });

    it('should return error when baseUrl is not configured', async () => {
      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.USE_OPENAI,
        baseUrl: undefined,
      });
      mockContext.services.config = mockConfig as Config;

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'No baseUrl configured. Please configure modelProviders or set the API endpoint.',
      });
    });

    it('should return model list on success', async () => {
      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.USE_OPENAI,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
      });
      mockContext.services.config = mockConfig as Config;

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }, { id: 'model-2' }],
        }),
      } as unknown as Response);

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'model-1\nmodel-2',
      });
    });

    it('should handle Error instance throw from fetchModels', async () => {
      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.USE_OPENAI,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
      });
      mockContext.services.config = mockConfig as Config;

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Failed to fetch models:'),
      });
    });

    it('should handle non-Error throw from fetchModels', async () => {
      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.USE_OPENAI,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
      });
      mockContext.services.config = mockConfig as Config;

      vi.spyOn(global, 'fetch').mockRejectedValue('string error');

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Failed to fetch models:'),
      });
    });

    it('should return error for QWEN_OAUTH auth type', async () => {
      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.QWEN_OAUTH,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
      });
      mockContext.services.config = mockConfig as Config;

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('not supported for auth type'),
      });
    });

    it('should return "no models found" when endpoint returns empty array', async () => {
      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.USE_OPENAI,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
      });
      mockContext.services.config = mockConfig as Config;

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      } as unknown as Response);

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('No models found'),
      });
    });
  });

  describe('fetchModels error handling', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should handle response.text() throwing in error path', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockRejectedValue(new Error('body stream locked')),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      await expect(
        fetchModels('https://api.example.com/v1', 'key'),
      ).rejects.toThrow(
        'Request failed (500): (unable to read error response)',
      );
    });

    it('should throw on non-JSON 200 response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      await expect(
        fetchModels('https://api.example.com/v1', 'key'),
      ).rejects.toThrow('Invalid JSON response from /models endpoint');
    });
  });
});
