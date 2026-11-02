import {
  DEFAULT_ACCOUNT_CODE,
  DEFAULT_CURRENCY,
  DEFAULT_DUE_DAYS,
  DEFAULT_EXPENSE_ACCOUNT,
  DEFAULT_POLL_MS,
  DEFAULT_STABLE_MS,
} from "./defaults.js";
import { UsageError } from "./errors.js";
import type { CsvFormat, DateFormatName, OutputFormat } from "./types.js";

export interface ParsedArgs {
  command: "convert" | "watch" | "validate" | "help" | "version";
  inPath?: string;
  outDir?: string;
  format?: string;
  llm: boolean;
  llmBaseUrl?: string;
  llmModel?: string;
  currency?: string;
  accountCode?: string;
  expenseAccount?: string;
  taxType?: string;
  taxCode?: string;
  dueDays?: number;
  dateFormat?: string;
  recursive: boolean;
  errorsPath?: string;
  quiet: boolean;
  pollMs?: number;
  stableMs?: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: "help",
    llm: false,
    recursive: false,
    quiet: false,
  };

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    parsed.command = "help";
    return parsed;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    parsed.command = "version";
    return parsed;
  }

  const command = argv[0];
  if (command !== "convert" && command !== "watch" && command !== "validate") {
    throw new UsageError(`Unknown command "${command}".`);
  }
  parsed.command = command;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;
    if (token === "--help" || token === "-h") {
      parsed.command = "help";
      return parsed;
    }
    if (token === "--llm") {
      parsed.llm = true;
      continue;
    }
    if (token === "--recursive") {
      parsed.recursive = true;
      continue;
    }
    if (token === "--quiet") {
      parsed.quiet = true;
      continue;
    }

    let flag = token;
    let inlineValue: string | undefined;
    if (token.startsWith("--") && token.includes("=")) {
      const equals = token.indexOf("=");
      flag = token.slice(0, equals);
      inlineValue = token.slice(equals + 1);
      if (!inlineValue) throw new UsageError(`Option "${flag}" needs a value.`);
    }
    const value =
      inlineValue === undefined ? readValue(argv, index) : { value: inlineValue, nextIndex: index };
    index = value.nextIndex;
    switch (flag) {
      case "--in":
        parsed.inPath = value.value;
        break;
      case "--out":
        parsed.outDir = value.value;
        break;
      case "--format":
        parsed.format = value.value;
        break;
      case "--llm-base-url":
        parsed.llmBaseUrl = value.value;
        break;
      case "--llm-model":
        parsed.llmModel = value.value;
        break;
      case "--currency":
        parsed.currency = value.value;
        break;
      case "--account-code":
        parsed.accountCode = value.value;
        break;
      case "--expense-account":
        parsed.expenseAccount = value.value;
        break;
      case "--tax-type":
        parsed.taxType = value.value;
        break;
      case "--tax-code":
        parsed.taxCode = value.value;
        break;
      case "--due-days":
        parsed.dueDays = readWholeNumber("--due-days", value.value);
        break;
      case "--date-format":
        parsed.dateFormat = value.value;
        break;
      case "--errors":
        parsed.errorsPath = value.value;
        break;
      case "--poll-ms":
        parsed.pollMs = readWholeNumber("--poll-ms", value.value);
        break;
      case "--stable-ms":
        parsed.stableMs = readWholeNumber("--stable-ms", value.value);
        break;
      default:
        throw new UsageError(`Unknown option "${token}".`);
    }
  }

  return parsed;
}

function readValue(argv: string[], index: number): { value: string; nextIndex: number } {
  const token = argv[index] ?? "";
  const equals = token.indexOf("=");
  if (equals >= 0) {
    const value = token.slice(equals + 1);
    if (!value) throw new UsageError(`Option "${token.slice(0, equals)}" needs a value.`);
    return { value, nextIndex: index };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`Option "${token}" needs a value.`);
  }
  return { value, nextIndex: index + 1 };
}

function readWholeNumber(flag: string, raw: string): number {
  if (!/^\d+$/.test(raw)) throw new UsageError(`${flag} must be a whole number.`);
  return Number(raw);
}

export function requireOutputFormat(raw: string | undefined): OutputFormat {
  const value = (raw ?? "both").toLowerCase();
  if (value === "xero" || value === "qbo" || value === "both") return value;
  throw new UsageError(`--format must be xero, qbo, or both. Received "${raw}".`);
}

export function requireCsvFormat(raw: string | undefined): CsvFormat {
  if (!raw) throw new UsageError("validate requires --format xero or --format qbo.");
  const value = raw.toLowerCase();
  if (value === "xero" || value === "qbo") return value;
  throw new UsageError(`validate --format must be xero or qbo. Received "${raw}".`);
}

export function requireDateFormat(raw: string | undefined): DateFormatName {
  const value = (raw ?? "iso").toLowerCase();
  if (value === "iso" || value === "dmy" || value === "mdy") return value;
  throw new UsageError(`--date-format must be iso, dmy, or mdy. Received "${raw}".`);
}

export function sharedSettings(parsed: ParsedArgs): {
  currency: string;
  accountCode: string;
  expenseAccount: string;
  taxType: string | null;
  taxCode: string | null;
  dueDays: number;
  dateFormat: DateFormatName;
  pollMs: number;
  stableMs: number;
} {
  const currency = (parsed.currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new UsageError("--currency must be a 3-letter ISO code.");
  }
  const accountCode = (parsed.accountCode ?? DEFAULT_ACCOUNT_CODE).trim();
  if (!accountCode) throw new UsageError("--account-code cannot be empty.");
  const expenseAccount = (parsed.expenseAccount ?? DEFAULT_EXPENSE_ACCOUNT).trim();
  if (!expenseAccount) throw new UsageError("--expense-account cannot be empty.");
  const dueDays = parsed.dueDays ?? DEFAULT_DUE_DAYS;
  const pollMs = parsed.pollMs ?? DEFAULT_POLL_MS;
  const stableMs = parsed.stableMs ?? DEFAULT_STABLE_MS;
  if (pollMs < 50) throw new UsageError("--poll-ms must be at least 50.");
  if (stableMs > 60_000) throw new UsageError("--stable-ms must be 60000 or less.");
  return {
    currency,
    accountCode,
    expenseAccount,
    taxType: parsed.taxType?.trim() || null,
    taxCode: parsed.taxCode?.trim() || null,
    dueDays,
    dateFormat: requireDateFormat(parsed.dateFormat),
    pollMs,
    stableMs,
  };
}
