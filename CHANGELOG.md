# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 - 2026-11-02

### Added

- `convert` reads a folder of PDF invoices and writes Xero and QuickBooks Online CSV files.
- Heuristic extraction for supplier, invoice number, dates, currency, tax, totals, and line items.
- Optional `--llm` fill-in through any OpenAI-compatible chat API. SpaceXAI (the xAI API) is the recommended endpoint. Heuristic values are never overwritten.
- `watch` rescans the inbox with `fs.watch` plus polling, and rewrites the CSVs when a PDF is added, changed, or removed.
- `validate` checks a CSV against the Xero or QuickBooks Online column set.
- Batch failures are reported on stderr and in `errors.json` without stopping the rest of the run.
- `npm run fixtures` generates the synthetic sample invoices.
- PDF text is read with Mozilla PDF.js (`pdfjs-dist`). Page rendering, and the optional native `@napi-rs/canvas` package, are not required.
