import type { Repositories } from '../repositories/index.js';

const SEP = '\u0000';

/**
 * Caches the label -> id mapping for every dimension table and lazily creates
 * rows on first sight. Without this cache, ingesting ~18.3M facts would issue a
 * lookup (and occasionally an insert) per row; with it we touch the dimension
 * tables at most once per distinct label.
 */
export class DimensionResolver {
  private readonly productIds = new Map<string, number>();
  private readonly companyIds = new Map<string, number>();
  private readonly issueIds = new Map<string, number>();
  private readonly subProductIds = new Map<string, number>();
  private readonly subIssueIds = new Map<string, number>();

  constructor(private readonly repos: Repositories) {
    this.preload();
  }

  /** Warm the caches from any rows already present (idempotent re-runs). */
  private preload(): void {
    for (const row of this.repos.products.findMany()) {
      this.productIds.set(row.name, row.id);
    }
    for (const row of this.repos.companies.findMany()) {
      this.companyIds.set(row.name, row.id);
    }
    for (const row of this.repos.issues.findMany()) {
      this.issueIds.set(row.name, row.id);
    }
    for (const row of this.repos.subProducts.findMany()) {
      this.subProductIds.set(`${row.productId}${SEP}${row.name}`, row.id);
    }
    for (const row of this.repos.subIssues.findMany()) {
      this.subIssueIds.set(`${row.issueId}${SEP}${row.name}`, row.id);
    }
  }

  resolveProduct(name: string | null): number | null {
    if (name === null) return null;
    const cached = this.productIds.get(name);
    if (cached !== undefined) return cached;
    const id = this.repos.products.findOrCreateByName(name).id;
    this.productIds.set(name, id);
    return id;
  }

  resolveCompany(name: string | null): number | null {
    if (name === null) return null;
    const cached = this.companyIds.get(name);
    if (cached !== undefined) return cached;
    const id = this.repos.companies.findOrCreateByName(name).id;
    this.companyIds.set(name, id);
    return id;
  }

  resolveIssue(name: string | null): number | null {
    if (name === null) return null;
    const cached = this.issueIds.get(name);
    if (cached !== undefined) return cached;
    const id = this.repos.issues.findOrCreateByName(name).id;
    this.issueIds.set(name, id);
    return id;
  }

  resolveSubProduct(productId: number | null, name: string | null): number | null {
    if (productId === null || name === null) return null;
    const key = `${productId}${SEP}${name}`;
    const cached = this.subProductIds.get(key);
    if (cached !== undefined) return cached;
    const id = this.repos.subProducts.findOrCreateByName(productId, name).id;
    this.subProductIds.set(key, id);
    return id;
  }

  resolveSubIssue(issueId: number | null, name: string | null): number | null {
    if (issueId === null || name === null) return null;
    const key = `${issueId}${SEP}${name}`;
    const cached = this.subIssueIds.get(key);
    if (cached !== undefined) return cached;
    const id = this.repos.subIssues.findOrCreateByName(issueId, name).id;
    this.subIssueIds.set(key, id);
    return id;
  }

  stats() {
    return {
      products: this.productIds.size,
      companies: this.companyIds.size,
      issues: this.issueIds.size,
      subProducts: this.subProductIds.size,
      subIssues: this.subIssueIds.size,
    };
  }
}
