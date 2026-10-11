import {
  and,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import type { AppDatabase } from '../db/client.js';
import {
  complaints,
  type Complaint,
  type NewComplaint,
} from '../db/schema.js';
import { BaseRepository, type FindManyOptions } from './base.repository.js';

/** Declarative filter set backing the list/search helpers. */
export interface ComplaintFilters {
  companyId?: number;
  productId?: number;
  subProductId?: number;
  issueId?: number;
  state?: string;
  /** Inclusive lower bound on `date_received` (YYYY-MM-DD). */
  dateFrom?: string;
  /** Inclusive upper bound on `date_received` (YYYY-MM-DD). */
  dateTo?: string;
  timelyResponse?: boolean;
  companyResponse?: string;
}

export interface BulkInsertOptions {
  /** Rows per INSERT statement. Keep well under SQLite's variable limit (~32k). */
  chunkSize?: number;
  /** Treat existing primary keys as no-ops instead of erroring (idempotent ingest). */
  onConflictDoNothing?: boolean;
}

export interface GroupCount {
  value: string | number | null;
  total: number;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export class ComplaintRepository extends BaseRepository<typeof complaints> {
  constructor(db: AppDatabase) {
    super(db, complaints, complaints.complaintId);
  }

  findByComplaintId(complaintId: number): Complaint | undefined {
    return super.findById(complaintId);
  }

  /** Build a composable WHERE clause from a filter object. */
  buildWhere(filters: ComplaintFilters = {}): SQL | undefined {
    const predicates: SQL[] = [];

    if (filters.companyId !== undefined) {
      predicates.push(eq(complaints.companyId, filters.companyId));
    }
    if (filters.productId !== undefined) {
      predicates.push(eq(complaints.productId, filters.productId));
    }
    if (filters.subProductId !== undefined) {
      predicates.push(eq(complaints.subProductId, filters.subProductId));
    }
    if (filters.issueId !== undefined) {
      predicates.push(eq(complaints.issueId, filters.issueId));
    }
    if (filters.state !== undefined) {
      predicates.push(eq(complaints.state, filters.state));
    }
    if (filters.dateFrom !== undefined) {
      predicates.push(gte(complaints.dateReceived, filters.dateFrom));
    }
    if (filters.dateTo !== undefined) {
      predicates.push(lte(complaints.dateReceived, filters.dateTo));
    }
    if (filters.timelyResponse !== undefined) {
      predicates.push(eq(complaints.timelyResponse, filters.timelyResponse));
    }
    if (filters.companyResponse !== undefined) {
      predicates.push(eq(complaints.companyResponse, filters.companyResponse));
    }

    return predicates.length ? and(...predicates) : undefined;
  }

  /** Paginated complaint search. */
  search(filters: ComplaintFilters = {}, page: FindManyOptions = {}): Complaint[] {
    return this.findMany({
      ...page,
      where: and(this.buildWhere(filters), page.where) ?? this.buildWhere(filters),
    });
  }

  /** Total rows matching a filter set (ignores pagination). */
  countMatching(filters: ComplaintFilters = {}): number {
    return this.count(this.buildWhere(filters));
  }

  findByCompanyId(
    companyId: number,
    page: Omit<FindManyOptions, 'where'> = {},
  ): Complaint[] {
    return this.findMany({ ...page, where: eq(complaints.companyId, companyId) });
  }

  findByProductId(productId: number, page: Omit<FindManyOptions, 'where'> = {}): Complaint[] {
    return this.findMany({ ...page, where: eq(complaints.productId, productId) });
  }

  /** Inclusive date-received range (YYYY-MM-DD strings sort lexicographically). */
  findByDateRange(
    from: string,
    to: string,
    page: Omit<FindManyOptions, 'where'> = {},
  ): Complaint[] {
    return this.findMany({
      ...page,
      where: and(gte(complaints.dateReceived, from), lte(complaints.dateReceived, to)),
    });
  }

  /** Load a complaint with every related dimension eagerly joined. */
  getWithDetails(complaintId: number) {
    return this.db.query.complaints
      .findFirst({
        where: eq(complaints.complaintId, complaintId),
        with: {
          company: true,
          product: true,
          subProduct: true,
          issue: true,
          subIssue: true,
        },
      })
      .sync();
  }

  /**
   * Bulk insert in a single transaction, chunked to respect SQLite's bound
   * parameter limit. Returns the number of rows actually written.
   */
  createManyChunked(rows: NewComplaint[], options: BulkInsertOptions = {}): number {
    const { chunkSize = 500, onConflictDoNothing = false } = options;
    if (rows.length === 0) return 0;

    const chunks = chunkArray(rows, chunkSize);
    let written = 0;

    this.db.transaction((tx) => {
      for (const chunk of chunks) {
        let statement = tx.insert(complaints).values(chunk);
        if (onConflictDoNothing) {
          statement = statement.onConflictDoNothing();
        }
        written += statement.run().changes;
      }
    });

    return written;
  }

  /* ----------------------------- aggregates ------------------------------ */

  /** Rank a single column by row count, most frequent first. */
  private groupCount(column: SQLiteColumn, limit?: number): GroupCount[] {
    let query = this.db
      .select({ value: column, total: count() })
      .from(complaints)
      .groupBy(column)
      .orderBy(desc(count()))
      .$dynamic();

    if (limit !== undefined) query = query.limit(limit);

    return query.all() as GroupCount[];
  }

  countByState(limit?: number): GroupCount[] {
    return this.groupCount(complaints.state, limit);
  }

  countByProduct(limit?: number): GroupCount[] {
    return this.groupCount(complaints.productId, limit);
  }

  countByCompany(limit?: number): GroupCount[] {
    return this.groupCount(complaints.companyId, limit);
  }

  countByIssue(limit?: number): GroupCount[] {
    return this.groupCount(complaints.issueId, limit);
  }

  countByResponse(limit?: number): GroupCount[] {
    return this.groupCount(complaints.companyResponse, limit);
  }

  countByMonth(): GroupCount[] {
    return this.db
      .select({
        value: sql<string>`substr(${complaints.dateReceived}, 1, 7)`,
        total: count(),
      })
      .from(complaints)
      .groupBy(sql`substr(${complaints.dateReceived}, 1, 7)`)
      .orderBy(sql`substr(${complaints.dateReceived}, 1, 7)`)
      .all() as GroupCount[];
  }
}
