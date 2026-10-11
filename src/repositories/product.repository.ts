import { eq, like } from 'drizzle-orm';

import type { AppDatabase } from '../db/client.js';
import { products, type Product } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export class ProductRepository extends BaseRepository<typeof products> {
  constructor(db: AppDatabase) {
    super(db, products, products.id);
  }

  findByName(name: string): Product | undefined {
    return this.findOne(eq(products.name, name));
  }

  /** Resolve a product row by name, creating it on first sight (idempotent). */
  findOrCreateByName(name: string): Product {
    const existing = this.findByName(name);
    if (existing) return existing;

    const inserted = this.db
      .insert(products)
      .values({ name })
      .onConflictDoNothing({ target: products.name })
      .returning()
      .get();

    return inserted ?? this.findByName(name)!;
  }

  searchByName(term: string, limit = 25): Product[] {
    return this.findMany({
      where: like(products.name, `%${term}%`),
      orderBy: products.name,
      limit,
    });
  }
}
