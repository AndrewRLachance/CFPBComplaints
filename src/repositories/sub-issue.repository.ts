import { and, eq } from 'drizzle-orm';

import type { AppDatabase } from '../db/client.js';
import { subIssues, type SubIssue } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export class SubIssueRepository extends BaseRepository<typeof subIssues> {
  constructor(db: AppDatabase) {
    super(db, subIssues, subIssues.id);
  }

  findByIssueId(issueId: number): SubIssue[] {
    return this.findMany({
      where: eq(subIssues.issueId, issueId),
      orderBy: subIssues.name,
    });
  }

  findByName(issueId: number, name: string): SubIssue | undefined {
    return this.findOne(
      and(eq(subIssues.issueId, issueId), eq(subIssues.name, name)),
    );
  }

  /** Resolve a sub-issue by (issue, name), creating it on first sight. */
  findOrCreateByName(issueId: number, name: string): SubIssue {
    const existing = this.findByName(issueId, name);
    if (existing) return existing;

    const inserted = this.db
      .insert(subIssues)
      .values({ issueId, name })
      .onConflictDoNothing({
        target: [subIssues.issueId, subIssues.name],
      })
      .returning()
      .get();

    return inserted ?? this.findByName(issueId, name)!;
  }
}
