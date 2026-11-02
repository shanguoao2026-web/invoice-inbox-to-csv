import { parseDate } from "../dates.js";
import { LlmRequestError, UsageError } from "../errors.js";
import { round2, round4 } from "../money.js";
import type { InvoiceDraft, LlmClient, LineItem } from "../types.js";

export const LLM_SYSTEM_PROMPT = `You extract data from the text of a supplier invoice.
Reply with one JSON object and no markdown.
Schema:
{
  "vendor": string | null,
  "invoiceNumber": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "currency": "ISO-4217" | null,
  "subtotal": number | null,
  "taxAmount": number | null,
  "taxRate": number | null,
  "total": number | null,
  "lineItems": [
    { "description": string, "quantity": number, "unitAmount": number, "amount": number }
  ]
}
Rules:
- Use null when a field is not printed. Do not invent values.
- vendor is the supplier who issued the invoice, not the customer in Bill To.
- Dates are calendar dates. Numbers are the printed figures. Do not convert tax-inclusive prices.
- taxRate is a percent, so 15 means 15%.
- currency is a 3-letter ISO code.
- lineItems is an empty array when the invoice has no item rows.`;

export interface LlmClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxChars?: number;
}

export interface ResolvedLlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: "xai" | "openai" | "custom";
}

const XAI_BASE_URL = "https://api.x.ai/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const XAI_DEFAULT_MODEL = "grok-4.7";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Resolve an OpenAI-compatible chat endpoint.
 * Key order: INVOICE_LLM_API_KEY, then XAI_API_KEY (SpaceXAI / xAI), then OPENAI_API_KEY.
 * When both provider keys are set, XAI_API_KEY wins unless INVOICE_LLM_API_KEY is set.
 */
export function resolveLlmConfig(
  env: Record<string, string | undefined>,
  flags: { baseUrl?: string; model?: string } = {},
): ResolvedLlmConfig {
  const explicitKey = env.INVOICE_LLM_API_KEY?.trim() ?? "";
  const xaiKey = env.XAI_API_KEY?.trim() ?? "";
  const openaiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const apiKey = explicitKey || xaiKey || openaiKey;
  if (!apiKey) {
    throw new UsageError(
      "The --llm flag needs an API key. Set XAI_API_KEY (SpaceXAI / xAI) or OPENAI_API_KEY.",
    );
  }

  const provider: ResolvedLlmConfig["provider"] = explicitKey ? "custom" : xaiKey ? "xai" : "openai";
  const baseUrl = (
    flags.baseUrl ||
    env.INVOICE_LLM_BASE_URL ||
    env.OPENAI_BASE_URL ||
    (provider === "openai" ? OPENAI_BASE_URL : XAI_BASE_URL)
  ).replace(/\/+$/, "");

  const hostIsXai = /^https:\/\/api\.x\.ai(?:\/|$)/i.test(baseUrl);
  const model =
    flags.model ||
    env.INVOICE_LLM_MODEL ||
    (hostIsXai || provider === "xai" ? XAI_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL);

  return { apiKey, baseUrl, model, provider };
}

export function createLlmClient(options: LlmClientOptions): LlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxChars = options.maxChars ?? 24_000;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  return {
    async extract(text: string): Promise<Partial<InvoiceDraft>> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: LLM_SYSTEM_PROMPT },
              { role: "user", content: text.slice(0, maxChars) },
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.text();
          throw new LlmRequestError(
            `LLM request failed (${response.status}): ${body.replace(/\s+/g, " ").slice(0, 300)}`,
          );
        }
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content || !content.trim()) {
          throw new LlmRequestError("LLM response did not include message content.");
        }
        return draftFromUnknown(parseModelJson(content));
      } catch (error) {
        if (error instanceof LlmRequestError) throw error;
        if (error instanceof SyntaxError) {
          throw new LlmRequestError("LLM response was not valid JSON.");
        }
        const aborted = error instanceof Error && error.name === "AbortError";
        throw new LlmRequestError(
          aborted ? `LLM request timed out after ${timeoutMs}ms.` : `LLM request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function parseModelJson(content: string): unknown {
  let text = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text) as unknown;
}

export function draftFromUnknown(value: unknown): Partial<InvoiceDraft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmRequestError("LLM response was not a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const draft: Partial<InvoiceDraft> = {};

  const vendor = textValue(record.vendor);
  if (vendor) draft.vendor = vendor;
  const invoiceNumber = textValue(record.invoiceNumber);
  if (invoiceNumber) draft.invoiceNumber = invoiceNumber;

  const invoiceDate = dateValue(record.invoiceDate);
  if (invoiceDate) draft.invoiceDate = invoiceDate;
  const dueDate = dateValue(record.dueDate);
  if (dueDate) draft.dueDate = dueDate;

  const currency = textValue(record.currency);
  if (currency && /^[A-Za-z]{3}$/.test(currency)) draft.currency = currency.toUpperCase();

  const subtotal = numberValue(record.subtotal);
  if (subtotal != null) draft.subtotal = subtotal;
  const taxAmount = numberValue(record.taxAmount);
  if (taxAmount != null) draft.taxAmount = taxAmount;
  const taxRate = numberValue(record.taxRate);
  if (taxRate != null) draft.taxRate = taxRate;
  const total = numberValue(record.total);
  if (total != null) draft.total = total;

  if (Array.isArray(record.lineItems)) {
    const items: LineItem[] = [];
    for (const entry of record.lineItems) {
      const item = lineItemFromUnknown(entry);
      if (item) items.push(item);
    }
    if (items.length > 0) draft.lineItems = items;
  }

  return draft;
}

function lineItemFromUnknown(value: unknown): LineItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const description = textValue(record.description);
  const quantity = numberValue(record.quantity);
  if (!description || quantity == null || quantity <= 0) return null;
  const unitAmount = numberValue(record.unitAmount);
  const amount = numberValue(record.amount);
  const unit = unitAmount ?? (amount != null ? amount / quantity : null);
  const extended = amount ?? (unit != null ? unit * quantity : null);
  if (unit == null || extended == null) return null;
  return {
    description,
    quantity,
    unitAmount: round4(unit),
    amount: round2(extended),
  };
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return parseDate(value);
}
