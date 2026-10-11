# `complaints-data/` — CFPB source CSV (not committed)

This directory is where the ingest pipeline expects the raw CFPB Consumer
Complaint Database CSV. The file is **not committed** (it is ~5.5 GB
uncompressed / ~337 MB zipped) — only this note is tracked.

## Download

The CFPB generally updates the database daily and provides a bulk export of the
full dataset:

```bash
# from the repository root
mkdir -p complaints-data
curl -L -o complaints-data/complaints.csv.zip \
  https://files.consumerfinance.gov/ccdb/complaints.csv.zip
unzip -o complaints-data/complaints.csv.zip -d complaints-data
```

That yields `complaints-data/complaints.csv`, which is the default input for
`npm run ingest`.

| | |
| --- | --- |
| Source | <https://www.consumerfinance.gov/data-research/consumer-complaints/> |
| Bulk endpoint | <https://files.consumerfinance.gov/ccdb/complaints.csv.zip> |
| Format | one header row + one row per complaint |
| Size | ~337 MB zipped, ~5.5 GB unzipped (~18M rows) |

## Notes

- Re-running the download picks up newly published complaints. Ingestion is
  idempotent (`onConflictDoNothing` on `complaint_id`), so re-loading the same
  file is safe.
- To use a file at another path, pass `--file <path>` to `npm run ingest` or
  set the path via `DATABASE_URL` for the database side.
