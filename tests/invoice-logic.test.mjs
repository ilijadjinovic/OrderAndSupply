// Pokretanje: node tests/invoice-logic.test.mjs
import assert from "node:assert/strict";
import {
  fromGross, fromNet, validateInvoice, summarizeInvoices, purchaseHasInvoice, isLegacyPurchaseAmount,
  computeInvoiceStatus, isAwaitingInvoice, canManageInvoices, round2,
} from "../js/invoice-logic.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };

ok("fromGross: 20% i 10% PDV", () => {
  assert.deepEqual(fromGross(1200, 20), { net: 1000, vat: 200, gross: 1200 });
  assert.deepEqual(fromGross(1100, 10), { net: 1000, vat: 100, gross: 1100 });
  assert.deepEqual(fromGross(500, 0), { net: 500, vat: 0, gross: 500 });
});
ok("fromGross: zaokruživanje, osnovica + PDV uvek daju ukupno", () => {
  const r = fromGross(999.99, 20);
  assert.equal(round2(r.net + r.vat), 999.99);
});
ok("fromNet", () => {
  assert.deepEqual(fromNet(1000, 20), { net: 1000, vat: 200, gross: 1200 });
  assert.deepEqual(fromNet("83.33", 20), { net: 83.33, vat: 16.67, gross: 100 });
});
ok("validateInvoice: ispravan, prazan broj, zbir se ne slaže, duplikat", () => {
  assert.deepEqual(validateInvoice({ number: "A-1", net: 1000, vat: 200, gross: 1200 }), []);
  assert.ok(validateInvoice({ number: " ", net: 1000, vat: 200, gross: 1200 }).includes("number_required"));
  assert.ok(validateInvoice({ number: "A-1", net: 1000, vat: 100, gross: 1200 }).includes("sum_mismatch"));
  assert.ok(validateInvoice({ number: "A-1", net: 0, vat: 0, gross: 0 }).includes("gross_required"));
  assert.ok(validateInvoice({ number: "a-1", net: 1000, vat: 200, gross: 1200 }, { existingNumbers: ["A-1"] }).includes("duplicate_number"));
  assert.deepEqual(validateInvoice({ number: "A-1", net: "1000,00", vat: "200,00", gross: "1200,00" }), []);
});
ok("summarizeInvoices: zbir sa PDV-om, brojevi, poslednji datum", () => {
  const s = summarizeInvoices([
    { number: "1", date: "2026-11-02", netAmount: 1000, vatAmount: 200, grossAmount: 1200 },
    { number: "2", date: "2026-11-05", netAmount: 100, vatAmount: 10, grossAmount: 110 },
  ]);
  assert.deepEqual(s, { paidAmount: 1310, netAmount: 1100, vatAmount: 210, invoiceCount: 2, receiptNumber: "1, 2", receiptDate: "2026-11-05" });
  assert.equal(summarizeInvoices([]).paidAmount, 0);
});
ok("raniji ručni iznos se računa kao račun, dok ne bude pretvoren", () => {
  assert.equal(purchaseHasInvoice({ paidAmount: 500 }), true);
  assert.equal(isLegacyPurchaseAmount({ paidAmount: 500 }), true);
  assert.equal(purchaseHasInvoice({ paidAmount: 0 }), false);
  assert.equal(purchaseHasInvoice({ paidAmount: 0, invoiceCount: 0 }), false);
  assert.equal(isLegacyPurchaseAmount({ paidAmount: 500, invoiceCount: 1 }), false);
});
ok("computeInvoiceStatus", () => {
  const items = [{ supplierId: "s1", purchasedQty: 2 }, { supplierId: "s2", purchasedQty: 1 }, { supplierId: "s3", purchasedQty: 0 }];
  const P = (id, extra = {}) => ({ supplierId: id, ...extra });
  assert.equal(computeInvoiceStatus([P("s1"), P("s2"), P("s3")], items), "bez_racuna");
  assert.equal(computeInvoiceStatus([P("s1", { invoiceCount: 1 }), P("s2"), P("s3")], items), "delimicno");
  assert.equal(computeInvoiceStatus([P("s1", { invoiceCount: 1 }), P("s2", { invoiceCount: 2 }), P("s3")], items), "kompletno");
  assert.equal(computeInvoiceStatus([P("s1", { noInvoice: true }), P("s2", { noInvoice: true })], items), "nije_potreban");
  assert.equal(computeInvoiceStatus([P("s1", { invoiceCount: 1 }), P("s2", { noInvoice: true })], items), "kompletno");
  assert.equal(computeInvoiceStatus([P("s1")], [{ supplierId: "s1", purchasedQty: 0 }]), "nije_potreban");
  assert.equal(computeInvoiceStatus([], []), "nije_potreban");
});
ok("isAwaitingInvoice samo za zatvorene", () => {
  assert.equal(isAwaitingInvoice({ status: "zatvorena", invoiceStatus: "bez_racuna" }), true);
  assert.equal(isAwaitingInvoice({ status: "zatvorena", invoiceStatus: "delimicno" }), true);
  assert.equal(isAwaitingInvoice({ status: "zatvorena", invoiceStatus: "kompletno" }), false);
  assert.equal(isAwaitingInvoice({ status: "u_nabavci", invoiceStatus: "bez_racuna" }), false);
  assert.equal(isAwaitingInvoice({ status: "zatvorena" }), false);
});
ok("canManageInvoices: prava po ulozi", () => {
  const o = { status: "zatvorena", createdByUid: "N1", assignedToUid: "I1" };
  assert.equal(canManageInvoices({ role: "admin" }, o, "A1"), true);
  assert.equal(canManageInvoices({ role: "narucilac" }, o, "N1"), true);
  assert.equal(canManageInvoices({ role: "narucilac" }, o, "N2"), false);
  assert.equal(canManageInvoices({ role: "isporucilac" }, o, "I1"), true);
  assert.equal(canManageInvoices({ role: "isporucilac" }, o, "I2"), false);
  assert.equal(canManageInvoices({ role: "admin" }, { ...o, status: "odbijena" }, "A1"), false);
  assert.equal(canManageInvoices({ role: "admin" }, { ...o, status: "kreirana" }, "A1"), false);
});
console.log(`\n${n} testova prošlo.`);
