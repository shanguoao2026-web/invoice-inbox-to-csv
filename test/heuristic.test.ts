import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseInvoiceText } from "../src/parse/heuristic.js";

const northwind = `
NORTHWIND SUPPLIES LTD
12 Harbor Road
Auckland 1010
New Zealand
accounts@northwind.example
TAX INVOICE
Invoice Number: INV-2024-001
Invoice Date: 15 March 2024
Due Date: 14 April 2024
Currency: NZD
Bill To: Acme Holdings Ltd
Description Qty Unit Price Amount
Consulting services 2 150.00 300.00
Travel reimbursement 1 48.50 48.50
Subtotal: 348.50
GST (15%): 52.28
Total: 400.78
-- 1 of 1 --
`;

describe("parseInvoiceText", () => {
  test("reads a labeled NZ invoice and ignores the bill-to party", () => {
    const draft = parseInvoiceText(northwind);
    assert.equal(draft.vendor, "NORTHWIND SUPPLIES LTD");
    assert.equal(draft.invoiceNumber, "INV-2024-001");
    assert.equal(draft.invoiceDate, "2024-03-15");
    assert.equal(draft.dueDate, "2024-04-14");
    assert.equal(draft.currency, "NZD");
    assert.equal(draft.subtotal, 348.5);
    assert.equal(draft.taxAmount, 52.28);
    assert.equal(draft.taxRate, 15);
    assert.equal(draft.total, 400.78);
    assert.equal(draft.taxInclusive, false);
    assert.deepEqual(
      draft.lineItems.map((item) => item.description),
      ["Consulting services", "Travel reimbursement"],
    );
    assert.equal(draft.lineItems[0]?.quantity, 2);
    assert.equal(draft.lineItems[0]?.unitAmount, 150);
    assert.equal(draft.lineItems[0]?.amount, 300);
    assert.equal(draft.vendor?.includes("Acme"), false);
  });

  test("reads a US bill-from label, a comma in the name, and sales tax", () => {
    const draft = parseInvoiceText(`
INVOICE
Bill From: Harbor, Pine & Co.
18 Wharf Street
Portland OR 97201
Phone: +1 503 555 0148
Invoice #: HP-88421
Invoice Date: March 3, 2026
Due Date: April 2, 2026
Currency: USD
Description Qty Unit Price Amount
Brass hinges 10 4.50 45.00
Oak dowels 4 2.25 9.00
Delivery 1 12.00 12.00
Subtotal: 66.00
Sales Tax (8.25%): 5.45
Total: 71.45
`);
    assert.equal(draft.vendor, "Harbor, Pine & Co");
    assert.equal(draft.invoiceNumber, "HP-88421");
    assert.equal(draft.invoiceDate, "2026-03-03");
    assert.equal(draft.dueDate, "2026-04-02");
    assert.equal(draft.currency, "USD");
    assert.equal(draft.taxRate, 8.25);
    assert.equal(draft.taxAmount, 5.45);
    assert.equal(draft.lineItems.length, 3);
    assert.equal(draft.lineItems[1]?.description, "Oak dowels");
    assert.equal(draft.lineItems[1]?.quantity, 4);
  });

  test("reads European amounts, a dotted date, and a second page line", () => {
    const draft = parseInvoiceText(`
Supplier: Müller GmbH
Invoice No: RE-9
Invoice Date: 20.01.2026
Currency: EUR
Description Qty Unit Price Amount
Beratung 2 1.250,00 2.500,00
Follow-up notes 1 200,00 200,00
Subtotal: 2.700,00
VAT (19%): 513,00
Total: 3.213,00
`);
    assert.equal(draft.vendor, "Müller GmbH");
    assert.equal(draft.invoiceNumber, "RE-9");
    assert.equal(draft.invoiceDate, "2026-01-20");
    assert.equal(draft.currency, "EUR");
    assert.equal(draft.lineItems[0]?.unitAmount, 1250);
    assert.equal(draft.lineItems[0]?.amount, 2500);
    assert.equal(draft.lineItems[1]?.amount, 200);
    assert.equal(draft.subtotal, 2700);
    assert.equal(draft.taxAmount, 513);
    assert.equal(draft.total, 3213);
    assert.equal(draft.taxRate, 19);
  });

  test("infers EUR from the euro sign and leaves a bare dollar unset", () => {
    const euro = parseInvoiceText(`
Supplier: Atelier SAS
Invoice Number: FR-1
Invoice Date: 2026-02-02
Description Qty Unit Price Amount
Poster 1 10.00 10.00
Total: €10.00
`);
    assert.equal(euro.currency, "EUR");

    const dollar = parseInvoiceText(`
Supplier: Corner Shop LLC
Invoice Number: US-1
Invoice Date: 2026-02-02
Description Qty Unit Price Amount
Poster 1 10.00 10.00
Total: $10.00
`);
    assert.equal(dollar.currency, null);
  });

  test("does not invent a supplier or an invoice number for a receipt", () => {
    const draft = parseInvoiceText(`
PAYMENT RECEIPT
Received with thanks.
Amount: 20.00
`);
    assert.equal(draft.vendor, null);
    assert.equal(draft.invoiceNumber, null);
    assert.equal(draft.invoiceDate, null);
    assert.equal(draft.total, 20);
    assert.equal(draft.lineItems.length, 0);
  });

  test("keeps a description that contains a model number when qty and prices are present", () => {
    const draft = parseInvoiceText(`
Supplier: Parts Ltd
Invoice Number: P-1
Invoice Date: 2026-04-04
Description Qty Unit Price Amount
Model 2000 widget 1 5.00 5.00
Total: 5.00
`);
    assert.equal(draft.lineItems[0]?.description, "Model 2000 widget");
    assert.equal(draft.lineItems[0]?.quantity, 1);
  });

  test("marks prices that include VAT", () => {
    const draft = parseInvoiceText(`
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
    assert.equal(draft.taxInclusive, true);
    assert.equal(draft.taxRate, 20);
    assert.equal(draft.taxAmount, 20);
    assert.equal(draft.total, 120);
    assert.equal(draft.subtotal, 100);
    assert.equal(draft.lineItems[0]?.amount, 120);
  });
});
