import { readFile } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveWithoutCanvas(request, parent, isMain, options) {
  if (request === "@napi-rs/canvas" || String(request).startsWith("@napi-rs/canvas/")) {
    const error = new Error(`Cannot find module '${request}'`);
    error.code = "MODULE_NOT_FOUND";
    throw error;
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { extractPdfText } = await import(pathToFileURL(path.join(root, "src/pdf/extract.ts")).href);
const bytes = await readFile(path.join(root, "fixtures/northwind-services.pdf"));
const text = await extractPdfText(bytes);
if (!text.includes("Consulting services 2 150.00 300.00")) {
  console.error(text);
  process.exit(1);
}
if (!text.includes("INV-2024-001")) {
  console.error(text);
  process.exit(1);
}
console.log("ok");
