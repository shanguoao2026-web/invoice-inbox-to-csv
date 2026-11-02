import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateCsvText } from "./csv/validate-csv.js";
import type { AmbiguousDateOrder } from "./dates.js";
import { UsageError } from "./errors.js";
import { createLogger } from "./logger.js";
import { buildValidateJson, formatCsvReport } from "./report.js";
import type { CsvFormat, Logger } from "./types.js";

export interface ValidateCommandOptions {
  csvPath: string;
  format: CsvFormat;
  ambiguousDates: AmbiguousDateOrder;
  errorsPath?: string;
  quiet: boolean;
  logger?: Logger;
  now?: () => Date;
}

export async function validateCsvFile(
  options: ValidateCommandOptions,
): Promise<{ exitCode: number; reportPath?: string }> {
  const logger = options.logger ?? createLogger(options.quiet);
  let text: string;
  try {
    text = await readFile(options.csvPath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") throw new UsageError(`CSV not found: ${options.csvPath}`);
    if (code === "EISDIR") throw new UsageError(`--in must be a CSV file for validate: ${options.csvPath}`);
    throw error;
  }

  const report = validateCsvText(text, {
    format: options.format,
    file: options.csvPath,
    ambiguousDates: options.ambiguousDates,
  });
  const rendered = formatCsvReport(report);
  if (report.errors.length > 0) logger.error(rendered);
  else if (report.warnings.length > 0) logger.warn(rendered);
  else logger.info(rendered);

  let reportPath: string | undefined;
  if (options.errorsPath) {
    reportPath = options.errorsPath;
    await mkdir(path.dirname(reportPath), { recursive: true });
    const body = buildValidateJson(report, (options.now ?? (() => new Date()))().toISOString());
    await writeFile(reportPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    logger.info(`Wrote ${reportPath}`);
  }

  return { exitCode: report.errors.length > 0 ? 1 : 0, reportPath };
}
