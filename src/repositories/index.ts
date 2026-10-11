import type { AppDatabase } from '../db/client.js';

import { BaseRepository } from './base.repository.js';
import { CompanyRepository } from './company.repository.js';
import { ComplaintRepository } from './complaint.repository.js';
import { IssueRepository } from './issue.repository.js';
import { ProductRepository } from './product.repository.js';
import { SubIssueRepository } from './sub-issue.repository.js';
import { SubProductRepository } from './sub-product.repository.js';

export * from './base.repository.js';
export * from './company.repository.js';
export * from './complaint.repository.js';
export * from './issue.repository.js';
export * from './product.repository.js';
export * from './sub-issue.repository.js';
export * from './sub-product.repository.js';

/** All repositories sharing one Drizzle connection. */
export interface Repositories {
  companies: CompanyRepository;
  products: ProductRepository;
  subProducts: SubProductRepository;
  issues: IssueRepository;
  subIssues: SubIssueRepository;
  complaints: ComplaintRepository;
}

/** Compose every repository against a single connection. */
export function createRepositories(db: AppDatabase): Repositories {
  return {
    companies: new CompanyRepository(db),
    products: new ProductRepository(db),
    subProducts: new SubProductRepository(db),
    issues: new IssueRepository(db),
    subIssues: new SubIssueRepository(db),
    complaints: new ComplaintRepository(db),
  };
}

export { BaseRepository };
