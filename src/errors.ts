export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class LlmRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRequestError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const line = error.message.split("\n")[0];
    return line && line.length > 0 ? line : error.name;
  }
  return String(error);
}
