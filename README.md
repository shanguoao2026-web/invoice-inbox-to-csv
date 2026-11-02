# invoice-inbox-to-csv

A small command-line tool that reads a folder of PDF invoices, pulls out the supplier, dates, totals, tax, and line items, and writes CSV files you can import into **Xero** and **QuickBooks Online**.

Extraction is heuristic and runs entirely on your machine. Nothing is sent over the network unless you pass `--llm`. A file that cannot be read or is missing required fields is reported and skipped. The rest of the batch still exports.

## Install

Node.js 20.16 or newer.

```bash
npm install
npm run build
```

The program is `invoice-inbox-to-csv` (`node dist/cli.js` from this repository, or the same name on your `PATH` after `npm link` / `npm install -g`).

Generate the sample PDFs (pure JavaScript, no network):

```bash
npm run fixtures
```

## Quick start

```bash
invoice-inbox-to-csv convert --in ./fixtures --out ./out --format both
```

That writes:

- `out/xero.csv`
- `out/qbo.csv`
- `out/errors.json`

`fixtures/incomplete-receipt.pdf` is intentionally incomplete. The command exits **1**, prints the problems on stderr, and still writes the three valid invoices. Exit **0** means every PDF exported. Exit **2** means the command line was wrong or the tool crashed.

Check a file before you import it:

```bash
invoice-inbox-to-csv validate --in ./out/xero.csv --format xero
invoice-inbox-to-csv validate --in ./out/qbo.csv --format qbo
```

Watch a folder. Drop new PDFs in and the CSVs are rewritten.

```bash
invoice-inbox-to-csv watch --in ./inbox --out ./out --format both
```

Stop the watcher with Ctrl+C.

## What gets extracted

The tool reads the PDF text with [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`). It does not render pages, so it does not need a native canvas addon. `@napi-rs/canvas` is only an optional dependency of PDF.js; if that install fails, text extraction still runs. The parser then looks for common English invoice wording:

- Supplier: letterhead with a company suffix (`Ltd`, `Inc`, `GmbH`, `Co`, …), or a `Bill From` / `Supplier` / `Vendor` / `From` line. `Bill To` is the customer and is not used as the contact.
- `Invoice Number`, `Invoice No`, `Invoice #`, `Inv #`, `Bill Number`.
- `Invoice Date`, `Date of Issue`, `Issue Date`, or a plain `Date`.
- `Due Date`, `Payment Due`, `Pay By`, or `Due`.
- `Currency` as an ISO code (`NZD`, `USD`, `EUR`, …). `€`, `£`, `¥`, `NZ$`, `A$`, `C$`, and `US$` count. A bare `$` does not, because several currencies share it.
- `Subtotal`, `GST` / `VAT` / `Sales Tax` (with an optional percent), and `Total` / `Amount Due`.
- Line items shaped like `Description  Qty  Unit Price  Amount`, or a description plus a single amount.

Amounts may use `1,234.56` or `1.234,56`. Dates may be `15 March 2024`, `March 3, 2026`, `2026-01-20`, `15/04/2024`, or `04/15/2024`. When both numbers are 12 or less (`03/04/2026`), the day is assumed to come first unless you pass `--date-format mdy`.

If the due date or the currency is missing, the tool fills them (`--due-days`, default 30, and `--currency`, default `USD`) and records a warning. If there are no line items but there is a total, it writes one summary line. Printed prices that say they include GST or VAT are converted to tax-exclusive amounts when a rate was found. Xero and QuickBooks compute tax from the tax code, so the CSV amounts are tax-exclusive.

## CSV columns

One CSV row per line item. The invoice number, contact, and dates repeat on each row so the importer can group them.

### Xero

| Column | Source | Default |
| --- | --- | --- |
| ContactName | Supplier | Required. The file is skipped when it is missing. |
| InvoiceNumber | Invoice number | Required. |
| InvoiceDate | Invoice date | `YYYY-MM-DD` unless `--date-format` is `dmy` or `mdy`. |
| DueDate | Due date, or invoice date plus `--due-days` | Same date format. |
| Description | Line description | `Invoice total` when the PDF had no lines. |
| Quantity | Line quantity | `1` on a summary line. |
| UnitAmount | Tax-exclusive unit price | Up to 4 decimal places. |
| AccountCode | `--account-code` | `400`. This is a placeholder. Point it at a purchases or expense account in your chart. |
| TaxType | `--tax-type` | `NONE`. |
| Currency | ISO code | `USD` when the PDF does not say. |

Xero rejects a `TaxType` or `AccountCode` that is not in the organisation. `NONE` and `400` are safe placeholders, not a guess at your chart. When the PDF shows tax and you did not pass `--tax-type`, the row still uses `NONE` and `errors.json` warns you that the import will not accrue tax.

Xero's own date format follows the organisation's settings. Pass `--date-format dmy` or `mdy` if a `YYYY-MM-DD` value will not import.

### QuickBooks Online

QuickBooks Online does not ship one official bill CSV for every plan. This file is a vendor-bill line layout that common importers (and a spreadsheet you map once) can load. `Account` is the **expense** account on the line, not Accounts Payable. The importer should credit Accounts Payable for the vendor.

| Column | Source | Default |
| --- | --- | --- |
| Vendor | Supplier | Required. |
| BillNo | Invoice number | Required. |
| BillDate | Invoice date | Same `--date-format` as Xero. |
| DueDate | Due date | Same as Xero. |
| Terms | Days between the two dates | `Net 30`, `Due on receipt`, or blank when the due date is earlier than the invoice date. |
| Memo | Source file name, plus a note when tax was detected | |
| Account | `--expense-account` | `Uncategorized Expense` |
| Description | Line description | |
| Quantity | Line quantity | |
| Rate | Tax-exclusive unit price | |
| Amount | Quantity × rate, rounded to cents | |
| TaxCode | `--tax-code` | `NON` |
| Currency | ISO code | `USD` when the PDF does not say. |

`NON` means non-taxable. Pass `--tax-code` with a code that exists in the company (`TAX` is common in the US edition, but it is not universal).

## Command reference

```text
invoice-inbox-to-csv convert --in <dir> --out <dir> [--format xero|qbo|both]
invoice-inbox-to-csv watch   --in <dir> --out <dir> [--format xero|qbo|both]
invoice-inbox-to-csv validate --in <file.csv> --format xero|qbo
```

| Flag | Meaning |
| --- | --- |
| `--format` | `xero`, `qbo`, or `both` (default `both`). `validate` accepts only `xero` or `qbo`. |
| `--currency` | Fallback ISO code (default `USD`). |
| `--account-code` | Xero account code (default `400`). |
| `--expense-account` | QuickBooks expense account name (default `Uncategorized Expense`). |
| `--tax-type` | Xero `TaxType` for every line (default `NONE`). |
| `--tax-code` | QuickBooks `TaxCode` for every line (default `NON`). |
| `--due-days` | Used when the PDF has no due date (default `30`). |
| `--date-format` | `iso` (default), `dmy`, or `mdy`. For `validate`, `mdy` is also how ambiguous numeric dates are read. `iso` and `dmy` read those dates day-first. |
| `--recursive` | Include PDFs in subfolders. |
| `--errors` | Override the JSON report path. `convert` and `watch` always write `<out>/errors.json` unless you set this. `validate` writes JSON only when you pass `--errors`. |
| `--quiet` | Hide the "wrote file" lines. Warnings and errors still print. |
| `--llm` | Fill fields the heuristic left blank. See below. |
| `--llm-model`, `--llm-base-url` | Override the model and the OpenAI-compatible base URL. |
| `--poll-ms` | Watch poll interval (default `2000`, minimum `50`). |
| `--stable-ms` | Watch quiet period before a changed PDF is read (default `500`). |

`convert` accepts a directory or a single PDF. `watch` needs a directory. Output CSVs are overwritten on every run. An empty inbox writes a header and no data rows.

### Watch behavior

1. The inbox is scanned immediately.
2. `fs.watch` listens on that directory. On Linux this is not recursive.
3. A poll every `--poll-ms` catches events `fs.watch` misses (some network disks, editors that save in place, and nested folders when `--recursive` is set).
4. After a change, the scan waits until the inbox has been quiet for `--stable-ms`, so a download that is still growing is less likely to be parsed halfway through.
5. Each scan rewrites the CSVs from **every** PDF currently in the inbox. Delete a PDF and its rows disappear on the next scan.
6. A bad PDF is omitted from the CSV, listed in `errors.json`, and printed on stderr. The watcher keeps running.
7. Ctrl+C or SIGTERM stops it and exits 0.

## Optional LLM fill-in

Pass `--llm` to send the extracted text to an OpenAI-compatible `POST /chat/completions` endpoint. The model may fill **only** fields the heuristic left empty. It does not replace a supplier, number, date, total, or line list that was already found.

Recommended endpoint: **SpaceXAI**, served by the xAI API.

```bash
export XAI_API_KEY="your-key"
invoice-inbox-to-csv convert --in ./inbox --out ./out --llm
```

That uses `https://api.x.ai/v1` and the model `grok-4.7` unless you override them. `OPENAI_API_KEY` is also accepted. If both keys are set, `XAI_API_KEY` wins. `INVOICE_LLM_API_KEY` overrides both. `INVOICE_LLM_BASE_URL` or `OPENAI_BASE_URL` overrides the host. `INVOICE_LLM_MODEL` overrides the model.

```bash
invoice-inbox-to-csv convert --in ./inbox --out ./out --llm \
  --llm-base-url https://api.openai.com/v1 \
  --llm-model gpt-4o-mini
```

Keys are read from the environment only. They are not command-line flags, and they are not written to the CSV or `errors.json`. If the request fails, the heuristic result is kept and the file gets a warning. Copy `.env.example` to `.env` and keep `.env` out of git. Review every LLM-filled cell before you import.

Automated tests do not call this API. They cover the heuristic path and a stubbed client.

## errors.json

`convert` and `watch` always write a report:

```json
{
  "generatedAt": "2026-11-02T00:00:00.000Z",
  "command": "convert",
  "format": "both",
  "summary": { "processed": 4, "succeeded": 3, "failed": 1, "warnings": 3 },
  "results": [
    {
      "file": "incomplete-receipt.pdf",
      "status": "error",
      "invoiceNumber": null,
      "vendor": null,
      "errors": [{ "field": "invoiceNumber", "message": "Invoice number is required." }],
      "warnings": []
    }
  ]
}
```

The same problems are printed on stderr. A warning still exports the invoice. An error does not.

## Limitations

- No OCR. A scanned image with no text layer fails with a clear error.
- The heuristics target common English labels and simple tables (description, quantity, unit price, amount). Unusual layouts, multi-column pages, and credit-note workflows will miss fields.
- Line amounts need a decimal part (`10.00` or `10,00`) unless they sit on a labeled total. That avoids treating a street number as a price.
- One currency per document. A bare `$` is not mapped to USD.
- Tax codes and account codes are organisation-specific. The defaults will import only where those codes already exist, and they do not post tax until you set `--tax-type` / `--tax-code`.
- The QuickBooks file is a documented bill-line layout, not a file QuickBooks Online is guaranteed to import without a column mapping step.
- Dates written as `03/04/2026` are day-first unless `--date-format mdy` is used on the way out and again on `validate`.
- `--llm` can be wrong. It only fills blanks, and you should still review the CSV.
- Password-protected PDFs fail that file and the batch continues.

## Development

```bash
npm install
npm test
```

`npm test` regenerates `fixtures/*.pdf`, typechecks, and runs the tests with Node's built-in test runner. No network, no API key, and no native PDF libraries. `pdfkit` (a dev dependency) draws the sample invoices. `pdfjs-dist` reads them.

```bash
npm run fixtures   # rewrite fixtures/*.pdf
npm run build      # compile to dist/
npm run typecheck
```

## License

MIT. See [LICENSE](LICENSE).
