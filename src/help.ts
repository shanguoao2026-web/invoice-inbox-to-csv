export const HELP = `invoice-inbox-to-csv — turn PDF invoices into Xero and QuickBooks Online CSV files

Usage:
  invoice-inbox-to-csv convert --in <dir> --out <dir> [--format xero|qbo|both]
  invoice-inbox-to-csv watch   --in <dir> --out <dir> [--format xero|qbo|both]
  invoice-inbox-to-csv validate --in <file.csv> --format xero|qbo

Convert and watch:
  --in <path>               Folder of PDFs, or one PDF file (convert only)
  --out <dir>               Directory for xero.csv, qbo.csv, and errors.json
  --format <name>           xero, qbo, or both (default both)
  --currency <ISO>          Used when the PDF has no currency (default USD)
  --account-code <code>     Xero AccountCode on every line (default 400)
  --expense-account <name>  QuickBooks expense account (default "Uncategorized Expense")
  --tax-type <name>         Xero TaxType (default NONE)
  --tax-code <name>         QuickBooks TaxCode (default NON)
  --due-days <n>            Due date when the PDF has none (default 30)
  --date-format <fmt>       iso, dmy, or mdy (default iso)
  --recursive               Include PDFs in subfolders
  --errors <file>           Override the errors.json path
  --llm                     Fill blank fields via an OpenAI-compatible chat API
  --llm-model <id>          Model id (default grok-4.7 on api.x.ai, otherwise gpt-4o-mini)
  --llm-base-url <url>      API origin including /v1
  --quiet                   Hide the progress lines

Watch:
  --poll-ms <n>             Poll interval in milliseconds (default 2000, minimum 50)
  --stable-ms <n>           Quiet period before a changed PDF is read (default 500)

  fs.watch listens on the inbox directory. A poll runs as well, because fs.watch
  misses events on some network disks and is not recursive on Linux. Nested PDFs
  are included in the poll when --recursive is set. Each change rewrites the CSVs
  from every PDF currently in the inbox. Ctrl+C stops the watcher.

Validate:
  --in <file.csv>           CSV produced by this tool, or one with the same columns
  --format <xero|qbo>       Column set to check
  --date-format <fmt>       How to read ambiguous numeric dates (default iso, which
                            still treats 03/04/2026 as day-first)
  --errors <file>           Also write a JSON report

Exit codes:
  0  every invoice or row passed
  1  one or more files or rows failed; valid invoices were still written
  2  the command line was wrong, or the tool crashed

Examples:
  invoice-inbox-to-csv convert --in ./inbox --out ./out --format both
  invoice-inbox-to-csv watch --in ./inbox --out ./out --format xero
  invoice-inbox-to-csv validate --in ./out/xero.csv --format xero
`;
