import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Keep the project's local .env out of Cloudflare production artifacts.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

export default defineConfig({
  adapter: cloudflare({
    configPath: './wrangler.cloudflare.production.jsonc',
    imageService: 'passthrough',
  }),
  output: 'server',
  site: 'https://belstekloexpert.by',
  trailingSlash: 'always',
  vite: {
    // Never load the local project .env into the Cloudflare build bundle.
    envDir: './.cloudflare-env',
  },
});
