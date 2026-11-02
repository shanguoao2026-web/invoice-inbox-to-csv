import { KNOWN_CURRENCIES } from "./defaults.js";

export interface ParseMoneyOptions {
  /** Labeled totals may be whole numbers. Line items stay decimal-only so street numbers are not prices. */
  allowInteger?: boolean;
}

/**
 * Parse a money token.
 * `1,234.56` is US/UK grouping. `1.234,56` and `1234,56` are decimal-comma forms.
 * A bare integer is accepted only when `allowInteger` is set.
 */
export function parseMoney(raw: string, options: ParseMoneyOptions = {}): number | null {
  let source = raw.trim();
  if (!source) return null;

  let negative = false;
  if (/^\(.*\)$/.test(source)) {
    negative = true;
    source = source.slice(1, -1).trim();
  }

  source = source.replace(
    /^(?:USD|EUR|GBP|AUD|CAD|NZD|CHF|JPY|SEK|NOK|DKK|ZAR|SGD|HKD|CNY|INR|MXN|US\$|NZ\$|AU\$|A\$|CA\$|C\$|\$|€|£|¥)\s*/i,
    "",
  );
  source = source.replace(
    /\s*(?:USD|EUR|GBP|AUD|CAD|NZD|CHF|JPY|SEK|NOK|DKK|ZAR|SGD|HKD|CNY|INR|MXN)$/i,
    "",
  );
  source = source.replace(/\s+/g, "");

  if (source.startsWith("-")) {
    negative = true;
    source = source.slice(1);
  } else if (source.startsWith("+")) {
    source = source.slice(1);
  }

  // Decimal comma, optional dot as the thousands separator: 1.234,56 or 475,00.
  if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(source) || /^\d+,\d{2}$/.test(source)) {
    source = source.replace(/\./g, "").replace(",", ".");
  } else {
    source = source.replace(/,/g, "");
  }

  let value: number | null = null;
  if (/^\d+\.\d{2}$/.test(source)) {
    value = Number(source);
  } else if (options.allowInteger && /^\d+$/.test(source)) {
    value = Number(source);
  }
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = round2(value);
  return negative ? -rounded : rounded;
}

export function parseQuantity(raw: string): number | null {
  const source = raw.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(source)) return null;
  const value = Number(source);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function parsePercent(raw: string): number | null {
  const match = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return value;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/** Format money. `decimals` above 2 trims trailing zeros but keeps at least two places. */
export function formatAmount(value: number, decimals = 2): string {
  const negative = value < 0;
  const factor = 10 ** decimals;
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
  let text = rounded.toFixed(decimals);
  if (decimals > 2) {
    text = text.replace(/0+$/, "").replace(/\.$/, "");
    const fraction = text.split(".")[1] ?? "";
    if (fraction.length === 0) text += ".00";
    else if (fraction.length === 1) text += "0";
  }
  return negative ? `-${text}` : text;
}

export function formatQuantity(value: number): string {
  const rounded = round4(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

const CURRENCY_NAMES: Record<string, string> = {
  "us dollar": "USD",
  "us dollars": "USD",
  "united states dollar": "USD",
  "united states dollars": "USD",
  euro: "EUR",
  euros: "EUR",
  "pound sterling": "GBP",
  sterling: "GBP",
  "pound sterling gbp": "GBP",
  "new zealand dollar": "NZD",
  "new zealand dollars": "NZD",
  "australian dollar": "AUD",
  "australian dollars": "AUD",
  "canadian dollar": "CAD",
  "canadian dollars": "CAD",
};

const KNOWN_CURRENCY_SET = new Set<string>(KNOWN_CURRENCIES);

/** Read a currency from a labeled value such as `NZD` or `€`. */
export function parseCurrencyLabel(raw: string): string | null {
  const trimmed = raw.trim();
  const named = CURRENCY_NAMES[trimmed.toLowerCase().replace(/[.\s]+/g, " ").trim()];
  if (named) return named;
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  const codes = trimmed.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? [];
  const known = codes.find((code) => KNOWN_CURRENCY_SET.has(code));
  if (known) return known;
  return currencyFromSymbols(trimmed);
}

/**
 * Infer a currency from money-related lines.
 * A bare `$` is not enough, because it is shared by USD, AUD, CAD, and NZD.
 * Returns null when more than one currency is present and the total line does not settle it.
 */
export function inferCurrency(lines: string[]): string | null {
  const interesting = lines.filter((line) =>
    /currency|total|subtotal|amount|gst|vat|tax|price|due|€|£|¥|\$/i.test(line),
  );
  const found = new Set<string>();
  const blob = interesting.join("\n");
  const fromSymbols = currencyFromSymbols(blob);
  if (fromSymbols) found.add(fromSymbols);
  // Several distinct symbols can hide inside one string. Scan each.
  if (/NZ\$/i.test(blob)) found.add("NZD");
  if (/AU\$|A\$/i.test(blob)) found.add("AUD");
  if (/CA\$|C\$/i.test(blob)) found.add("CAD");
  if (/US\$/i.test(blob)) found.add("USD");
  if (blob.includes("€")) found.add("EUR");
  if (blob.includes("£")) found.add("GBP");
  if (blob.includes("¥")) found.add("JPY");

  for (const code of KNOWN_CURRENCIES) {
    if (new RegExp(`\\b${code}\\b`).test(blob)) found.add(code);
  }

  if (found.size === 1) return [...found][0] ?? null;
  if (found.size === 0) return null;

  for (const line of interesting) {
    if (!/\b(total|amount due|balance due)\b/i.test(line)) continue;
    for (const code of found) {
      if (line.toUpperCase().includes(code)) return code;
      if (code === "EUR" && line.includes("€")) return code;
      if (code === "GBP" && line.includes("£")) return code;
      if (code === "JPY" && line.includes("¥")) return code;
      if (code === "NZD" && /NZ\$/i.test(line)) return code;
      if (code === "AUD" && /AU\$|A\$/i.test(line)) return code;
      if (code === "CAD" && /CA\$|C\$/i.test(line)) return code;
      if (code === "USD" && /US\$/i.test(line)) return code;
    }
  }
  return null;
}

function currencyFromSymbols(raw: string): string | null {
  if (/NZ\$/i.test(raw)) return "NZD";
  if (/AU\$|A\$/i.test(raw)) return "AUD";
  if (/CA\$|C\$/i.test(raw)) return "CAD";
  if (/US\$/i.test(raw)) return "USD";
  if (raw.includes("€")) return "EUR";
  if (raw.includes("£")) return "GBP";
  if (raw.includes("¥")) return "JPY";
  return null;
}
