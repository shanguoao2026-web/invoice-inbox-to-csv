export const DEFAULT_CURRENCY = "USD";
export const DEFAULT_ACCOUNT_CODE = "400";
export const DEFAULT_EXPENSE_ACCOUNT = "Uncategorized Expense";
export const DEFAULT_DUE_DAYS = 30;
export const DEFAULT_POLL_MS = 2000;
export const DEFAULT_STABLE_MS = 500;
export const XERO_TAX_NONE = "NONE";
export const QBO_TAX_NONE = "NON";

/** Currencies we will infer from free text. A labeled code can be any ISO-like value. */
export const KNOWN_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "NZD",
  "CHF",
  "JPY",
  "SEK",
  "NOK",
  "DKK",
  "ZAR",
  "SGD",
  "HKD",
  "CNY",
  "INR",
  "MXN",
] as const;
