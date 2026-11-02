import type { CsvValidationReport, FileOutcome, Issue } from "./types.js";

export interface BatchReport {
  generatedAt: string;
  command: "convert" | "watch";
  format: string;
  summary: {
    processed: number;
    succeeded: number;
    failed: number;
    warnings: number;
  };
  results: Array<{
    file: string;
    status: "ok" | "error";
    invoiceNumber: string | null;
    vendor: string | null;
    errors: Issue[];
    warnings: Issue[];
  }>;
}

export function buildBatchReport(
  outcomes: FileOutcome[],
  meta: { generatedAt: string; command: "convert" | "watch"; format: string },
): BatchReport {
  return {
    generatedAt: meta.generatedAt,
    command: meta.command,
    format: meta.format,
    summary: {
      processed: outcomes.length,
      succeeded: outcomes.filter((outcome) => outcome.status === "ok").length,
      failed: outcomes.filter((outcome) => outcome.status === "error").length,
      warnings: outcomes.reduce((count, outcome) => count + outcome.warnings.length, 0),
    },
    results: outcomes.map((outcome) => ({
      file: outcome.file,
      status: outcome.status,
      invoiceNumber: outcome.invoice?.invoiceNumber ?? outcome.draft?.invoiceNumber ?? null,
      vendor: outcome.invoice?.vendor ?? outcome.draft?.vendor ?? null,
      errors: outcome.errors,
      warnings: outcome.warnings,
    })),
  };
}

export function formatBatchReport(outcomes: FileOutcome[]): string {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.errors.length === 0 && outcome.warnings.length === 0) continue;
    lines.push(outcome.file);
    for (const issue of outcome.errors) {
      lines.push(`  error: ${issue.field} — ${issue.message}`);
    }
    for (const issue of outcome.warnings) {
      lines.push(`  warning: ${issue.field} — ${issue.message}`);
    }
  }
  const failed = outcomes.filter((outcome) => outcome.status === "error").length;
  const succeeded = outcomes.length - failed;
  const noun = outcomes.length === 1 ? "file" : "files";
  lines.push(
    `${outcomes.length} ${noun} processed, ${succeeded} exported, ${failed} failed.`,
  );
  return lines.join("\n");
}

export function formatCsvReport(report: CsvValidationReport): string {
  const lines: string[] = [report.file];
  for (const issue of report.errors) {
    lines.push(`  error: row ${issue.row} ${issue.field} — ${issue.message}`);
  }
  for (const issue of report.warnings) {
    lines.push(`  warning: row ${issue.row} ${issue.field} — ${issue.message}`);
  }
  lines.push(
    `${report.dataRows} data row${report.dataRows === 1 ? "" : "s"}, ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}, ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}.`,
  );
  return lines.join("\n");
}

export interface ValidateJsonReport {
  generatedAt: string;
  command: "validate";
  format: string;
  file: string;
  summary: { rows: number; errors: number; warnings: number };
  errors: CsvValidationReport["errors"];
  warnings: CsvValidationReport["warnings"];
}

export function buildValidateJson(
  report: CsvValidationReport,
  generatedAt: string,
): ValidateJsonReport {
  return {
    generatedAt,
    command: "validate",
    format: report.format,
    file: report.file,
    summary: {
      rows: report.dataRows,
      errors: report.errors.length,
      warnings: report.warnings.length,
    },
    errors: report.errors,
    warnings: report.warnings,
  };
}
