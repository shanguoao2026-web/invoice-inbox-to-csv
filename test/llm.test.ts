import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { UsageError } from "../src/errors.js";
import { processInvoiceFile } from "../src/invoice/process-file.js";
import { mergeDraft } from "../src/parse/merge.js";
import {
  createLlmClient,
  draftFromUnknown,
  parseModelJson,
  resolveLlmConfig,
} from "../src/parse/llm.js";
import { emptyDraft, parseInvoiceText } from "../src/parse/heuristic.js";

describe("mergeDraft", () => {
  test("fills gaps and does not replace heuristic values or existing lines", () => {
    const base = parseInvoiceText(`
Supplier: Kept Ltd
Invoice Number: KEEP-1
Invoice Date: 2026-01-01
Description Qty Unit Price Amount
Original 1 5.00 5.00
Total: 5.00
`);
    const merged = mergeDraft(base, {
      vendor: "Replaced LLC",
      invoiceNumber: "OTHER",
      currency: "EUR",
      dueDate: "2026-01-31",
      lineItems: [{ description: "From the model", quantity: 1, unitAmount: 9, amount: 9 }],
    });
    assert.equal(merged.vendor, "Kept Ltd");
    assert.equal(merged.invoiceNumber, "KEEP-1");
    assert.equal(merged.currency, "EUR");
    assert.equal(merged.dueDate, "2026-01-31");
    assert.equal(merged.lineItems[0]?.description, "Original");
  });

  test("uses model line items only when the heuristic found none", () => {
    const merged = mergeDraft(emptyDraft(), {
      vendor: "Model Vendor GmbH",
      lineItems: [{ description: "From the model", quantity: 2, unitAmount: 4, amount: 8 }],
    });
    assert.equal(merged.vendor, "Model Vendor GmbH");
    assert.equal(merged.lineItems.length, 1);
    assert.equal(merged.lineItems[0]?.amount, 8);
  });
});

describe("llm client", () => {
  test("prefers an xAI key and falls back to OPENAI_API_KEY", () => {
    const xai = resolveLlmConfig({ XAI_API_KEY: "xai-key", OPENAI_API_KEY: "oa-key" });
    assert.equal(xai.provider, "xai");
    assert.equal(xai.apiKey, "xai-key");
    assert.equal(xai.baseUrl, "https://api.x.ai/v1");
    assert.equal(xai.model, "grok-4.7");

    const openai = resolveLlmConfig({ OPENAI_API_KEY: "oa-key" });
    assert.equal(openai.provider, "openai");
    assert.equal(openai.baseUrl, "https://api.openai.com/v1");
    assert.equal(openai.model, "gpt-4o-mini");

    const custom = resolveLlmConfig(
      { INVOICE_LLM_API_KEY: "custom", OPENAI_API_KEY: "oa-key" },
      { baseUrl: "https://example.test/v1", model: "local-model" },
    );
    assert.equal(custom.provider, "custom");
    assert.equal(custom.baseUrl, "https://example.test/v1");
    assert.equal(custom.model, "local-model");
  });

  test("throws a usage error when --llm has no key", () => {
    assert.throws(() => resolveLlmConfig({}), UsageError);
  });

  test("parses a fenced JSON chat completion without using the network", async () => {
    let requested = "";
    let auth = "";
    const client = createLlmClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1/",
      model: "grok-4.7",
      fetchImpl: async (url, init) => {
        requested = String(url);
        auth = new Headers(init?.headers).get("authorization") ?? "";
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          temperature: number;
          response_format: { type: string };
        };
        assert.equal(body.model, "grok-4.7");
        assert.equal(body.temperature, 0);
        assert.equal(body.response_format.type, "json_object");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '```json\n{"currency":"eur","invoiceDate":"2 Feb 2026","total":"12.50"}\n```',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const draft = await client.extract("Invoice text");
    assert.equal(requested, "https://example.test/v1/chat/completions");
    assert.equal(auth, "Bearer test-key");
    assert.equal(draft.currency, "EUR");
    assert.equal(draft.invoiceDate, "2026-02-02");
    assert.equal(draft.total, 12.5);
  });

  test("turns an HTTP error into an LLM failure and keeps the heuristic invoice", async () => {
    const client = createLlmClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "grok-4.7",
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    await assert.rejects(() => client.extract("text"), /503/);

    const outcome = await processInvoiceFile("/tmp/ignored.pdf", "ignored.pdf", {
      currency: "USD",
      taxType: null,
      taxCode: null,
      readFileImpl: async () => new Uint8Array([1, 2, 3]),
      extractor: async () => `
Supplier: Kept Ltd
Invoice Number: KEEP-1
Invoice Date: 2026-01-01
Currency: USD
Description Qty Unit Price Amount
Original 1 5.00 5.00
Total: 5.00
`,
      llmClient: {
        async extract() {
          throw new Error("offline");
        },
      },
    });
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.invoice?.invoiceNumber, "KEEP-1");
    assert.equal(outcome.warnings.some((issue) => issue.field === "llm"), true);
  });

  test("rejects an empty scan and coerces loose model JSON", async () => {
    const empty = await processInvoiceFile("/tmp/scan.pdf", "scan.pdf", {
      currency: "USD",
      taxType: null,
      taxCode: null,
      readFileImpl: async () => new Uint8Array(),
      extractor: async () => "   ",
    });
    assert.equal(empty.status, "error");
    assert.match(empty.errors[0]?.message ?? "", /does not OCR/);

    const parsed = draftFromUnknown(
      parseModelJson('{"vendor":"A GmbH","lineItems":[{"description":"Work","quantity":"2","unitAmount":3,"amount":6}]}'),
    );
    assert.equal(parsed.vendor, "A GmbH");
    assert.equal(parsed.lineItems?.[0]?.quantity, 2);
    assert.equal(parsed.lineItems?.[0]?.amount, 6);
  });
});
