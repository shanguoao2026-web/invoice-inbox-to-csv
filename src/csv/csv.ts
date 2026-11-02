import { formatDate, paymentTerms } from "../dates.js";
import { QBO_TAX_NONE, XERO_TAX_NONE } from "../defaults.js";
import { formatAmount, formatQuantity, round2 } from "../money.js";
import type { DateFormatName, PreparedInvoice } from "../types.js";

export const XERO_COLUMNS = [
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

/**
 * Vendor bill lines for QuickBooks Online CSV importers.
 * One row per invoice line. Account is the expense account, not Accounts Payable.
 */
export const QBO_COLUMNS = [
  "Vendor",
  "BillNo",
  "BillDate",
  "DueDate",
  "Terms",
  "Memo",
  "Account",
  "Description",
  "Quantity",
  "Rate",
  "Amount",
  "TaxCode",
  "Currency",
] as const;

export interface CsvBuildOptions {
  dateFormat: DateFormatName;
  accountCode: string;
  expenseAccount: string;
  taxType: string | null;
  taxCode: string | null;
}

export function toCsv(headers: readonly string[], rows: Array<Record<string, string>>): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** RFC 4180 reader. A trailing newline does not create an extra empty row. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char ?? "";
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char ?? "";
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

export function toXeroRows(
  invoice: PreparedInvoice,
  options: CsvBuildOptions,
): Array<Record<string, string>> {
  const taxType = options.taxType && options.taxType.trim() ? options.taxType.trim() : XERO_TAX_NONE;
  return invoice.lineItems.map((item) => ({
    ContactName: invoice.vendor,
    InvoiceNumber: invoice.invoiceNumber,
    InvoiceDate: formatDate(invoice.invoiceDate, options.dateFormat),
    DueDate: formatDate(invoice.dueDate, options.dateFormat),
    Description: item.description,
    Quantity: formatQuantity(item.quantity),
    UnitAmount: formatAmount(item.unitAmount, 4),
    AccountCode: options.accountCode,
    TaxType: taxType,
    Currency: invoice.currency,
  }));
}

export function toQboRows(
  invoice: PreparedInvoice,
  options: CsvBuildOptions,
): Array<Record<string, string>> {
  const taxCode = options.taxCode && options.taxCode.trim() ? options.taxCode.trim() : QBO_TAX_NONE;
  const memo = buildMemo(invoice, taxCode === QBO_TAX_NONE);
  return invoice.lineItems.map((item) => ({
    Vendor: invoice.vendor,
    BillNo: invoice.invoiceNumber,
    BillDate: formatDate(invoice.invoiceDate, options.dateFormat),
    DueDate: formatDate(invoice.dueDate, options.dateFormat),
    Terms: paymentTerms(invoice.invoiceDate, invoice.dueDate),
    Memo: memo,
    Account: options.expenseAccount,
    Description: item.description,
    Quantity: formatQuantity(item.quantity),
    Rate: formatAmount(item.unitAmount, 4),
    Amount: formatAmount(round2(item.quantity * item.unitAmount)),
    TaxCode: taxCode,
    Currency: invoice.currency,
  }));
}

function buildMemo(invoice: PreparedInvoice, taxLeftUncoded: boolean): string {
  const parts = [`Imported from ${invoice.sourceFile}`];
  if (taxLeftUncoded && invoice.taxAmount != null && invoice.taxAmount > 0) {
    const rate = invoice.taxRate != null ? ` at ${invoice.taxRate}%` : "";
    parts.push(
      `Detected tax ${formatAmount(invoice.taxAmount)} ${invoice.currency}${rate}. TaxCode left as NON; pass --tax-code to accrue it`,
    );
  }
  return parts.join(". ");
}
