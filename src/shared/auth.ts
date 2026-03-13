/**
 * Daemon token generation and validation.
 *
 * HQ generates a token when a project is added; the daemon presents it
 * during the auth handshake. Validation uses constant-time comparison
 * to prevent timing attacks.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TOKEN_BYTE_LENGTH } from './constants.js';

/**
 * Generate a secure random daemon token.
 * @returns hex-encoded token string (64 characters)
 */
export function generateDaemonToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
}

/**
 * Validate a daemon token against an expected value using constant-time comparison.
 * Returns false (rather than throwing) for length mismatches.
 */
export function validateDaemonToken(token: string, expected: string): boolean {
  const tokenBuf = Buffer.from(token, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (tokenBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(tokenBuf, expectedBuf);
}
