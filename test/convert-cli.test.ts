import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import PDFDocument from "pdfkit";
import { parseArgs } from "../src/args.js";
import { run } from "../src/cli.js";
import { parseCsv, QBO_COLUMNS, XERO_COLUMNS } from "../src/csv/csv.js";
import { convertInbox } from "../src/convert.js";
import { extractPdfText } from "../src/pdf/extract.js";
import { silentLogger } from "../src/logger.js";
import { watchInbox } from "../src/watch.js";
import { fixturesDir, makeTempDir, projectRoot, removeTempDir, waitFor } from "./helpers.js";

describe("fixtures and convert", () => {
  test("extracts text from the generated northwind PDF", async () => {
    const bytes = await readFile(path.join(fixturesDir, "northwind-services.pdf"));
    const text = await extractPdfText(bytes);
    assert.match(text, /INV-2024-001/);
    assert.match(text, /NORTHWIND SUPPLIES LTD/);
    assert.match(text, /Consulting services 2 150\.00 300\.00/);
  });

  test("extracts invoice text when the optional canvas package cannot load", async () => {
    const result = await runNode([
      "--import",
      "tsx",
      path.join(projectRoot, "test/extract-without-canvas.mjs"),
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /ok/);
    assert.doesNotMatch(result.stderr, /napi-rs\/canvas|DOMMatrix is not defined/);
  });

  test("joins separate text runs on the same baseline into one line", async () => {
    const dir = await makeTempDir("invoice-cols-");
    try {
      const filePath = path.join(dir, "columns.pdf");
      await writeColumnPdf(filePath);
      const text = await extractPdfText(await readFile(filePath));
      assert.match(text, /Widget 2 10\.00 20\.00/);
      assert.match(text, /Invoice Number: COL-1/);
    } finally {
      await removeTempDir(dir);
    }
  });

  test("writes both CSVs, keeps going after a bad file, and records errors.json", async () => {
    const outDir = await makeTempDir("invoice-out-");
    try {
      const result = await convertInbox({
        inPath: fixturesDir,
        outDir,
        format: "both",
        currency: "USD",
        accountCode: "400",
        expenseAccount: "Uncategorized Expense",
        taxType: null,
        taxCode: null,
        dueDays: 30,
        dateFormat: "iso",
        recursive: false,
        quiet: true,
        logger: silentLogger,
        now: () => new Date("2026-11-02T00:00:00.000Z"),
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.processed, 4);
      assert.equal(result.succeeded, 3);
      assert.equal(result.failed, 1);

      const xero = await readFile(path.join(outDir, "xero.csv"), "utf8");
      const qbo = await readFile(path.join(outDir, "qbo.csv"), "utf8");
      const xeroRows = parseCsv(xero);
      const qboRows = parseCsv(qbo);
      assert.deepEqual(xeroRows[0], [...XERO_COLUMNS]);
      assert.deepEqual(qboRows[0], [...QBO_COLUMNS]);
      assert.equal(xeroRows.length, 8);
      assert.match(xero, /"Harbor, Pine & Co"/);
      assert.match(xero, /HP-88421/);
      assert.match(xero, /RE-2026-014/);
      assert.match(xero, /INV-2024-001/);
      assert.match(xero, /Follow-up notes/);
      assert.doesNotMatch(xero, /incomplete-receipt/);
      assert.match(qbo, /Net 30/);
      assert.match(qbo, /Uncategorized Expense/);

      const report = JSON.parse(await readFile(result.errorsPath, "utf8")) as {
        generatedAt: string;
        summary: { failed: number; succeeded: number };
        results: Array<{ file: string; status: string; errors: Array<{ field: string }> }>;
      };
      assert.equal(report.generatedAt, "2026-11-02T00:00:00.000Z");
      assert.equal(report.summary.succeeded, 3);
      assert.equal(report.summary.failed, 1);
      const failed = report.results.find((entry) => entry.file === "incomplete-receipt.pdf");
      assert.equal(failed?.status, "error");
      assert.ok(failed?.errors.some((issue) => issue.field === "invoiceNumber"));

      const second = await convertInbox({
        inPath: fixturesDir,
        outDir,
        format: "xero",
        currency: "USD",
        accountCode: "400",
        expenseAccount: "Uncategorized Expense",
        taxType: null,
        taxCode: null,
        dueDays: 30,
        dateFormat: "iso",
        recursive: false,
        quiet: true,
        logger: silentLogger,
      });
      assert.equal(await readFile(path.join(outDir, "xero.csv"), "utf8"), xero);
      assert.equal(second.succeeded, 3);
    } finally {
      await removeTempDir(outDir);
    }
  });

  test("a corrupt PDF does not stop the batch, and non-PDFs are ignored", async () => {
    const inbox = await makeTempDir("invoice-in-");
    const outDir = await makeTempDir("invoice-out-");
    try {
      await copyFile(
        path.join(fixturesDir, "northwind-services.pdf"),
        path.join(inbox, "northwind-services.pdf"),
      );
      await writeFile(path.join(inbox, "notes.txt"), "not an invoice");
      await writeFile(path.join(inbox, "broken.pdf"), "this is not a pdf");
      await mkdir(path.join(inbox, "nested"), { recursive: true });
      await copyFile(
        path.join(fixturesDir, "harbor-pine-hardware.pdf"),
        path.join(inbox, "nested", "harbor-pine-hardware.pdf"),
      );

      const top = await convertInbox({
        inPath: inbox,
        outDir,
        format: "xero",
        currency: "USD",
        accountCode: "400",
        expenseAccount: "Uncategorized Expense",
        taxType: "GST",
        taxCode: "GST",
        dueDays: 30,
        dateFormat: "iso",
        recursive: false,
        quiet: true,
        logger: silentLogger,
      });
      assert.equal(top.processed, 2);
      assert.equal(top.succeeded, 1);
      assert.equal(top.failed, 1);
      const csv = await readFile(path.join(outDir, "xero.csv"), "utf8");
      assert.match(csv, /INV-2024-001/);
      assert.match(csv, /,GST,/);
      assert.doesNotMatch(csv, /HP-88421/);
      const broken = top.outcomes.find((outcome) => outcome.file === "broken.pdf");
      assert.match(broken?.errors[0]?.message ?? "", /Could not read PDF/);

      const nested = await convertInbox({
        inPath: inbox,
        outDir,
        format: "xero",
        currency: "USD",
        accountCode: "310",
        expenseAccount: "Uncategorized Expense",
        taxType: null,
        taxCode: null,
        dueDays: 30,
        dateFormat: "mdy",
        recursive: true,
        quiet: true,
        logger: silentLogger,
      });
      assert.equal(nested.succeeded, 2);
      const mdy = await readFile(path.join(outDir, "xero.csv"), "utf8");
      assert.match(mdy, /03\/15\/2024/);
      assert.match(mdy, /HP-88421/);
      assert.match(mdy, /,310,/);
    } finally {
      await removeTempDir(inbox);
      await removeTempDir(outDir);
    }
  });

  test("reports an image-only PDF as unsupported instead of crashing", async () => {
    const inbox = await makeTempDir("invoice-blank-");
    const outDir = await makeTempDir("invoice-blank-out-");
    try {
      await writeBlankPdf(path.join(inbox, "scan.pdf"));
      const result = await convertInbox({
        inPath: inbox,
        outDir,
        format: "qbo",
        currency: "USD",
        accountCode: "400",
        expenseAccount: "Uncategorized Expense",
        taxType: null,
        taxCode: null,
        dueDays: 30,
        dateFormat: "iso",
        recursive: false,
        quiet: true,
        logger: silentLogger,
      });
      assert.equal(result.failed, 1);
      assert.match(result.outcomes[0]?.errors[0]?.message ?? "", /does not OCR/);
      const csv = await readFile(path.join(outDir, "qbo.csv"), "utf8");
      assert.deepEqual(parseCsv(csv)[0], [...QBO_COLUMNS]);
      assert.equal(parseCsv(csv).length, 1);
    } finally {
      await removeTempDir(inbox);
      await removeTempDir(outDir);
    }
  });
});

describe("watch", () => {
  test("picks up a PDF that appears after the watcher starts", { timeout: 20_000 }, async () => {
    const inbox = await makeTempDir("invoice-watch-");
    const outDir = await makeTempDir("invoice-watch-out-");
    await copyFile(
      path.join(fixturesDir, "northwind-services.pdf"),
      path.join(inbox, "northwind-services.pdf"),
    );
    const handle = await watchInbox({
      inPath: inbox,
      outDir,
      format: "xero",
      currency: "USD",
      accountCode: "400",
      expenseAccount: "Uncategorized Expense",
      taxType: null,
      taxCode: null,
      dueDays: 30,
      dateFormat: "iso",
      recursive: false,
      quiet: true,
      logger: silentLogger,
      pollMs: 200,
      stableMs: 80,
    });
    try {
      const xeroPath = path.join(outDir, "xero.csv");
      await waitFor(async () => {
        try {
          return (await readFile(xeroPath, "utf8")).includes("INV-2024-001");
        } catch {
          return false;
        }
      });
      const staged = path.join(inbox, "harbor-pine-hardware.pdf.tmp");
      await copyFile(path.join(fixturesDir, "harbor-pine-hardware.pdf"), staged);
      await rename(staged, path.join(inbox, "harbor-pine-hardware.pdf"));
      await waitFor(async () => (await readFile(xeroPath, "utf8")).includes("HP-88421"));
    } finally {
      await handle.stop();
      await removeTempDir(inbox);
      await removeTempDir(outDir);
    }
  });
});

describe("cli", () => {
  test("parses equals-style flags", () => {
    const parsed = parseArgs([
      "convert",
      "--in=./inbox",
      "--out",
      "./out",
      "--format",
      "xero",
      "--llm",
      "--due-days",
      "14",
    ]);
    assert.equal(parsed.command, "convert");
    assert.equal(parsed.inPath, "./inbox");
    assert.equal(parsed.outDir, "./out");
    assert.equal(parsed.format, "xero");
    assert.equal(parsed.llm, true);
    assert.equal(parsed.dueDays, 14);
  });

  test("help exits 0 and a missing directory exits 2", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (message?: unknown) => {
      logs.push(String(message));
    };
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    try {
      assert.equal(await run(["--help"]), 0);
      assert.match(logs.join("\n"), /invoice-inbox-to-csv convert/);
      assert.equal(await run(["--version"]), 0);
      assert.match(logs.join("\n"), /0\.1\.0/);
      const code = await run(["convert", "--in", "/no/such/inbox", "--out", "/tmp/out"], {});
      assert.equal(code, 2);
      assert.match(errors.join("\n"), /does not exist|requires --in|Unknown/);
      const llm = await run(
        ["convert", "--in", fixturesDir, "--out", "/tmp/invoice-llm-out", "--llm"],
        {},
      );
      assert.equal(llm, 2);
      assert.match(errors.join("\n"), /API key/);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  test("the built bin prints the version", async () => {
    const { code, stdout } = await runNode(["dist/cli.js", "--version"]);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "0.1.0");
  });

  test("validate accepts a generated Xero file and rejects a broken one", async () => {
    const outDir = await makeTempDir("invoice-validate-");
    try {
      const code = await run(
        ["convert", "--in", fixturesDir, "--out", outDir, "--format", "xero", "--quiet"],
        {},
      );
      assert.equal(code, 1);
      const ok = await run(
        ["validate", "--in", path.join(outDir, "xero.csv"), "--format", "xero", "--quiet"],
        {},
      );
      assert.equal(ok, 0);
      const badPath = path.join(outDir, "bad.csv");
      await writeFile(badPath, "ContactName\nOnly\n", "utf8");
      const bad = await run(["validate", "--in", badPath, "--format", "xero", "--errors", path.join(outDir, "bad.errors.json"), "--quiet"], {});
      assert.equal(bad, 1);
      const report = JSON.parse(await readFile(path.join(outDir, "bad.errors.json"), "utf8")) as {
        command: string;
        summary: { errors: number };
      };
      assert.equal(report.command, "validate");
      assert.ok(report.summary.errors > 0);
    } finally {
      await removeTempDir(outDir);
    }
  });
});

function runNode(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function writeColumnPdf(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER" });
    const stream = createWriteStream(filePath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
    doc.font("Helvetica").fontSize(10);
    const y = 700;
    doc.text("Widget", 50, y, { lineBreak: false });
    doc.text("2", 220, y, { lineBreak: false });
    doc.text("10.00", 280, y, { lineBreak: false });
    doc.text("20.00", 360, y, { lineBreak: false });
    doc.text("Invoice Number: COL-1", 50, 660, { lineBreak: false });
    doc.end();
  });
}

function writeBlankPdf(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4" });
    const stream = createWriteStream(filePath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
    doc.moveTo(72, 720).lineTo(400, 720).stroke();
    doc.end();
  });
}
