import type { InvoiceDraft } from "../types.js";

/** Fill only fields the heuristic left empty. Line items from the PDF win when any were found. */
export function mergeDraft(base: InvoiceDraft, extra: Partial<InvoiceDraft>): InvoiceDraft {
  return {
    vendor: preferText(base.vendor, extra.vendor),
    invoiceNumber: preferText(base.invoiceNumber, extra.invoiceNumber),
    invoiceDate: preferText(base.invoiceDate, extra.invoiceDate),
    dueDate: preferText(base.dueDate, extra.dueDate),
    currency: preferText(base.currency, extra.currency),
    subtotal: preferNumber(base.subtotal, extra.subtotal),
    taxAmount: preferNumber(base.taxAmount, extra.taxAmount),
    taxRate: preferNumber(base.taxRate, extra.taxRate),
    total: preferNumber(base.total, extra.total),
    taxInclusive: base.taxInclusive,
    lineItems:
      base.lineItems.length > 0
        ? base.lineItems
        : extra.lineItems && extra.lineItems.length > 0
          ? extra.lineItems
          : base.lineItems,
    rawInvoiceNumber: base.rawInvoiceNumber,
    rawInvoiceDate: base.rawInvoiceDate,
    rawDueDate: base.rawDueDate,
  };
}

function preferText(current: string | null, incoming: string | null | undefined): string | null {
  if (current && current.trim()) return current;
  if (incoming && incoming.trim()) return incoming;
  return current;
}

function preferNumber(current: number | null, incoming: number | null | undefined): number | null {
  if (current != null) return current;
  if (incoming != null && Number.isFinite(incoming)) return incoming;
  return current;
}
