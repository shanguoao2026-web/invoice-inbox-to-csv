import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { prepareInvoice } from "../src/invoice/prepare.js";
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

  test("reads the filedone sample without colons, in rupees, and skips the placeholder name", () => {
    const draft = parseInvoiceText(filedoneSample);
    assert.equal(draft.vendor, "Larkfield Stationers");
    assert.equal(draft.invoiceNumber, "INV-2026-0142");
    assert.equal(draft.invoiceDate, "2026-09-18");
    assert.equal(draft.dueDate, "2026-10-18");
    assert.equal(draft.currency, "INR");
    assert.equal(draft.subtotal, 14702);
    assert.equal(draft.taxAmount, 2646.36);
    assert.equal(draft.taxRate, 18);
    assert.equal(draft.total, 17348.36);
    assert.equal(draft.lineItems.length, 6);
    assert.equal(draft.lineItems[0]?.quantity, 20);
    assert.equal(draft.lineItems[0]?.unitAmount, 285);
    assert.equal(draft.lineItems[0]?.amount, 5700);
    assert.match(draft.lineItems[0]?.description ?? "", /copier paper/);
    assert.equal(
      draft.lineItems.some((item) => /^(?:gst|vat|hst|pst|sales\s*tax|tax)\b/i.test(item.description)),
      false,
    );

    const outcome = prepareInvoice(draft, {
      sourceFile: "filedone-sample-invoice.pdf",
      currency: "USD",
      taxType: null,
      taxCode: null,
    });
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.invoice?.currency, "INR");
    assert.equal(outcome.invoice?.lineItems.length, 6);
  });

  test("prefers an earlier trade name over a fictional placeholder", () => {
    const placeholderFirst = parseInvoiceText(`
A fictional company
Larkfield Stationers
Invoice no. INV-1
Invoice date 2 January 2026
Total 10.00
`);
    assert.equal(placeholderFirst.vendor, "Larkfield Stationers");

    const mergedBanner = parseInvoiceText(`
SPECIMEN
Larkfield Stationers TAX INVOICE
Invoice no. INV-2
Invoice date 2 January 2026
Total 10.00
`);
    assert.equal(mergedBanner.vendor, "Larkfield Stationers");
  });

  test("does not export GST 15% as a product line", () => {
    const draft = parseInvoiceText(`
Kiwi Digits Ltd
Level 4, 22 Queen Street, Auckland 1010
TAX INVOICE
Invoice #: KI-4521
Issue Date: 20 January 2026
Due: 19 February 2026
Currency NZD
Supplier: Kiwi Digits Ltd
Bill To: Harbour Retail Group
Website redesign phase 2 1 2800.00 2800.00
Content migration 1 650.00 650.00
Subtotal $3,450.00
GST 15% $517.50
Amount Due $3,967.50
`);
    assert.equal(draft.vendor, "Kiwi Digits Ltd");
    assert.equal(draft.currency, "NZD");
    assert.equal(draft.subtotal, 3450);
    assert.equal(draft.taxAmount, 517.5);
    assert.equal(draft.taxRate, 15);
    assert.equal(draft.total, 3967.5);
    assert.deepEqual(
      draft.lineItems.map((item) => item.description),
      ["Website redesign phase 2", "Content migration"],
    );
  });

  test("reads European totals and does not ingest VAT as a line", () => {
    const withColon = parseInvoiceText(`
Nordlicht GmbH
Friedrichstraße 12, 10117 Berlin, Germany
Tax Invoice
Invoice No: RE-2026-0311
Date of Issue: 11 March 2026
Payment Due: 10 April 2026
Currency: EUR
Bill From: Nordlicht GmbH
Bill To: Contoso Europe BV
Description Qty Unit Price Amount
API integration consulting (hrs) 12 95.00 1140.00
Webhook monitoring setup 1 250.00 250.00
Subtotal: 1.390,00
VAT 19%: 264,10
Total: 1.654,10
`);
    assert.equal(withColon.subtotal, 1390);
    assert.equal(withColon.taxAmount, 264.1);
    assert.equal(withColon.taxRate, 19);
    assert.equal(withColon.total, 1654.1);
    assert.deepEqual(
      withColon.lineItems.map((item) => item.description),
      ["API integration consulting (hrs)", "Webhook monitoring setup"],
    );
    const sum = withColon.lineItems.reduce((total, item) => total + item.amount, 0);
    assert.equal(sum, 1390);
    const outcome = prepareInvoice(withColon, {
      sourceFile: "berlin-eur-invoice.pdf",
      currency: "EUR",
      taxType: null,
      taxCode: null,
    });
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.warnings.some((issue) => issue.field === "subtotal"), false);

    const withoutColon = parseInvoiceText(`
Supplier: Nordlicht GmbH
Invoice No: RE-1
Invoice Date: 11 March 2026
Widget 1 10.00 10.00
Subtotal: 1.390,00
VAT 19% 264,10
Total: 1.654,10
`);
    assert.equal(withoutColon.subtotal, 1390);
    assert.equal(withoutColon.taxAmount, 264.1);
    assert.equal(withoutColon.taxRate, 19);
    assert.equal(withoutColon.lineItems.length, 1);
    assert.equal(withoutColon.lineItems[0]?.description, "Widget");
  });

  test("ignores a bare label that has no date or amount", () => {
    const draft = parseInvoiceText(`
Supplier: Bare Labels Ltd
Invoice date
Invoice no.
Due date
Subtotal
Total
Widget 1 5.00 5.00
Total: 5.00
`);
    assert.equal(draft.vendor, "Bare Labels Ltd");
    assert.equal(draft.invoiceDate, null);
    assert.equal(draft.rawInvoiceDate, null);
    assert.equal(draft.invoiceNumber, null);
    assert.equal(draft.dueDate, null);
    assert.equal(draft.subtotal, null);
    assert.equal(draft.total, 5);
    assert.equal(draft.lineItems.length, 1);
  });
});

/** Reconstructed text of filedone-sample-invoice.pdf (CC0). */
const filedoneSample = `
Larkfield Stationers TAX INVOICE
A fictional company
Invoice no. INV-2026-0142
22 Example Market, Sampleton 000 000
Invoice date 18 September 2026
accounts@larkfield.example
Due date 18 October 2026
Tax no.: SPECIMEN-TAX-0001
Order ref. PO-77310
BILL TO
Example Traders (fictional)
Unit 5, Specimen Industrial Estate
Sampleton 000 000
Tax no.: SPECIMEN-TAX-0002
# Description Qty Unit price Amount
1 A4 copier paper, 75 gsm, ream of 500 20 ₹285.00 ₹5,700.00
2 Ballpoint pens, blue, box of 50 4 ₹420.00 ₹1,680.00
3 Lever-arch files, A4, pack of 10 3 ₹899.00 ₹2,697.00
4 Whiteboard markers, assorted, pack of 4 6 ₹160.00 ₹960.00
5 Desk organiser, mesh, black 5 ₹349.00 ₹1,745.00
6 Sticky notes, 76 x 76 mm, pack of 12 8 ₹240.00 ₹1,920.00
Subtotal ₹14,702.00
GST at 18% ₹2,646.36
Total due ₹17,348.36
Payment
Bank transfer to Specimen Bank, account SPECIMEN-0000-1111, within
30 days. Please quote the invoice number with your payment.
Every amount is quantity times unit price; the subtotal, GST and total add
up to the paisa.
SPECIMEN - fictional document made by filedone.ai for testing. Free to use (CC0 1.0). Page 1 of 1
`;
