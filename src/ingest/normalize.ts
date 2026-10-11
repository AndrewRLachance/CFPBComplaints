/**
 * Pure (side-effect free) transforms that turn a raw CSV record from
 * `complaints-data/complaints.csv` into the normalised shape used by the
 * repositories. Kept free of database access so it is trivial to unit test.
 */

export type RawRecord = Record<string, string | undefined>;

export interface NormalizedRow {
  complaintId: number;
  dateReceived: string;
  dateSentToCompany: string | null;

  product: string | null;
  subProduct: string | null;
  issue: string | null;
  subIssue: string | null;
  company: string | null;

  companyPublicResponse: string | null;
  companyResponse: string | null;
  timelyResponse: boolean | null;

  state: string | null;
  zipCode: string | null;
  tags: string | null;
  submittedVia: string | null;
}

/** Trim a CSV cell and collapse empty strings to `null`. */
export function clean(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Parse the CFPB "Yes"/"No" columns into a boolean (null when absent). */
export function parseYesNo(value: string | undefined | null): boolean | null {
  const cleaned = clean(value)?.toLowerCase();
  if (cleaned === 'yes') return true;
  if (cleaned === 'no') return false;
  return null;
}

/**
 * Map one CSV record to a `NormalizedRow`.
 * Returns `null` for records missing a usable primary key or received date.
 */
export function normalizeRow(record: RawRecord): NormalizedRow | null {
  const complaintId = Number(clean(record['Complaint ID']));
  if (!Number.isInteger(complaintId) || complaintId <= 0) return null;

  const dateReceived = clean(record['Date received']);
  if (dateReceived === null) return null;

  return {
    complaintId,
    dateReceived,
    dateSentToCompany: clean(record['Date sent to company']),

    product: clean(record['Product']),
    subProduct: clean(record['Sub-product']),
    issue: clean(record['Issue']),
    subIssue: clean(record['Sub-issue']),
    company: clean(record['Company']),

    companyPublicResponse: clean(record['Company public response']),
    companyResponse: clean(record['Company response to consumer']),
    timelyResponse: parseYesNo(record['Timely response?']),

    state: clean(record['State']),
    zipCode: clean(record['ZIP code']),
    tags: clean(record['Tags']),
    submittedVia: clean(record['Submitted via']),
  };
}
