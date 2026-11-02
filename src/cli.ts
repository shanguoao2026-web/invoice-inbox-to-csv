#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  requireCsvFormat,
  requireOutputFormat,
  sharedSettings,
} from "./args.js";
import { convertInbox } from "./convert.js";
import { UsageError, errorMessage } from "./errors.js";
import { HELP } from "./help.js";
import { createLogger } from "./logger.js";
import { createLlmClient, resolveLlmConfig } from "./parse/llm.js";
import { validateCsvFile } from "./validate-command.js";
import { watchInbox } from "./watch.js";

export async function run(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.command === "help") {
      console.log(HELP);
      return 0;
    }
    if (parsed.command === "version") {
      console.log(readVersion());
      return 0;
    }

    const settings = sharedSettings(parsed);
    const logger = createLogger(parsed.quiet);

    if (parsed.command === "validate") {
      if (!parsed.inPath) throw new UsageError("validate requires --in <file.csv>.");
      const format = requireCsvFormat(parsed.format);
      const ambiguous = settings.dateFormat === "mdy" ? "mdy" : "dmy";
      const result = await validateCsvFile({
        csvPath: parsed.inPath,
        format,
        ambiguousDates: ambiguous,
        errorsPath: parsed.errorsPath,
        quiet: parsed.quiet,
        logger,
      });
      return result.exitCode;
    }

    if (!parsed.inPath) throw new UsageError(`${parsed.command} requires --in <directory>.`);
    if (!parsed.outDir) throw new UsageError(`${parsed.command} requires --out <directory>.`);
    const format = requireOutputFormat(parsed.format);
    const llmClient = parsed.llm
      ? createLlmClient({
          ...resolveLlmConfig(env, {
            baseUrl: parsed.llmBaseUrl,
            model: parsed.llmModel,
          }),
        })
      : null;

    const options = {
      inPath: parsed.inPath,
      outDir: parsed.outDir,
      format,
      currency: settings.currency,
      accountCode: settings.accountCode,
      expenseAccount: settings.expenseAccount,
      taxType: settings.taxType,
      taxCode: settings.taxCode,
      dueDays: settings.dueDays,
      dateFormat: settings.dateFormat,
      recursive: parsed.recursive,
      errorsPath: parsed.errorsPath,
      quiet: parsed.quiet,
      logger,
      llmClient,
    };

    if (parsed.command === "watch") {
      const handle = await watchInbox({
        ...options,
        pollMs: settings.pollMs,
        stableMs: settings.stableMs,
      });
      await new Promise<void>((resolve) => {
        const stop = (): void => {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
          void handle.stop().then(resolve);
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      });
      return 0;
    }

    const result = await convertInbox(options, "convert");
    return result.exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error("Run invoice-inbox-to-csv --help for usage.");
      return 2;
    }
    console.error(error instanceof Error ? (error.stack ?? error.message) : errorMessage(error));
    return 2;
  }
}

function readVersion(): string {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
})();
if (invokedDirectly) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
