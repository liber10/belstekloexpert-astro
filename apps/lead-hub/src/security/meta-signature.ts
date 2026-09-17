import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyMetaWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string | undefined,
) {
  if (!signature || !appSecret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature.trim());
  if (!match?.[1]) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const provided = Buffer.from(match[1], 'hex');
  const actual = Buffer.from(expected, 'hex');
  return provided.length === actual.length && timingSafeEqual(provided, actual);
}
