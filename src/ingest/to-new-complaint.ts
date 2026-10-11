import type { NewComplaint } from '../db/schema.js';

import type { DimensionResolver } from './dimension-resolver.js';
import type { NormalizedRow } from './normalize.js';

/**
 * Convert a normalised CSV row into an insertable complaint, resolving (and
 * memoising) each dimension label to its foreign key via the resolver.
 */
export function toNewComplaint(row: NormalizedRow, resolver: DimensionResolver): NewComplaint {
  const productId = resolver.resolveProduct(row.product);
  const issueId = resolver.resolveIssue(row.issue);

  return {
    complaintId: row.complaintId,
    dateReceived: row.dateReceived,
    dateSentToCompany: row.dateSentToCompany,
    productId,
    subProductId: resolver.resolveSubProduct(productId, row.subProduct),
    issueId,
    subIssueId: resolver.resolveSubIssue(issueId, row.subIssue),
    companyId: resolver.resolveCompany(row.company),
    companyPublicResponse: row.companyPublicResponse,
    companyResponse: row.companyResponse,
    timelyResponse: row.timelyResponse,
    state: row.state,
    zipCode: row.zipCode,
    tags: row.tags,
    submittedVia: row.submittedVia,
  };
}
