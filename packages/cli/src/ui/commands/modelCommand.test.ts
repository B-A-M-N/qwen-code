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

  describe('completion', () => {
    it('should return --fast and list completions when no partial', async () => {
      const result = await modelCommand.completion!(mockContext, '');
      expect(result).toEqual([
        expect.objectContaining({ value: '--fast' }),
        expect.objectContaining({ value: 'list' }),
      ]);
    });

    it('should filter by partial match for --fast', async () => {
      const result = await modelCommand.completion!(mockContext, '--f');
      expect(result).toEqual([expect.objectContaining({ value: '--fast' })]);
    });

    it('should filter by partial match for list', async () => {
      const result = await modelCommand.completion!(mockContext, 'l');
      expect(result).toEqual([expect.objectContaining({ value: 'list' })]);
    });

    it('should return null when no match', async () => {
      const result = await modelCommand.completion!(mockContext, 'xyz');
      expect(result).toBeNull();
    });
  });
});

describe('fetchModels', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return model IDs on success', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'model-1' }, { id: 'model-2' }, { id: 'model-3' }],
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const models = await fetchModels('https://api.example.com/v1/');

    expect(models).toEqual(['model-1', 'model-2', 'model-3']);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.any(Object),
    );
  });

  it('should include Authorization header when apiKey is provided', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'model-1' }],
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await fetchModels('https://api.example.com/v1/', 'my-api-key');

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(lastCall[1]?.headers?.Authorization).toBe('Bearer my-api-key');
  });

  it('should throw on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(fetchModels('https://api.example.com/v1/')).rejects.toThrow(
      'Network error',
    );
  });

  it('should throw on non-2xx response', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await expect(fetchModels('https://api.example.com/v1/')).rejects.toThrow(
      'Request failed (401)',
    );
  });

  it('should sanitize apiKey in error messages', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Error with secret-key-12345'),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await expect(
      fetchModels('https://api.example.com/v1/', 'secret-key-12345'),
    ).rejects.toThrow('[REDACTED]');
  });

  it('should handle empty data array', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const models = await fetchModels('https://api.example.com/v1/');
    expect(models).toEqual([]);
  });

  it('should filter out non-string and empty model IDs', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          { id: 'valid-model' },
          { id: 123 },
          { id: '' },
          { id: null },
          { id: 'another-valid' },
        ],
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const models = await fetchModels('https://api.example.com/v1/');
    expect(models).toEqual(['valid-model', 'another-valid']);
  });

  it('should throw on missing data array in response', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await expect(fetchModels('https://api.example.com/v1/')).rejects.toThrow(
      'Unexpected response format: missing data array',
    );
  });

  it('should normalize baseUrl by removing trailing slashes', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'model-1' }],
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await fetchModels('https://api.example.com/v1/');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.any(Object),
    );
  });

  it('should throw on invalid URL', async () => {
    await expect(fetchModels('not-a-valid-url')).rejects.toThrow(
      'Invalid baseUrl',
    );
  });

  it('should throw on non-HTTPS URL', async () => {
    await expect(fetchModels('http://api.example.com/v1/')).rejects.toThrow(
      'baseUrl must use HTTPS',
    );
  });

  it('should throw on private IP address (SSRF check)', async () => {
    await expect(fetchModels('https://192.168.1.1/api/')).rejects.toThrow(
      'private IP',
    );
  });

  it('should throw on localhost (SSRF check)', async () => {
    await expect(fetchModels('https://localhost:8080/api/')).rejects.toThrow(
      'SSRF check',
    );
  });
});

describe('/model list subcommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = createMockCommandContext({
      executionMode: 'non_interactive',
    });
    vi.clearAllMocks();
  });

  it('should return error when config is not available', async () => {
    mockContext.services.config = null;

    const result = await modelCommand.subCommands![0].action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available.',
    });
  });

  it('should return error when content generator config is not available', async () => {
    const mockConfig = createMockConfig(null);
    mockContext.services.config = mockConfig as Config;

    const result = await modelCommand.subCommands![0].action!(mockContext, '');

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

    const result = await modelCommand.subCommands![0].action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('No baseUrl configured'),
    });
  });

  it('should return "no models found" when fetchModels returns empty', async () => {
    const mockConfig = createMockConfig({
      model: 'test-model',
      authType: AuthType.USE_OPENAI,
      baseUrl: 'https://api.example.com/v1/',
    });
    mockContext.services.config = mockConfig as Config;

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await modelCommand.subCommands![0].action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'No models found from the configured endpoint.',
    });
  });
});
