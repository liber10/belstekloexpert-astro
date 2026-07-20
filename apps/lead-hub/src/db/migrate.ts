import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config.js';
import { createDatabaseClient } from './client.js';

const config = loadConfig();
const database = createDatabaseClient(config.databaseUrl);

try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  process.stdout.write('Lead Hub migrations completed.\n');
} finally {
  await database.pool.end();
}
