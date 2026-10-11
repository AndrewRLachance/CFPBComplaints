import { eq, like } from 'drizzle-orm';

import type { AppDatabase } from '../db/client.js';
import { companies, type Company } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export class CompanyRepository extends BaseRepository<typeof companies> {
  constructor(db: AppDatabase) {
    super(db, companies, companies.id);
  }

  findByName(name: string): Company | undefined {
    return this.findOne(eq(companies.name, name));
  }

  /** Resolve a company row by name, creating it on first sight (idempotent). */
  findOrCreateByName(name: string): Company {
    const existing = this.findByName(name);
    if (existing) return existing;

    const inserted = this.db
      .insert(companies)
      .values({ name })
      .onConflictDoNothing({ target: companies.name })
      .returning()
      .get();

    // Another writer may have won the race; fall back to a read.
    return inserted ?? this.findByName(name)!;
  }

  /** Case-insensitive-ish substring search for admin/autocomplete UIs. */
  searchByName(term: string, limit = 25): Company[] {
    return this.findMany({
      where: like(companies.name, `%${term}%`),
      orderBy: companies.name,
      limit,
    });
  }
}
