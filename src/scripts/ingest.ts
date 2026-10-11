import { createReadStream, statSync } from 'node:fs';

import type Database from 'better-sqlite3';
import { parse } from 'csv-parse';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { createDatabase } from '../db/client.js';
import type { NewComplaint } from '../db/schema.js';
import { DimensionResolver } from '../ingest/dimension-resolver.js';
import { normalizeRow } from '../ingest/normalize.js';
import { toNewComplaint } from '../ingest/to-new-complaint.js';
import { createRepositories } from '../repositories/index.js';

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface IndexDef {
  name: string;
  sql: string;
}

/**
 * Grab the secondary-index DDL for `complaints` from sqlite_master so we can
 * drop it for the duration of a bulk load and rebuild it afterwards. Deriving
 * the SQL here (rather than hard-coding it) keeps this in sync with migrations.
 * Auto-indexes (sql IS NULL) are excluded.
 */
function readComplaintIndexes(sqlite: Database.Database): IndexDef[] {
  return sqlite
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'complaints' AND sql IS NOT NULL",
    )
    .all() as IndexDef[];
}

async function main(): Promise<void> {
  const file = getArg('--file') ?? 'complaints-data/complaints.csv';
  const dbPath = getArg('--db');
  const limitArg = getArg('--limit');
  const limit = limitArg ? Number(limitArg) : Number.POSITIVE_INFINITY;
  const batchSize = Number(getArg('--batch') ?? 1000);
  const keepIndexes = process.argv.includes('--keep-indexes');

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error(`Invalid --batch value: ${getArg('--batch')}`);
  }

  const fileSize = statSync(file).size;
  console.log(`Ingesting ${file} (${formatMb(fileSize)}) into SQLite`);
  if (Number.isFinite(limit)) console.log(`  limit: first ${limit.toLocaleString()} rows`);

  const client = createDatabase({
    ...(dbPath ? { path: dbPath } : {}),
    // Bulk-load tuning: a large page cache + memory map keep the interior of
    // the growing B-trees resident, and `synchronous = OFF` skips per-commit
    // fsyncs. Safe here because the CSV is the source of truth and the load is
    // re-runnable; do NOT use these settings for normal runtime queries.
    cacheSizeKb: -2 * 1024 * 1024,
    mmapSizeBytes: 8 * 1024 * 1024 * 1024,
    synchronous: 'OFF',
  });
  migrate(client.db, { migrationsFolder: './drizzle' });
  const repos = createRepositories(client.db);

  // Complaint IDs arrive in effectively random order, so every row lands in the
  // middle of the rowid B-tree and updates all seven secondary indexes. Dropping
  // them for the load removes 7 of the 8 random-write B-trees; recreating once at
  // the end is a sorted bulk build and far cheaper than per-row maintenance.
  const deferredIndexes = keepIndexes ? [] : readComplaintIndexes(client.sqlite);
  if (deferredIndexes.length > 0) {
    for (const { name } of deferredIndexes) {
      client.sqlite.exec(`DROP INDEX IF EXISTS "${name}"`);
    }
    console.log(`  deferred ${deferredIndexes.length} secondary indexes (--keep-indexes to disable)`);
  }

  const startedAt = Date.now();
  const resolver = new DimensionResolver(repos);

  const parser = createReadStream(file).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }),
  );

  let buffer: NewComplaint[] = [];
  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let lastMark = 0;
  let lastMarkAt = startedAt;

  const flush = (): void => {
    if (buffer.length === 0) return;
    inserted += repos.complaints.createManyChunked(buffer, {
      chunkSize: batchSize,
      onConflictDoNothing: true,
    });
    buffer = [];
  };

  for await (const record of parser) {
    const row = normalizeRow(record);
    if (!row) {
      skipped += 1;
      continue;
    }

    buffer.push(toNewComplaint(row, resolver));

    processed += 1;
    if (buffer.length >= batchSize) flush();

    if (processed % 250_000 === 0) {
      const now = Date.now();
      const intervalRate = (processed - lastMark) / ((now - lastMarkAt) / 1000);
      const avgRate = processed / ((now - startedAt) / 1000);
      console.log(
        `  ${processed.toLocaleString()} rows | ` +
          `${Math.round(intervalRate).toLocaleString()} rows/s interval | ` +
          `${Math.round(avgRate).toLocaleString()} rows/s avg`,
      );
      lastMark = processed;
      lastMarkAt = now;
    }

    if (processed >= limit) break;
  }

  flush();

  let rebuildMs = 0;
  if (deferredIndexes.length > 0) {
    const rebuildStart = Date.now();
    console.log(`Rebuilding ${deferredIndexes.length} secondary indexes...`);
    for (const { sql } of deferredIndexes) client.sqlite.exec(sql);
    client.sqlite.exec('ANALYZE');
    rebuildMs = Date.now() - rebuildStart;
  }

  client.sqlite.pragma('optimize');

  const elapsed = (Date.now() - startedAt) / 1000;
  const total = repos.complaints.count();

  console.log('\nIngest complete');
  console.log(`  rows processed : ${processed.toLocaleString()}`);
  console.log(`  rows written   : ${inserted.toLocaleString()}`);
  console.log(`  rows skipped   : ${skipped.toLocaleString()}`);
  console.log(`  complaints@db  : ${total.toLocaleString()}`);
  console.log(`  dimensions     : ${JSON.stringify(resolver.stats())}`);
  console.log(`  index rebuild  : ${(rebuildMs / 1000).toFixed(1)}s`);
  console.log(`  elapsed        : ${elapsed.toFixed(1)}s (${Math.round(processed / elapsed).toLocaleString()} rows/s)`);

  client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
