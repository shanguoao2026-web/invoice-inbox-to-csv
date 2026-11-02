import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { QBO_COLUMNS, XERO_COLUMNS, toCsv, toQboRows, toXeroRows } from "./csv/csv.js";
import { UsageError } from "./errors.js";
import { displayPath, listInvoicePdfs } from "./files.js";
import { processInvoiceFile } from "./invoice/process-file.js";
import { createLogger } from "./logger.js";
import { buildBatchReport, formatBatchReport } from "./report.js";
import type { ConvertOptions, ConvertResult, FileOutcome } from "./types.js";

export async function convertInbox(
  options: ConvertOptions,
  command: "convert" | "watch" = "convert",
): Promise<ConvertResult> {
  const logger = options.logger ?? createLogger(options.quiet);
  const resolvedIn = path.resolve(options.inPath);
  const resolvedOut = path.resolve(options.outDir);
  if (resolvedIn === resolvedOut) {
    logger.warn(
      "Input and output paths are the same. Use a separate --out directory so the inbox stays limited to PDFs.",
    );
  }

  const files = await listInvoicePdfs(options.inPath, options.recursive);
  const root = (await isDirectory(options.inPath)) ? options.inPath : path.dirname(options.inPath);
  const outcomes: FileOutcome[] = [];
  for (const filePath of files) {
    const label = displayPath(filePath, root);
    outcomes.push(
      await processInvoiceFile(filePath, label, {
        currency: options.currency,
        dueDays: options.dueDays,
        taxType: options.taxType,
        taxCode: options.taxCode,
        llmClient: options.llmClient,
        extractor: options.extractor,
      }),
    );
  }

  await mkdir(options.outDir, { recursive: true });
  const build = {
    dateFormat: options.dateFormat,
    accountCode: options.accountCode,
    expenseAccount: options.expenseAccount,
    taxType: options.taxType,
    taxCode: options.taxCode,
  };
  const outputs: string[] = [];
  const ready = outcomes.flatMap((outcome) => (outcome.invoice ? [outcome.invoice] : []));

  if (options.format === "xero" || options.format === "both") {
    const csvPath = path.join(options.outDir, "xero.csv");
    const rows = ready.flatMap((invoice) => toXeroRows(invoice, build));
    await writeFile(csvPath, toCsv(XERO_COLUMNS, rows), "utf8");
    outputs.push(csvPath);
    logger.info(`Wrote ${csvPath} (${rows.length} data ${rows.length === 1 ? "row" : "rows"})`);
  }
  if (options.format === "qbo" || options.format === "both") {
    const csvPath = path.join(options.outDir, "qbo.csv");
    const rows = ready.flatMap((invoice) => toQboRows(invoice, build));
    await writeFile(csvPath, toCsv(QBO_COLUMNS, rows), "utf8");
    outputs.push(csvPath);
    logger.info(`Wrote ${csvPath} (${rows.length} data ${rows.length === 1 ? "row" : "rows"})`);
  }

  const errorsPath = options.errorsPath ?? path.join(options.outDir, "errors.json");
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const report = buildBatchReport(outcomes, {
    generatedAt,
    command,
    format: options.format,
  });
  await mkdir(path.dirname(errorsPath), { recursive: true });
  await writeFile(errorsPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  outputs.push(errorsPath);

  const summary = formatBatchReport(outcomes);
  if (report.summary.failed > 0 || report.summary.warnings > 0) logger.warn(summary);
  else logger.info(summary);
  logger.info(`Wrote ${errorsPath}`);

  return {
    processed: report.summary.processed,
    succeeded: report.summary.succeeded,
    failed: report.summary.failed,
    outputs,
    errorsPath,
    exitCode: report.summary.failed > 0 ? 1 : 0,
    outcomes,
  };
}

async function isDirectory(inputPath: string): Promise<boolean> {
  try {
    return (await stat(inputPath)).isDirectory();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") throw new UsageError(`Input path does not exist: ${inputPath}`);
    throw error;
  }
}
