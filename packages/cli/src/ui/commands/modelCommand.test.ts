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
  getOrCreateSharedDispatcher,
  type ContentGeneratorConfig,
  type Config,
} from '@qwen-code/qwen-code-core';

// Mock the proxy dispatcher module so tests control its return value.
vi.mock('@qwen-code/qwen-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@qwen-code/qwen-code-core')>();
  return {
    ...actual,
    getOrCreateSharedDispatcher: vi.fn().mockReturnValue(undefined),
  };
});

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

    it('should strip trailing /models case-insensitively to avoid double path', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockResponse as unknown as Response);

      await fetchModels('https://api.example.com/v1/Models', 'key');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.any(Object),
      );
    });

    it('should merge customHeaders into fetch request headers', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockResponse as unknown as Response);

      await fetchModels(
        'https://api.example.com/v1',
        'key',
        undefined,
        undefined,
        {
          'X-Custom': 'value',
        },
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json',
            'X-Custom': 'value',
            Authorization: 'Bearer key',
          }),
        }),
      );
    });

    it('should pass dispatcher from getOrCreateSharedDispatcher when proxy is set', async () => {
      const mockDispatcher = { fake: true };
      vi.mocked(getOrCreateSharedDispatcher).mockReturnValue(
        mockDispatcher as never,
      );

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockResponse as unknown as Response);

      await fetchModels(
        'https://api.example.com/v1',
        'key',
        undefined,
        'http://proxy:8080',
      );
      expect(getOrCreateSharedDispatcher).toHaveBeenCalledWith(
        'http://proxy:8080',
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.objectContaining({ dispatcher: mockDispatcher }),
      );

      vi.mocked(getOrCreateSharedDispatcher).mockReturnValue(
        undefined as never,
      );
    });

    it('should deduplicate authorization header when customHeaders has lowercase key', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockResponse as unknown as Response);

      await fetchModels(
        'https://api.example.com/v1',
        'my-key',
        undefined,
        undefined,
        {
          authorization: 'should-be-replaced',
        },
      );
      // Should only have one Authorization header with the apiKey value
      const callArgs = fetchSpy.mock.calls[0][1] as {
        headers: Record<string, string>;
      };
      const authHeaders = Object.keys(callArgs.headers).filter(
        (k) => k.toLowerCase() === 'authorization',
      );
      expect(authHeaders).toHaveLength(1);
      expect(callArgs.headers['Authorization']).toBe('Bearer my-key');
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

    it('should abort via internal timeout and call clearTimeout on completion', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Suppress the unhandled rejection that vitest reports from fake timers
      const unhandledHandler = () => {};
      process.on('unhandledRejection', unhandledHandler);

      // Mock fetch to hang on a pending promise; pass the abort signal
      // through so the internal AbortController timeout propagates correctly.
      vi.spyOn(global, 'fetch').mockImplementation((_url, opts) => {
        const signal = opts?.signal;
        let rejectFn: (reason: unknown) => void;
        const promise = new Promise<Response>((_resolve, reject) => {
          rejectFn = reject;
        });
        signal?.addEventListener('abort', () => rejectFn!(signal.reason), {
          once: true,
        });
        return promise;
      });

      const fetchPromise = fetchModels('https://api.example.com/v1', 'key');

      await vi.advanceTimersByTimeAsync(15_000);

      await expect(fetchPromise).rejects.toThrow('The operation was aborted');

      // clearTimeout must have been called in the finally block
      expect(clearTimeoutSpy).toHaveBeenCalled();

      process.removeListener('unhandledRejection', unhandledHandler);
      vi.useRealTimers();
    }, 10_000);

    it('should use custom timeout instead of the default 15s', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Mock fetch to hang on a pending promise; pass the abort signal
      // through so the internal AbortController timeout propagates correctly.
      vi.spyOn(global, 'fetch').mockImplementation((_url, opts) => {
        const signal = opts?.signal;
        let rejectFn: (reason: unknown) => void;
        const promise = new Promise<Response>((_resolve, reject) => {
          rejectFn = reject;
        });
        signal?.addEventListener('abort', () => rejectFn!(signal.reason), {
          once: true,
        });
        return promise;
      });

      // Use a 5-second custom timeout
      const fetchPromise = fetchModels(
        'https://api.example.com/v1',
        'key',
        undefined,
        undefined,
        undefined,
        5_000,
      );

      // At 4 seconds the request should NOT have timed out yet
      await vi.advanceTimersByTimeAsync(4_000);
      // The fetch promise should still be pending — verify it hasn't resolved/rejected
      let settled = false;
      fetchPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      // At 6 seconds total the custom timeout should fire
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(fetchPromise).rejects.toThrow('The operation was aborted');

      // clearTimeout must have been called in the finally block
      expect(clearTimeoutSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should call clearTimeout on successful fetch completion', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse as unknown as Response,
      );

      await fetchModels('https://api.example.com/v1', 'key');

      // clearTimeout is called in the finally block after a successful request
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should fall back to default timeout when timeout is 0', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Mock fetch to hang until aborted
      vi.spyOn(global, 'fetch').mockImplementation((_url, opts) => {
        const signal = opts?.signal;
        let rejectFn: (reason: unknown) => void;
        const promise = new Promise<Response>((_resolve, reject) => {
          rejectFn = reject;
        });
        signal?.addEventListener('abort', () => rejectFn!(signal.reason), {
          once: true,
        });
        return promise;
      });

      // timeout: 0 should fall back to the default 15s, not abort immediately
      const fetchPromise = fetchModels(
        'https://api.example.com/v1',
        'key',
        undefined,
        undefined,
        undefined,
        0,
      );

      // At 1 second it should NOT have timed out (would have with timeout: 0)
      await vi.advanceTimersByTimeAsync(1_000);
      let settled = false;
      fetchPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      // At 15 seconds the default timeout fires
      await vi.advanceTimersByTimeAsync(14_000);
      await expect(fetchPromise).rejects.toThrow('The operation was aborted');
      expect(clearTimeoutSpy).toHaveBeenCalled();

      vi.useRealTimers();
    }, 10_000);

    it('should preserve custom authorization header when apiKey is not set', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      };
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(mockResponse as unknown as Response);

      // No apiKey, but customHeaders has an authorization header
      await fetchModels(
        'https://api.example.com/v1',
        undefined,
        undefined,
        undefined,
        { Authorization: 'Bearer custom-token' },
      );

      // The custom Authorization header should be preserved
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer custom-token',
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

    it('should pass proxy, customHeaders, and timeout from config to fetchModels', async () => {
      const mockDispatcher = { fake: true };
      vi.mocked(getOrCreateSharedDispatcher).mockReturnValue(
        mockDispatcher as never,
      );

      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.USE_OPENAI,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        proxy: 'http://proxy:8080',
        customHeaders: { 'X-Custom': 'value' },
        timeout: 5_000,
      });
      mockContext.services.config = mockConfig as Config;

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      } as unknown as Response);

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'model-1',
      });

      // Verify proxy dispatcher was looked up
      expect(getOrCreateSharedDispatcher).toHaveBeenCalledWith(
        'http://proxy:8080',
      );

      // Verify fetch was called with dispatcher, custom headers, and timeout signal
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.objectContaining({
          dispatcher: mockDispatcher,
          headers: expect.objectContaining({
            'X-Custom': 'value',
            Authorization: 'Bearer test-key',
          }),
          signal: expect.any(AbortSignal),
        }),
      );

      vi.mocked(getOrCreateSharedDispatcher).mockReturnValue(
        undefined as never,
      );
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

    it('should return "timed out" on AbortError when abortSignal is not aborted (timeout)', async () => {
      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.USE_OPENAI,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
      });
      mockContext.services.config = mockConfig as Config;

      const abortError = new DOMException(
        'The operation was aborted',
        'AbortError',
      );
      vi.spyOn(global, 'fetch').mockRejectedValue(abortError);

      // abortSignal exists but is NOT aborted → timeout
      mockContext.abortSignal = new AbortController().signal;

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('timed out'),
      });
    });

    it('should return "cancelled" on AbortError when abortSignal is aborted (user cancel)', async () => {
      const mockConfig = createMockConfig({
        model: 'test-model',
        authType: AuthType.USE_OPENAI,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
      });
      mockContext.services.config = mockConfig as Config;

      const abortError = new DOMException(
        'The operation was aborted',
        'AbortError',
      );
      vi.spyOn(global, 'fetch').mockRejectedValue(abortError);

      // abortSignal exists AND is aborted → user cancel
      const controller = new AbortController();
      controller.abort();
      mockContext.abortSignal = controller.signal;

      const result = await getListAction()(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('cancelled'),
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
