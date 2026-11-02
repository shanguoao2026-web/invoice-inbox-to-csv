import { readFile } from "node:fs/promises";
import { errorMessage } from "../errors.js";
import { extractPdfText } from "../pdf/extract.js";
import { parseInvoiceText } from "../parse/heuristic.js";
import { mergeDraft } from "../parse/merge.js";
import type { FileOutcome, InvoiceDraft, Issue, LlmClient } from "../types.js";
import { prepareInvoice, type PrepareOptions } from "./prepare.js";

const MAX_TEXT_CHARS = 500_000;

export interface ProcessFileOptions extends Omit<PrepareOptions, "sourceFile"> {
  llmClient?: LlmClient | null;
  extractor?: (data: Uint8Array) => Promise<string>;
  readFileImpl?: (filePath: string) => Promise<Uint8Array>;
}

export async function processInvoiceFile(
  filePath: string,
  sourceFile: string,
  options: ProcessFileOptions,
): Promise<FileOutcome> {
  const read = options.readFileImpl ?? readBytes;
  const extract = options.extractor ?? extractPdfText;
  let text = "";
  try {
    const bytes = await read(filePath);
    text = await extract(bytes);
  } catch (error) {
    return failed(sourceFile, "pdf", `Could not read PDF: ${errorMessage(error)}`, null);
  }

  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
  }
  if (!text.trim()) {
    return failed(
      sourceFile,
      "text",
      "No text could be extracted. Image-only scans are not supported (this tool does not OCR).",
      null,
    );
  }

  let draft = parseInvoiceText(text);
  const seedWarnings: Issue[] = [];
  if (text.length >= MAX_TEXT_CHARS) {
    seedWarnings.push({
      field: "text",
      message: "Invoice text was truncated before parsing.",
    });
  }

  if (options.llmClient) {
    try {
      const extra = await options.llmClient.extract(text);
      draft = mergeDraft(draft, extra);
    } catch (error) {
      seedWarnings.push({
        field: "llm",
        message: `LLM enhancement failed (${errorMessage(error)}). The heuristic result was kept.`,
      });
    }
  }

  return prepareInvoice(
    draft,
    {
      sourceFile,
      currency: options.currency,
      dueDays: options.dueDays,
      taxType: options.taxType,
      taxCode: options.taxCode,
    },
    seedWarnings,
  );
}

async function readBytes(filePath: string): Promise<Uint8Array> {
  const buffer = await readFile(filePath);
  return new Uint8Array(buffer);
}

function failed(
  file: string,
  field: string,
  message: string,
  draft: InvoiceDraft | null,
): FileOutcome {
  return {
    file,
    status: "error",
    errors: [{ field, message }],
    warnings: [],
    invoice: null,
    draft,
  };
}
