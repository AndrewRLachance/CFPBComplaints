import { eq, like } from 'drizzle-orm';

import type { AppDatabase } from '../db/client.js';
import { issues, type Issue } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export class IssueRepository extends BaseRepository<typeof issues> {
  constructor(db: AppDatabase) {
    super(db, issues, issues.id);
  }

  findByName(name: string): Issue | undefined {
    return this.findOne(eq(issues.name, name));
  }

  /** Resolve an issue row by name, creating it on first sight (idempotent). */
  findOrCreateByName(name: string): Issue {
    const existing = this.findByName(name);
    if (existing) return existing;

    const inserted = this.db
      .insert(issues)
      .values({ name })
      .onConflictDoNothing({ target: issues.name })
      .returning()
      .get();

    return inserted ?? this.findByName(name)!;
  }

  searchByName(term: string, limit = 25): Issue[] {
    return this.findMany({
      where: like(issues.name, `%${term}%`),
      orderBy: issues.name,
      limit,
    });
  }
}
