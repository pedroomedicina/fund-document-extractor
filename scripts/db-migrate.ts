/** Apply pending migrations in drizzle/ to DATABASE_URL.  npm run db:migrate */
import 'dotenv/config';
import { connect, runMigrations } from '../src/db/client.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see env.example)');
  process.exit(1);
}
const handle = connect(url);
try {
  await runMigrations(handle.db);
  console.log('Migrations applied.');
} finally {
  await handle.close();
}
