import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;
export type DatabaseClient = {
  /** Raw better-sqlite3 handle (for pragmas, transactions, bulk `.run()`). */
  sqlite: Database.Database;
  /** Drizzle query builder bound to the schema. */
  db: AppDatabase;
  /** Close the underlying connection. */
  close: () => void;
};

export const DEFAULT_DATABASE_PATH = './data/complaints.db';

export interface CreateDatabaseOptions {
  /** SQLite file path, or `:memory:`. Falls back to `DATABASE_URL`. */
  path?: string;
  /** Emit SQL statements to the console. */
  logger?: boolean;
  /** Open the file read-only (useful for analytics against a built DB). */
  readonly?: boolean;
  /** SQLite page cache size in KiB (negative = KiB, positive = pages). */
  cacheSizeKb?: number;
  /** Bytes of address space the OS may memory-map for the DB file. */
  mmapSizeBytes?: number;
  /** Durability trade-off. `OFF` is unsafe but common for bulk (re)builds. */
  synchronous?: 'OFF' | 'NORMAL' | 'FULL';
}

/**
 * Create a configured SQLite connection wrapped with Drizzle.
 *
 * Pragmas chosen for a single-writer analytical workload with ~18M rows:
 *  - `journal_mode = WAL`   -> readers don't block the (long) writer.
 *  - `synchronous = NORMAL` -> big speed-up for bulk ingest, still crash-safe in WAL.
 *  - `foreign_keys = ON`    -> enforce the relation FKs at the engine level.
 *  - `busy_timeout`         -> wait instead of throwing SQLITE_BUSY under contention.
 */
export function createDatabase(options: CreateDatabaseOptions = {}): DatabaseClient {
  const path = options.path ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_PATH;

  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const sqlite = new Database(path, { readonly: options.readonly ?? false });

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma(`synchronous = ${options.synchronous ?? 'NORMAL'}`);
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma(`cache_size = ${options.cacheSizeKb ?? -64000}`); // 64 MiB default
  if (options.mmapSizeBytes !== undefined) {
    sqlite.pragma(`mmap_size = ${options.mmapSizeBytes}`);
  }

  const db = drizzle(sqlite, {
    schema,
    logger: options.logger ?? false,
  });

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}

/**
 * Process-wide default connection, created lazily so importing a repository
 * never opens a file handle until a query actually runs.
 */
let defaultClient: DatabaseClient | undefined;

export function getDatabase(): DatabaseClient {
  defaultClient ??= createDatabase();
  return defaultClient;
}

/** Lazily-resolved Drizzle instance for the default connection. */
export function getDb(): AppDatabase {
  return getDatabase().db;
}
