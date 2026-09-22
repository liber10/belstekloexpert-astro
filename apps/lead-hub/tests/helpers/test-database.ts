// Integration suites truncate tables. Never accept production or an arbitrary
// inherited DATABASE_URL; require a loopback-only, explicitly named test DB.
export function testDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-z0-9_]+_test$/.test(url.pathname)
    || value === process.env.DATABASE_URL) {
    throw new Error('Integration tests require a separate loopback PostgreSQL database named *_test.');
  }
  return value;
}
