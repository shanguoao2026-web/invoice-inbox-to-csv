import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "fixtures");

const fixtures: Array<{ filename: string; pages: string[][] }> = [
  {
    filename: "northwind-services.pdf",
    pages: [
      [
        "## NORTHWIND SUPPLIES LTD",
        "12 Harbor Road",
        "Auckland 1010",
        "New Zealand",
        "accounts@northwind.example",
        "",
        "# TAX INVOICE",
        "---",
        "Invoice Number: INV-2024-001",
        "Invoice Date: 15 March 2024",
        "Due Date: 14 April 2024",
        "Currency: NZD",
        "",
        "Bill To: Acme Holdings Ltd",
        "",
        "Description Qty Unit Price Amount",
        "Consulting services 2 150.00 300.00",
        "Travel reimbursement 1 48.50 48.50",
        "",
        "Subtotal: 348.50",
        "GST (15%): 52.28",
        "Total: 400.78",
      ],
    ],
  },
  {
    filename: "harbor-pine-hardware.pdf",
    pages: [
      [
        "# INVOICE",
        "---",
        "Bill From: Harbor, Pine & Co.",
        "18 Wharf Street",
        "Portland OR 97201",
        "Phone: +1 503 555 0148",
        "",
        "Invoice #: HP-88421",
        "Invoice Date: March 3, 2026",
        "Due Date: April 2, 2026",
        "Currency: USD",
        "",
        "Description Qty Unit Price Amount",
        "Brass hinges 10 4.50 45.00",
        "Oak dowels 4 2.25 9.00",
        "Delivery 1 12.00 12.00",
        "",
        "Subtotal: 66.00",
        "Sales Tax (8.25%): 5.45",
        "Total: 71.45",
      ],
    ],
  },
  {
    filename: "helios-consulting.pdf",
    pages: [
      [
        "## HELIOS CONSULTING GMBH",
        "Hauptstrasse 10",
        "10115 Berlin",
        "Germany",
        "",
        "# TAX INVOICE",
        "---",
        "Supplier: Helios Consulting GmbH",
        "Invoice No: RE-2026-014",
        "Invoice Date: 2026-01-20",
        "Due Date: 2026-02-19",
        "Currency: EUR",
        "",
        "Description Qty Unit Price Amount",
        "Strategy workshop 1 1800.00 1800.00",
        "",
        "Subtotal: 2000.00",
        "VAT (19%): 380.00",
        "Total: 2380.00",
      ],
      [
        "## HELIOS CONSULTING GMBH",
        "Description Qty Unit Price Amount",
        "Follow-up notes 1 200.00 200.00",
      ],
    ],
  },
  {
    filename: "incomplete-receipt.pdf",
    pages: [
      [
        "# PAYMENT RECEIPT",
        "Received with thanks.",
        "Amount: 20.00",
      ],
    ],
  },
];

async function writePdf(filePath: string, pages: string[][]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const stream = createWriteStream(filePath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
    doc.info.Creator = "invoice-inbox-to-csv fixtures";
    doc.info.Title = path.basename(filePath, ".pdf");
    pages.forEach((lines, pageIndex) => {
      if (pageIndex > 0) doc.addPage();
      drawPage(doc, lines);
    });
    doc.end();
  });
}

function drawPage(doc: PDFKit.PDFDocument, lines: string[]): void {
  let y = 54;
  for (const raw of lines) {
    if (raw === "---") {
      y += 4;
      doc.moveTo(54, y).lineTo(541, y).lineWidth(0.6).strokeColor("#444444").stroke();
      y += 10;
      continue;
    }
    if (raw === "") {
      y += 8;
      continue;
    }
    const heading = raw.startsWith("## ");
    const subheading = !heading && raw.startsWith("# ");
    const text = heading ? raw.slice(3) : subheading ? raw.slice(2) : raw;
    const size = heading ? 16 : subheading ? 13 : 10;
    doc.font(heading || subheading ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor("#111111");
    doc.text(text, 54, y, { lineBreak: false });
    y += size + (heading ? 8 : 5);
  }
}

await mkdir(outputDir, { recursive: true });
for (const fixture of fixtures) {
  const filePath = path.join(outputDir, fixture.filename);
  await writePdf(filePath, fixture.pages);
  console.log(`wrote ${path.relative(root, filePath)}`);
}
