import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { createDatabase } from '../db/client.js';
import { DimensionResolver } from '../ingest/dimension-resolver.js';
import { normalizeRow, type RawRecord } from '../ingest/normalize.js';
import { toNewComplaint } from '../ingest/to-new-complaint.js';
import { createRepositories } from '../repositories/index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/** A few real rows copied from the head of complaints.csv. */
const SAMPLE: RawRecord[] = [
  {
    'Date received': '2024-08-24',
    Product: 'Credit reporting or other personal consumer reports',
    'Sub-product': 'Credit reporting',
    Issue: 'Improper use of your report',
    'Sub-issue': 'Reporting company used your report improperly',
    'Company public response': '',
    Company: 'EQUIFAX, INC.',
    State: 'IL',
    'ZIP code': '60617',
    Tags: '',
    'Submitted via': 'Web',
    'Date sent to company': '2024-08-24',
    'Company response to consumer': 'Closed with non-monetary relief',
    'Timely response?': 'Yes',
    'Complaint ID': '9898870',
  },
  {
    'Date received': '2024-08-24',
    Product: 'Credit reporting or other personal consumer reports',
    'Sub-product': 'Credit reporting',
    Issue: 'Improper use of your report',
    'Sub-issue': 'Reporting company used your report improperly',
    'Company public response': 'Company has responded to the consumer and the CFPB and chooses not to provide a public response',
    Company: 'Experian Information Solutions Inc.',
    State: 'IL',
    'ZIP code': '60617',
    Tags: '',
    'Submitted via': 'Web',
    'Date sent to company': '2024-08-24',
    'Company response to consumer': 'Closed with explanation',
    'Timely response?': 'Yes',
    'Complaint ID': '9898711',
  },
  {
    'Date received': '2024-11-15',
    Product: 'Credit reporting or other personal consumer reports',
    'Sub-product': 'Credit reporting',
    Issue: 'Incorrect information on your report',
    'Sub-issue': 'Information belongs to someone else',
    'Company public response': '',
    Company: 'EQUIFAX, INC.',
    State: 'IL',
    'ZIP code': '60617',
    Tags: 'Servicemember',
    'Submitted via': 'Web',
    'Date sent to company': '2024-11-15',
    'Company response to consumer': 'Closed with explanation',
    'Timely response?': 'No',
    'Complaint ID': '10807557',
  },
];

function main(): void {
  const client = createDatabase({ path: ':memory:' });
  migrate(client.db, { migrationsFolder: './drizzle' });

  const repos = createRepositories(client.db);
  const resolver = new DimensionResolver(repos);

  // --- insert ------------------------------------------------------------
  for (const raw of SAMPLE) {
    const row = normalizeRow(raw);
    assert(row !== null, `row ${raw['Complaint ID']} should normalise`);
    repos.complaints.create(toNewComplaint(row, resolver));
  }

  // --- reads -------------------------------------------------------------
  assert(repos.complaints.count() === 3, 'expected 3 complaints');
  assert(repos.companies.count() === 2, 'expected 2 distinct companies');
  assert(repos.products.count() === 1, 'expected 1 distinct product');
  assert(repos.issues.count() === 2, 'expected 2 distinct issues');

  const equifax = repos.companies.findByName('EQUIFAX, INC.');
  assert(equifax !== undefined, 'EQUIFAX should exist');
  assert(equifax.id === resolver.resolveCompany('EQUIFAX, INC.'), 'company cache should be stable');

  // idempotent dimension resolution
  const productsBefore = repos.products.count();
  repos.products.findOrCreateByName('Credit reporting or other personal consumer reports');
  assert(repos.products.count() === productsBefore, 'findOrCreateByName must not duplicate');

  // --- eager-loaded relations -------------------------------------------
  const details = repos.complaints.getWithDetails(9898870);
  assert(details !== undefined, 'getWithDetails should find 9898870');
  assert(details.company?.name === 'EQUIFAX, INC.', 'joined company name');
  assert(details.issue?.name === 'Improper use of your report', 'joined issue name');
  assert(details.subProduct?.name === 'Credit reporting', 'joined sub-product name');
  assert(details.timelyResponse === true, 'timely_response should be boolean true');

  // --- filters -----------------------------------------------------------
  assert(repos.complaints.search({ state: 'IL' }).length === 3, 'state filter');
  assert(repos.complaints.search({ dateFrom: '2024-11-01' }).length === 1, 'date range filter');
  assert(
    repos.complaints.countMatching({ companyResponse: 'Closed with explanation' }) === 2,
    'company response filter',
  );
  assert(
    repos.complaints.findByCompanyId(equifax.id).length === 2,
    'findByCompanyId',
  );
  assert(repos.complaints.search({ timelyResponse: false }).length === 1, 'timely=false filter');

  // --- aggregates --------------------------------------------------------
  const byState = repos.complaints.countByState();
  assert(byState.length === 1 && byState[0]?.value === 'IL' && byState[0]?.total === 3, 'countByState');
  const byResponse = repos.complaints.countByResponse();
  assert(byResponse[0]?.value === 'Closed with explanation', 'countByResponse');

  // --- bulk + idempotency ------------------------------------------------
  repos.complaints.createManyChunked(
    SAMPLE.map((raw) => toNewComplaint(normalizeRow(raw)!, resolver)),
    { onConflictDoNothing: true, chunkSize: 2 },
  );
  assert(repos.complaints.count() === 3, 'onConflictDoNothing keeps count stable');

  client.close();
  console.log('smoke: all assertions passed ✓');
}

main();
