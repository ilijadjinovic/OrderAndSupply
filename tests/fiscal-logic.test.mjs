// Pokretanje: node tests/fiscal-logic.test.mjs
import assert from "node:assert/strict";
import { extractReceiptUrl, receiptKey, receiptDate, receiptToDraft, vatCheck, usageList } from "../js/fiscal-logic.js";
import { sumLines, lineProblems, normalizeLine } from "../js/invoice-lines.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };
const URL1 = "https://suf.purs.gov.rs/v/?vl=A1B2C3D4E5F6";

ok("extractReceiptUrl: čist link, link u tekstu, razmaci; odbija tuđ domen i link bez vl", () => {
  assert.equal(extractReceiptUrl(URL1), URL1);
  assert.equal(extractReceiptUrl(`  ${URL1}  \n`), URL1);
  assert.equal(extractReceiptUrl(`Račun: ${URL1} hvala`), URL1);
  assert.equal(extractReceiptUrl("https://evil.example/v/?vl=abc"), null);
  assert.equal(extractReceiptUrl("https://suf.purs.gov.rs.evil.example/v/?vl=abc"), null);
  assert.equal(extractReceiptUrl("https://suf.purs.gov.rs/v/"), null);
  assert.equal(extractReceiptUrl("neki tekst"), null);
  assert.equal(extractReceiptUrl(""), null);
});
ok("receiptKey i receiptDate", () => {
  assert.equal(receiptKey(" abcd1234-abcd1234-12345 "), "ABCD1234-ABCD1234-12345");
  assert.equal(receiptKey("a/b c"), "A_B_C");
  assert.equal(receiptDate("2026-11-27T10:15:00"), "2026-11-27"); assert.equal(receiptDate(""), "");
});
const RECEIPT = {
  pib: "123456789", chain: "Prodavnica", object: "Centar", address: "Glavna 5", city: "ŠABAC", total: 6000, time: "2026-11-27T10:15:00",
  pfr: "ABCD1234-ABCD1234-12345", totalTax: 931.82,
  taxes: [{ label: "Đ", name: "O-PDV", rate: 20, tax: 850 }, { label: "E", name: "P-PDV", rate: 10, tax: 81.82 }],
  items: [
    { name: "Klema", quantity: 30, unitPrice: 120, total: 3600, vatRate: 20 },
    { name: "Prekidač", quantity: 6, unitPrice: 250, total: 1500, vatRate: 20 },
    { name: "Cev", quantity: 10, unitPrice: 90, total: 900, vatRate: 10 },
  ],
};
ok("receiptToDraft: broj=PFR, datum, cene sa PDV-om, zbir stavki = račun", () => {
  let k = 0; const d = receiptToDraft(RECEIPT, { newId: () => `L${++k}` });
  assert.equal(d.number, "ABCD1234-ABCD1234-12345"); assert.equal(d.date, "2026-11-27"); assert.equal(d.pricesIncludeVat, true);
  assert.equal(d.lines.length, 3); assert.equal(d.unknownVat, 0); assert.equal(d.controlGross, 6000);
  const s = sumLines(d.lines, { pricesIncludeVat: true });
  assert.equal(s.gross, 6000); assert.equal(s.vat, 931.82); assert.equal(s.net, 5068.18);
  assert.deepEqual(s.byRate, [{ rate: 20, net: 4250, vat: 850 }, { rate: 10, net: 818.18, vat: 81.82 }]);
  assert.equal(d.fiscal.pib, "123456789"); assert.equal(d.fiscal.totalTax, 931.82);
});
ok("PDV iz stavki se slaže sa ukupnim porezom računa (vatCheck)", () => {
  const d = receiptToDraft(RECEIPT, { newId: () => "x" });
  const s = sumLines(d.lines, { pricesIncludeVat: true });
  assert.deepEqual(vatCheck(s.vat, d.fiscal.totalTax), { computed: 931.82, reported: 931.82, diff: 0, ok: true });
  assert.equal(vatCheck(900, 931.82).ok, false); assert.equal(vatCheck(900, null), null);
});
ok("nepoznata stopa PDV-a: stavka ostaje bez stope i ne može da se potvrdi dok se ne izabere", () => {
  const r = { ...RECEIPT, items: [{ ...RECEIPT.items[0], vatRate: null }, RECEIPT.items[1]] };
  const d = receiptToDraft(r, { newId: () => "x" });
  assert.equal(d.unknownVat, 1); assert.equal(d.lines[0].vatRate, "");
  assert.ok(lineProblems(d.lines[0], { pricesIncludeVat: true }).includes("vat_missing"));
  assert.deepEqual(lineProblems(d.lines[1], { pricesIncludeVat: true }), []);
  assert.equal(normalizeLine(d.lines[0], { pricesIncludeVat: true }).vatRate, null);   // nacrt čuva "nepoznato"
  d.lines[0].vatRate = 20;
  assert.deepEqual(lineProblems(d.lines[0], { pricesIncludeVat: true }), []);
});
ok("stavka sa negativnim iznosom (popust na računu) prolazi proveru", () => {
  const r = { ...RECEIPT, items: [{ name: "Popust", quantity: 1, unitPrice: -100, total: -100, vatRate: 20 }] };
  const d = receiptToDraft(r, { newId: () => "x" });
  assert.deepEqual(lineProblems(d.lines[0], { pricesIncludeVat: true }), []);
  assert.equal(sumLines(d.lines, { pricesIncludeVat: true }).gross, -100);
});
ok("usageList: ranija upotreba računa, uz izuzetak sopstvenog računa", () => {
  const doc = { uses: { i1: { orderNumber: "N-1", byName: "Pera" }, i2: { orderNumber: "N-2" } } };
  assert.equal(usageList(doc).length, 2);
  assert.deepEqual(usageList(doc, { exceptInvoiceId: "i1" }).map((u) => u.orderNumber), ["N-2"]);
  assert.deepEqual(usageList(null), []);
});
console.log(`\n${n} testova prošlo.`);
