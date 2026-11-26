import { sql } from 'drizzle-orm';
import { connect, type DbHandle, runMigrations } from '../../src/db/client.js';

/** CI sets DATABASE_URL_TEST; locally it defaults to the docker-compose database. */
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5433/fund_docs_test';

/**
 * Connect to the test database and rebuild it from the migrations. Refuses to touch a
 * database whose name doesn't end in `_test`, because this drops every table.
 */
export async function freshTestDb(): Promise<DbHandle> {
  const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to reset "${name}": test database names must end in _test`);
  }
  const handle = connect(TEST_DATABASE_URL);
  await handle.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await handle.db.execute(sql`DROP SCHEMA public CASCADE`);
  await handle.db.execute(sql`CREATE SCHEMA public`);
  await runMigrations(handle.db);
  return handle;
}
