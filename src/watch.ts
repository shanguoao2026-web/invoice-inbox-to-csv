import { watch as watchDirectory } from "node:fs";
import type { FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { convertInbox } from "./convert.js";
import { errorMessage, UsageError } from "./errors.js";
import { listInvoicePdfs } from "./files.js";
import { createLogger } from "./logger.js";
import type { WatchOptions } from "./types.js";

export interface WatchHandle {
  stop: () => Promise<void>;
}

/**
 * Watch an inbox and rewrite the CSVs whenever the set of PDFs changes.
 *
 * `fs.watch` reports changes on the top-level directory. A poll every `pollMs`
 * covers missed events and, with `--recursive`, PDFs in subfolders (Linux
 * `fs.watch` is not recursive). After a change, the scan waits until the inbox
 * has been quiet for `stableMs` so a file that is still being saved is not read early.
 * Each scan rewrites the output from every PDF currently in the inbox.
 */
export async function watchInbox(options: WatchOptions): Promise<WatchHandle> {
  const logger = options.logger ?? createLogger(options.quiet);
  const info = await stat(options.inPath);
  if (!info.isDirectory()) {
    throw new UsageError("--in must be a directory for watch.");
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = 0;
  let chain: Promise<void> = Promise.resolve();
  let lastFingerprint = "";
  let watcher: FSWatcher | undefined;

  const fingerprint = async (): Promise<string | null> => {
    try {
      const files = await listInvoicePdfs(options.inPath, options.recursive);
      if (files.length === 0) return "empty";
      const parts: string[] = [];
      for (const filePath of files) {
        const fileInfo = await stat(filePath);
        parts.push(`${filePath}\0${fileInfo.size}\0${fileInfo.mtimeMs}`);
      }
      return parts.join("\n");
    } catch (error) {
      logger.error(`Cannot read inbox: ${errorMessage(error)}`);
      return null;
    }
  };

  const scanOnce = async (): Promise<void> => {
    if (stopped) return;
    const current = await fingerprint();
    if (current == null || current === lastFingerprint) return;
    await convertInbox({ ...options, logger }, "watch");
    const after = await fingerprint();
    lastFingerprint = current;
    if (after != null && after !== current && !stopped) schedule(options.stableMs, true);
  };

  const enqueue = (): void => {
    chain = chain
      .then(scanOnce)
      .catch((error: unknown) => {
        logger.error(`Watch scan failed: ${errorMessage(error)}`);
      });
  };

  const arm = (): void => {
    if (stopped) return;
    const wait = dueAt - Date.now();
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped) return;
      if (dueAt - Date.now() > 5) {
        arm();
        return;
      }
      enqueue();
    }, Math.max(0, wait));
  };

  const schedule = (delay: number, extend: boolean): void => {
    if (stopped) return;
    const nextDue = Date.now() + delay;
    if (!timer) {
      dueAt = nextDue;
      arm();
      return;
    }
    if (extend && nextDue > dueAt) dueAt = nextDue;
  };

  logger.info(
    `Watching ${path.resolve(options.inPath)} (fs.watch plus poll every ${options.pollMs}ms, quiet period ${options.stableMs}ms). Stop with Ctrl+C.`,
  );
  schedule(0, false);

  try {
    watcher = watchDirectory(options.inPath, { persistent: true }, () => {
      schedule(options.stableMs, true);
    });
    watcher.on("error", (error) => {
      logger.warn(`fs.watch stopped (${errorMessage(error)}). Polling will continue.`);
      watcher?.close();
      watcher = undefined;
    });
  } catch (error) {
    logger.warn(`fs.watch is unavailable (${errorMessage(error)}). Polling will continue.`);
  }

  const poll = setInterval(() => {
    void fingerprint().then((current) => {
      if (stopped || current == null) return;
      if (current !== lastFingerprint) schedule(options.stableMs, false);
    });
  }, options.pollMs);

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      watcher?.close();
      await chain;
    },
  };
}
