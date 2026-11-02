export type AmbiguousDateOrder = "dmy" | "mdy";

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

/**
 * Parse a human invoice date into `YYYY-MM-DD`.
 * Numeric dates are unambiguous when one side is greater than 12.
 * When both day and month are 12 or less, `ambiguous` decides. The default is day-first,
 * which matches most invoices outside the United States.
 */
export function parseDate(raw: string, ambiguous: AmbiguousDateOrder = "dmy"): string | null {
  const cleaned = raw
    .trim()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\d+)(?:st|nd|rd|th)\b/gi, "$1");
  if (!cleaned) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  if (iso?.[1] && iso[2] && iso[3]) {
    return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dayMonth = /^(\d{1,2})(?:\s+|[\/\-.])([A-Za-z]+)(?:\s+|[\/\-.])(\d{2,4})$/.exec(cleaned);
  if (dayMonth?.[1] && dayMonth[2] && dayMonth[3]) {
    const month = MONTHS[dayMonth[2].toLowerCase()];
    if (month) return toIso(expandYear(dayMonth[3]), month, Number(dayMonth[1]));
  }

  const monthDay = /^([A-Za-z]+)(?:\s+|[\/\-.])(\d{1,2})(?:\s+|[\/\-.])(\d{2,4})$/.exec(cleaned);
  if (monthDay?.[1] && monthDay[2] && monthDay[3]) {
    const month = MONTHS[monthDay[1].toLowerCase()];
    if (month) return toIso(expandYear(monthDay[3]), month, Number(monthDay[2]));
  }

  const numeric = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(cleaned);
  if (numeric?.[1] && numeric[2] && numeric[3]) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = expandYear(numeric[3]);
    let day = first;
    let month = second;
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      month = first;
      day = second;
    } else if (first <= 12 && second <= 12) {
      if (ambiguous === "mdy") {
        month = first;
        day = second;
      } else {
        day = first;
        month = second;
      }
    } else {
      return null;
    }
    return toIso(year, month, day);
  }

  return null;
}

export function formatDate(iso: string, format: "iso" | "dmy" | "mdy"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match?.[1] || !match[2] || !match[3]) return iso;
  if (format === "dmy") return `${match[3]}/${match[2]}/${match[1]}`;
  if (format === "mdy") return `${match[2]}/${match[3]}/${match[1]}`;
  return iso;
}

export function addDays(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Cannot add days to invalid date ${iso}`);
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function paymentTerms(invoiceDate: string, dueDate: string): string {
  const days = daysBetween(invoiceDate, dueDate);
  if (!Number.isFinite(days) || days < 0) return "";
  if (days === 0) return "Due on receipt";
  return `Net ${days}`;
}

export function isValidIsoDate(iso: string): boolean {
  return parseDate(iso) === iso;
}

function expandYear(raw: string): number {
  const year = Number(raw);
  if (raw.length <= 2) return 2000 + year;
  return year;
}

function toIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  return `${year}-${monthText}-${dayText}`;
}
