import { existsSync } from 'node:fs';

import { companies } from '../db/schema.js';
import { createDatabase, createRepositories, DEFAULT_DATABASE_PATH } from '../index.js';

/**
 * List every company name, alphabetically.
 *
 * Usage: tsx src/scripts/list-companies.ts [optional-db-path]
 *
 * Opens the database **read-only** so it never creates an empty file when the
 * path is wrong, and fails with guidance instead of a raw SQLite error when the
 * database has not been built yet.
 */
const path = process.argv[2] ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_PATH;

if (!existsSync(path)) {
  console.error(`Database not found: ${path}`);
  console.error('Build it first with `npm run ingest` (see README "Getting the data").');
  process.exitCode = 1;
} else {
  const { db, close } = createDatabase({ path, readonly: true });
  try {
    for (const { name } of createRepositories(db).companies.findMany({ orderBy: companies.name })) {
      console.log(name);
    }
  } finally {
    close();
  }
}
