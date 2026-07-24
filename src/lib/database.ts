import { Pool } from 'pg';

let databasePool: Pool | undefined;

export function getDatabasePool(): Pool {
  if (databasePool) {
    return databasePool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Database configuration is unavailable.');
  }

  databasePool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  databasePool.on('error', () => {
    console.error('Database pool error.');
  });

  return databasePool;
}
