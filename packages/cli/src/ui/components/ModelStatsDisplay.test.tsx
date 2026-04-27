/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ModelStatsDisplay } from './ModelStatsDisplay.js';
import * as SessionContext from '../contexts/SessionContext.js';
import type {
  ModelMetrics,
  ModelMetricsCore,
  SessionMetrics,
} from '../contexts/SessionContext.js';
import { MAIN_SOURCE } from '@qwen-code/qwen-code-core';
import { SettingsContext } from '../contexts/SettingsContext.js';
import type { LoadedSettings } from '../../config/settings.js';

const mainOnly = (core: ModelMetricsCore): ModelMetrics => ({
  ...core,
  bySource: { [MAIN_SOURCE]: core },
});

// Mock the context to provide controlled data for testing
vi.mock('../contexts/SessionContext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionContext>();
  return {
    ...actual,
    useSessionStats: vi.fn(),
  };
});

const useSessionStatsMock = vi.mocked(SessionContext.useSessionStats);

const renderWithMockedStats = (
  metrics: SessionMetrics,
  modelPricing?: Record<
    string,
    { inputPerMillionTokens?: number; outputPerMillionTokens?: number }
  >,
) => {
  useSessionStatsMock.mockReturnValue({
    stats: {
      sessionStartTime: new Date(),
      metrics,
      lastPromptTokenCount: 0,
      promptCount: 5,
    },

    getPromptCount: () => 5,
    startNewPrompt: vi.fn(),
  });

  const mockSettings = {
    merged: { modelPricing },
  } as unknown as LoadedSettings;

  return render(
    <SettingsContext.Provider value={mockSettings}>
      <ModelStatsDisplay />
    </SettingsContext.Provider>,
  );
};

describe('<ModelStatsDisplay />', () => {
  beforeAll(() => {
    vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
      this: number,
    ) {
      // Use a stable 'en-US' format for test consistency.
      return new Intl.NumberFormat('en-US').format(this);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should render "no API calls" message when there are no active models', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {},
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
    });

    expect(lastFrame()).toContain(
      'No API calls have been made in this session.',
    );
    expect(lastFrame()).toMatchSnapshot();
  });

  it('should not display conditional rows if no model has data for them', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {
        'gemini-2.5-pro': mainOnly({
          api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
          tokens: {
            prompt: 10,
            candidates: 20,
            total: 30,
            cached: 0,
            thoughts: 0,
            tool: 0,
          },
        }),
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
    });

    const output = lastFrame();
    expect(output).not.toContain('Cached');
    expect(output).not.toContain('Thoughts');
    expect(output).not.toContain('Tool');
    expect(output).toMatchSnapshot();
  });

  it('should display conditional rows if at least one model has data', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {
        'gemini-2.5-pro': mainOnly({
          api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
          tokens: {
            prompt: 10,
            candidates: 20,
            total: 30,
            cached: 5,
            thoughts: 2,
            tool: 0,
          },
        }),
        'gemini-2.5-flash': mainOnly({
          api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 50 },
          tokens: {
            prompt: 5,
            candidates: 10,
            total: 15,
            cached: 0,
            thoughts: 0,
            tool: 3,
          },
        }),
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
    });

    const output = lastFrame();
    expect(output).toContain('Cached');
    expect(output).toContain('Thoughts');
    expect(output).toContain('Tool');
    expect(output).toMatchSnapshot();
  });

  it('should display stats for multiple models correctly', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {
        'gemini-2.5-pro': mainOnly({
          api: { totalRequests: 10, totalErrors: 1, totalLatencyMs: 1000 },
          tokens: {
            prompt: 100,
            candidates: 200,
            total: 300,
            cached: 50,
            thoughts: 10,
            tool: 5,
          },
        }),
        'gemini-2.5-flash': mainOnly({
          api: { totalRequests: 20, totalErrors: 2, totalLatencyMs: 500 },
          tokens: {
            prompt: 200,
            candidates: 400,
            total: 600,
            cached: 100,
            thoughts: 20,
            tool: 10,
          },
        }),
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
    });

    const output = lastFrame();
    expect(output).toContain('gemini-2.5-pro');
    expect(output).toContain('gemini-2.5-flash');
    expect(output).toMatchSnapshot();
  });

  it('should handle large values without wrapping or overlapping', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {
        'gemini-2.5-pro': mainOnly({
          api: {
            totalRequests: 999999999,
            totalErrors: 123456789,
            totalLatencyMs: 9876,
          },
          tokens: {
            prompt: 987654321,
            candidates: 123456789,
            total: 999999999,
            cached: 123456789,
            thoughts: 111111111,
            tool: 222222222,
          },
        }),
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
    });

    expect(lastFrame()).toMatchSnapshot();
  });

  it('should display a single model correctly', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {
        'gemini-2.5-pro': mainOnly({
          api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
          tokens: {
            prompt: 10,
            candidates: 20,
            total: 30,
            cached: 5,
            thoughts: 2,
            tool: 1,
          },
        }),
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
    });

    const output = lastFrame();
    expect(output).toContain('gemini-2.5-pro');
    expect(output).not.toContain('gemini-2.5-flash');
    expect(output).toMatchSnapshot();
  });

  describe('Subagent source attribution', () => {
    const baseTools: SessionMetrics['tools'] = {
      totalCalls: 0,
      totalSuccess: 0,
      totalFail: 0,
      totalDurationMs: 0,
      totalDecisions: { accept: 0, reject: 0, modify: 0 },
      byName: {},
    };
    const baseFiles: SessionMetrics['files'] = {
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    };
    const makeCore = (reqs: number): ModelMetricsCore => ({
      api: { totalRequests: reqs, totalErrors: 0, totalLatencyMs: 100 },
      tokens: {
        prompt: 10,
        candidates: 20,
        total: 30,
        cached: 0,
        thoughts: 0,
        tool: 0,
      },
    });

    it('collapses the column header when only main is a source', () => {
      const { lastFrame } = renderWithMockedStats({
        models: { 'glm-5': mainOnly(makeCore(1)) },
        tools: baseTools,
        files: baseFiles,
      });
      const output = lastFrame();
      expect(output).toContain('glm-5');
      expect(output).not.toContain('glm-5 (main)');
    });

    it('renders distinct columns for main and subagent when same model has multiple sources', () => {
      const mainCore = makeCore(1);
      const echoerCore = makeCore(1);
      const { lastFrame } = renderWithMockedStats({
        models: {
          'glm-5': {
            api: { totalRequests: 2, totalErrors: 0, totalLatencyMs: 200 },
            tokens: {
              prompt: 20,
              candidates: 40,
              total: 60,
              cached: 0,
              thoughts: 0,
              tool: 0,
            },
            bySource: {
              [MAIN_SOURCE]: mainCore,
              echoer: echoerCore,
            },
          },
        },
        tools: baseTools,
        files: baseFiles,
      });
      const output = lastFrame();
      expect(output).toContain('glm-5 (main)');
      expect(output).toContain('glm-5 (echoer)');
    });
  });

  describe('Cost estimation', () => {
    it('does not display cost section when modelPricing is not configured', () => {
      const { lastFrame } = renderWithMockedStats(
        {
          models: {
            'gemini-2.5-pro': mainOnly({
              api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
              tokens: {
                prompt: 10_000,
                candidates: 5_000,
                total: 15_005,
                cached: 0,
                thoughts: 5,
                tool: 0,
              },
            }),
          },
          tools: {
            totalCalls: 0,
            totalSuccess: 0,
            totalFail: 0,
            totalDurationMs: 0,
            totalDecisions: { accept: 0, reject: 0, modify: 0 },
            byName: {},
          },
          files: {
            totalLinesAdded: 0,
            totalLinesRemoved: 0,
          },
        },
        undefined, // No pricing configured
      );

      const output = lastFrame();
      expect(output).not.toContain('Cost');
      expect(output).not.toContain('Estimated');
    });

    it('does not display cost section when modelPricing is empty', () => {
      const { lastFrame } = renderWithMockedStats(
        {
          models: {
            'gemini-2.5-pro': mainOnly({
              api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
              tokens: {
                prompt: 10_000,
                candidates: 5_000,
                total: 15_005,
                cached: 0,
                thoughts: 5,
                tool: 0,
              },
            }),
          },
          tools: {
            totalCalls: 0,
            totalSuccess: 0,
            totalFail: 0,
            totalDurationMs: 0,
            totalDecisions: { accept: 0, reject: 0, modify: 0 },
            byName: {},
          },
          files: {
            totalLinesAdded: 0,
            totalLinesRemoved: 0,
          },
        },
        {}, // Empty pricing
      );

      const output = lastFrame();
      expect(output).not.toContain('Cost');
      expect(output).not.toContain('Estimated');
    });

    it('displays cost section when modelPricing is configured for the model', () => {
      const { lastFrame } = renderWithMockedStats(
        {
          models: {
            'gemini-2.5-pro': mainOnly({
              api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
              tokens: {
                prompt: 1_000_000,
                candidates: 500_000,
                total: 1_500_000,
                cached: 0,
                thoughts: 300_000,
                tool: 0,
              },
            }),
          },
          tools: {
            totalCalls: 0,
            totalSuccess: 0,
            totalFail: 0,
            totalDurationMs: 0,
            totalDecisions: { accept: 0, reject: 0, modify: 0 },
            byName: {},
          },
          files: {
            totalLinesAdded: 0,
            totalLinesRemoved: 0,
          },
        },
        {
          'gemini-2.5-pro': {
            inputPerMillionTokens: 0.3,
            outputPerMillionTokens: 1.2,
          },
        },
      );

      const output = lastFrame();
      expect(output).toContain('Cost');
      expect(output).toContain('Estimated');
      // 1M input * $0.30/M = $0.30
      // 800K output (500K candidates + 300K thoughts) * $1.20/M = $0.96
      // Total = $1.26
      expect(output).toContain('$1.2600');
    });

    it('includes thoughts tokens in cost calculation', () => {
      const { lastFrame } = renderWithMockedStats(
        {
          models: {
            'gemini-2.5-pro': mainOnly({
              api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
              tokens: {
                prompt: 1_000_000,
                candidates: 0,
                total: 1_000_000,
                cached: 0,
                thoughts: 1_000_000,
                tool: 0,
              },
            }),
          },
          tools: {
            totalCalls: 0,
            totalSuccess: 0,
            totalFail: 0,
            totalDurationMs: 0,
            totalDecisions: { accept: 0, reject: 0, modify: 0 },
            byName: {},
          },
          files: {
            totalLinesAdded: 0,
            totalLinesRemoved: 0,
          },
        },
        {
          'gemini-2.5-pro': {
            inputPerMillionTokens: 0.3,
            outputPerMillionTokens: 1.2,
          },
        },
      );

      const output = lastFrame();
      // 1M input * $0.30/M = $0.30
      // 1M thoughts (as output) * $1.20/M = $1.20
      // Total = $1.50
      expect(output).toContain('$1.5000');
    });

    it('shows N/A when pricing is not configured for a specific model', () => {
      const { lastFrame } = renderWithMockedStats(
        {
          models: {
            'gemini-2.5-pro': mainOnly({
              api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
              tokens: {
                prompt: 1_000_000,
                candidates: 1_000_000,
                total: 2_000_000,
                cached: 0,
                thoughts: 0,
                tool: 0,
              },
            }),
            'gemini-2.5-flash': mainOnly({
              api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 50 },
              tokens: {
                prompt: 2_000_000,
                candidates: 2_000_000,
                total: 4_000_000,
                cached: 0,
                thoughts: 0,
                tool: 0,
              },
            }),
          },
          tools: {
            totalCalls: 0,
            totalSuccess: 0,
            totalFail: 0,
            totalDurationMs: 0,
            totalDecisions: { accept: 0, reject: 0, modify: 0 },
            byName: {},
          },
          files: {
            totalLinesAdded: 0,
            totalLinesRemoved: 0,
          },
        },
        {
          'gemini-2.5-pro': {
            inputPerMillionTokens: 0.3,
            outputPerMillionTokens: 1.2,
          },
          // gemini-2.5-flash has no pricing
        },
      );

      const output = lastFrame();
      expect(output).toContain('$1.5000'); // gemini-2.5-pro cost
      expect(output).toContain('N/A'); // gemini-2.5-flash has no pricing
    });
  });
});
