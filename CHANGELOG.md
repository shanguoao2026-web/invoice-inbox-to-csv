# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- Invoice date, due date, invoice number, subtotal, tax, and total labels match when the colon is omitted and the value is separated by whitespace.
- The rupee sign `₹` is read as INR and parsed as a money amount.
- GST and VAT summary rows (`GST 15%`, `GST at 18%`, `VAT 19%`) stay on the tax fields and are not exported as product lines.
- A letterhead trade name such as `Larkfield Stationers` is preferred over a placeholder line (`A fictional company` or `SPECIMEN`).

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
