// Pokretanje: node tests/invoice-lines.test.mjs
import assert from "node:assert/strict";
import { lineAmounts, sumLines, lineProblems, isBlankLine, normalizeLine, linesFromItems, commonVatRate } from "../js/invoice-lines.js";
import { normalizeName, nameScore, autoMatch, reconcile, matchStatusOf, purchaseStatusAfterCorrection, surplusRows } from "../js/invoice-match.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };

ok("lineAmounts: cena bez PDV-a, rabat, PDV", () => {
  assert.deepEqual(lineAmounts({ qty: 10, unitPrice: 100, discountPct: 10, vatRate: 20 }), { net: 900, vat: 180, gross: 1080, valid: true });
  assert.deepEqual(lineAmounts({ qty: "2,5", unitPrice: "40,00", vatRate: 10 }), { net: 100, vat: 10, gross: 110, valid: true });
});
ok("lineAmounts: cena SA PDV-om (fiskalni račun)", () => {
  assert.deepEqual(lineAmounts({ qty: 1, unitPrice: 1200, vatRate: 20 }, { pricesIncludeVat: true }), { net: 1000, vat: 200, gross: 1200, valid: true });
});
ok("lineAmounts: ručno zadat iznos ima prednost; neispravan unos", () => {
  assert.equal(lineAmounts({ qty: 3, unitPrice: 33.3333, vatRate: 20, netOverride: 100 }).net, 100);
  assert.equal(lineAmounts({ qty: "", unitPrice: 5 }).valid, false);
  assert.equal(lineAmounts({ qty: -1, unitPrice: 5 }).valid, false);
});
ok("sumLines: zbir i PDV po stopama", () => {
  const s = sumLines([{ qty: 1, unitPrice: 1000, vatRate: 20 }, { qty: 1, unitPrice: 100, vatRate: 10 }, { qty: 2, unitPrice: 500, vatRate: 20 }]);
  assert.deepEqual(s, { net: 2100, vat: 410, gross: 2510, byRate: [{ rate: 20, net: 2000, vat: 400 }, { rate: 10, net: 100, vat: 10 }] });
  assert.equal(commonVatRate([{ vatRate: 20 }, { vatRate: 20 }]), 20);
  assert.equal(commonVatRate([{ vatRate: 20 }, { vatRate: 10 }]), null);
});
ok("lineProblems / isBlankLine / normalizeLine", () => {
  assert.deepEqual(lineProblems({ name: "", qty: 0, unitPrice: "" }), ["name_required", "qty_invalid", "price_invalid"]);
  assert.deepEqual(lineProblems({ name: "Cement", qty: 2, unitPrice: 10 }), []);
  assert.equal(isBlankLine({ name: " ", qty: "", unitPrice: "" }), true);
  const nl = normalizeLine({ id: "a", name: " Cement ", qty: "2,5", unitPrice: "10", vatRate: 20, resolution: "item", link: "i1" });
  assert.equal(nl.net, 25); assert.equal(nl.gross, 30); assert.equal(nl.link, "i1");
  assert.equal(normalizeLine({ id: "b", name: "x", qty: 1, unitPrice: 1, resolution: "extra", link: "i1" }).link, null);
});
ok("linesFromItems: samo preuzeti artikli, zamena nosi naziv zamene", () => {
  let k = 0;
  const l = linesFromItems([
    { id: "1", productName: "Cement", purchasedQty: 5, unit: "kom" },
    { id: "2", productName: "Šrafovi", purchasedQty: 0 },
    { id: "3", productName: "Farba", substituteName: "Farba bela", purchasedQty: 2 },
  ], () => `L${++k}`);
  assert.equal(l.length, 2); assert.equal(l[0].link, "1"); assert.equal(l[1].name, "Farba bela");
});

ok("normalizeName: dijakritici, ćirilica, đ", () => {
  assert.equal(normalizeName("Šrafovi ČEŠLJEVI Đ"), "srafovi cesljevi dj");
  assert.equal(normalizeName("Цемент"), "cement");
  assert.equal(normalizeName("Đubrivo"), "djubrivo");
});
ok("nameScore: padeži, redosled reči, različiti artikli", () => {
  assert.ok(nameScore("Cement 25kg", "cementa 25kg") >= 0.99);
  assert.ok(nameScore("Šraf M8 x 40", "Šraf M10 x 40") < 0.99);
  assert.ok(nameScore("Cement portland", "Portland cement") >= 0.99);
  assert.equal(nameScore("Boja", "Cement"), 0);
});
ok("autoMatch: šifra, naziv, preskače rešene, bira bliži po količini", () => {
  const items = [
    { id: "a", productName: "Cement 25kg", code: "CM25", purchasedQty: 10 },
    { id: "b", productName: "Šraf M8", code: "", purchasedQty: 100 },
    { id: "c", productName: "Šraf M8", code: "", purchasedQty: 5 },
  ];
  const m = autoMatch([
    { id: "1", name: "bilo šta", code: "cm25", qty: 10 },
    { id: "2", name: "ŠRAF M8", qty: 5 },
    { id: "3", name: "Nepoznat artikal", qty: 1 },
    { id: "4", name: "Cement 25kg", qty: 1, resolution: "extra" },
  ], items);
  assert.deepEqual(m.map((x) => [x.lineId, x.itemId]), [["1", "a"], ["2", "c"]]);
});
ok("reconcile: ok / manje / više / nema na računu / nerešene", () => {
  const items = [
    { id: "a", quantity: 10, purchasedQty: 10 }, { id: "b", quantity: 5, purchasedQty: 5 },
    { id: "c", quantity: 4, purchasedQty: 4 }, { id: "d", quantity: 3, purchasedQty: 3 }, { id: "e", quantity: 2, purchasedQty: 0 },
  ];
  const lines = [
    { id: "1", resolution: "item", link: "a", qty: 10 }, { id: "2", resolution: "item", link: "b", qty: 3 },
    { id: "3", resolution: "item", link: "c", qty: 6 }, { id: "4", resolution: "", qty: 1 }, { id: "5", resolution: "extra", qty: 1 },
  ];
  const r = reconcile({ items, lines });
  assert.deepEqual(r.rows.map((x) => x.status), ["ok", "less", "more", "missing_on_invoice", "ok"]);
  assert.equal(r.unresolved.length, 1); assert.equal(r.extras.length, 1);
  assert.equal(r.status, "nije_usaglaseno");
  assert.equal(r.rows[2].overOrdered, 0); // naručeno 4, preuzeto 4 (na računu 6 je razlika, ne višak preuzetog)
});
ok("reconcile: predložena ispravka preuzetog usaglašava, a višak se računa preko naručenog", () => {
  const items = [{ id: "c", quantity: 4, purchasedQty: 4 }, { id: "d", quantity: 3, purchasedQty: 3 }];
  const lines = [{ id: "3", resolution: "item", link: "c", qty: 6 }];
  const r = reconcile({ items, lines, overrides: { c: 6, d: 0 } });
  assert.deepEqual(r.rows.map((x) => x.status), ["ok", "ok"]);
  assert.equal(r.rows[0].overOrdered, 2); assert.equal(r.rows[0].corrected, true);
  assert.equal(r.status, "usaglaseno");
  const s = surplusRows(r, { supplierId: "s1", supplierName: "Dobavljač" });
  assert.deepEqual(s.shortages, [{ itemId: "c", missingQty: 2 }]);
});
ok("surplusRows: stavka 'višak' bez svog para postaje sintetički artikal", () => {
  const r = reconcile({ items: [], lines: [{ id: "9", resolution: "surplus", name: "Lepak", unit: "kom", qty: 3 }] });
  const s = surplusRows(r, { supplierId: "s1", supplierName: "D" });
  assert.equal(s.synthetic[0].productName, "Lepak"); assert.deepEqual(s.shortages, [{ itemId: "surplus_9", missingQty: 3 }]);
});
ok("matchStatusOf i status nabavke posle ispravke", () => {
  assert.equal(matchStatusOf({ unresolved: [], differences: [] }), "usaglaseno");
  assert.equal(matchStatusOf({ unresolved: [], differences: [1] }), "usaglaseno_uz_razlike");
  assert.equal(matchStatusOf({ unresolved: [1], differences: [] }), "nije_usaglaseno");
  assert.equal(purchaseStatusAfterCorrection("kupljeno", 0), "nije_pronadjeno");
  assert.equal(purchaseStatusAfterCorrection("nije_pronadjeno", 2), "kupljeno");
  assert.equal(purchaseStatusAfterCorrection("zamena", 2), "zamena");
});
console.log(`\n${n} testova prošlo.`);
