import {
  count as countFn,
  eq,
  type InferInsertModel,
  type InferSelectModel,
  type SQL,
} from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { AppDatabase } from '../db/client.js';

export type OrderBy = AnySQLiteColumn | SQL;

export interface FindManyOptions {
  where?: SQL | undefined;
  orderBy?: OrderBy | OrderBy[];
  limit?: number;
  offset?: number;
}

/**
 * Small, synchronous repository base for the better-sqlite3 driver.
 *
 * Every concrete repository supplies its table plus the column that acts as the
 * primary key, so the base class can implement the common CRUD surface without
 * leaking `any` all over the codebase. The handful of casts below exist only
 * because Drizzle cannot correlate a *generic* table parameter with the
 * `InferSelectModel` of its concrete instantiation.
 */
export abstract class BaseRepository<
  TTable extends SQLiteTable,
  TSelect = InferSelectModel<TTable>,
  TInsert = InferInsertModel<TTable>,
> {
  protected constructor(
    protected readonly db: AppDatabase,
    protected readonly table: TTable,
    protected readonly idColumn: AnySQLiteColumn,
  ) {}

  /** Find a single row by primary key. */
  findById(id: number | string): TSelect | undefined {
    return this.db
      .select()
      .from(this.table)
      .where(eq(this.idColumn, id))
      .limit(1)
      .get() as TSelect | undefined;
  }

  /** Find the first row matching an arbitrary predicate. */
  findOne(where: SQL | undefined): TSelect | undefined {
    return this.db
      .select()
      .from(this.table)
      .where(where)
      .limit(1)
      .get() as TSelect | undefined;
  }

  /** Find a page of rows. */
  findMany(options: FindManyOptions = {}): TSelect[] {
    const { where, orderBy, limit, offset } = options;

    let query = this.db.select().from(this.table).$dynamic();
    if (where) query = query.where(where);
    if (orderBy) query = query.orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]));
    if (limit !== undefined) query = query.limit(limit);
    if (offset !== undefined) query = query.offset(offset);

    return query.all() as TSelect[];
  }

  /** Count rows, optionally constrained by a predicate. */
  count(where?: SQL): number {
    const row = this.db
      .select({ value: countFn() })
      .from(this.table)
      .where(where)
      .get();
    return row?.value ?? 0;
  }

  /** Does a row with this primary key exist? */
  exists(id: number | string): boolean {
    const row = this.db
      .select({ value: countFn() })
      .from(this.table)
      .where(eq(this.idColumn, id))
      .get();
    return (row?.value ?? 0) > 0;
  }

  /** Insert a single row and return it. */
  create(values: TInsert): TSelect {
    return this.db
      .insert(this.table)
      .values(values as never)
      .returning()
      .get() as TSelect;
  }

  /** Insert many rows in a single statement (caller chunking recommended). */
  createMany(values: TInsert[]): TSelect[] {
    if (values.length === 0) return [];
    return this.db
      .insert(this.table)
      .values(values as never)
      .returning()
      .all() as unknown as TSelect[];
  }

  /** Update a row by primary key and return the new state. */
  updateById(id: number | string, values: Partial<TInsert>): TSelect | undefined {
    return this.db
      .update(this.table)
      .set(values as never)
      .where(eq(this.idColumn, id))
      .returning()
      .get() as TSelect | undefined;
  }

  /** Delete a row by primary key. Returns the number of rows removed. */
  deleteById(id: number | string): number {
    const result = this.db.delete(this.table).where(eq(this.idColumn, id)).run();
    return result.changes;
  }

  /** Delete every row in the table. Returns the number of rows removed. */
  deleteAll(): number {
    return this.db.delete(this.table).run().changes;
  }

  /** Access the underlying table definition (for ad-hoc joins). */
  get definition(): TTable {
    return this.table;
  }
}
