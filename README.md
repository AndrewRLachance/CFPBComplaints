# CFPB Complaints — Drizzle ORM + SQLite data layer

A typed, foundational data-access layer for the CFPB Consumer Complaint
Database (~18.3M rows, ~5.5 GB CSV) built with the latest **Drizzle ORM**
(`0.45.x`) on **SQLite** via **better-sqlite3**.

> The CFPB source CSV and the built SQLite database are **not** committed —
> they are large, regenerable downloads. See
> [Getting the data](#getting-the-data) and
> [`complaints-data/README.md`](complaints-data/README.md).

It ships the three things you asked for:

1. **Tables + relations** — a normalised star-ish schema (`src/db/schema.ts`).
2. **Database connection** — a configured SQLite/Drizzle client (`src/db/client.ts`).
3. **Foundational repository classes** — a generic base plus one per table
   (`src/repositories/*`), with a CSV ingestion pipeline (`src/ingest/*`).

## Requirements

- Node.js 20+ (developed on Node 24)
- A C toolchain for `better-sqlite3`'s native binding (prebuilt binaries are
  usually downloaded automatically)

## Quickstart

```bash
npm install

# 0. Fetch the CFPB bulk CSV into complaints-data/ (git-ignored).
mkdir -p complaints-data
curl -L -o complaints-data/complaints.csv.zip \
  https://files.consumerfinance.gov/ccdb/complaints.csv.zip
unzip -o complaints-data/complaints.csv.zip -d complaints-data

# 1. Create the SQLite schema (data/complaints.db)
npm run db:migrate

# 2. Load the CSV (streaming + chunked). Omit --limit to load all 18.3M rows.
npm run ingest -- --limit 50000

# 3. Verify the whole stack end-to-end (in-memory DB, no fixtures needed)
npm run smoke

# or: typecheck
npm run typecheck
```

Both the source CSV and `data/complaints.db` are git-ignored.

## Getting the data

Neither the CFPB source CSV nor the built database is tracked in git. The CFPB
publishes a weekly bulk export of the full database:

| | |
| --- | --- |
| Source | <https://www.consumerfinance.gov/data-research/consumer-complaints/> |
| Bulk endpoint | <https://files.consumerfinance.gov/ccdb/complaints.csv.zip> |
| Format | one header row + one row per complaint |
| Size | ~337 MB zipped, ~5.5 GB unzipped (~18M rows) |

```bash
mkdir -p complaints-data
curl -L -o complaints-data/complaints.csv.zip \
  https://files.consumerfinance.gov/ccdb/complaints.csv.zip
unzip -o complaints-data/complaints.csv.zip -d complaints-data   # → complaints-data/complaints.csv
```

Because the export refreshes weekly, re-running the download picks up newly
published complaints. Ingestion is idempotent (`onConflictDoNothing` on
`complaint_id`), so reloading the same file is safe. Use `--file <path>` with
`npm run ingest` to point at a CSV elsewhere.

## Schema

The flat CSV is normalised so the 18M-row fact table only stores integers and
free text, while repeated labels live once in dimension tables.

```
products ──< sub_products ──┐
issues   ──< sub_issues   ──┤
                            ├──< complaints >── companies
                            │
```

| Table          | Key / unique              | Notes                                              |
| -------------- | ------------------------- | -------------------------------------------------- |
| `companies`    | `id`, unique `name`       | CSV "Company"                                      |
| `products`     | `id`, unique `name`       | CSV "Product"                                      |
| `sub_products` | `id`, unique `(product_id, name)` | CSV "Sub-product", FK → `products`          |
| `issues`       | `id`, unique `name`       | CSV "Issue"                                        |
| `sub_issues`   | `id`, unique `(issue_id, name)`   | CSV "Sub-issue", FK → `issues`              |
| `complaints`   | PK `complaint_id` (natural key) | fact table, FKs → all dimensions             |

`complaints` also stores `date_received` / `date_sent_to_company` as ISO-8601
text (`YYYY-MM-DD`, lexicographically sortable), `timely_response` as a real
boolean, `zip_code` as text (to preserve leading zeros), plus
`company_public_response`, `company_response`, `state`, `tags`, `submitted_via`.
Drizzle `relations()` wire up every one-to-many / many-to-one edge, and indexes
exist on all foreign keys plus the commonly filtered columns.

## Connection

`createDatabase()` opens better-sqlite3 with pragmas tuned for a single-writer
analytical workload:

| Pragma                | Value          | Why                                        |
| --------------------- | -------------- | ------------------------------------------ |
| `journal_mode`        | `WAL`          | readers don't block the long writer        |
| `synchronous`         | `NORMAL`       | large bulk-insert speedup, still crash-safe |
| `foreign_keys`        | `ON`           | enforce relation FKs in the engine         |
| `busy_timeout`        | `5000`         | wait instead of throwing `SQLITE_BUSY`     |
| `cache_size`          | `-64000` (64MiB) | fewer page faults while scanning         |

```ts
import { createDatabase, createRepositories } from './src/index.js';

const { db, close } = createDatabase(); // or { path: ':memory:' } / DATABASE_URL
const repos = createRepositories(db);

const equifax = repos.companies.findOrCreateByName('EQUIFAX, INC.');
const recent = repos.complaints.findByCompanyId(equifax.id, { limit: 10 });
const detail = repos.complaints.getWithDetails(recent[0]!.complaintId); // eager relations
close();
```

For the default connection there are also `getDatabase()` / `getDb()` singletons,
created lazily so importing a repository never opens a file until first use.

## Repositories

`BaseRepository<TTable>` provides the common synchronous CRUD surface
(`findById`, `findOne`, `findMany`, `count`, `exists`, `create`, `createMany`,
`updateById`, `deleteById`, `deleteAll`). Concrete repositories add
domain-specific queries:

- **`CompanyRepository`, `ProductRepository`, `IssueRepository`** — unique-name
  lookups, `findOrCreateByName()` (idempotent), `searchByName()`.
- **`SubProductRepository`, `SubIssueRepository`** — composite-key lookups,
  `findOrCreateByName(parentId, name)`, `findBy<Parent>Id()`.
- **`ComplaintRepository`** — `buildWhere(ComplaintFilters)`, `search()`,
  `countMatching()`, `findByCompanyId/ProductId/DateRange`, relational
  `getWithDetails()`, chunked transactional `createManyChunked()`, and
  aggregate helpers (`countByState/Product/Company/Issue/Response/Month`).

`createRepositories(db)` bundles them all against one connection. Methods are
**synchronous** because the better-sqlite3 driver is synchronous.

## Ingestion

`src/ingest/` is the ETL layer:

- `normalize.ts` — pure CSV-record → normalised-row transforms (empty → `null`,
  Yes/No → boolean, ...), trivially unit-testable.
- `dimension-resolver.ts` — memoises label → FK in Maps and preloads from the DB,
  so dimensions are touched at most once per distinct label (not once per row).
- `to-new-complaint.ts` — assembles the insertable `NewComplaint`.
- `src/scripts/ingest.ts` — streams the CSV with `csv-parse`, batches inserts
  inside a transaction with `onConflictDoNothing` (idempotent, re-runnable),
  logs throughput, and applies pending migrations first.

Flags: `--file <path>`, `--limit <n>`, `--batch <n>` (rows per INSERT, default
1000), `--db <path>`, `--keep-indexes`.

### Why bulk loads slow down (and what the loader does about it)

Throughput decays as the table grows, and it is **continuous** — the per-250k log
line is just a sampling interval, not the cause. Two structural reasons:

1. **Random primary-key order.** `complaint_id` is the `INTEGER PRIMARY KEY`
   (rowid alias), but the CSV is *not* sorted by it — e.g. line 100k has ID
   29,319,411 while line 1M has 7,214,978. Every insert therefore lands in the
   middle of the table's B-tree, causing page splits and random page writes
   across the whole file rather than an append.
2. **Seven secondary indexes.** Each row also has to be inserted into all seven
   index B-trees, whose keys (`company_id`, `date_received`, `state`, ...) are
   equally scattered.

As the file outgrows the page cache, those random writes turn into disk I/O, so
the cost per row climbs.

The loader mitigates this by default:

- **Deferring secondary indexes** — it drops the seven `complaints` indexes
  before the load and rebuilds them in one sorted bulk pass afterwards
  (`--keep-indexes` opts out). Rebuilding 1M rows' worth took ~4s.
- **Bulk-tuned pragmas** — 2 GiB page cache, an 8 GiB memory map, and
  `synchronous = OFF` for the duration of the load (the CSV is the source of
  truth and the load is re-runnable, so this is safe here — never use it for
  normal queries).

Measured on 1,000,000 rows on this machine:

| Setting              | Throughput | Interval trend              | Total |
| -------------------- | ---------- | --------------------------- | ----- |
| `--keep-indexes`     | ~14.6k r/s | 16.5k → 12.9k r/s (decaying) | 68.4s |
| default (deferred)   | ~17.1k r/s | ~18–20k r/s (flat)           | 58.4s |

The gap widens with scale, since the decaying term is exactly what grows with
row count. A further step (not yet wired up) would be to insert in `complaint_id`
order — an external sort of the last CSV column — to make the table B-tree
append-only as well. On a machine with 20 GB RAM the full 18.3M-row load lands
around 4.5 GB on disk.


## Analysis

`npm run analyze` opens the built database **read-only** and writes a
point-in-time report to [`reports/cfpb-complaints-analysis.md`](reports/cfpb-complaints-analysis.md),
plus self-contained SVG charts and a monthly CSV in `reports/`. It runs a fixed
set of aggregate queries (volume over time, ranked companies/products/issues,
response mix, timeliness, geography, submission channels, data quality) and
mutates nothing.

Headline findings from the current snapshot (18,329,250 complaints,
2011-12-01 → 2026-10-10):

- The three national credit bureaus dominate: **TransUnion, Equifax and Experian =
  78.5%** of all complaints (top 10 = 84.1%, HHI ≈ 2,068).
- Credit-reporting products account for **~81%** of complaints; the single
  largest issue is *"Incorrect information on your report"* (45.5%).
- Volume has grown steeply — 2024 → 2025 roughly **doubled** (2.73M → 5.44M).
- Companies report a timely response in **99.4%** of complaints; the most common
  resolution is *Closed with explanation* (61.3%).

## Project layout

```
drizzle.config.ts            Drizzle Kit config (dialect: sqlite)
drizzle/                     generated SQL migrations + snapshots (commit these)
src/db/schema.ts             tables, indexes, relations, inferred types
src/db/client.ts             SQLite + Drizzle connection & pragmas
src/repositories/            base + per-table repository classes
src/ingest/                  CSV → normalised rows → DB
src/scripts/ingest.ts        CLI loader
src/scripts/analyze.ts       read-only analytics → reports/
src/scripts/smoke.ts         end-to-end smoke test
reports/                     generated analysis report + SVG charts (commit these)
```

## Scripts

| Script                | What it does                                    |
| --------------------- | ----------------------------------------------- |
| `npm run db:generate` | Diff schema → new SQL migration in `drizzle/`   |
| `npm run db:migrate`  | Apply migrations to `data/complaints.db`        |
| `npm run db:push`     | Push schema directly (no migration files)       |
| `npm run db:studio`   | Open Drizzle Studio                             |
| `npm run ingest`      | Stream + load the CSV                           |
| `npm run analyze`     | Generate the analysis report + SVG charts       |
| `npm run smoke`       | End-to-end assertions on an in-memory DB        |
| `npm run typecheck`   | `tsc --noEmit`                                  |

## Configuration

Set `DATABASE_URL` to override the database path (default
`./data/complaints.db`); both `drizzle.config.ts` and `createDatabase()` respect it.
