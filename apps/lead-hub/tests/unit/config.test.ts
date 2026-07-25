import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('loads safe local defaults with Telegram disabled', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://localhost/lead_hub' });
    expect(config.port).toBe(8787);
    expect(config.telegram.enabled).toBe(false);
    expect(config.allowedOrigins).toEqual(['http://localhost:4321']);
  });

  it('keeps object storage disabled when no B2 settings are present', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://localhost/lead_hub' });
    expect(config.objectStorage).toBeNull();
  });

  it('rejects a partial object storage configuration', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://localhost/lead_hub',
        OBJECT_STORAGE_ENDPOINT: 'https://s3.example.test',
      }),
    ).toThrow('OBJECT_STORAGE_REGION');
  });

  it('loads a complete private object storage configuration', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://localhost/lead_hub',
      OBJECT_STORAGE_ENDPOINT: 'https://s3.example.test',
      OBJECT_STORAGE_REGION: 'region-1',
      OBJECT_STORAGE_BUCKET: 'private-photo-bucket',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key-value',
    });

    expect(config.objectStorage?.bucket).toBe('private-photo-bucket');
    expect(config.objectStorage?.prefix).toBe('leads/');
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

  it('uses the platform port when LEAD_HUB_PORT is not set', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://localhost/lead_hub',
      PORT: '10000',
    });

    expect(config.port).toBe(10000);
  });

  it('prefers an explicit LEAD_HUB_PORT over the platform port', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://localhost/lead_hub',
      LEAD_HUB_PORT: '8787',
      PORT: '10000',
    });

    expect(config.port).toBe(8787);
  });
});
