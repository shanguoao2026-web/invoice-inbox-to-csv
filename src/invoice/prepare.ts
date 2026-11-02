import { DEFAULT_DUE_DAYS } from "../defaults.js";
import { addDays, daysBetween } from "../dates.js";
import { formatAmount, round2, round4 } from "../money.js";
import type { FileOutcome, InvoiceDraft, Issue, LineItem, PreparedInvoice } from "../types.js";

export interface PrepareOptions {
  sourceFile: string;
  currency: string;
  dueDays?: number;
  taxType: string | null;
  taxCode: string | null;
}

export function prepareInvoice(
  draft: InvoiceDraft,
  options: PrepareOptions,
  seedWarnings: Issue[] = [],
): FileOutcome {
  const warnings: Issue[] = [...seedWarnings];
  const errors: Issue[] = [];
  const dueDays = options.dueDays ?? DEFAULT_DUE_DAYS;
  let lineItems = draft.lineItems.map((item) => ({ ...item }));

  if (draft.taxInclusive && draft.taxRate != null && draft.taxRate > 0 && lineItems.length > 0) {
    const factor = 1 + draft.taxRate / 100;
    lineItems = lineItems.map((item) => ({
      ...item,
      unitAmount: round4(item.unitAmount / factor),
      amount: round2(item.amount / factor),
    }));
    warnings.push({
      field: "taxInclusive",
      message: `Prices were marked tax-inclusive. Line amounts were converted to tax-exclusive at ${draft.taxRate}%.`,
    });
  } else if (draft.taxInclusive && lineItems.length > 0) {
    warnings.push({
      field: "taxInclusive",
      message: "Prices were marked tax-inclusive, but no tax rate was found. Amounts were left as printed.",
    });
  }

  lineItems = normalizeUnitAmounts(lineItems, warnings);

  if (lineItems.length === 0) {
    const net = exclusiveNet(draft);
    if (net == null) {
      errors.push({
        field: "lineItems",
        message: "No line items or total amount were found.",
      });
    } else {
      lineItems = [{ description: "Invoice total", quantity: 1, unitAmount: net, amount: net }];
      warnings.push({
        field: "lineItems",
        message: "No line items found; exported one summary line from the invoice total.",
      });
    }
  }

  if (lineItems.length > 0 && draft.subtotal != null) {
    const sum = round2(lineItems.reduce((total, item) => total + item.amount, 0));
    if (Math.abs(sum - draft.subtotal) > 0.05) {
      warnings.push({
        field: "subtotal",
        message: `Line items sum to ${formatAmount(sum)} but the subtotal is ${formatAmount(draft.subtotal)}.`,
      });
    }
  }

  let currency = draft.currency;
  if (!currency) {
    currency = options.currency.toUpperCase();
    warnings.push({
      field: "currency",
      message: `Currency was not found; defaulted to ${currency}.`,
    });
  }

  let dueDate = draft.dueDate;
  if (!dueDate && draft.invoiceDate) {
    dueDate = addDays(draft.invoiceDate, dueDays);
    const why = draft.rawDueDate
      ? `Due date "${draft.rawDueDate}" could not be parsed`
      : "Due date was not found";
    warnings.push({
      field: "dueDate",
      message: `${why}; defaulted to the invoice date plus ${dueDays} days (${dueDate}).`,
    });
  } else if (dueDate && draft.invoiceDate && daysBetween(draft.invoiceDate, dueDate) < 0) {
    warnings.push({
      field: "dueDate",
      message: `Due date ${dueDate} is before invoice date ${draft.invoiceDate}.`,
    });
  }

  if (draft.taxAmount != null && draft.taxAmount > 0 && (!options.taxType || !options.taxCode)) {
    const rate = draft.taxRate != null ? ` (${draft.taxRate}%)` : "";
    const missing: string[] = [];
    if (!options.taxType) missing.push("Xero TaxType is NONE (pass --tax-type)");
    if (!options.taxCode) missing.push("QuickBooks TaxCode is NON (pass --tax-code)");
    warnings.push({
      field: "taxType",
      message: `Tax of ${formatAmount(draft.taxAmount)} ${currency}${rate} was detected. ${missing.join("; ")}. Amounts in the CSV are tax-exclusive, and the import will not accrue tax until the code matches your books.`,
    });
  }

  if (!draft.vendor) {
    errors.push({
      field: "vendor",
      message:
        "Supplier name is required. Use a letterhead with a company suffix, or a Bill From / Supplier / Vendor label.",
    });
  }
  if (!draft.invoiceNumber) {
    errors.push({
      field: "invoiceNumber",
      message: draft.rawInvoiceNumber
        ? `Invoice number "${draft.rawInvoiceNumber}" is not usable.`
        : "Invoice number is required.",
    });
  }
  if (!draft.invoiceDate) {
    errors.push({
      field: "invoiceDate",
      message: draft.rawInvoiceDate
        ? `Invoice date "${draft.rawInvoiceDate}" could not be parsed.`
        : "Invoice date is required.",
    });
  }
  for (const item of lineItems) {
    if (!item.description.trim()) {
      errors.push({ field: "lineItems", message: "A line item is missing its description." });
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      errors.push({
        field: "lineItems",
        message: `Quantity for "${item.description}" must be greater than zero.`,
      });
    }
    if (!Number.isFinite(item.unitAmount)) {
      errors.push({
        field: "lineItems",
        message: `Unit amount for "${item.description}" is not a number.`,
      });
    }
  }

  if (errors.length > 0 || !draft.vendor || !draft.invoiceNumber || !draft.invoiceDate || !dueDate) {
    return {
      file: options.sourceFile,
      status: "error",
      errors,
      // Fill-in notes (default currency, summary line, tax code) describe an exported row.
      warnings: seedWarnings,
      invoice: null,
      draft,
    };
  }

  const invoice: PreparedInvoice = {
    sourceFile: options.sourceFile,
    vendor: draft.vendor,
    invoiceNumber: draft.invoiceNumber,
    invoiceDate: draft.invoiceDate,
    dueDate,
    currency,
    subtotal: draft.subtotal,
    taxAmount: draft.taxAmount,
    taxRate: draft.taxRate,
    total: draft.total,
    taxInclusive: draft.taxInclusive,
    lineItems,
    warnings,
  };

  return {
    file: options.sourceFile,
    status: "ok",
    errors: [],
    warnings,
    invoice,
    draft,
  };
}

function normalizeUnitAmounts(items: LineItem[], warnings: Issue[]): LineItem[] {
  return items.map((item) => {
    const extended = round2(item.quantity * item.unitAmount);
    if (Math.abs(extended - round2(item.amount)) <= 0.02 || item.quantity === 0) return item;
    const unitAmount = round4(item.amount / item.quantity);
    warnings.push({
      field: "lineItems",
      message: `Adjusted the unit amount for "${item.description}" from ${formatAmount(item.unitAmount, 4)} to ${formatAmount(unitAmount, 4)} so quantity × price matches ${formatAmount(item.amount)}.`,
    });
    return { ...item, unitAmount };
  });
}

function exclusiveNet(draft: InvoiceDraft): number | null {
  if (draft.subtotal != null) return draft.subtotal;
  if (draft.total != null && draft.taxAmount != null) return round2(draft.total - draft.taxAmount);
  if (draft.total != null && draft.taxInclusive && draft.taxRate != null && draft.taxRate > 0) {
    return round2(draft.total / (1 + draft.taxRate / 100));
  }
  return draft.total;
}
