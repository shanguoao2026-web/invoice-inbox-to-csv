/**
 * Fields read from one supplier invoice before defaults are applied.
 * Dates are ISO `YYYY-MM-DD` when parsing succeeded.
 * Money amounts are plain numbers. `taxRate` is a percent (15 means 15%).
 */
export interface InvoiceDraft {
  vendor: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  total: number | null;
  /** True when the document says the printed prices include tax. */
  taxInclusive: boolean;
  lineItems: LineItem[];
  /** Original date or number text that was present but could not be parsed. */
  rawInvoiceNumber: string | null;
  rawInvoiceDate: string | null;
  rawDueDate: string | null;
}

export interface LineItem {
  description: string;
  quantity: number;
  /** Tax-exclusive unit price after preparation. */
  unitAmount: number;
  /** Tax-exclusive extended amount (quantity × unit, within rounding). */
  amount: number;
}

export interface Issue {
  field: string;
  message: string;
}

/** An invoice that passed validation and is safe to write to a CSV row. */
export interface PreparedInvoice {
  sourceFile: string;
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  subtotal: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  total: number | null;
  taxInclusive: boolean;
  lineItems: LineItem[];
  warnings: Issue[];
}

export interface FileOutcome {
  file: string;
  status: "ok" | "error";
  errors: Issue[];
  warnings: Issue[];
  invoice: PreparedInvoice | null;
  draft: InvoiceDraft | null;
}

export type CsvFormat = "xero" | "qbo";
export type OutputFormat = CsvFormat | "both";
export type DateFormatName = "iso" | "dmy" | "mdy";

export interface LlmClient {
  /** Return only fields the model could read. Unknown fields should be omitted. */
  extract(text: string): Promise<Partial<InvoiceDraft>>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ConvertOptions {
  inPath: string;
  outDir: string;
  format: OutputFormat;
  currency: string;
  accountCode: string;
  expenseAccount: string;
  /** When set, every Xero row uses this TaxType. Otherwise rows use `NONE`. */
  taxType: string | null;
  /** When set, every QuickBooks row uses this TaxCode. Otherwise rows use `NON`. */
  taxCode: string | null;
  dueDays: number;
  dateFormat: DateFormatName;
  recursive: boolean;
  errorsPath?: string;
  quiet: boolean;
  logger?: Logger;
  llmClient?: LlmClient | null;
  extractor?: (data: Uint8Array) => Promise<string>;
  now?: () => Date;
}

export interface ConvertResult {
  processed: number;
  succeeded: number;
  failed: number;
  outputs: string[];
  errorsPath: string;
  exitCode: number;
  outcomes: FileOutcome[];
}

export interface WatchOptions extends ConvertOptions {
  pollMs: number;
  stableMs: number;
}

export interface CsvIssue {
  row: number;
  field: string;
  message: string;
}

export interface CsvValidationReport {
  format: CsvFormat;
  file: string;
  dataRows: number;
  errors: CsvIssue[];
  warnings: CsvIssue[];
}
