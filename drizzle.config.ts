import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * `db:generate` diffs `src/db/schema.ts` and writes SQL migrations to ./drizzle.
 * `db:migrate` applies those migrations to the SQLite database file.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './data/complaints.db',
  },
  strict: true,
  verbose: true,
});
