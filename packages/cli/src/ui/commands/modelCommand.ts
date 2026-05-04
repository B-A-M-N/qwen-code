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
  fetchWithTimeout,
  isPrivateIp,
  formatFetchErrorForUser,
  createDebugLogger,
} from '@qwen-code/qwen-code-core';
import { escapeAnsiCtrlCodes } from '../../ui/utils/textUtils.js';

const debugLogger = createDebugLogger('MODEL_COMMAND');
const FETCH_TIMEOUT_MS = 30_000;

export const modelCommand: SlashCommand = {
  name: 'model',
  completionPriority: 100,
  get description() {
    return t('Switch the model for this session (--fast for suggestion model)');
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
  completion: async (_context, partialArg) => {
    const completions = [];

    // Always offer --fast and list when no partial arg, or filter by match
    if (!partialArg || '--fast'.startsWith(partialArg)) {
      completions.push({
        value: '--fast',
        description: t(
          'Set a lighter model for prompt suggestions and speculative execution',
        ),
      });
    }

    if (!partialArg || 'list'.startsWith(partialArg)) {
      completions.push({
        value: 'list',
        description: t(
          'List available models from the configured API endpoint',
        ),
      });
    }

    return completions.length > 0 ? completions : null;
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
      action: async (context: CommandContext): Promise<MessageActionReturn> => {
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

        const { baseUrl, apiKey } = contentGeneratorConfig;

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
          const models = await fetchModels(baseUrl, apiKey);
          if (models.length === 0) {
            return {
              type: 'message',
              messageType: 'info',
              content: t('No models found from the configured endpoint.'),
            };
          }
          // Sanitize model IDs to prevent terminal escape sequence injection
          const output = escapeAnsiCtrlCodes(models.join('\n'));
          return {
            type: 'message',
            messageType: 'info',
            content: output,
          };
        } catch (error) {
          const errorMessage = formatFetchErrorForUser(error, {
            url: `${baseUrl.replace(/\/+$/, '')}/models`,
          });
          return {
            type: 'message',
            messageType: 'error',
            content: t('Failed to fetch models: {{error}}', {
              error: errorMessage,
            }),
          };
        }
      },
    },
  ],
};

/**
 * Fetch available models from the OpenAI-compatible /models endpoint.
 * Returns an array of model ID strings.
 * Exported for testing purposes.
 */
export async function fetchModels(
  baseUrl: string,
  apiKey?: string,
): Promise<string[]> {
  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Invalid baseUrl: must be a valid URL');
  }

  // Enforce HTTPS
  if (parsed.protocol !== 'https:') {
    throw new Error('baseUrl must use HTTPS');
  }

  // SSRF protection: block private IPs and localhost.
  // isPrivateIp() handles IPv4, IPv6 (including bracketed), and IPv4-mapped IPv6.
  // The explicit localhost check covers the hostname string 'localhost' which
  // isPrivateIp would miss (it's not an IP literal).
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') {
    throw new Error(
      'baseUrl points to a private or reserved IP address (SSRF check)',
    );
  }
  if (isPrivateIp(baseUrl)) {
    throw new Error(
      'baseUrl points to a private or reserved IP address (SSRF check)',
    );
  }

  // Normalize baseUrl to avoid double slash (e.g., "https://api.openai.com/v1/")
  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  const url = `${normalizedUrl}/models`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Sanitize URL for debug logging — strip embedded credentials
  const logSafeUrl = new URL(url);
  logSafeUrl.username = '';
  logSafeUrl.password = '';
  debugLogger.debug('Fetching models from', logSafeUrl.toString());

  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, headers, 'error');
  } catch (error) {
    debugLogger.debug('Models request failed', {
      error,
      url: logSafeUrl.toString(),
    });
    throw error;
  }

  debugLogger.debug('Models response', {
    status: response.status,
    duration: Date.now() - startTime,
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Sanitize API key from error messages to prevent leakage
    const truncated = errorText.slice(0, 500);
    const sanitized = apiKey
      ? truncated.replaceAll(apiKey, '[REDACTED]')
      : truncated;
    throw new Error(
      `Request failed (HTTP_${response.status}): ${sanitized}`,
    );
  }

  const data = (await response.json()) as {
    data?: Array<{ id?: unknown; [key: string]: unknown }>;
  };

  if (!Array.isArray(data.data)) {
    throw new Error('Unexpected response format: missing data array');
  }

  // Type-check model IDs: only accept non-empty strings
  return data.data
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
