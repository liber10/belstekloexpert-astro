import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type LeadHubDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  db: LeadHubDatabase;
  pool: Pool;
}

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}
