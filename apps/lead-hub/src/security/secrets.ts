import { timingSafeEqual } from 'node:crypto';

export function matchesSecret(provided: string | undefined, expected: string | undefined) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  return authorization.slice('Bearer '.length).trim() || undefined;
}
