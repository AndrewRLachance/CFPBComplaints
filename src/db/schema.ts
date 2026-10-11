import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

/**
 * Schema for the CFPB Consumer Complaint Database (`complaints-data/complaints.csv`).
 *
 * The raw CSV is intentionally normalised into a small star-ish shape:
 *
 *   products ──< sub_products ──┐
 *   issues   ──< sub_issues   ──┤
 *                               ├──< complaints >── companies
 *                               │
 *
 * Dimension rows (product / sub-product / issue / sub-issue / company) are
 * de-duplicated via a unique key and resolved once per distinct label, so the
 * fact table (`complaints`, ~18.3M rows) only stores integers + free text.
 */

/* -------------------------------------------------------------------------- */
/*                                   Dimensions                               */
/* -------------------------------------------------------------------------- */

export const companies = sqliteTable(
  'companies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [unique('companies_name_unique').on(t.name)],
);

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [unique('products_name_unique').on(t.name)],
);

export const subProducts = sqliteTable(
  'sub_products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    unique('sub_products_product_name_unique').on(t.productId, t.name),
    index('sub_products_product_id_idx').on(t.productId),
  ],
);

export const issues = sqliteTable(
  'issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [unique('issues_name_unique').on(t.name)],
);

export const subIssues = sqliteTable(
  'sub_issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    unique('sub_issues_issue_name_unique').on(t.issueId, t.name),
    index('sub_issues_issue_id_idx').on(t.issueId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                  Fact table                                */
/* -------------------------------------------------------------------------- */

export const complaints = sqliteTable(
  'complaints',
  {
    /** Natural key taken straight from the CSV "Complaint ID" column. */
    complaintId: integer('complaint_id').primaryKey(),

    /** CSV "Date received" (YYYY-MM-DD). */
    dateReceived: text('date_received').notNull(),
    /** CSV "Date sent to company" (YYYY-MM-DD). */
    dateSentToCompany: text('date_sent_to_company'),

    productId: integer('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    subProductId: integer('sub_product_id').references(() => subProducts.id, {
      onDelete: 'set null',
    }),
    issueId: integer('issue_id').references(() => issues.id, {
      onDelete: 'set null',
    }),
    subIssueId: integer('sub_issue_id').references(() => subIssues.id, {
      onDelete: 'set null',
    }),
    companyId: integer('company_id').references(() => companies.id, {
      onDelete: 'set null',
    }),

    /** CSV "Company public response". */
    companyPublicResponse: text('company_public_response'),
    /** CSV "Company response to consumer". */
    companyResponse: text('company_response'),
    /** CSV "Timely response?" (Yes/No) stored as a real boolean. */
    timelyResponse: integer('timely_response', { mode: 'boolean' }),

    state: text('state'),
    /** Stored as TEXT to preserve leading zeros (e.g. "02134"). */
    zipCode: text('zip_code'),
    /** CSV "Tags" (semicolon separated). */
    tags: text('tags'),
    /** CSV "Submitted via". */
    submittedVia: text('submitted_via'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index('complaints_date_received_idx').on(t.dateReceived),
    index('complaints_company_id_idx').on(t.companyId),
    index('complaints_product_id_idx').on(t.productId),
    index('complaints_sub_product_id_idx').on(t.subProductId),
    index('complaints_issue_id_idx').on(t.issueId),
    index('complaints_sub_issue_id_idx').on(t.subIssueId),
    index('complaints_state_idx').on(t.state),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                  Relations                                 */
/* -------------------------------------------------------------------------- */

export const companiesRelations = relations(companies, ({ many }) => ({
  complaints: many(complaints),
}));

export const productsRelations = relations(products, ({ many }) => ({
  subProducts: many(subProducts),
  complaints: many(complaints),
}));

export const subProductsRelations = relations(subProducts, ({ one, many }) => ({
  product: one(products, {
    fields: [subProducts.productId],
    references: [products.id],
  }),
  complaints: many(complaints),
}));

export const issuesRelations = relations(issues, ({ many }) => ({
  subIssues: many(subIssues),
  complaints: many(complaints),
}));

export const subIssuesRelations = relations(subIssues, ({ one, many }) => ({
  issue: one(issues, {
    fields: [subIssues.issueId],
    references: [issues.id],
  }),
  complaints: many(complaints),
}));

export const complaintsRelations = relations(complaints, ({ one }) => ({
  company: one(companies, {
    fields: [complaints.companyId],
    references: [companies.id],
  }),
  product: one(products, {
    fields: [complaints.productId],
    references: [products.id],
  }),
  subProduct: one(subProducts, {
    fields: [complaints.subProductId],
    references: [subProducts.id],
  }),
  issue: one(issues, {
    fields: [complaints.issueId],
    references: [issues.id],
  }),
  subIssue: one(subIssues, {
    fields: [complaints.subIssueId],
    references: [subIssues.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/*                              Inferred TS types                             */
/* -------------------------------------------------------------------------- */

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export type SubProduct = typeof subProducts.$inferSelect;
export type NewSubProduct = typeof subProducts.$inferInsert;

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;

export type SubIssue = typeof subIssues.$inferSelect;
export type NewSubIssue = typeof subIssues.$inferInsert;

export type Complaint = typeof complaints.$inferSelect;
export type NewComplaint = typeof complaints.$inferInsert;

/** Tables keyed by name, used by the generic base repository. */
export const schema = {
  companies,
  products,
  subProducts,
  issues,
  subIssues,
  complaints,
} as const;

export type DatabaseSchema = typeof schema;
