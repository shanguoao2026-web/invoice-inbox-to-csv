import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseCsv, toCsv, toQboRows, toXeroRows, XERO_COLUMNS } from "../src/csv/csv.js";
import { validateCsvText } from "../src/csv/validate-csv.js";
import { prepareInvoice } from "../src/invoice/prepare.js";
import { parseInvoiceText } from "../src/parse/heuristic.js";
import type { InvoiceDraft } from "../src/types.js";

const csvOptions = {
  dateFormat: "iso" as const,
  accountCode: "400",
  expenseAccount: "Uncategorized Expense",
  taxType: null,
  taxCode: null,
};

function draft(overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    vendor: "Parts Ltd",
    invoiceNumber: "P-1",
    invoiceDate: "2026-04-04",
    dueDate: "2026-05-04",
    currency: "USD",
    subtotal: 10,
    taxAmount: 0,
    taxRate: null,
    total: 10,
    taxInclusive: false,
    lineItems: [{ description: "Widget", quantity: 1, unitAmount: 10, amount: 10 }],
    rawInvoiceNumber: null,
    rawInvoiceDate: null,
    rawDueDate: null,
    ...overrides,
  };
}

describe("prepareInvoice", () => {
  test("defaults a missing due date and currency", () => {
    const outcome = prepareInvoice(
      draft({ dueDate: null, currency: null, rawDueDate: null }),
      { sourceFile: "a.pdf", currency: "USD", taxType: null, taxCode: null, dueDays: 30 },
    );
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.invoice?.dueDate, "2026-05-04");
    assert.equal(outcome.invoice?.currency, "USD");
    assert.equal(outcome.warnings.some((issue) => issue.field === "currency"), true);
    assert.equal(outcome.warnings.some((issue) => issue.field === "dueDate"), true);
  });

  test("rejects an invoice that has no supplier, number, or date", () => {
    const outcome = prepareInvoice(
      draft({ vendor: null, invoiceNumber: null, invoiceDate: null, dueDate: null, lineItems: [], total: 20, subtotal: null, taxAmount: null }),
      { sourceFile: "receipt.pdf", currency: "USD", taxType: null, taxCode: null },
    );
    assert.equal(outcome.status, "error");
    assert.equal(outcome.invoice, null);
    assert.equal(
      outcome.warnings.some((issue) => /exported/i.test(issue.message)),
      false,
    );
    const fields = outcome.errors.map((issue) => issue.field);
    assert.ok(fields.includes("vendor"));
    assert.ok(fields.includes("invoiceNumber"));
    assert.ok(fields.includes("invoiceDate"));
  });

  test("builds one summary line when only a total was found", () => {
    const outcome = prepareInvoice(
      draft({ lineItems: [], subtotal: null, taxAmount: 2, total: 12 }),
      { sourceFile: "summary.pdf", currency: "USD", taxType: "INPUT", taxCode: "TAX" },
    );
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.invoice?.lineItems.length, 1);
    assert.equal(outcome.invoice?.lineItems[0]?.description, "Invoice total");
    assert.equal(outcome.invoice?.lineItems[0]?.unitAmount, 10);
    assert.equal(outcome.warnings.some((issue) => issue.field === "taxType"), false);
  });

  test("converts tax-inclusive unit prices and warns when tax codes are unset", () => {
    const parsed = parseInvoiceText(`
Supplier: Inclusive Goods Ltd
Invoice Number: INC-1
Invoice Date: 1 May 2026
Currency: GBP
Prices include VAT.
Description Qty Unit Price Amount
Widget 1 120.00 120.00
VAT (20%): 20.00
Total: 120.00
`);
    const outcome = prepareInvoice(parsed, {
      sourceFile: "inclusive.pdf",
      currency: "USD",
      taxType: null,
      taxCode: null,
    });
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.invoice?.lineItems[0]?.unitAmount, 100);
    assert.equal(outcome.invoice?.lineItems[0]?.amount, 100);
    assert.equal(outcome.invoice?.dueDate, "2026-05-31");
    assert.equal(outcome.warnings.some((issue) => issue.field === "taxInclusive"), true);
    assert.equal(outcome.warnings.some((issue) => issue.field === "taxType"), true);
  });

  test("adjusts a unit price that does not match the line amount", () => {
    const outcome = prepareInvoice(
      draft({
        lineItems: [{ description: "Split pack", quantity: 3, unitAmount: 1, amount: 10 }],
        subtotal: 10,
        total: 10,
      }),
      { sourceFile: "split.pdf", currency: "USD", taxType: null, taxCode: null },
    );
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.invoice?.lineItems[0]?.unitAmount, 3.3333);
    assert.match(outcome.warnings.map((issue) => issue.message).join(" "), /Adjusted the unit amount/);
  });
});

describe("csv", () => {
  test("quotes commas, quotes, and newlines", () => {
    const csv = toCsv(["Name", "Note"], [
      { Name: 'Harbor, Pine & Co', Note: 'Say "hi"\nplease' },
    ]);
    assert.equal(csv, 'Name,Note\n"Harbor, Pine & Co","Say ""hi""\nplease"\n');
    const table = parseCsv(csv);
    assert.equal(table[1]?.[0], "Harbor, Pine & Co");
    assert.equal(table[1]?.[1], 'Say "hi"\nplease');
  });

  test("repeats invoice headers once per Xero line and maps QBO bill columns", () => {
    const outcome = prepareInvoice(
      draft({
        vendor: "Harbor, Pine & Co",
        invoiceNumber: "HP-1",
        invoiceDate: "2026-03-03",
        dueDate: "2026-04-02",
        currency: "USD",
        subtotal: 54,
        taxAmount: 0,
        total: 54,
        lineItems: [
          { description: "Brass hinges", quantity: 10, unitAmount: 4.5, amount: 45 },
          { description: "Delivery", quantity: 1, unitAmount: 12, amount: 12 },
        ],
      }),
      { sourceFile: "harbor.pdf", currency: "USD", taxType: null, taxCode: null },
    );
    assert.ok(outcome.invoice);
    const xero = toXeroRows(outcome.invoice, csvOptions);
    assert.deepEqual(Object.keys(xero[0] ?? {}), [...XERO_COLUMNS]);
    assert.equal(xero.length, 2);
    assert.equal(xero[0]?.ContactName, "Harbor, Pine & Co");
    assert.equal(xero[0]?.InvoiceNumber, "HP-1");
    assert.equal(xero[1]?.InvoiceNumber, "HP-1");
    assert.equal(xero[0]?.AccountCode, "400");
    assert.equal(xero[0]?.TaxType, "NONE");
    assert.equal(xero[0]?.UnitAmount, "4.50");

    const qbo = toQboRows(outcome.invoice, csvOptions);
    assert.equal(qbo[0]?.Vendor, "Harbor, Pine & Co");
    assert.equal(qbo[0]?.BillNo, "HP-1");
    assert.equal(qbo[0]?.Terms, "Net 30");
    assert.equal(qbo[0]?.Account, "Uncategorized Expense");
    assert.equal(qbo[0]?.TaxCode, "NON");
    assert.equal(qbo[0]?.Amount, "45.00");
    assert.equal(qbo[0]?.Rate, "4.50");
    assert.match(qbo[0]?.Memo ?? "", /Imported from harbor\.pdf/);
  });

  test("validate accepts the Xero CSV this tool writes", () => {
    const outcome = prepareInvoice(draft(), {
      sourceFile: "a.pdf",
      currency: "USD",
      taxType: null,
      taxCode: null,
    });
    assert.ok(outcome.invoice);
    const csv = toCsv(XERO_COLUMNS, toXeroRows(outcome.invoice, csvOptions));
    const report = validateCsvText(csv, { format: "xero", file: "xero.csv" });
    assert.deepEqual(report.errors, []);
    assert.equal(report.dataRows, 1);
  });

  test("validate reports a missing column, a bad currency, and a QBO amount mismatch", () => {
    const missing = validateCsvText("ContactName,InvoiceNumber\nA,B\n", {
      format: "xero",
      file: "bad.csv",
    });
    assert.ok(missing.errors.some((issue) => issue.field === "InvoiceDate"));

    const badCurrency = validateCsvText(
      `${XERO_COLUMNS.join(",")}
Acme,INV-1,2026-01-01,2026-01-31,Work,1,10.00,400,NONE,US
`,
      { format: "xero", file: "currency.csv" },
    );
    assert.ok(badCurrency.errors.some((issue) => issue.field === "Currency"));

    const mismatch = validateCsvText(
      `Vendor,BillNo,BillDate,DueDate,Terms,Memo,Account,Description,Quantity,Rate,Amount,TaxCode,Currency
Acme,B-1,2026-01-01,2026-01-31,Net 30,,Office,Work,2,10.00,15.00,NON,USD
`,
      { format: "qbo", file: "qbo.csv" },
    );
    assert.ok(mismatch.errors.some((issue) => issue.field === "Amount"));
  });
});
