/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderModelConfig as ModelConfig } from '@qwen-code/qwen-code-core';

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Anthropic · Claude 3.5 Sonnet',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Anthropic · Claude 3.5 Haiku',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Anthropic · Claude 3 Opus',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
  },
];

interface AnthropicModelApiRecord {
  id?: string;
  type?: string;
  display_name?: string;
  created_at?: string;
}

/**
 * Fetch models from Anthropic API.
 * Uses x-api-key and anthropic-version headers as documented.
 */
export async function fetchAnthropicModels(
  apiKey: string,
  baseUrl?: string,
): Promise<ModelConfig[]> {
  const url = baseUrl
    ? `${baseUrl.replace(/\/+$/, '')}/v1/models`
    : ANTHROPIC_MODELS_URL;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Anthropic models request failed (${response.status}): ${errorText}`,
    );
  }

  const data = (await response.json()) as {
    data?: AnthropicModelApiRecord[];
  };

  const records = Array.isArray(data.data) ? data.data : [];

  const models: ModelConfig[] = records
    .filter((record) => record.id && record.type === 'model')
    .map((record) => ({
      id: record.id!,
      name: record.display_name
        ? `Anthropic · ${record.display_name}`
        : `Anthropic · ${record.id!}`,
      baseUrl: baseUrl || 'https://api.anthropic.com/v1',
      envKey: 'ANTHROPIC_API_KEY',
    }));

  if (models.length === 0) {
    throw new Error('Anthropic models request returned no usable models.');
  }

  return models;
}

/**
 * Fetch Anthropic models with fallback to defaults on error.
 */
export async function getAnthropicModelsWithFallback(
  apiKey: string,
  baseUrl?: string,
): Promise<ModelConfig[]> {
  try {
    return await fetchAnthropicModels(apiKey, baseUrl);
  } catch {
    return ANTHROPIC_DEFAULT_MODELS;
  }
}

export { ANTHROPIC_DEFAULT_MODELS };
