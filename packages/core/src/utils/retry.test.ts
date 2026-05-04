/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest';
import type { HttpError } from './retry.js';
import {
  retryWithBackoff,
  isTransientCapacityError,
  isUnattendedMode,
  isRetryableNetworkError,
  classifyError,
} from './retry.js';
import { getErrorStatus } from './errors.js';
import { setSimulate429 } from './testUtils.js';
import { AuthType } from '../core/contentGenerator.js';

// Helper to create a mock function that fails a certain number of times
const createFailingFunction = (
  failures: number,
  successValue: string = 'success',
) => {
  let attempts = 0;
  return vi.fn(async () => {
    attempts++;
    if (attempts <= failures) {
      // Simulate a retryable error
      const error: HttpError = new Error(`Simulated error attempt ${attempts}`);
      error.status = 500; // Simulate a server error
      throw error;
    }
    return successValue;
  });
};

// Custom error for testing non-retryable conditions
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Disable 429 simulation for tests
    setSimulate429(false);
    // Suppress unhandled promise rejection warnings for tests that expect errors
    console.warn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should return the result on the first attempt if successful', async () => {
    const mockFn = createFailingFunction(0);
    const result = await retryWithBackoff(mockFn);
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry and succeed if failures are within maxAttempts', async () => {
    const mockFn = createFailingFunction(2);
    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    await vi.runAllTimersAsync(); // Ensure all delays and retries complete

    const result = await promise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should throw an error if all attempts fail', async () => {
    const mockFn = createFailingFunction(3);

    // 1. Start the retryable operation, which returns a promise.
    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    // 2. IMPORTANT: Attach the rejection expectation to the promise *immediately*.
    //    This ensures a 'catch' handler is present before the promise can reject.
    //    The result is a new promise that resolves when the assertion is met.

    const assertionPromise = await expect(promise).rejects.toThrow(
      'Simulated error attempt 3',
    );

    // 3. Now, advance the timers. This will trigger the retries and the
    //    eventual rejection. The handler attached in step 2 will catch it.
    await vi.runAllTimersAsync();

    // 4. Await the assertion promise itself to ensure the test was successful.
    await assertionPromise;

    // 5. Finally, assert the number of calls.
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should default to 7 maxAttempts if no options are provided', async () => {
    // This function will fail more than 7 times to ensure all retries are used.
    const mockFn = createFailingFunction(10);

    const promise = retryWithBackoff(mockFn, { initialDelayMs: 10 });

    // Expect it to fail with the error from the 7th attempt.

    const assertionPromise = await expect(promise).rejects.toThrow(
      'Simulated error attempt 7',
    );
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(7);
  });

  it('should default to 7 maxAttempts if options.maxAttempts is undefined', async () => {
    // This function will fail more than 7 times to ensure all retries are used.
    const mockFn = createFailingFunction(10);

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: undefined,
      initialDelayMs: 10,
    });

    // Expect it to fail with the error from the 7th attempt.

    const assertionPromise = await expect(promise).rejects.toThrow(
      'Simulated error attempt 7',
    );
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(7);
  });

  it('should not retry if shouldRetry returns false', async () => {
    const mockFn = vi.fn(async () => {
      throw new NonRetryableError('Non-retryable error');
    });
    const shouldRetryOnError = (error: Error) =>
      !(error instanceof NonRetryableError);

    const promise = retryWithBackoff(mockFn, {
      shouldRetryOnError,
      initialDelayMs: 10,
    });

    await expect(promise).rejects.toThrow('Non-retryable error');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if maxAttempts is not a positive number', async () => {
    const mockFn = createFailingFunction(1);

    // Test with 0
    await expect(retryWithBackoff(mockFn, { maxAttempts: 0 })).rejects.toThrow(
      'maxAttempts must be a positive number.',
    );

    // The function should not be called at all if validation fails
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('should use default shouldRetry if not provided, retrying on 429', async () => {
    const mockFn = vi.fn(async () => {
      const error = new Error('Too Many Requests') as any;
      error.status = 429;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    // Attach the rejection expectation *before* running timers
    const assertionPromise =
      await expect(promise).rejects.toThrow('Too Many Requests');

    // Run timers to trigger retries and eventual rejection
    await vi.runAllTimersAsync();

    // Await the assertion
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should use default shouldRetry if not provided, not retrying on 400', async () => {
    const mockFn = vi.fn(async () => {
      const error = new Error('Bad Request') as any;
      error.status = 400;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });
    await expect(promise).rejects.toThrow('Bad Request');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should respect maxDelayMs', async () => {
    const mockFn = createFailingFunction(3);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 4,
      initialDelayMs: 100,
      maxDelayMs: 250, // Max delay is less than 100 * 2 * 2 = 400
    });

    await vi.advanceTimersByTimeAsync(1000); // Advance well past all delays
    await promise;

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);

    // Delays should be around initial, initial*2, maxDelay (due to cap)
    // Jitter makes exact assertion hard, so we check ranges / caps
    expect(delays.length).toBe(3);
    expect(delays[0]).toBeGreaterThanOrEqual(100 * 0.7);
    expect(delays[0]).toBeLessThanOrEqual(100 * 1.3);
    expect(delays[1]).toBeGreaterThanOrEqual(200 * 0.7);
    expect(delays[1]).toBeLessThanOrEqual(200 * 1.3);
    // The third delay should be capped by maxDelayMs (250ms), accounting for jitter
    expect(delays[2]).toBeGreaterThanOrEqual(250 * 0.7);
    expect(delays[2]).toBeLessThanOrEqual(250 * 1.3);
  });

  it('should handle jitter correctly, ensuring varied delays', async () => {
    let mockFn = createFailingFunction(5);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    // Run retryWithBackoff multiple times to observe jitter
    const runRetry = () =>
      retryWithBackoff(mockFn, {
        maxAttempts: 2, // Only one retry, so one delay
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

    // We expect rejections as mockFn fails 5 times
    const promise1 = runRetry();
    // Attach the rejection expectation *before* running timers

    const assertionPromise1 = await expect(promise1).rejects.toThrow();
    await vi.runAllTimersAsync(); // Advance for the delay in the first runRetry
    await assertionPromise1;

    const firstDelaySet = setTimeoutSpy.mock.calls.map(
      (call) => call[1] as number,
    );
    setTimeoutSpy.mockClear(); // Clear calls for the next run

    // Reset mockFn to reset its internal attempt counter for the next run
    mockFn = createFailingFunction(5); // Re-initialize with 5 failures

    const promise2 = runRetry();
    // Attach the rejection expectation *before* running timers

    const assertionPromise2 = await expect(promise2).rejects.toThrow();
    await vi.runAllTimersAsync(); // Advance for the delay in the second runRetry
    await assertionPromise2;

    const secondDelaySet = setTimeoutSpy.mock.calls.map(
      (call) => call[1] as number,
    );

    // Check that the delays are not exactly the same due to jitter
    // This is a probabilistic test, but with +/-30% jitter, it's highly likely they differ.
    if (firstDelaySet.length > 0 && secondDelaySet.length > 0) {
      // Check the first delay of each set
      expect(firstDelaySet[0]).not.toBe(secondDelaySet[0]);
    } else {
      // If somehow no delays were captured (e.g. test setup issue), fail explicitly
      throw new Error('Delays were not captured for jitter test');
    }

    // Ensure delays are within the expected jitter range [7, 13] for initialDelayMs = 10
    [...firstDelaySet, ...secondDelaySet].forEach((d) => {
      expect(d).toBeGreaterThanOrEqual(10 * 0.7);
      expect(d).toBeLessThanOrEqual(10 * 1.3);
    });
  });

  describe('Qwen OAuth 429 error handling', () => {
    it('should retry for Qwen OAuth 429 errors that are throttling-related', async () => {
      const errorWith429: HttpError = new Error('Rate limit exceeded');
      errorWith429.status = 429;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(errorWith429)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        authType: AuthType.QWEN_OAUTH,
      });

      // Fast-forward time for delays
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should be called twice (1 failure + 1 success)
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately for Qwen OAuth with insufficient_quota message', async () => {
      const errorWithInsufficientQuota = Object.assign(
        new Error('Free allocated quota exceeded.'),
        { status: 429, code: 'insufficient_quota' },
      );

      const fn = vi.fn().mockRejectedValue(errorWithInsufficientQuota);

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        authType: AuthType.QWEN_OAUTH,
      });

      await expect(promise).rejects.toThrow(
        /Qwen OAuth free tier has been discontinued/,
      );

      // Should be called only once (no retries)
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw immediately for Qwen OAuth with free allocated quota exceeded message', async () => {
      const errorWithQuotaExceeded = Object.assign(
        new Error('Free allocated quota exceeded.'),
        { status: 429, code: 'insufficient_quota' },
      );

      const fn = vi.fn().mockRejectedValue(errorWithQuotaExceeded);

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        authType: AuthType.QWEN_OAUTH,
      });

      await expect(promise).rejects.toThrow(
        /Qwen OAuth free tier has been discontinued/,
      );

      // Should be called only once (no retries)
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry for Qwen OAuth with throttling message', async () => {
      const throttlingError: HttpError = new Error(
        'requests throttling triggered',
      );
      throttlingError.status = 429;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(throttlingError)
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        authType: AuthType.QWEN_OAUTH,
      });

      // Fast-forward time for delays
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should be called 3 times (2 failures + 1 success)
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry for Qwen OAuth with throttling error', async () => {
      const throttlingError: HttpError = new Error('throttling');
      throttlingError.status = 429;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        authType: AuthType.QWEN_OAUTH,
      });

      // Fast-forward time for delays
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should be called 2 times (1 failure + 1 success)
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately for Qwen OAuth with quota message', async () => {
      const errorWithQuota = Object.assign(
        new Error('Free allocated quota exceeded.'),
        { status: 429, code: 'insufficient_quota' },
      );

      const fn = vi.fn().mockRejectedValue(errorWithQuota);

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        authType: AuthType.QWEN_OAUTH,
      });

      await expect(promise).rejects.toThrow(
        /Qwen OAuth free tier has been discontinued/,
      );

      // Should be called only once (no retries)
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry normal errors for Qwen OAuth (not quota-related)', async () => {
      const normalError: HttpError = new Error('Network error');
      normalError.status = 500;

      const fn = createFailingFunction(2, 'success');
      // Replace the default 500 error with our normal error
      fn.mockRejectedValueOnce(normalError)
        .mockRejectedValueOnce(normalError)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        authType: AuthType.QWEN_OAUTH,
      });

      // Fast-forward time for delays
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should be called 3 times (2 failures + 1 success)
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});

describe('isTransientCapacityError', () => {
  it('should return true for 429 errors', () => {
    const error = { status: 429 };
    expect(isTransientCapacityError(error)).toBe(true);
  });

  it('should return true for 529 errors', () => {
    const error = { status: 529 };
    expect(isTransientCapacityError(error)).toBe(true);
  });

  it('should return false for 500 errors', () => {
    const error = { status: 500 };
    expect(isTransientCapacityError(error)).toBe(false);
  });

  it('should return false for 400 errors', () => {
    const error = { status: 400 };
    expect(isTransientCapacityError(error)).toBe(false);
  });

  it('should return false for errors without status', () => {
    expect(isTransientCapacityError(new Error('generic'))).toBe(false);
    expect(isTransientCapacityError(null)).toBe(false);
  });

  // 408 and network errors are NOT transient capacity errors — they can indicate
  // permanent config issues and should not trigger indefinite persistent retries.
  // They remain retryable in standard mode via classifyError.
  it('should return false for 408 errors', () => {
    const error = { status: 408 };
    expect(isTransientCapacityError(error)).toBe(false);
  });

  it('should return false for ECONNRESET network errors', () => {
    const error = new Error('Connection reset') as NodeJS.ErrnoException;
    error.code = 'ECONNRESET';
    expect(isTransientCapacityError(error)).toBe(false);
  });

  it('should return false for ETIMEDOUT network errors', () => {
    const error = new Error('Timed out') as NodeJS.ErrnoException;
    error.code = 'ETIMEDOUT';
    expect(isTransientCapacityError(error)).toBe(false);
  });

  it('should return false for "socket closed" message', () => {
    const error = new Error('The socket closed unexpectedly');
    expect(isTransientCapacityError(error)).toBe(false);
  });
});

describe('isUnattendedMode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['QWEN_CODE_UNATTENDED_RETRY'];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return true when QWEN_CODE_UNATTENDED_RETRY=1', () => {
    process.env['QWEN_CODE_UNATTENDED_RETRY'] = '1';
    expect(isUnattendedMode()).toBe(true);
  });

  it('should return true when QWEN_CODE_UNATTENDED_RETRY=true', () => {
    process.env['QWEN_CODE_UNATTENDED_RETRY'] = 'true';
    expect(isUnattendedMode()).toBe(true);
  });

  it('should return false when no env vars are set', () => {
    expect(isUnattendedMode()).toBe(false);
  });

  it('should NOT activate on CI=true alone', () => {
    process.env['CI'] = 'true';
    expect(isUnattendedMode()).toBe(false);
  });

  it('should return false for non-matching values', () => {
    process.env['QWEN_CODE_UNATTENDED_RETRY'] = '0';
    expect(isUnattendedMode()).toBe(false);
    process.env['QWEN_CODE_UNATTENDED_RETRY'] = 'false';
    expect(isUnattendedMode()).toBe(false);
    process.env['QWEN_CODE_UNATTENDED_RETRY'] = '';
    expect(isUnattendedMode()).toBe(false);
  });

  it('should use strict matching consistent with parseBooleanEnvFlag', () => {
    // Only 'true' and '1' are accepted — matches project convention
    process.env['QWEN_CODE_UNATTENDED_RETRY'] = 'TRUE';
    expect(isUnattendedMode()).toBe(false); // strict: not 'true'
    process.env['QWEN_CODE_UNATTENDED_RETRY'] = ' 1 ';
    expect(isUnattendedMode()).toBe(false); // strict: not '1'
    process.env['QWEN_CODE_UNATTENDED_RETRY'] = 'yes';
    expect(isUnattendedMode()).toBe(false);
  });
});

describe('retryWithBackoff - persistent mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
    console.warn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should retry indefinitely for 429 errors in persistent mode', async () => {
    // Fail 10 times with 429, then succeed
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts <= 10) {
        const error: HttpError = new Error('Rate limited');
        error.status = 429;
        throw error;
      }
      return 'success';
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3, // Would normally fail after 3
      initialDelayMs: 10,
      persistentMode: true,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(11); // 10 failures + 1 success
  });

  it('should retry indefinitely for 529 errors in persistent mode', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts <= 8) {
        const error: HttpError = new Error('Overloaded');
        error.status = 529;
        throw error;
      }
      return 'success';
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      persistentMode: true,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(9);
  });

  it('should NOT retry indefinitely for 500 errors in persistent mode', async () => {
    const fn = vi.fn(async () => {
      const error: HttpError = new Error('Internal Server Error');
      error.status = 500;
      throw error;
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      persistentMode: true,
    });

    const assertionPromise = await expect(promise).rejects.toThrow(
      'Internal Server Error',
    );
    await vi.runAllTimersAsync();
    await assertionPromise;

    // Should stop at maxAttempts for non-transient errors
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should cap single retry backoff at persistentMaxBackoffMs', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts <= 20) {
        const error: HttpError = new Error('Rate limited');
        error.status = 429;
        throw error;
      }
      return 'success';
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      persistentMode: true,
      persistentMaxBackoffMs: 5000, // 5 seconds cap for test
    });

    await vi.runAllTimersAsync();
    await promise;

    // Jitter is re-capped, so no delay should exceed the cap itself
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(5000 + 1); // cap + rounding tolerance
    }
  });

  it('should call heartbeatFn during persistent retry waits', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts <= 2) {
        const error: HttpError = new Error('Rate limited');
        error.status = 429;
        throw error;
      }
      return 'success';
    });

    const heartbeatFn = vi.fn();

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      persistentMode: true,
      heartbeatIntervalMs: 30, // Short interval for test
      heartbeatFn,
    });

    await vi.runAllTimersAsync();
    await promise;

    // Heartbeat should have been called at least once during waits > heartbeatInterval
    expect(heartbeatFn).toHaveBeenCalled();
    // Verify heartbeat info structure
    const call = heartbeatFn.mock.calls[0][0];
    expect(call).toHaveProperty('attempt');
    expect(call).toHaveProperty('remainingMs');
    expect(call).toHaveProperty('error');
  });

  it('should abort persistent retry when signal is aborted', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      const error: HttpError = new Error('Rate limited');
      error.status = 429;
      throw error;
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 100, // Short delay; abort via setTimeout below
      persistentMode: true,
      heartbeatIntervalMs: 50,
      signal: controller.signal,
    });

    // Abort after the first retry starts waiting
    setTimeout(() => controller.abort(), 100);

    const assertionPromise = await expect(promise).rejects.toThrow(
      'Retry aborted by signal',
    );
    await vi.runAllTimersAsync();
    await assertionPromise;
  });

  it('should respect shouldRetryOnError even in persistent mode', async () => {
    // Caller explicitly says "don't retry 429" — persistent mode must obey
    const fn = vi.fn(async () => {
      const error: HttpError = new Error('Rate limited');
      error.status = 429;
      throw error;
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      persistentMode: true,
      shouldRetryOnError: () => false, // force fast-fail
    });

    const assertionPromise = await expect(promise).rejects.toThrow('Rate limited');
    await vi.runAllTimersAsync();
    await assertionPromise;

    // Should fail on first attempt — shouldRetryOnError trumps persistent mode
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should not infinite-loop when heartbeatIntervalMs is 0', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts <= 2) {
        const error: HttpError = new Error('Rate limited');
        error.status = 429;
        throw error;
      }
      return 'success';
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      persistentMode: true,
      heartbeatIntervalMs: 0, // Would cause infinite loop without Math.max(1, ...)
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not affect normal mode behavior when persistentMode is false', async () => {
    const fn = vi.fn(async () => {
      const error: HttpError = new Error('Rate limited');
      error.status = 429;
      throw error;
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      persistentMode: false,
    });

    const assertionPromise = await expect(promise).rejects.toThrow('Rate limited');
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('retryWithBackoff - Retry-After handling in persistent mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
    console.warn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Helper: create a 429 error with Retry-After header
  function make429WithRetryAfter(seconds: number): HttpError {
    const error: HttpError & { response: { headers: Record<string, string> } } =
      Object.assign(new Error('Rate limited'), {
        status: 429,
        response: { headers: { 'retry-after': String(seconds) } },
      });
    return error;
  }

  it('should respect Retry-After and NOT cap at maxBackoff', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts <= 1) {
        throw make429WithRetryAfter(600); // server says wait 10 minutes
      }
      return 'success';
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      persistentMode: true,
      persistentMaxBackoffMs: 5000, // 5 seconds — Retry-After must NOT be capped to this
    });

    await vi.runAllTimersAsync();
    await promise;

    // The first retry delay should be ~600s (600000ms), not 5s (5000ms)
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    const firstRetryDelay = delays[0];
    expect(firstRetryDelay).toBeGreaterThan(5000); // NOT capped at maxBackoff
    expect(firstRetryDelay).toBeLessThanOrEqual(600 * 1000); // respects server value
  });

  it('should cap Retry-After at persistentCapMs', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts <= 1) {
        throw make429WithRetryAfter(100); // server says wait 100s
      }
      return 'success';
    });

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      persistentMode: true,
      persistentCapMs: 50_000, // absolute cap 50s — less than Retry-After
    });

    await vi.runAllTimersAsync();
    await promise;

    // Delay should be capped at persistentCapMs (50s), not the full 100s
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    const firstRetryDelay = delays[0];
    expect(firstRetryDelay).toBeLessThanOrEqual(50_000 + 1);
  });

  it('should NOT add jitter to Retry-After delays', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    // Run multiple times to check for jitter variance
    const observedDelays: number[] = [];

    for (let run = 0; run < 5; run++) {
      setTimeoutSpy.mockClear();
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts <= 1) {
          throw make429WithRetryAfter(10); // 10 seconds
        }
        return 'success';
      });

      const promise = retryWithBackoff(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        persistentMode: true,
      });

      await vi.runAllTimersAsync();
      await promise;

      const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
      observedDelays.push(delays[0]);
    }

    // All delays should be exactly 10000ms — no jitter
    for (const d of observedDelays) {
      expect(d).toBe(10_000);
    }
  });
});

describe('getErrorStatus', () => {
  it('should extract status from error.status (OpenAI/Anthropic/Gemini style)', () => {
    expect(getErrorStatus({ status: 429 })).toBe(429);
    expect(getErrorStatus({ status: 500 })).toBe(500);
    expect(getErrorStatus({ status: 503 })).toBe(503);
    expect(getErrorStatus({ status: 400 })).toBe(400);
  });

  it('should extract status from error.statusCode', () => {
    expect(getErrorStatus({ statusCode: 429 })).toBe(429);
    expect(getErrorStatus({ statusCode: 502 })).toBe(502);
  });

  it('should extract status from error.response.status (axios style)', () => {
    expect(getErrorStatus({ response: { status: 429 } })).toBe(429);
    expect(getErrorStatus({ response: { status: 503 } })).toBe(503);
  });

  it('should extract status from error.error.code (nested error style)', () => {
    expect(getErrorStatus({ error: { code: 429 } })).toBe(429);
    expect(getErrorStatus({ error: { code: 500 } })).toBe(500);
  });

  it('should prefer status over statusCode over response.status over error.code', () => {
    expect(
      getErrorStatus({
        status: 429,
        statusCode: 500,
        response: { status: 502 },
        error: { code: 503 },
      }),
    ).toBe(429);

    expect(
      getErrorStatus({
        statusCode: 500,
        response: { status: 502 },
        error: { code: 503 },
      }),
    ).toBe(500);

    expect(
      getErrorStatus({ response: { status: 502 }, error: { code: 503 } }),
    ).toBe(502);
  });

  it('should return undefined for out-of-range status codes', () => {
    expect(getErrorStatus({ status: 0 })).toBeUndefined();
    expect(getErrorStatus({ status: 99 })).toBeUndefined();
    expect(getErrorStatus({ status: 600 })).toBeUndefined();
    expect(getErrorStatus({ status: -1 })).toBeUndefined();
  });

  it('should return undefined for non-numeric status values', () => {
    expect(getErrorStatus({ status: 'not_a_number' })).toBeUndefined();
    expect(
      getErrorStatus({ error: { code: 'invalid_api_key' } }),
    ).toBeUndefined();
  });

  it('should return undefined for null, undefined, and non-object values', () => {
    expect(getErrorStatus(null)).toBeUndefined();
    expect(getErrorStatus(undefined)).toBeUndefined();
    expect(getErrorStatus(true)).toBeUndefined();
    expect(getErrorStatus(429)).toBeUndefined();
    expect(getErrorStatus('500')).toBeUndefined();
  });

  it('should handle Error instances with a status property', () => {
    const error: HttpError = new Error('Too Many Requests');
    error.status = 429;
    expect(getErrorStatus(error)).toBe(429);
  });

  it('should return undefined for Error instances without a status', () => {
    expect(getErrorStatus(new Error('generic error'))).toBeUndefined();
  });

  it('should return undefined for empty objects', () => {
    expect(getErrorStatus({})).toBeUndefined();
    expect(getErrorStatus({ response: {} })).toBeUndefined();
    expect(getErrorStatus({ error: {} })).toBeUndefined();
  });

  it('should parse HTTP_STATUS/NNN from streamed SSE error messages', () => {
    // DashScope throttling: error opens with 200 OK, then surfaces as an SSE
    // error frame. The SDK preserves the raw SSE text in error.message.
    const dashscopeThrottle = new Error(
      'id:1\nevent:error\n:HTTP_STATUS/429\ndata:{"request_id":"x","code":"Throttling.AllocationQuota","message":"Allocated quota exceeded"}',
    );
    expect(getErrorStatus(dashscopeThrottle)).toBe(429);

    expect(getErrorStatus(new Error('upstream :HTTP_STATUS/503'))).toBe(503);
  });

  it('should prefer numeric status fields over HTTP_STATUS/NNN in message', () => {
    const error: HttpError = new Error(':HTTP_STATUS/500');
    error.status = 429;
    expect(getErrorStatus(error)).toBe(429);
  });

  it('should ignore HTTP_STATUS/NNN outside the valid range', () => {
    expect(getErrorStatus(new Error('HTTP_STATUS/999'))).toBeUndefined();
  });

  it('should not match HTTP_STATUS/NNN when adjacent to more digits', () => {
    expect(getErrorStatus(new Error('HTTP_STATUS/4291'))).toBeUndefined();
  });
});

describe('isRetryableNetworkError', () => {
  it('should return true for ECONNRESET', () => {
    const error = new Error('Connection reset');
    (error as NodeJS.ErrnoException).code = 'ECONNRESET';
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for ETIMEDOUT', () => {
    const error = new Error('Timed out');
    (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for ESOCKETTIMEDOUT', () => {
    const error = new Error('Socket timed out');
    (error as NodeJS.ErrnoException).code = 'ESOCKETTIMEDOUT';
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for ECONNREFUSED', () => {
    const error = new Error('Connection refused');
    (error as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for ENOTFOUND', () => {
    const error = new Error('Not found');
    (error as NodeJS.ErrnoException).code = 'ENOTFOUND';
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for EHOSTUNREACH', () => {
    const error = new Error('Host unreachable');
    (error as NodeJS.ErrnoException).code = 'EHOSTUNREACH';
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for EAI_AGAIN', () => {
    const error = new Error('Temporary failure');
    (error as NodeJS.ErrnoException).code = 'EAI_AGAIN';
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for "socket closed" message', () => {
    const error = new Error('The socket closed unexpectedly');
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for "stream ended" message', () => {
    const error = new Error('The stream ended before completion');
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for "network error" message', () => {
    const error = new Error('A network error occurred');
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for "connection reset" message', () => {
    const error = new Error('connection reset by peer');
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for "econnreset" message (case-insensitive)', () => {
    const error = new Error('ECONNRESET: econnreset');
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return true for "etimedout" message (case-insensitive)', () => {
    const error = new Error('etimedout waiting for response');
    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('should return false for non-retryable errors', () => {
    const error = new Error('Bad request');
    expect(isRetryableNetworkError(error)).toBe(false);
  });

  it('should return false for errors with non-retryable codes', () => {
    const error = new Error('Permission denied');
    (error as NodeJS.ErrnoException).code = 'EACCES';
    expect(isRetryableNetworkError(error)).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isRetryableNetworkError(null)).toBe(false);
    expect(isRetryableNetworkError(undefined)).toBe(false);
  });
});

describe('classifyError', () => {
  it('should classify 400 as non-retryable', () => {
    const error = { status: 400 };
    const result = classifyError(error);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Deterministic request error');
    expect(result.status).toBe(400);
  });

  it('should classify 401 as non-retryable', () => {
    const error = { status: 401 };
    const result = classifyError(error);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Deterministic request error');
  });

  it('should classify 403 as non-retryable', () => {
    const error = { status: 403 };
    const result = classifyError(error);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Deterministic request error');
  });

  it('should classify 404 as non-retryable', () => {
    const error = { status: 404 };
    const result = classifyError(error);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Deterministic request error');
  });

  it('should classify 422 as non-retryable', () => {
    const error = { status: 422 };
    const result = classifyError(error);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Deterministic request error');
  });

  it('should classify 429 as retryable', () => {
    const error = { status: 429 };
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('Rate limited');
    expect(result.status).toBe(429);
  });

  it('should classify 408 as retryable', () => {
    const error = { status: 408 };
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('Request timeout');
  });

  it('should classify 409 with transient message as retryable', () => {
    const error: HttpError = new Error('Lock contention detected');
    error.status = 409;
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('Transient conflict');
  });

  it('should classify 409 with contention message as retryable', () => {
    const error: HttpError = new Error('Resource contention');
    error.status = 409;
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
  });

  // 'conflict' is NOT a transient keyword — it appears in the standard HTTP 409
  // reason phrase "Conflict", so matching it would make all 409s transient.
  it('should classify 409 with conflict-only message as non-retryable', () => {
    const error: HttpError = Object.assign(new Error('Duplicate resource'), {
      status: 409,
    });
    const result = classifyError(error);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Deterministic conflict');
  });

  it('should classify 409 without transient message as non-retryable', () => {
    const error: HttpError = Object.assign(new Error('Validation failed'), {
      status: 409,
    });
    const result = classifyError(error);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Deterministic conflict');
  });

  it('should classify 500 as retryable', () => {
    const error = { status: 500 };
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('Server error');
  });

  it('should classify 503 as retryable', () => {
    const error = { status: 503 };
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('Server error');
  });

  it('should classify 599 as retryable', () => {
    const error = { status: 599 };
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('Server error');
  });

  it('should classify ECONNRESET as retryable network error', () => {
    const error = new Error('Connection reset');
    (error as NodeJS.ErrnoException).code = 'ECONNRESET';
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('network error');
  });

  it('should classify "socket closed" as retryable network error', () => {
    const error = new Error('The socket closed unexpectedly');
    const result = classifyError(error);
    expect(result.retryable).toBe(true);
    expect(result.reason).toContain('network error');
  });

  it('should classify unknown errors as non-retryable', () => {
    const error = new Error('Something weird happened');
    const result = classifyError(error);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Non-retryable');
  });

  it('should classify null as non-retryable', () => {
    const result = classifyError(null);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Non-retryable');
  });

  it('should classify undefined as non-retryable', () => {
    const result = classifyError(undefined);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('Non-retryable');
  });
});

describe('retryWithBackoff integration — defaultShouldRetry new error paths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
    console.warn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // --- 408 Request Timeout ---
  // Note: defaultShouldRetry only retries 429/5xx. 408 requires a custom
  // shouldRetryOnError (e.g. classifyError) — these tests verify that
  // callers using classifyError-based retry DO retry on 408.

  it('should retry on 408 when shouldRetryOnError uses classifyError', async () => {
    let attempts = 0;
    const mockFn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        const error = new Error('Request Timeout') as any;
        error.status = 408;
        throw error;
      }
      return 'ok';
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      shouldRetryOnError: (e) => classifyError(e).retryable,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should exhaust retries on persistent 408 with classifyError', async () => {
    const mockFn = vi.fn(async () => {
      const error = new Error('Request Timeout') as any;
      error.status = 408;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
      shouldRetryOnError: (e) => classifyError(e).retryable,
    });

    const assertionPromise = await expect(promise).rejects.toThrow('Request Timeout');
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  // --- 409 Conflict (transient vs deterministic) ---

  it('should retry on 409 with lock contention message when using classifyError', async () => {
    let attempts = 0;
    const mockFn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        const error: HttpError = new Error('Lock contention on resource');
        error.status = 409;
        throw error;
      }
      return 'ok';
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      shouldRetryOnError: (e) => classifyError(e).retryable,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on 409 without transient message', async () => {
    const mockFn = vi.fn(async () => {
      const error: HttpError = new Error('Resource already exists');
      error.status = 409;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      shouldRetryOnError: (e) => classifyError(e).retryable,
    });

    // Attach rejection handler before running timers to avoid unhandled rejection
    const assertionPromise = await expect(promise).rejects.toThrow(
      'Resource already exists',
    );
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  // --- Network errors ---

  it('should retry on ECONNRESET when shouldRetryOnError uses classifyError', async () => {
    let attempts = 0;
    const mockFn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        const error = new Error('Connection reset') as NodeJS.ErrnoException;
        error.code = 'ECONNRESET';
        throw error;
      }
      return 'ok';
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      shouldRetryOnError: (e) => classifyError(e).retryable,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should retry on ETIMEDOUT when shouldRetryOnError uses classifyError', async () => {
    let attempts = 0;
    const mockFn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        const error = new Error('Operation timed out') as NodeJS.ErrnoException;
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return 'ok';
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      shouldRetryOnError: (e) => classifyError(e).retryable,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should retry on "socket closed" message when using classifyError', async () => {
    let attempts = 0;
    const mockFn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        const error = new Error('The socket closed unexpectedly');
        throw error;
      }
      return 'ok';
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      shouldRetryOnError: (e) => classifyError(e).retryable,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should exhaust retries on persistent network error with classifyError', async () => {
    const mockFn = vi.fn(async () => {
      const error = new Error('Connection reset') as NodeJS.ErrnoException;
      error.code = 'ECONNRESET';
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
      shouldRetryOnError: (e) => classifyError(e).retryable,
    });

    const assertionPromise =
      await expect(promise).rejects.toThrow('Connection reset');
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  // --- Non-retryable status codes should NOT retry ---

  it('should NOT retry on 401 via defaultShouldRetry', async () => {
    const mockFn = vi.fn(async () => {
      const error = new Error('Unauthorized') as any;
      error.status = 401;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const assertionPromise = await expect(promise).rejects.toThrow('Unauthorized');
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry on 404 via defaultShouldRetry', async () => {
    const mockFn = vi.fn(async () => {
      const error = new Error('Not Found') as any;
      error.status = 404;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const assertionPromise = await expect(promise).rejects.toThrow('Not Found');
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
