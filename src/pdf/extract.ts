/**
 * Extract text with Mozilla PDF.js (`pdfjs-dist`).
 * Pages are not rendered. `@napi-rs/canvas` is an optional PDF.js dependency and is not required.
 * Node has no DOMMatrix, which PDF.js constructs while loading, so a small pure-JS matrix is
 * installed when the native package cannot provide one. Polyfill warnings are dropped.
 */
import { createRequire } from "node:module";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

const require = createRequire(import.meta.url);

interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

let pdfjsPromise: Promise<Pdfjs> | null = null;
let warnDepth = 0;
let savedWarn: typeof console.warn | null = null;

export async function extractPdfText(data: Uint8Array): Promise<string> {
  return suppressCanvasPolyfillWarnings(async () => {
    ensureDomMatrix();
    const pdfjs = await loadPdfjs();
    // Copy so PDF.js can transfer its own buffer to the worker without detaching the caller's.
    const bytes = new Uint8Array(data);
    const task = pdfjs.getDocument({
      data: bytes,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
      isEvalSupported: false,
    });
    try {
      const doc = await task.promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const text = runsToText(content.items);
          if (text.length > 0) pages.push(text);
        } finally {
          page.cleanup();
        }
      }
      return pages.join("\n");
    } finally {
      await task.destroy();
    }
  });
}

function ensureDomMatrix(): void {
  const globals = globalThis as typeof globalThis & { DOMMatrix?: unknown };
  if (typeof globals.DOMMatrix === "function") return;
  globals.DOMMatrix = readNativeDomMatrix() ?? DomMatrixPolyfill;
}

function readNativeDomMatrix(): unknown {
  try {
    const canvas = require("@napi-rs/canvas") as { DOMMatrix?: unknown };
    if (typeof canvas.DOMMatrix === "function") return canvas.DOMMatrix;
  } catch {
    // The optional native package is absent or failed to load.
  }
  return null;
}

/**
 * Enough of DOMMatrix for PDF.js to load and read text. Rendering is not used.
 * 2D form: [a b c d e f] maps (x, y) to (a*x + c*y + e, b*x + d*y + f).
 */
class DomMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;

  constructor(init?: string | number[]) {
    if (typeof init === "string" || !init) return;
    if (init.length === 6) {
      this.a = init[0] ?? 1;
      this.b = init[1] ?? 0;
      this.c = init[2] ?? 0;
      this.d = init[3] ?? 1;
      this.e = init[4] ?? 0;
      this.f = init[5] ?? 0;
    } else if (init.length === 16) {
      this.a = init[0] ?? 1;
      this.b = init[1] ?? 0;
      this.c = init[4] ?? 0;
      this.d = init[5] ?? 1;
      this.e = init[12] ?? 0;
      this.f = init[13] ?? 0;
    }
  }

  multiplySelf(other: DomMatrixLike): this {
    const next = multiply(this, other);
    this.a = next.a;
    this.b = next.b;
    this.c = next.c;
    this.d = next.d;
    this.e = next.e;
    this.f = next.f;
    return this;
  }

  preMultiplySelf(other: DomMatrixLike): this {
    const next = multiply(other, this);
    this.a = next.a;
    this.b = next.b;
    this.c = next.c;
    this.d = next.d;
    this.e = next.e;
    this.f = next.f;
    return this;
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.multiplySelf(new DomMatrixPolyfill([1, 0, 0, 1, tx, ty]));
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    return this.multiplySelf(new DomMatrixPolyfill([scaleX, 0, 0, scaleY, 0, 0]));
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) return this;
    const a = this.d / det;
    const b = -this.b / det;
    const c = -this.c / det;
    const d = this.a / det;
    const e = (this.c * this.f - this.d * this.e) / det;
    const f = (this.b * this.e - this.a * this.f) / det;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }
}

interface DomMatrixLike {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function multiply(left: DomMatrixLike, right: DomMatrixLike): DomMatrixLike {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

function runsToText(items: readonly unknown[]): string {
  const runs: TextRun[] = [];
  for (const item of items) {
    const run = toRun(item);
    if (run) runs.push(run);
  }
  if (runs.length === 0) return "";

  const sorted = [...runs].sort((left, right) => {
    const dy = right.y - left.y;
    if (Math.abs(dy) > 1) return dy;
    return left.x - right.x;
  });

  const lines: TextRun[][] = [];
  let line: TextRun[] = [];
  let anchorY = 0;
  let anchorHeight = 0;
  for (const run of sorted) {
    const tolerance = Math.max(2, Math.max(anchorHeight, run.height) * 0.4);
    if (line.length === 0 || Math.abs(run.y - anchorY) <= tolerance) {
      if (line.length === 0) {
        anchorY = run.y;
        anchorHeight = run.height;
      } else {
        anchorHeight = Math.max(anchorHeight, run.height);
      }
      line.push(run);
    } else {
      lines.push(line);
      line = [run];
      anchorY = run.y;
      anchorHeight = run.height;
    }
  }
  if (line.length > 0) lines.push(line);

  return lines
    .map(joinLine)
    .filter((text) => text.length > 0)
    .join("\n");
}

function toRun(item: unknown): TextRun | null {
  if (!item || typeof item !== "object" || !("str" in item)) return null;
  const record = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
  if (typeof record.str !== "string" || record.str.length === 0) return null;
  if (!Array.isArray(record.transform) || record.transform.length < 6) return null;
  const x = Number(record.transform[4]);
  const y = Number(record.transform[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Number(record.width);
  const height = Number(record.height);
  return {
    text: record.str,
    x,
    y,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

function joinLine(line: readonly TextRun[]): string {
  const ordered = [...line].sort((left, right) => left.x - right.x || left.y - right.y);
  let text = "";
  let endX = 0;
  let height = 0;
  for (const run of ordered) {
    if (text.length === 0) {
      text = run.text;
      endX = run.x + Math.max(run.width, 0);
      height = run.height;
      continue;
    }
    const gap = run.x - endX;
    const separated = gap > Math.max(1, height * 0.2);
    if (separated && !/\s$/u.test(text) && !/^\s/u.test(run.text)) {
      text += " ";
    }
    text += run.text;
    endX = Math.max(endX, run.x + Math.max(run.width, 0));
    height = Math.max(height, run.height);
  }
  return text.replace(/[^\S\n]+/gu, " ").trim();
}

async function suppressCanvasPolyfillWarnings<T>(work: () => Promise<T>): Promise<T> {
  if (warnDepth === 0) {
    savedWarn = console.warn;
    console.warn = ((...args: unknown[]) => {
      const message = args.map((part) => String(part)).join(" ");
      if (isCanvasPolyfillWarning(message)) return;
      savedWarn?.(...(args as Parameters<typeof console.warn>));
    }) as typeof console.warn;
  }
  warnDepth += 1;
  try {
    return await work();
  } finally {
    warnDepth -= 1;
    if (warnDepth === 0 && savedWarn) {
      console.warn = savedWarn;
      savedWarn = null;
    }
  }
}

function isCanvasPolyfillWarning(message: string): boolean {
  return (
    message.includes("@napi-rs/canvas") ||
    message.includes("DOMMatrix") ||
    message.includes("ImageData") ||
    message.includes("Path2D")
  );
}
