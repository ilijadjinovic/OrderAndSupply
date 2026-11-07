// Pokretanje: node tests/catalog-search.test.mjs
import assert from "node:assert/strict";
import { normalizeSearch, filterProducts, hasActiveFilter } from "../js/catalog-search.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };

const P = [
  { id: "1", name: "Šunka pizza 1kg", code: "1001", barcode: "8600001", categoryId: "meso", active: true },
  { id: "2", name: "Džus od narandže 1l", code: "2002", barcode: "8600002", categoryId: "pice", active: true },
  { id: "3", name: "Mleko 1l", code: "3003", barcode: "8600003", categoryId: "mlecno", active: false },
  { id: "4", name: "Đumbir svež", code: "4004", barcode: "", categoryId: "", active: true },
  { id: "5", name: "Млеко 2,8%", code: "3004", categoryId: "mlecno", active: true },
];
const isActive = (p) => p.active !== false;
const ids = (f) => filterProducts(P, f, isActive).map((p) => p.id);

ok("normalizeSearch: kvačice, velika slova, đ, dž, razmaci", () => {
  assert.equal(normalizeSearch("  ŠUNKA  Čačak "), "sunka cacak");
  assert.equal(normalizeSearch("Đumbir"), "djumbir");
  assert.equal(normalizeSearch("Džus"), "dzus");
  assert.equal(normalizeSearch(null), "");
});
ok("normalizeSearch: ćirilica se pretvara u latinicu", () => {
  assert.equal(normalizeSearch("Млеко"), "mleko");
  assert.equal(normalizeSearch("Ђумбир Џем"), "djumbir dzem");
});
ok("pretraga bez kvačica nalazi artikal sa kvačicama (i obrnuto)", () => {
  assert.deepEqual(ids({ query: "sunka" }), ["1"]);
  assert.deepEqual(ids({ query: "šunka" }), ["1"]);
  assert.deepEqual(ids({ query: "dzus" }), ["2"]);
  assert.deepEqual(ids({ query: "djumbir" }), ["4"]);
});
ok("ćirilični unos nalazi latinični naziv i obrnuto", () => {
  assert.deepEqual(ids({ query: "млеко" }), ["3", "5"]);
  assert.deepEqual(ids({ query: "mleko" }), ["3", "5"]);
});
ok("više reči: moraju sve, redosled nije bitan", () => {
  assert.deepEqual(ids({ query: "mleko 1l" }), ["3"]);
  assert.deepEqual(ids({ query: "1l mleko" }), ["3"]);
  assert.deepEqual(ids({ query: "mleko pizza" }), []);
});
ok("pretraga po šifri i barkodu (delimično)", () => {
  assert.deepEqual(ids({ query: "2002" }), ["2"]);
  assert.deepEqual(ids({ query: "860000" }), ["1", "2", "3"]);
});
ok("filter po kategoriji i statusu, u kombinaciji sa pretragom", () => {
  assert.deepEqual(ids({ categoryId: "mlecno" }), ["3", "5"]);
  assert.deepEqual(ids({ status: "passive" }), ["3"]);
  assert.deepEqual(ids({ status: "active", categoryId: "mlecno" }), ["5"]);
  assert.deepEqual(ids({ query: "mleko", status: "active" }), ["5"]);
});
ok("prazni filteri vraćaju sve; hasActiveFilter", () => {
  assert.equal(ids({}).length, 5);
  assert.equal(hasActiveFilter({ query: "  " }), false);
  assert.equal(hasActiveFilter({ query: "a" }), true);
  assert.equal(hasActiveFilter({ status: "passive" }), true);
});
console.log(`\n${n} testova prošlo`);
