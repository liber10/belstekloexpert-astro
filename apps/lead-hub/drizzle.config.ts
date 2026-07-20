import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://lead_hub:lead_hub@localhost:54329/lead_hub',
  },
  strict: true,
  verbose: true,
});
