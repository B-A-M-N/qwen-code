/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage, isNodeError } from './errors.js';
import { URL } from 'node:url';

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./, // AWS IMDS and link-local
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // CGNAT (RFC 6598)
  /^0\./, // 0.0.0.0/8 — can reach localhost on Linux
  /^::1$/, // IPv6 loopback
  /^fc00:/, // IPv6 unique local
  /^fe80:/, // IPv6 link-local
  // IPv4-mapped IPv6: ::ffff:x.x.x.x (Node normalizes to hex, e.g. ::ffff:c0a8:101)
  // We check the raw hostname for the ::ffff: prefix and also test the original URL
  // via isPrivateIp which uses the original string before Node normalization
];

const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const FETCH_TROUBLESHOOTING_ERROR_CODES = new Set([
  ...TLS_ERROR_CODES,
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

export class FetchError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export function isPrivateIp(url: string): boolean {
  try {
    // Node 20+ returns IPv6 hostnames with brackets (e.g. '[::1]').
    // Strip them before testing against IP range patterns.
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
    if (PRIVATE_IP_RANGES.some((range) => range.test(hostname))) {
      return true;
    }
    // IPv4-mapped IPv6: Node normalizes ::ffff:192.168.1.1 to ::ffff:c0a8:101 (hex).
    // Check the original URL string for ::ffff: followed by a dotted-quad pattern.
    const rawHostname = url.match(/:\/\/([^/]+)/)?.[1] ?? '';
    const bareHostname = rawHostname.replace(/^\[|\]$/g, '');
    if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(bareHostname)) {
      // Extract the IPv4 part and check if it's private
      const ipv4 = bareHostname.replace(/^::ffff:/, '');
      return PRIVATE_IP_RANGES.some((range) => range.test(ipv4));
    }
    return false;
  } catch (_e) {
    return false;
  }
}

export async function fetchWithTimeout(
  url: string,
  timeout: number,
  headers?: Record<string, string>,
  redirect: RequestRedirect = 'error',
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect,
    });
    return response;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ABORT_ERR') {
      throw new FetchError(`Request timed out after ${timeout}ms`, 'ETIMEDOUT');
    }
    throw new FetchError(getErrorMessage(error), getErrorCode(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if (
    'code' in error &&
    typeof (error as Record<string, unknown>)['code'] === 'string'
  ) {
    return (error as Record<string, string>)['code'];
  }

  return undefined;
}

function formatUnknownErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') {
    return error;
  }

  if (
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint'
  ) {
    return String(error);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const message = (error as Record<string, unknown>)['message'];
  if (typeof message === 'string') {
    return message;
  }

  return undefined;
}

function formatErrorCause(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause) {
    return undefined;
  }

  const causeCode = getErrorCode(cause);
  const causeMessage = formatUnknownErrorMessage(cause);

  if (!causeCode && !causeMessage) {
    return undefined;
  }

  if (causeCode && causeMessage && !causeMessage.includes(causeCode)) {
    return `${causeCode}: ${causeMessage}`;
  }

  return causeMessage ?? causeCode;
}

export function formatFetchErrorForUser(
  error: unknown,
  options: { url?: string } = {},
): string {
  const errorMessage = getErrorMessage(error);

  const code =
    error instanceof Error
      ? (getErrorCode((error as Error & { cause?: unknown }).cause) ??
        getErrorCode(error))
      : getErrorCode(error);

  const cause = formatErrorCause(error);
  const fullErrorMessage = [
    errorMessage,
    cause ? `(cause: ${cause})` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  const shouldShowFetchHints =
    errorMessage.toLowerCase().includes('fetch failed') ||
    (code != null && FETCH_TROUBLESHOOTING_ERROR_CODES.has(code));

  const shouldShowTlsHint = code != null && TLS_ERROR_CODES.has(code);

  if (!shouldShowFetchHints) {
    return fullErrorMessage;
  }

  const hintLines = [
    '',
    'Troubleshooting:',
    ...(options.url
      ? [`- Confirm you can reach ${options.url} from this machine.`]
      : []),
    '- If you are behind a proxy, pass `--proxy <url>` (or set `proxy` in settings).',
    ...(shouldShowTlsHint
      ? [
          '- If your network uses a corporate TLS inspection CA, set `NODE_EXTRA_CA_CERTS` to your CA bundle.',
        ]
      : []),
  ];

  return `${fullErrorMessage}${hintLines.join('\n')}`;
}
