import { describe, expect, it, vi } from 'vitest';
import type { Lead } from '../../src/db/schema.js';
import {
  deliverLeadWithBestEffortPhotos,
  isTelegramMessageNotModified,
} from '../../src/integrations/telegram/index.js';

describe('Telegram text-first delivery', () => {
  it('preserves a successful text receipt when photo signing fails', async () => {
    const lead = { id: 'lead', publicId: 'BSE-TEST', photoRefs: ['private-ref'] } as Lead;
    const sendCard = vi.fn(() => Promise.resolve({ chatId: 'chat', messageId: 42 }));
    const sendPhoto = vi.fn(() => Promise.resolve());
    const receipt = await deliverLeadWithBestEffortPhotos({
      lead,
      sendCard,
      resolvePhotoUrls: vi.fn(() => Promise.reject(new Error('signing unavailable'))),
      sendPhoto,
    });
    expect(receipt).toEqual({ chatId: 'chat', messageId: 42 });
    expect(sendCard).toHaveBeenCalledOnce();
    expect(sendPhoto).not.toHaveBeenCalled();
  });

  it('recognizes Telegram idempotent edit responses as successful no-ops', () => {
    expect(isTelegramMessageNotModified({ description: 'Bad Request: message is not modified' })).toBe(true);
    expect(isTelegramMessageNotModified(new Error('Call failed: message is not modified'))).toBe(true);
    expect(isTelegramMessageNotModified({ description: 'Bad Request: message to edit not found' })).toBe(false);
  });
});
