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

/** Trade words that mark a letterhead even when there is no Ltd/Inc suffix. */
const TRADE_WORD = /\b(?:stationers|cafe|café|trading|services|studio|consulting)\b/i;

const TRAILING_BANNER =
  /\s+(?:tax\s+invoice|commercial\s+invoice|payment\s+receipt|credit\s+note|remittance(?:\s+advice)?|invoice|bill|statement|receipt|quote|estimate)\s*$/i;

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
 * Labeled lines (`Invoice Number:`, `Invoice date 18 September 2026`, `GST 15%`) win over the letterhead guess.
 * A colon or whitespace may separate a label from its value. Without a colon, the value must look like a date,
 * an amount, or an id that contains a digit, so a bare label is not captured.
 * A line is a line item when it ends in quantity, unit price, and amount, or in a single amount
 * whose description contains no bare numbers. Tax, subtotal, and total rows are not line items.
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
    if (consumed.has(index) || isTableHeader(line) || isSummaryLine(line)) return;
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
  const invoiceDate = acceptDate(
    line,
    /^(?:invoice\s*date|date\s*of\s*issue|issue\s*date|bill\s*date|tax\s*point|document\s*date)(?:\s*[:：]\s*|\s+)(.+)$/i,
  );
  if (invoiceDate) return { key: "invoiceDate", value: invoiceDate };

  const dueDate = acceptDate(
    line,
    /^(?:due\s*date|payment\s*due|date\s*due|pay\s*by|due)(?:\s*[:：]\s*|\s+)(.+)$/i,
  );
  if (dueDate) return { key: "dueDate", value: dueDate };

  const invoiceNumber = acceptId(
    line,
    /^(?:invoice\s*(?:number|no\.?|num(?:ber)?)|invoice\s*#|inv\.?\s*(?:no\.?|#)|bill\s*(?:number|no\.?|#)|bill\s*#)\s*[:：#]?\s*(.+)$/i,
  );
  if (invoiceNumber) return { key: "invoiceNumber", value: invoiceNumber };

  const currency = /^(?:currency|ccy)\s*[:：]\s*(.+)$/i.exec(line);
  if (currency?.[1]) return { key: "currency", value: currency[1].trim() };

  const vendor = /^(?:bill\s*from|supplier|vendor|seller|from|issued\s*by|biller)\s*[:：]\s*(.+)$/i.exec(line);
  if (vendor?.[1]) return { key: "vendor", value: vendor[1].trim() };

  const billTo = /^(?:bill\s*to|billed\s*to|customer|sold\s*to|ship\s*to|invoice\s*to)\s*[:：]\s*(.+)$/i.exec(line);
  if (billTo?.[1]) return { key: "billTo", value: billTo[1].trim() };

  const taxRate = /^(?:(?:gst|vat|hst|sales\s*tax|tax)\s*rate)\s*[:：]\s*(.+)$/i.exec(line);
  if (taxRate?.[1]) return { key: "taxRate", value: taxRate[1].trim() };

  const subtotal = acceptMoney(
    line,
    /^(?:sub\s*total|subtotal|net\s*amount|amount\s*excluding(?:\s*(?:gst|vat|tax))?|total\s*ex(?:cl\.?)?(?:\s*tax)?)(?:\s*[:：]\s*|\s+)(.+)$/i,
  );
  if (subtotal) return { key: "subtotal", value: subtotal };

  const tax = matchTax(line);
  if (tax) return tax;

  const total = acceptMoney(
    line,
    /^(?:grand\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|total(?:\s*(?:including|incl\.?)\s*(?:gst|vat|tax))?|amount)(?:\s*[:：]\s*|\s+)(.+)$/i,
  );
  if (total) return { key: "total", value: total };

  const genericDate = /^(?:date)\s*[:：]\s*(.+)$/i.exec(line);
  if (genericDate?.[1]) return { key: "invoiceDate", value: genericDate[1].trim() };

  return null;
}

/**
 * Colon-separated labels keep their old behaviour.
 * When the colon is absent, whitespace must introduce a real date, amount, or id.
 * Reconstructed PDF lines usually contain a single space, so the value shape is the guard.
 */
function captureLabel(line: string, re: RegExp): { value: string; colon: boolean } | null {
  const match = re.exec(line);
  const value = match?.[1]?.trim();
  if (!value) return null;
  const index = line.lastIndexOf(value);
  const prefix = index >= 0 ? line.slice(0, index) : line;
  return { value, colon: /[:：]/.test(prefix) };
}

function acceptDate(line: string, re: RegExp): string | null {
  const hit = captureLabel(line, re);
  if (!hit) return null;
  if (!hit.colon && (parseDate(hit.value) == null || !/\d/.test(hit.value))) return null;
  return hit.value;
}

function acceptMoney(line: string, re: RegExp): string | null {
  const hit = captureLabel(line, re);
  if (!hit) return null;
  if (!hit.colon && (parseMoney(hit.value, { allowInteger: true }) == null || !/\d/.test(hit.value))) return null;
  return hit.value;
}

function acceptId(line: string, re: RegExp): string | null {
  const hit = captureLabel(line, re);
  if (!hit) return null;
  if (!hit.colon) {
    const number = cleanInvoiceNumber(hit.value);
    if (!number || !/\d/.test(number)) return null;
  }
  return hit.value;
}

function matchTax(line: string): TaxHit | null {
  const colon =
    /^(?:gst|vat|hst|pst|sales\s*tax|tax)(?:\s*\(\s*([^)]*?)\s*\))?\s*[:：]\s*(.+)$/i.exec(line);
  if (colon?.[2]) {
    const rate = colon[1]?.trim();
    return { key: "tax", amount: colon[2].trim(), rate: rate ? rate : null };
  }

  // "GST 15% $517.50", "GST at 18% ₹2,646.36", "VAT 19%: 264,10", "VAT 19% 264,10".
  const rated =
    /^(?:gst|vat|hst|pst|sales\s*tax|tax)(?:\s+at)?\s+(\d+(?:\.\d+)?)\s*%\s*[:：]?\s*(.+)$/i.exec(line);
  if (rated?.[1] && rated[2]) {
    const amount = rated[2].trim();
    if (!/\d/.test(amount) || parseMoney(amount, { allowInteger: true }) == null) return null;
    return { key: "tax", amount, rate: `${rated[1]}%` };
  }

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
  let placeholder: string | null = null;
  for (const line of lines) {
    if (matchLabel(line)) break;
    if (BANNER.test(line)) continue;
    const cleaned = cleanLetterhead(line);
    if (!cleaned || BANNER.test(cleaned)) continue;
    if (isContactOrAddress(cleaned)) continue;
    if (isPlaceholderName(cleaned)) {
      placeholder ??= cleaned;
      continue;
    }
    if (looksLikeOrganisation(cleaned)) return cleaned;
  }
  return placeholder;
}

function cleanLetterhead(line: string): string {
  return line.replace(TRAILING_BANNER, "").replace(/[.,]+$/g, "").trim();
}

/** "A fictional company" and "SPECIMEN" lose to any earlier or later real letterhead. */
function isPlaceholderName(line: string): boolean {
  return /^(?:a\s+fictional\s+company|specimen)$/i.test(line.trim());
}

function looksLikeOrganisation(line: string): boolean {
  if (line.length < 3 || line.length > 100) return false;
  if (!/[A-Za-z]{2,}/.test(line)) return false;
  if (parseDate(line)) return false;
  if (COMPANY_SUFFIX.test(line)) return true;
  if (TRADE_WORD.test(line)) return true;
  if (capitalisedWordCount(line) >= 2) return true;
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.8;
}

function capitalisedWordCount(line: string): number {
  return line.split(/\s+/).filter((word) => {
    const bare = word.replace(/^[("'\[]+|[)"',.\]]+$/g, "");
    if (!bare) return false;
    return /^[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*$/.test(bare) || /^[A-Z]{2,}$/.test(bare);
  }).length;
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
  if (isTableHeader(line) || isSummaryLine(line)) return null;
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

function isSummaryLine(line: string): boolean {
  if (isSummaryLabel(line)) return true;
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 2) return false;
  const last = tokens[tokens.length - 1] ?? "";
  if (parseMoney(last) == null) return false;
  return isSummaryLabel(tokens.slice(0, -1).join(" "));
}

function isSummaryLabel(description: string): boolean {
  const label = description.trim().replace(/[:#]+$/g, "").trim();
  if (
    /^(?:sub\s*total|subtotal|grand\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|total|amount|currency|invoice\s*date|due\s*date|invoice\s*(?:number|no\.?)|bill\s*from|bill\s*to|supplier|vendor|qty|quantity|unit\s*price|description|balance|payment\s*due|date\s*due|pay\s*by)$/i.test(
      label,
    )
  ) {
    return true;
  }
  return /^(?:incl\.?\s*)?(?:gst|vat|hst|pst|sales\s*tax|tax)(?:\s+at)?(?:\s*\(?\s*\d+(?:\.\d+)?\s*%\s*\)?)?$/i.test(
    label,
  );
}
