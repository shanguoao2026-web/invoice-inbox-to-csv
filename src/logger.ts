import type { Logger } from "./types.js";

export function createLogger(quiet: boolean): Logger {
  return {
    info(message: string) {
      if (!quiet) console.error(message);
    },
    warn(message: string) {
      console.error(message);
    },
    error(message: string) {
      console.error(message);
    },
  };
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
