/**
 * Read-only analytics over the loaded CFPB complaints database.
 *
 * Opens `data/complaints.db` read-only, runs a fixed set of aggregate queries,
 * and writes a Markdown report plus a few self-contained SVG charts under
 * `reports/`. Nothing here mutates the database.
 *
 * Usage:
 *   tsx src/scripts/analyze.ts [--db <path>] [--out <report.md>]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { createDatabase, DEFAULT_DATABASE_PATH } from '../db/client.js';

/* -------------------------------------------------------------------------- */
/*                                    args                                    */
/* -------------------------------------------------------------------------- */

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dbPath = getArg('--db') ?? DEFAULT_DATABASE_PATH;
const outFile = resolve(getArg('--out') ?? 'reports/cfpb-complaints-analysis.md');
const outDir = dirname(outFile);
const chartsDir = join(outDir, 'charts');

/* -------------------------------------------------------------------------- */
/*                                  connection                                */
/* -------------------------------------------------------------------------- */

const client = createDatabase({
  path: dbPath,
  readonly: true,
  // Analytics scan the whole fact table; give SQLite a big page cache + mmap.
  cacheSizeKb: -512 * 1024,
  mmapSizeBytes: 8 * 1024 * 1024 * 1024,
});
const { sqlite } = client;

function rows<T>(sql: string): T[] {
  return sqlite.prepare(sql).all() as T[];
}

function row<T>(sql: string): T {
  return sqlite.prepare(sql).get() as T;
}

function timed<T>(label: string, fn: () => T): T {
  const start = Date.now();
  const result = fn();
  console.log(`  queried ${label} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  return result;
}

/* -------------------------------------------------------------------------- */
/*                              formatting helpers                            */
/* -------------------------------------------------------------------------- */

function num(value: number): string {
  return value.toLocaleString('en-US');
}

function pct(value: number, total: number, digits = 1): string {
  if (total === 0) return '—';
  return `${((value / total) * 100).toFixed(digits)}%`;
}

function mdTable(headers: string[], alignRight: boolean[], body: string[][]): string {
  const rule = headers.map((_, i) => (alignRight[i] ? '---:' : '---'));
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${rule.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*                                  SVG charts                                */
/* -------------------------------------------------------------------------- */

interface Point {
  label: string;
  value: number;
}

/** Vertical axis labels at "nice" intervals, plus the series max. */
function axisTicks(max: number, count = 4): number[] {
  const step = max / count;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i += 1) ticks.push(Math.round(step * i));
  return ticks;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return String(value);
}

/** Line + area chart for a dense monthly series. */
function lineChartSvg(series: Point[]): string {
  const width = 960;
  const height = 320;
  const padL = 64;
  const padR = 20;
  const padT = 20;
  const padB = 44;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const max = Math.max(1, ...series.map((p) => p.value));
  const x = (i: number): number =>
    padL + (series.length <= 1 ? 0 : (i / (series.length - 1)) * innerW);
  const y = (v: number): number => padT + innerH - (v / max) * innerH;

  const line = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  const area =
    `${line} L${x(series.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} ` +
    `L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const grid = axisTicks(max)
    .map((tick) => {
      const yy = y(tick);
      return (
        `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${width - padR}" y2="${yy.toFixed(1)}" ` +
        `stroke="#e6e6e6" stroke-width="1" />` +
        `<text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" ` +
        `font-family="sans-serif" font-size="11" fill="#666">${compact(tick)}</text>`
      );
    })
    .join('\n  ');

  const xLabels = series
    .map((p, i) => {
      const isJan = p.label.endsWith('-01');
      const isEdge = i === 0 || i === series.length - 1;
      if (!isJan && !isEdge) return '';
      const anchor = i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle';
      return (
        `<text x="${x(i).toFixed(1)}" y="${height - 14}" text-anchor="${anchor}" ` +
        `font-family="sans-serif" font-size="11" fill="#666">${p.label.slice(0, 4)}</text>`
      );
    })
    .filter(Boolean)
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  ${grid}
  <path d="${area}" fill="rgba(37,99,235,0.12)" />
  <path d="${line}" fill="none" stroke="#2563eb" stroke-width="2" />
  <line x1="${padL}" y1="${padT + innerH}" x2="${width - padR}" y2="${padT + innerH}" stroke="#999" stroke-width="1" />
  ${xLabels}
</svg>`;
}

/** Horizontal bar chart for a ranked list (already sorted descending). */
function hBarChartSvg(items: Point[], color = '#2563eb'): string {
  const rowH = 26;
  const padL = 240;
  const padR = 80;
  const padT = 12;
  const width = 960;
  const height = padT * 2 + items.length * rowH;
  const innerW = width - padL - padR;
  const max = Math.max(1, ...items.map((i) => i.value));

  const bars = items
    .map((item, i) => {
      const yy = padT + i * rowH;
      const barW = Math.max(1, (item.value / max) * innerW);
      const label = item.label.length > 34 ? `${item.label.slice(0, 33)}…` : item.label;
      return (
        `<text x="${padL - 10}" y="${yy + rowH / 2 + 4}" text-anchor="end" ` +
        `font-family="sans-serif" font-size="12" fill="#333">${escapeXml(label)}</text>` +
        `<rect x="${padL}" y="${yy + 4}" width="${barW.toFixed(1)}" height="${rowH - 8}" rx="2" fill="${color}" />` +
        `<text x="${(padL + barW + 6).toFixed(1)}" y="${yy + rowH / 2 + 4}" ` +
        `font-family="sans-serif" font-size="11" fill="#666">${num(item.value)}</text>`
      );
    })
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  ${bars}
</svg>`;
}

/** Vertical bar chart for the yearly series. */
function vBarChartSvg(items: Point[], color = '#2563eb'): string {
  const width = 720;
  const height = 320;
  const padL = 64;
  const padR = 20;
  const padT = 20;
  const padB = 40;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(1, ...items.map((i) => i.value));
  const slot = innerW / items.length;
  const barW = slot * 0.6;

  const grid = axisTicks(max)
    .map((tick) => {
      const yy = padT + innerH - (tick / max) * innerH;
      return (
        `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${width - padR}" y2="${yy.toFixed(1)}" stroke="#e6e6e6" />` +
        `<text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="11" fill="#666">${compact(tick)}</text>`
      );
    })
    .join('\n  ');

  const bars = items
    .map((item, i) => {
      const barH = (item.value / max) * innerH;
      const xx = padL + slot * i + (slot - barW) / 2;
      const yy = padT + innerH - barH;
      return (
        `<rect x="${xx.toFixed(1)}" y="${yy.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2" />` +
        `<text x="${(xx + barW / 2).toFixed(1)}" y="${height - 14}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#666">${item.label}</text>`
      );
    })
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  ${grid}
  ${bars}
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/*                                   queries                                  */
/* -------------------------------------------------------------------------- */

interface Overview {
  total: number;
  minDate: string;
  maxDate: string;
  companies: number;
  products: number;
  issues: number;
  states: number;
}

console.log(`Analysing ${dbPath} (read-only)`);

const overview = timed('overview', () =>
  row<Overview>(
    `SELECT COUNT(*) AS total,
            MIN(date_received) AS minDate,
            MAX(date_received) AS maxDate,
            (SELECT COUNT(*) FROM companies) AS companies,
            (SELECT COUNT(*) FROM products) AS products,
            (SELECT COUNT(*) FROM issues) AS issues,
            (SELECT COUNT(DISTINCT state) FROM complaints WHERE state IS NOT NULL) AS states
     FROM complaints`,
  ),
);

const monthly = timed('monthly', () =>
  rows<{ m: string; n: number }>(
    `SELECT substr(date_received, 1, 7) AS m, COUNT(*) AS n
     FROM complaints GROUP BY m ORDER BY m`,
  ),
);

const yearly = new Map<string, number>();
for (const { m, n } of monthly) {
  const year = m.slice(0, 4);
  yearly.set(year, (yearly.get(year) ?? 0) + n);
}
const yearlySeries: Point[] = [...yearly.entries()].map(([label, value]) => ({ label, value }));

// All companies with counts — used for the ranked table and concentration maths.
const companyCounts = timed('companies', () =>
  rows<{ name: string; total: number }>(
    `SELECT c.name AS name, COUNT(*) AS total
     FROM complaints x JOIN companies c ON c.id = x.company_id
     GROUP BY x.company_id ORDER BY total DESC`,
  ),
);

const productCounts = timed('products', () =>
  rows<{ name: string; total: number }>(
    `SELECT p.name AS name, COUNT(*) AS total
     FROM complaints x JOIN products p ON p.id = x.product_id
     GROUP BY x.product_id ORDER BY total DESC`,
  ),
);

const subProductCounts = timed('sub-products', () =>
  rows<{ name: string; total: number }>(
    // Group by name (not id): the same label can exist under two products, and
    // a global ranking by label is what a reader expects here.
    `SELECT sp.name AS name, COUNT(*) AS total
     FROM complaints x JOIN sub_products sp ON sp.id = x.sub_product_id
     GROUP BY sp.name ORDER BY total DESC LIMIT 15`,
  ),
);

const issueCounts = timed('issues', () =>
  rows<{ name: string; total: number }>(
    `SELECT i.name AS name, COUNT(*) AS total
     FROM complaints x JOIN issues i ON i.id = x.issue_id
     GROUP BY x.issue_id ORDER BY total DESC LIMIT 20`,
  ),
);

const responseCounts = timed('responses', () =>
  rows<{ value: string | null; total: number }>(
    `SELECT company_response AS value, COUNT(*) AS total
     FROM complaints GROUP BY company_response ORDER BY total DESC`,
  ),
);

const timelyCounts = timed('timely', () =>
  rows<{ value: number | null; total: number }>(
    `SELECT timely_response AS value, COUNT(*) AS total
     FROM complaints GROUP BY timely_response ORDER BY total DESC`,
  ),
);

const stateCounts = timed('states', () =>
  rows<{ value: string | null; total: number }>(
    `SELECT state AS value, COUNT(*) AS total
     FROM complaints GROUP BY state ORDER BY total DESC LIMIT 20`,
  ),
);

const submittedVia = timed('submitted-via', () =>
  rows<{ value: string | null; total: number }>(
    `SELECT submitted_via AS value, COUNT(*) AS total
     FROM complaints GROUP BY submitted_via ORDER BY total DESC`,
  ),
);

const tagCounts = timed('tags', () =>
  rows<{ value: string | null; total: number }>(
    `SELECT tags AS value, COUNT(*) AS total
     FROM complaints GROUP BY tags ORDER BY total DESC LIMIT 12`,
  ),
);

const publicResponses = timed('public-responses', () =>
  rows<{ value: string | null; total: number }>(
    `SELECT company_public_response AS value, COUNT(*) AS total
     FROM complaints GROUP BY company_public_response ORDER BY total DESC`,
  ),
);

const untimelyByCompany = timed('untimely-by-company', () =>
  rows<{ name: string; total: number; untimely: number }>(
    `SELECT c.name AS name,
            COUNT(*) AS total,
            SUM(CASE WHEN x.timely_response = 0 THEN 1 ELSE 0 END) AS untimely
     FROM complaints x JOIN companies c ON c.id = x.company_id
     GROUP BY x.company_id
     HAVING COUNT(*) >= 10000
     ORDER BY untimely * 1.0 / COUNT(*) DESC
     LIMIT 15`,
  ),
);

const timelyByCompany = timed('timely-by-company', () =>
  rows<{ name: string; total: number; timely: number }>(
    `SELECT c.name AS name,
            COUNT(*) AS total,
            SUM(CASE WHEN x.timely_response = 1 THEN 1 ELSE 0 END) AS timely
     FROM complaints x JOIN companies c ON c.id = x.company_id
     GROUP BY x.company_id
     HAVING COUNT(*) >= 50000
     ORDER BY timely * 1.0 / COUNT(*) DESC
     LIMIT 10`,
  ),
);

const nullRates = timed('null-rates', () =>
  row<Record<string, number>>(
    `SELECT
       SUM(company_id IS NULL) AS company,
       SUM(product_id IS NULL) AS product,
       SUM(issue_id IS NULL) AS issue,
       SUM(state IS NULL) AS state,
       SUM(zip_code IS NULL) AS zip,
       SUM(tags IS NULL) AS tags,
       SUM(submitted_via IS NULL) AS submittedVia,
       SUM(company_response IS NULL) AS companyResponse,
       SUM(company_public_response IS NULL) AS publicResponse,
       SUM(timely_response IS NULL) AS timely,
       SUM(date_sent_to_company IS NULL) AS dateSent
     FROM complaints`,
  ),
);

const subIssueCount = timed('sub-issue-count', () =>
  row<{ n: number }>('SELECT COUNT(*) AS n FROM sub_issues').n,
);

/* -------------------------------------------------------------------------- */
/*                                 derivations                                */
/* -------------------------------------------------------------------------- */

const total = overview.total;

const topCompanyTotal = companyCounts.slice(0, 10).reduce((acc, c) => acc + c.total, 0);
const top3 = companyCounts.slice(0, 3).reduce((acc, c) => acc + c.total, 0);
const top1 = companyCounts[0]?.total ?? 0;
// Herfindahl–Hirschman Index on percentage shares (0–10,000).
const hhi = companyCounts.reduce((acc, c) => acc + (c.total / total) ** 2, 0) * 10_000;

const timelyYes = timelyCounts.find((t) => t.value === 1)?.total ?? 0;
const timelyNo = timelyCounts.find((t) => t.value === 0)?.total ?? 0;
const timelyKnown = timelyYes + timelyNo;

const latestYear = yearlySeries[yearlySeries.length - 1]!;
const lastComplete = yearlySeries[yearlySeries.length - 2];
const prevComplete = yearlySeries[yearlySeries.length - 3];
const yoy =
  lastComplete && prevComplete && prevComplete.value > 0
    ? (lastComplete.value / prevComplete.value - 1) * 100
    : 0;

const peakMonth = monthly.reduce((best, cur) => (cur.n > best.n ? cur : best), monthly[0]!);

/* -------------------------------------------------------------------------- */
/*                                   render                                   */
/* -------------------------------------------------------------------------- */

mkdirSync(chartsDir, { recursive: true });

const monthlySvg = lineChartSvg(monthly.map(({ m, n }) => ({ label: m, value: n })));
const yearlySvg = vBarChartSvg(yearlySeries);
const companySvg = hBarChartSvg(
  companyCounts.slice(0, 12).map(({ name, total: t }) => ({ label: name, value: t })),
);

const monthlyChartPath = 'charts/monthly-complaints.svg';
const yearlyChartPath = 'charts/yearly-complaints.svg';
const companyChartPath = 'charts/top-companies.svg';

writeFileSync(join(chartsDir, 'monthly-complaints.svg'), monthlySvg);
writeFileSync(join(chartsDir, 'yearly-complaints.svg'), yearlySvg);
writeFileSync(join(chartsDir, 'top-companies.svg'), companySvg);

// Full monthly series as CSV, for reuse elsewhere.
const monthlyCsv = ['month,complaints', ...monthly.map(({ m, n }) => `${m},${n}`)].join('\n');
writeFileSync(join(outDir, 'complaints-per-month.csv'), `${monthlyCsv}\n`);

const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);

const yoyRows: string[][] = yearlySeries.map((point, i) => {
  const prev = yearlySeries[i - 1];
  const isPartialLatest = i === yearlySeries.length - 1;
  const growth =
    prev && prev.value > 0 && !isPartialLatest
      ? `${((point.value / prev.value - 1) * 100).toFixed(1)}%`
      : '—';
  const share = pct(point.value, total, 2);
  return [point.label, num(point.value), share, growth];
});

const companyBody: string[][] = [];
let cumulative = 0;
companyCounts.slice(0, 15).forEach((c, i) => {
  cumulative += c.total;
  companyBody.push([
    String(i + 1),
    c.name,
    num(c.total),
    pct(c.total, total, 2),
    pct(cumulative, total, 2),
  ]);
});

const productBody = productCounts.map((p, i) => [String(i + 1), p.name, num(p.total), pct(p.total, total, 2)]);
const subProductBody = subProductCounts.map((p, i) => [String(i + 1), p.name, num(p.total), pct(p.total, total, 2)]);
const issueBody = issueCounts.map((p, i) => [String(i + 1), p.name, num(p.total), pct(p.total, total, 2)]);

const responseBody = responseCounts.map((r) => [
  r.value ?? '_(missing)_',
  num(r.total),
  pct(r.total, total, 2),
]);

const stateBody = stateCounts.map((s) => [s.value ?? '_(missing)_', num(s.total), pct(s.total, total, 2)]);

const viaBody = submittedVia.map((s) => [s.value ?? '_(missing)_', num(s.total), pct(s.total, total, 2)]);
const tagBody = tagCounts.map((s) => [s.value ?? '_(none)_', num(s.total), pct(s.total, total, 3)]);
const publicBody = publicResponses.map((s) => [s.value ?? '_(missing)_', num(s.total), pct(s.total, total, 2)]);

const untimelyBody = untimelyByCompany.map((c) => [
  c.name,
  num(c.total),
  num(c.untimely),
  pct(c.untimely, c.total, 2),
]);
const timelyBody = timelyByCompany.map((c) => [
  c.name,
  num(c.total),
  pct(c.timely, c.total, 2),
]);

const nullRows: Array<[string, number]> = [
  ['Company', nullRates.company ?? 0],
  ['Product', nullRates.product ?? 0],
  ['Issue', nullRates.issue ?? 0],
  ['Company response', nullRates.companyResponse ?? 0],
  ['Company public response', nullRates.publicResponse ?? 0],
  ['Timely response?', nullRates.timely ?? 0],
  ['Date sent to company', nullRates.dateSent ?? 0],
  ['State', nullRates.state ?? 0],
  ['ZIP code', nullRates.zip ?? 0],
  ['Tags', nullRates.tags ?? 0],
  ['Submitted via', nullRates.submittedVia ?? 0],
];
const nullBody: string[][] = nullRows.map(([field, missing]) => [
  field,
  num(missing),
  pct(missing, total, 2),
]);

const report = `# CFPB Consumer Complaint Database — analysis

_Generated ${generatedAt} from \`${dbPath}\` (${num(total)} complaints, read-only)._

![Complaints per month](${monthlyChartPath})

## Executive summary

- The database holds **${num(total)} complaints** received between **${overview.minDate}** and **${overview.maxDate}** — ${num(overview.companies)} companies, ${num(overview.products)} products, ${num(overview.issues)} issues and ${num(subIssueCount)} sub-issues.
- Volume is extremely top-heavy: the **top 3 companies account for ${pct(top3, total)}** of all complaints and the top 10 for ${pct(topCompanyTotal, total)} (HHI ≈ ${Math.round(hhi).toLocaleString('en-US')}; on the standard scale 1,500–2,500 is "moderately concentrated" and >2,500 "highly concentrated").
- **${companyCounts[0]?.name ?? 'n/a'}** alone is the single largest filer at ${num(top1)} complaints (${pct(top1, total)}).
- The single largest product is **${productCounts[0]?.name ?? 'n/a'}** with ${num(productCounts[0]?.total ?? 0)} complaints (${pct(productCounts[0]?.total ?? 0, total)}).
- Complaint volume has grown sharply: **${prevComplete?.label ?? '?'} → ${lastComplete?.label ?? '?'}** went from ${num(prevComplete?.value ?? 0)} to ${num(lastComplete?.value ?? 0)} (${yoy >= 0 ? '+' : ''}${yoy.toFixed(0)}% YoY). The busiest month on record is **${peakMonth.m}** with ${num(peakMonth.n)} complaints.
- Companies respond on time in **${pct(timelyYes, timelyKnown)}** of complaints where timeliness is recorded (${num(timelyNo)} late).
- The most common resolution is **${responseCounts[0]?.value ?? 'n/a'}** (${pct(responseCounts[0]?.total ?? 0, total)}), and most complaints arrive via **${submittedVia[0]?.value ?? 'n/a'}** (${pct(submittedVia[0]?.total ?? 0, total)}).

## 1. Dataset at a glance

${mdTable(
  ['Metric', 'Value'],
  [false, true],
  [
    ['Complaints', num(total)],
    ['Date range', `${overview.minDate} → ${overview.maxDate}`],
    ['Distinct companies', num(overview.companies)],
    ['Distinct products', num(overview.products)],
    ['Distinct sub-products', num(rows<{ n: number }>('SELECT COUNT(*) n FROM sub_products')[0]!.n)],
    ['Distinct issues', num(overview.issues)],
    ['Distinct sub-issues', num(subIssueCount)],
    ['Distinct states/territories', num(overview.states)],
    ['Top-3 company share', pct(top3, total)],
    ['Top-10 company share', pct(topCompanyTotal, total)],
    ['Company HHI (0–10,000)', Math.round(hhi).toLocaleString('en-US')],
  ],
)}

## 2. Volume over time

![Complaints per year](${yearlyChartPath})

### Complaints by year

${mdTable(['Year', 'Complaints', 'Share', 'YoY growth'], [false, true, true, true], yoyRows)}

_${latestYear.label} is partial (through ${overview.maxDate}); 2011 starts on ${overview.minDate}. YoY growth for the latest (partial) year is not comparable._

### Most recent months

${mdTable(
  ['Month', 'Complaints'],
  [false, true],
  monthly.slice(-12).map(({ m, n }) => [m, num(n)]),
)}

The full monthly series (${monthly.length} months) is in [\`complaints-per-month.csv\`](complaints-per-month.csv).

## 3. Companies

![Top companies by complaint volume](${companyChartPath})

### Top 15 companies

${mdTable(['#', 'Company', 'Complaints', 'Share', 'Cumulative'], [true, false, true, true, true], companyBody)}

The tail is long: the remaining ${num(companyCounts.length - 15)} companies together account for ${pct(total - cumulative, total)} of complaints.

### Untimely-response rate — companies with ≥ 10,000 complaints

${mdTable(['Company', 'Complaints', 'Not timely', '% not timely'], [false, true, true, true], untimelyBody)}

### Best on-time records — companies with ≥ 50,000 complaints

${mdTable(['Company', 'Complaints', '% timely'], [false, true, true], timelyBody)}

## 4. Products & issues

### All products

${mdTable(['#', 'Product', 'Complaints', 'Share'], [true, false, true, true], productBody)}

### Top 15 sub-products

${mdTable(['#', 'Sub-product', 'Complaints', 'Share'], [true, false, true, true], subProductBody)}

### Top 20 issues

${mdTable(['#', 'Issue', 'Complaints', 'Share'], [true, false, true, true], issueBody)}

## 5. Responses & timeliness

### Company response to consumer

${mdTable(['Resolution', 'Complaints', 'Share'], [false, true, true], responseBody)}

### Timely response?

${mdTable(
  ['Timely?', 'Complaints', 'Share'],
  [false, true, true],
  timelyCounts.map((t) => [
    t.value === 1 ? 'Yes' : t.value === 0 ? 'No' : '_(missing)_',
    num(t.total),
    pct(t.total, total, 2),
  ]),
)}

### Company public response

${mdTable(['Public response', 'Complaints', 'Share'], [false, true, true], publicBody)}

## 6. Geography

### Top 20 states / territories

${mdTable(['State', 'Complaints', 'Share'], [false, true, true], stateBody)}

## 7. Submission channels, tags & data quality

### Submitted via

${mdTable(['Channel', 'Complaints', 'Share'], [false, true, true], viaBody)}

### Tags

${mdTable(['Tag', 'Complaints', 'Share'], [false, true, true], tagBody)}

### Missing-dimension rates

${mdTable(['Field', 'Missing rows', '% of total'], [false, true, true], nullBody)}

---
_Report produced by \`src/scripts/analyze.ts\`. All figures are point-in-time counts over the loaded snapshot; no sampling._
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, report);

client.close();

console.log(`\nReport written to ${outFile}`);
console.log(`Charts in ${chartsDir}`);
console.log(`Relative path from project root: ${relative(process.cwd(), outFile)}`);
