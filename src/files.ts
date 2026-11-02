import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { UsageError } from "./errors.js";

export async function listInvoicePdfs(inputPath: string, recursive: boolean): Promise<string[]> {
  let info;
  try {
    info = await stat(inputPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") throw new UsageError(`Input path does not exist: ${inputPath}`);
    throw error;
  }

  if (info.isFile()) {
    if (!inputPath.toLowerCase().endsWith(".pdf")) {
      throw new UsageError(`Input file is not a PDF: ${inputPath}`);
    }
    return [inputPath];
  }
  if (!info.isDirectory()) {
    throw new UsageError(`Input path is not a directory: ${inputPath}`);
  }

  const found: string[] = [];
  await walk(inputPath, recursive, found);
  found.sort((left, right) => left.localeCompare(right));
  return found;
}

async function walk(directory: string, recursive: boolean, found: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await walk(fullPath, true, found);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) found.push(fullPath);
  }
}

export function displayPath(filePath: string, root: string): string {
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }
  return relative.split(path.sep).join("/");
}
