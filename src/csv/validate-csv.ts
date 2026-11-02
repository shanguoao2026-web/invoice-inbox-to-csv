import { parseDate, type AmbiguousDateOrder } from "../dates.js";
import { parseMoney, parseQuantity, round2 } from "../money.js";
import type { CsvFormat, CsvIssue, CsvValidationReport } from "../types.js";
import { QBO_COLUMNS, XERO_COLUMNS, parseCsv } from "./csv.js";

export interface ValidateCsvOptions {
  format: CsvFormat;
  file: string;
  ambiguousDates?: AmbiguousDateOrder;
}

const XERO_REQUIRED = [
  "ContactName",
  "InvoiceNumber",
  "InvoiceDate",
  "DueDate",
  "Description",
  "Quantity",
  "UnitAmount",
  "AccountCode",
  "TaxType",
  "Currency",
] as const;

const QBO_REQUIRED = [
  "Vendor",
  "BillNo",
  "BillDate",
  "DueDate",
  "Account",
  "Description",
  "Quantity",
  "Rate",
  "Amount",
  "TaxCode",
  "Currency",
] as const;

export function validateCsvText(text: string, options: ValidateCsvOptions): CsvValidationReport {
  const errors: CsvIssue[] = [];
  const warnings: CsvIssue[] = [];
  const table = parseCsv(text);
  if (table.length === 0) {
    errors.push({ row: 1, field: "header", message: "CSV is empty." });
    return { format: options.format, file: options.file, dataRows: 0, errors, warnings };
  }

  const header = table[0] ?? [];
  const expected = new Set<string>(options.format === "xero" ? XERO_COLUMNS : QBO_COLUMNS);
  const required = options.format === "xero" ? XERO_REQUIRED : QBO_REQUIRED;
  const seen = new Set<string>();
  header.forEach((name, index) => {
    if (!name.trim()) {
      errors.push({ row: 1, field: `column ${index + 1}`, message: "Header cell is empty." });
      return;
    }
    if (seen.has(name)) {
      errors.push({ row: 1, field: name, message: `Duplicate column "${name}".` });
    }
    seen.add(name);
  });

  for (const column of required) {
    if (!seen.has(column)) {
      errors.push({ row: 1, field: column, message: `Missing required column "${column}".` });
    }
  }
  for (const column of header) {
    if (column && !expected.has(column)) {
      warnings.push({
        row: 1,
        field: column,
        message: `Column "${column}" is not part of the ${options.format} mapping. It was ignored.`,
      });
    }
  }

  const data = table.slice(1);
  if (data.length === 0) {
    warnings.push({ row: 1, field: "rows", message: "CSV has no data rows." });
  }

  const indexOf = new Map<string, number>();
  header.forEach((name, index) => {
    if (!indexOf.has(name)) indexOf.set(name, index);
  });

  data.forEach((cells, dataIndex) => {
    const row = dataIndex + 2;
    if (cells.length !== header.length) {
      errors.push({
        row,
        field: "columns",
        message: `Expected ${header.length} columns but found ${cells.length}.`,
      });
    }
    const value = (column: string): string => {
      const index = indexOf.get(column);
      if (index == null) return "";
      return (cells[index] ?? "").trim();
    };

    if (options.format === "xero") checkXeroRow(value, row, errors, options.ambiguousDates ?? "dmy");
    else checkQboRow(value, row, errors, options.ambiguousDates ?? "dmy");
  });

  return {
    format: options.format,
    file: options.file,
    dataRows: data.length,
    errors,
    warnings,
  };
}

function checkXeroRow(
  value: (column: string) => string,
  row: number,
  errors: CsvIssue[],
  ambiguous: AmbiguousDateOrder,
): void {
  requireText(value, row, "ContactName", errors);
  requireText(value, row, "InvoiceNumber", errors);
  requireDate(value, row, "InvoiceDate", errors, ambiguous);
  requireDate(value, row, "DueDate", errors, ambiguous);
  requireText(value, row, "Description", errors);
  requireQuantity(value, row, "Quantity", errors);
  requireMoney(value, row, "UnitAmount", errors);
  requireText(value, row, "AccountCode", errors);
  requireText(value, row, "TaxType", errors);
  requireCurrency(value, row, "Currency", errors);
}

function checkQboRow(
  value: (column: string) => string,
  row: number,
  errors: CsvIssue[],
  ambiguous: AmbiguousDateOrder,
): void {
  requireText(value, row, "Vendor", errors);
  requireText(value, row, "BillNo", errors);
  requireDate(value, row, "BillDate", errors, ambiguous);
  requireDate(value, row, "DueDate", errors, ambiguous);
  requireText(value, row, "Account", errors);
  requireText(value, row, "Description", errors);
  requireQuantity(value, row, "Quantity", errors);
  requireMoney(value, row, "Rate", errors);
  requireMoney(value, row, "Amount", errors);
  requireText(value, row, "TaxCode", errors);
  requireCurrency(value, row, "Currency", errors);

  const quantity = parseQuantity(value("Quantity"));
  const rate = parseMoney(value("Rate"), { allowInteger: true });
  const amount = parseMoney(value("Amount"), { allowInteger: true });
  if (quantity != null && rate != null && amount != null) {
    const extended = round2(quantity * rate);
    if (Math.abs(extended - amount) > 0.05) {
      errors.push({
        row,
        field: "Amount",
        message: `Amount ${amount} does not match quantity × rate (${extended}).`,
      });
    }
  }
}

function requireText(
  value: (column: string) => string,
  row: number,
  field: string,
  errors: CsvIssue[],
): void {
  if (!value(field)) errors.push({ row, field, message: `${field} is required.` });
}

function requireDate(
  value: (column: string) => string,
  row: number,
  field: string,
  errors: CsvIssue[],
  ambiguous: AmbiguousDateOrder,
): void {
  const raw = value(field);
  if (!raw) {
    errors.push({ row, field, message: `${field} is required.` });
    return;
  }
  if (!parseDate(raw, ambiguous)) {
    errors.push({ row, field, message: `${field} "${raw}" is not a recognized date.` });
  }
}

function requireQuantity(
  value: (column: string) => string,
  row: number,
  field: string,
  errors: CsvIssue[],
): void {
  const raw = value(field);
  if (!raw) {
    errors.push({ row, field, message: `${field} is required.` });
    return;
  }
  if (parseQuantity(raw) == null) {
    errors.push({ row, field, message: `${field} must be a number greater than zero.` });
  }
}

function requireMoney(
  value: (column: string) => string,
  row: number,
  field: string,
  errors: CsvIssue[],
): void {
  const raw = value(field);
  if (!raw) {
    errors.push({ row, field, message: `${field} is required.` });
    return;
  }
  if (parseMoney(raw, { allowInteger: true }) == null) {
    errors.push({ row, field, message: `${field} must be a number.` });
  }
}

function requireCurrency(
  value: (column: string) => string,
  row: number,
  field: string,
  errors: CsvIssue[],
): void {
  const raw = value(field);
  if (!raw) {
    errors.push({ row, field, message: `${field} is required.` });
    return;
  }
  if (!/^[A-Za-z]{3}$/.test(raw)) {
    errors.push({ row, field, message: `${field} must be a 3-letter ISO code.` });
  }
}
