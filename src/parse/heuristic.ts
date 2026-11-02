import { parseDate } from "../dates.js";
import {
  inferCurrency,
  parseCurrencyLabel,
  parseMoney,
  parsePercent,
  parseQuantity,
  round2,
} from "../money.js";
import type { InvoiceDraft, LineItem } from "../types.js";

const INCLUSIVE_PATTERN =
  /(?:prices?\s+include|inclusive\s+of|tax[\s-]+inclusive|vat[\s-]+inclusive|gst[\s-]+inclusive|incl\.?\s*(?:gst|vat|tax))/i;

const BANNER =
  /^(?:tax\s+invoice|commercial\s+invoice|invoice|bill|statement|receipt|payment\s+receipt|credit\s+note|remittance(?:\s+advice)?|quote|estimate)$/i;

const COMPANY_SUFFIX =
  /\b(?:ltd|limited|inc|incorporated|llc|llp|gmbh|pty|plc|corp|corporation|company|bv|ag|sa|sarl|srl|oy|ab|nv|kg)\b\.?|\bco\b\.?/i;

export function emptyDraft(): InvoiceDraft {
  return {
    vendor: null,
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    currency: null,
    subtotal: null,
    taxAmount: null,
    taxRate: null,
    total: null,
    taxInclusive: false,
    lineItems: [],
    rawInvoiceNumber: null,
    rawInvoiceDate: null,
    rawDueDate: null,
  };
}

export function normalizeLines(text: string): string[] {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\f/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !/^--\s*\d+\s+of\s+\d+\s*--$/.test(line));
}

/**
 * Read common English invoice layouts.
 * Labeled lines (`Invoice Number:`, `GST (15%):`, `Bill From:`) win over the letterhead guess.
 * A line is a line item when it ends in quantity, unit price, and amount, or in a single amount
 * whose description contains no bare numbers.
 */
export function parseInvoiceText(text: string): InvoiceDraft {
  const lines = normalizeLines(text);
  const draft = emptyDraft();
  const consumed = new Set<number>();

  lines.forEach((line, index) => {
    const hit = matchLabel(line);
    if (!hit) return;
    consumed.add(index);
    applyLabel(draft, hit);
  });

  if (!draft.vendor) draft.vendor = fallbackVendor(lines);
  if (!draft.currency) draft.currency = inferCurrency(lines);
  draft.taxInclusive = INCLUSIVE_PATTERN.test(text);
  fillDerivedTotals(draft);

  lines.forEach((line, index) => {
    if (consumed.has(index) || isTableHeader(line)) return;
    const item = parseItemLine(line);
    if (item) draft.lineItems.push(item);
  });

  return draft;
}

interface TextHit {
  key:
    | "invoiceDate"
    | "dueDate"
    | "invoiceNumber"
    | "currency"
    | "vendor"
    | "billTo"
    | "subtotal"
    | "total"
    | "taxRate";
  value: string;
}

interface TaxHit {
  key: "tax";
  amount: string;
  rate: string | null;
}

type LabelHit = TextHit | TaxHit;

function matchLabel(line: string): LabelHit | null {
  const patterns: Array<{ key: TextHit["key"]; re: RegExp }> = [
    {
      key: "invoiceDate",
      re: /^(?:invoice\s*date|date\s*of\s*issue|issue\s*date|bill\s*date|tax\s*point|document\s*date)\s*:\s*(.+)$/i,
    },
    {
      key: "dueDate",
      re: /^(?:due\s*date|payment\s*due|date\s*due|pay\s*by|due)\s*:\s*(.+)$/i,
    },
    {
      key: "invoiceNumber",
      re: /^(?:invoice\s*(?:number|no\.?|num(?:ber)?)|invoice\s*#|inv\.?\s*(?:no\.?|#)|bill\s*(?:number|no\.?|#)|bill\s*#)\s*[:#]?\s*(.+)$/i,
    },
    { key: "currency", re: /^(?:currency|ccy)\s*:\s*(.+)$/i },
    {
      key: "vendor",
      re: /^(?:bill\s*from|supplier|vendor|seller|from|issued\s*by|biller)\s*:\s*(.+)$/i,
    },
    {
      key: "billTo",
      re: /^(?:bill\s*to|billed\s*to|customer|sold\s*to|ship\s*to|invoice\s*to)\s*:\s*(.+)$/i,
    },
    {
      key: "taxRate",
      re: /^(?:(?:gst|vat|hst|sales\s*tax|tax)\s*rate)\s*:\s*(.+)$/i,
    },
    {
      key: "subtotal",
      re: /^(?:sub\s*total|subtotal|net\s*amount|amount\s*excluding(?:\s*(?:gst|vat|tax))?|total\s*ex(?:cl\.?)?(?:\s*tax)?)\s*:\s*(.+)$/i,
    },
  ];

  for (const pattern of patterns) {
    const match = pattern.re.exec(line);
    if (match?.[1]) return { key: pattern.key, value: match[1].trim() };
  }

  const tax = /^(?:gst|vat|hst|pst|sales\s*tax|tax)(?:\s*\(([^)]*)\))?\s*:\s*(.+)$/i.exec(line);
  if (tax?.[2]) return { key: "tax", amount: tax[2].trim(), rate: tax[1]?.trim() ?? null };

  const total =
    /^(?:grand\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|total(?:\s*(?:including|incl\.?)\s*(?:gst|vat|tax))?|amount)\s*:\s*(.+)$/i.exec(
      line,
    );
  if (total?.[1]) return { key: "total", value: total[1].trim() };

  const genericDate = /^(?:date)\s*:\s*(.+)$/i.exec(line);
  if (genericDate?.[1]) return { key: "invoiceDate", value: genericDate[1].trim() };

  return null;
}

function applyLabel(draft: InvoiceDraft, hit: LabelHit): void {
  if (hit.key === "tax") {
    const rateSource = hit.rate ?? "";
    const rate = rateSource ? parsePercent(rateSource) : null;
    const amount = parseMoney(hit.amount, { allowInteger: true });
    if (rate != null && draft.taxRate == null) draft.taxRate = rate;
    if (amount != null && draft.taxAmount == null) draft.taxAmount = amount;
    return;
  }

  if (hit.key === "billTo") return;

  if (hit.key === "invoiceDate" && draft.invoiceDate == null) {
    const iso = parseDate(hit.value);
    if (iso) {
      draft.invoiceDate = iso;
      draft.rawInvoiceDate = null;
    } else if (!draft.rawInvoiceDate) {
      draft.rawInvoiceDate = hit.value;
    }
    return;
  }

  if (hit.key === "dueDate" && draft.dueDate == null) {
    const iso = parseDate(hit.value);
    if (iso) {
      draft.dueDate = iso;
      draft.rawDueDate = null;
    } else if (!draft.rawDueDate) {
      draft.rawDueDate = hit.value;
    }
    return;
  }

  if (hit.key === "invoiceNumber" && draft.invoiceNumber == null) {
    const number = cleanInvoiceNumber(hit.value);
    if (number) {
      draft.invoiceNumber = number;
      draft.rawInvoiceNumber = null;
    } else if (!draft.rawInvoiceNumber) {
      draft.rawInvoiceNumber = hit.value;
    }
    return;
  }

  if (hit.key === "currency" && draft.currency == null) {
    draft.currency = parseCurrencyLabel(hit.value);
    return;
  }

  if (hit.key === "vendor" && draft.vendor == null) {
    draft.vendor = cleanParty(hit.value);
    return;
  }

  if (hit.key === "taxRate" && draft.taxRate == null) {
    draft.taxRate = parsePercent(hit.value);
    return;
  }

  if (hit.key === "subtotal" && draft.subtotal == null) {
    draft.subtotal = parseMoney(hit.value, { allowInteger: true });
    return;
  }

  if (hit.key === "total" && draft.total == null) {
    draft.total = parseMoney(hit.value, { allowInteger: true });
  }
}

function fillDerivedTotals(draft: InvoiceDraft): void {
  if (draft.total == null && draft.subtotal != null && draft.taxAmount != null) {
    draft.total = round2(draft.subtotal + draft.taxAmount);
  }
  if (draft.subtotal == null && draft.total != null && draft.taxAmount != null) {
    draft.subtotal = round2(draft.total - draft.taxAmount);
  }
  if (draft.taxAmount == null && draft.total != null && draft.subtotal != null) {
    const diff = round2(draft.total - draft.subtotal);
    if (diff >= 0) draft.taxAmount = diff;
  }
}

function fallbackVendor(lines: string[]): string | null {
  for (const line of lines) {
    if (BANNER.test(line)) continue;
    if (isContactOrAddress(line)) continue;
    if (matchLabel(line)) break;
    if (looksLikeOrganisation(line)) return line.replace(/[.,]+$/g, "").trim();
  }
  return null;
}

function looksLikeOrganisation(line: string): boolean {
  if (line.length < 3 || line.length > 100) return false;
  if (!/[A-Za-z]{2,}/.test(line)) return false;
  if (COMPANY_SUFFIX.test(line)) return true;
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.8;
}

function isContactOrAddress(line: string): boolean {
  if (/@/.test(line) || /^https?:\/\//i.test(line) || /^www\./i.test(line)) return true;
  if (/^(?:phone|tel|telephone|fax|mobile|email|e-mail)\b/i.test(line)) return true;
  if (
    /^\d+\s+.+\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|boulevard|blvd|place|pl|terrace|crescent|highway|hwy|strasse|straße|box)\b/i.test(
      line,
    )
  ) {
    return true;
  }
  if (/^(?:po|p\.o\.)\s*box\b/i.test(line)) return true;
  return false;
}

function cleanParty(raw: string): string | null {
  const value = raw.replace(/\s+/g, " ").trim().replace(/[.,;]+$/g, "");
  if (value.length < 2 || value.length > 120) return null;
  if (!/[A-Za-z]/.test(value)) return null;
  return value;
}

function cleanInvoiceNumber(raw: string): string | null {
  let value = raw.trim().replace(/^[#:\s]+/, "").replace(/[.,;]+$/g, "").trim();
  if (!value || value.length > 50) return null;
  if (!/[A-Za-z0-9]/.test(value)) return null;
  if (parseDate(value)) return null;
  const words = value.split(/\s+/);
  const first = words[0];
  if (words.length > 3 && first && /^[A-Za-z0-9][A-Za-z0-9\-\/.]{1,49}$/.test(first)) {
    return first;
  }
  if (words.length > 4) return null;
  return value;
}

function isTableHeader(line: string): boolean {
  return (
    /\bdescription\b/i.test(line) &&
    /\b(?:qty|quantity)\b/i.test(line) &&
    /\b(?:amount|price)\b/i.test(line)
  );
}

function parseItemLine(line: string): LineItem | null {
  if (isTableHeader(line)) return null;
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1] ?? "";
  const amount = parseMoney(last);
  if (amount == null) return null;

  if (tokens.length >= 4) {
    const unit = parseMoney(tokens[tokens.length - 2] ?? "");
    const quantity = parseQuantity(tokens[tokens.length - 3] ?? "");
    if (unit != null && quantity != null) {
      const description = tokens.slice(0, -3).join(" ").trim();
      if (validDescription(description)) {
        return { description, quantity, unitAmount: unit, amount };
      }
    }
  }

  const description = tokens.slice(0, -1).join(" ").trim();
  if (!validDescription(description)) return null;
  const hasBareNumber = description.split(/\s+/).some((token) => {
    const plain = token.replace(/,/g, "");
    return /^\d+(?:\.\d+)?$/.test(plain);
  });
  if (hasBareNumber) return null;
  return { description, quantity: 1, unitAmount: amount, amount };
}

function validDescription(description: string): boolean {
  if (description.length < 2) return false;
  if (!/[A-Za-z]/.test(description)) return false;
  return !isSummaryLabel(description);
}

function isSummaryLabel(description: string): boolean {
  const label = description.trim().replace(/[:#]+$/g, "").trim();
  return /^(?:sub\s*total|subtotal|grand\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|total|gst|vat|hst|pst|sales\s*tax|tax|amount|currency|invoice\s*date|due\s*date|invoice\s*(?:number|no)|bill\s*from|bill\s*to|supplier|vendor|qty|quantity|unit\s*price|description|balance)$/i.test(
    label,
  );
}
