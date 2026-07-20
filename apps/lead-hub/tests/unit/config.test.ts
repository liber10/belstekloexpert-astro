import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('loads safe local defaults with Telegram disabled', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://localhost/lead_hub' });
    expect(config.port).toBe(8787);
    expect(config.telegram.enabled).toBe(false);
    expect(config.allowedOrigins).toEqual(['http://localhost:4321']);
  });

  it('requires all Telegram settings when enabled', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/lead_hub',
        TELEGRAM_ENABLED: 'true',
      }),
    ).toThrow('TELEGRAM_BOT_TOKEN');
  });

  it('requires a web ingest key in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://localhost/lead_hub',
      }),
    ).toThrow('WEB_INGEST_API_KEY');
  });
});
