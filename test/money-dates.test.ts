import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, daysBetween, parseDate, paymentTerms } from "../src/dates.js";
import { formatAmount, inferCurrency, parseCurrencyLabel, parseMoney, parseQuantity } from "../src/money.js";

describe("parseMoney", () => {
  test("reads US grouping and a leading symbol", () => {
    assert.equal(parseMoney("$1,234.56"), 1234.56);
    assert.equal(parseMoney("USD 348.50"), 348.5);
  });

  test("reads decimal-comma amounts", () => {
    assert.equal(parseMoney("1.250,00"), 1250);
    assert.equal(parseMoney("475,00"), 475);
  });

  test("reads a parenthetical negative and rejects bare integers by default", () => {
    assert.equal(parseMoney("(20.00)"), -20);
    assert.equal(parseMoney("1010"), null);
    assert.equal(parseMoney("400", { allowInteger: true }), 400);
  });

  test("parses quantities and leaves zero out", () => {
    assert.equal(parseQuantity("2"), 2);
    assert.equal(parseQuantity("2.5"), 2.5);
    assert.equal(parseQuantity("0"), null);
    assert.equal(parseQuantity("two"), null);
  });

  test("formats money with at least two decimals", () => {
    assert.equal(formatAmount(4.5), "4.50");
    assert.equal(formatAmount(4.5, 4), "4.50");
    assert.equal(formatAmount(10 / 3, 4), "3.3333");
    assert.equal(formatAmount(-2), "-2.00");
  });
});

describe("currency", () => {
  test("reads an ISO label and a euro symbol", () => {
    assert.equal(parseCurrencyLabel("NZD"), "NZD");
    assert.equal(parseCurrencyLabel("New Zealand Dollar"), "NZD");
    assert.equal(parseCurrencyLabel("€"), "EUR");
  });

  test("does not treat a bare dollar sign as USD", () => {
    assert.equal(inferCurrency(["Total: $100.00"]), null);
    assert.equal(inferCurrency(["Total: €100.00"]), "EUR");
    assert.equal(inferCurrency(["Currency: NZD", "Total: 10.00"]), "NZD");
  });
});

describe("parseDate", () => {
  test("reads month names and ISO dates", () => {
    assert.equal(parseDate("15 March 2024"), "2024-03-15");
    assert.equal(parseDate("15th March 2024"), "2024-03-15");
    assert.equal(parseDate("March 3, 2026"), "2026-03-03");
    assert.equal(parseDate("2026-01-20"), "2026-01-20");
    assert.equal(parseDate("15-Mar-2024"), "2024-03-15");
  });

  test("disambiguates numeric dates and rejects impossible days", () => {
    assert.equal(parseDate("15/04/2024"), "2024-04-15");
    assert.equal(parseDate("04/15/2024"), "2024-04-15");
    assert.equal(parseDate("03/04/2026", "dmy"), "2026-04-03");
    assert.equal(parseDate("03/04/2026", "mdy"), "2026-03-04");
    assert.equal(parseDate("20.01.2026"), "2026-01-20");
    assert.equal(parseDate("31/02/2024"), null);
    assert.equal(parseDate("2025-02-29"), null);
  });

  test("adds days in UTC and builds payment terms", () => {
    assert.equal(addDays("2026-01-31", 1), "2026-02-01");
    assert.equal(addDays("2026-05-01", 30), "2026-05-31");
    assert.equal(daysBetween("2026-03-03", "2026-04-02"), 30);
    assert.equal(paymentTerms("2026-03-03", "2026-04-02"), "Net 30");
    assert.equal(paymentTerms("2026-03-03", "2026-03-03"), "Due on receipt");
    assert.equal(paymentTerms("2026-04-02", "2026-03-03"), "");
  });
});
