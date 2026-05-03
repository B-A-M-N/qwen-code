/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { t } from '../../i18n/index.js';
import { getPersistScopeForModelSelection } from '../../config/modelProvidersScope.js';
import {
  AuthType,
  getOrCreateSharedDispatcher,
} from '@qwen-code/qwen-code-core';

export const modelCommand: SlashCommand = {
  name: 'model',
  completionPriority: 100,
  get description() {
    return t('Switch the model for this session (--fast for suggestion model)');
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
  completion: async (_context, partialArg) => {
    if (partialArg && '--fast'.startsWith(partialArg)) {
      return [
        {
          value: '--fast',
          description: t(
            'Set a lighter model for prompt suggestions and speculative execution',
          ),
        },
      ];
    }
    return null;
  },
  action: async (
    context: CommandContext,
  ): Promise<OpenDialogActionReturn | MessageActionReturn> => {
    const { services } = context;
    const { config, settings } = services;

    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: t('Configuration not available.'),
      };
    }

    // Handle --fast flag: /model --fast <modelName>
    const args = context.invocation?.args?.trim() ?? '';
    if (args.startsWith('--fast')) {
      const modelName = args.replace('--fast', '').trim();
      if (!modelName) {
        // Open model dialog in fast-model mode (interactive) or return current fast model (non-interactive)
        if (context.executionMode !== 'interactive') {
          const fastModel =
            context.services.settings?.merged?.fastModel ?? 'not set';
          return {
            type: 'message',
            messageType: 'info',
            content: `Current fast model: ${fastModel}\nUse "/model --fast <model-id>" to set fast model.`,
          };
        }
        return {
          type: 'dialog',
          dialog: 'fast-model',
        };
      }
      // Set fast model
      if (!settings) {
        return {
          type: 'message',
          messageType: 'error',
          content: t('Settings service not available.'),
        };
      }
      settings.setValue(
        getPersistScopeForModelSelection(settings),
        'fastModel',
        modelName,
      );
      // Sync the runtime Config so forked agents pick up the change immediately
      // without requiring a restart.
      config.setFastModel(modelName);
      return {
        type: 'message',
        messageType: 'info',
        content: t('Fast Model') + ': ' + modelName,
      };
    }

    const contentGeneratorConfig = config.getContentGeneratorConfig();
    if (!contentGeneratorConfig) {
      return {
        type: 'message',
        messageType: 'error',
        content: t('Content generator configuration not available.'),
      };
    }

    const authType = contentGeneratorConfig.authType;
    if (!authType) {
      return {
        type: 'message',
        messageType: 'error',
        content: t('Authentication type not available.'),
      };
    }

    // Non-interactive/ACP: set model if an arg was provided, otherwise show current model
    if (context.executionMode !== 'interactive') {
      const modelName = args.trim();
      if (modelName) {
        // /model <model-id> — set the main model
        if (!settings) {
          return {
            type: 'message',
            messageType: 'error',
            content: t('Settings service not available.'),
          };
        }
        settings.setValue(
          getPersistScopeForModelSelection(settings),
          'model.name',
          modelName,
        );
        await config.setModel(modelName);
        return {
          type: 'message',
          messageType: 'info',
          content: t('Model') + ': ' + modelName,
        };
      }
      // /model with no args — show current model
      const currentModel = config.getModel() ?? 'unknown';
      return {
        type: 'message',
        messageType: 'info',
        content: `Current model: ${currentModel}\nUse "/model <model-id>" to switch models or "/model --fast <model-id>" to set the fast model.`,
      };
    }

    return {
      type: 'dialog',
      dialog: 'model',
    };
  },
  subCommands: [
    {
      name: 'list',
      get description() {
        return t('List available models from the configured API endpoint');
      },
      kind: CommandKind.BUILT_IN,
      supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
      action: async (
        context: CommandContext,
        _args: string,
      ): Promise<MessageActionReturn> => {
        const { services } = context;
        const { config } = services;

        if (!config) {
          return {
            type: 'message',
            messageType: 'error',
            content: t('Configuration not available.'),
          };
        }

        const contentGeneratorConfig = config.getContentGeneratorConfig();
        if (!contentGeneratorConfig) {
          return {
            type: 'message',
            messageType: 'error',
            content: t('Content generator configuration not available.'),
          };
        }

        const { baseUrl, apiKey, authType, proxy, customHeaders, timeout } =
          contentGeneratorConfig;

        if (!authType || authType !== AuthType.USE_OPENAI) {
          return {
            type: 'message',
            messageType: 'error',
            content: t(
              'Model listing is not supported for auth type: {{authType}}. Only OpenAI-compatible endpoints are supported.',
              { authType: authType ?? 'none' },
            ),
          };
        }

        if (!baseUrl) {
          return {
            type: 'message',
            messageType: 'error',
            content: t(
              'No baseUrl configured. Please configure modelProviders or set the API endpoint.',
            ),
          };
        }

        try {
          const models = await fetchModels(
            baseUrl,
            apiKey,
            context.abortSignal,
            proxy,
            customHeaders,
            timeout,
          );

          if (models.length === 0) {
            return {
              type: 'message',
              messageType: 'info',
              content: t('No models found from the configured endpoint.'),
            };
          }

          return {
            type: 'message',
            messageType: 'info',
            content: models.join('\n'),
          };
        } catch (error) {
          let errorMessage: string;
          if (error instanceof DOMException && error.name === 'AbortError') {
            const isTimeout = !context.abortSignal?.aborted;
            errorMessage = isTimeout
              ? t('Request timed out. The endpoint may be slow or unreachable.')
              : t('Request cancelled.');
          } else {
            errorMessage =
              error instanceof Error ? error.message : String(error);
          }
          return {
            type: 'message',
            messageType: 'error',
            content: `${t('Failed to fetch models:')} ${errorMessage}`,
          };
        }
      },
    },
  ],
};

/**
 * Fetch available models from the OpenAI-compatible /models endpoint.
 * Handles multiple response shapes:
 *   - Standard: { data: [{ id: "qwen-plus" }] }
 *   - With object field: { object: "list", data: [{ id: "deepseek-chat", ... }] }
 *   - Bare array: [{ id: "model" }] (some providers)
 * Extra fields (owned_by, created, etc.) are ignored.
 * Export for testing.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchModels(
  baseUrl: string,
  apiKey?: string,
  abortSignal?: AbortSignal,
  proxy?: string,
  customHeaders?: Record<string, string>,
  timeout?: number,
): Promise<string[]> {
  // Normalize baseUrl: strip trailing slashes and trailing /models (case-insensitive) to avoid
  // double path (e.g., "https://api.example.com/v1/models" → "/models/models")
  const normalizedUrl = baseUrl.replace(/\/+$/, '').replace(/\/models$/i, '');
  const url = `${normalizedUrl}/models`;

  // Build headers with customHeaders support (mirrors provider pattern)
  const defaultHeaders: Record<string, string> = {
    Accept: 'application/json',
  };
  const headers = customHeaders
    ? { ...defaultHeaders, ...customHeaders }
    : { ...defaultHeaders };

  // Deduplicate any existing authorization header (case-insensitive) before
  // setting the Bearer token to avoid sending two Authorization headers when
  // customHeaders contains a lowercase 'authorization' key.
  const existingAuthKey = Object.keys(headers).find(
    (k) => k.toLowerCase() === 'authorization',
  );
  if (existingAuthKey) {
    delete headers[existingAuthKey];
  }

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Set up timeout and optional user abort signal
  const fetchTimeout = timeout ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), fetchTimeout);

  const signal = abortSignal
    ? AbortSignal.any([timeoutController.signal, abortSignal])
    : timeoutController.signal;

  // Build proxy-aware fetch options (mirrors provider pattern)
  const runtimeOptions = getOrCreateSharedDispatcher(proxy);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal,
      ...(runtimeOptions ? { dispatcher: runtimeOptions } : {}),
    });
    if (!response.ok) {
      let errorText: string;
      try {
        errorText = (await response.text()).slice(0, 500);
      } catch {
        errorText = '(unable to read error response)';
      }
      throw new Error(`Request failed (${response.status}): ${errorText}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(
        'Invalid JSON response from /models endpoint. Check that the baseUrl points to a valid OpenAI-compatible API.',
      );
    }

    // Extract the models array from various response shapes.
    // 1. Standard OpenAI: { data: [{ id: "..." }] }
    // 2. With object field: { object: "list", data: [{ id: "...", owned_by: "...", ... }] }
    // 3. Bare array: [{ id: "..." }] (some providers skip the wrapper)
    let modelArray: unknown[];

    if (Array.isArray(body)) {
      // Shape 3: bare array
      modelArray = body;
    } else if (body && typeof body === 'object') {
      // Shapes 1 & 2: look for data property using bracket notation
      const obj = body as Record<string, unknown>;
      if (Array.isArray(obj['data'])) {
        modelArray = obj['data'] as unknown[];
      } else {
        throw new Error('Unexpected response format: missing data array');
      }
    } else {
      throw new Error(
        'Unexpected response format: response is not an object or array',
      );
    }

    // Extract model IDs.
    // The only required field is `id` (string, non-empty).
    // All other fields (owned_by, created, object, permission, etc.) are ignored.
    const modelIds: string[] = [];

    for (const item of modelArray) {
      if (item && typeof item === 'object') {
        const model = item as Record<string, unknown>;
        const id = model['id'];
        if (typeof id === 'string' && id.trim().length > 0) {
          modelIds.push(id.trim());
        }
      }
    }

    return modelIds;
  } finally {
    clearTimeout(timeoutId);
  }
}
