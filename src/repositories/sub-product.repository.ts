import { and, eq } from 'drizzle-orm';

import type { AppDatabase } from '../db/client.js';
import { subProducts, type SubProduct } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export class SubProductRepository extends BaseRepository<typeof subProducts> {
  constructor(db: AppDatabase) {
    super(db, subProducts, subProducts.id);
  }

  findByProductId(productId: number): SubProduct[] {
    return this.findMany({
      where: eq(subProducts.productId, productId),
      orderBy: subProducts.name,
    });
  }

  findByName(productId: number, name: string): SubProduct | undefined {
    return this.findOne(
      and(eq(subProducts.productId, productId), eq(subProducts.name, name)),
    );
  }

  /** Resolve a sub-product by (product, name), creating it on first sight. */
  findOrCreateByName(productId: number, name: string): SubProduct {
    const existing = this.findByName(productId, name);
    if (existing) return existing;

    const inserted = this.db
      .insert(subProducts)
      .values({ productId, name })
      .onConflictDoNothing({
        target: [subProducts.productId, subProducts.name],
      })
      .returning()
      .get();

    return inserted ?? this.findByName(productId, name)!;
  }
}
