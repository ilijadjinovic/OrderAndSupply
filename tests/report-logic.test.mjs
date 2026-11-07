// Pokretanje: node tests/report-logic.test.mjs
import assert from "node:assert/strict";
import { aggregateBySupplier, aggregateByItem, groupItemsBySupplier, parseQty, fmtQty, itemKey, toDate, summarizeOrders, topBy, pickSuppliers, pickNarucilac } from "../js/report-logic.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };

const rows = [
  { id: "o1", items: [
    { productId: "p1", code: "1012", productName: "Brašno T-500", quantity: 10, unit: "kom", supplierId: "s1", supplierName: "Metro" },
    { productId: "p2", code: "2210", productName: "Paradajz", quantity: "2,5", unit: "kg", supplierId: "s2", supplierName: "Delta" },
  ] },
  { id: "o2", items: [
    { productId: "p1", code: "1012", productName: "Brašno T-500", quantity: 5, unit: "kom", supplierId: "s1", supplierName: "Metro" },
    { productId: "p1", code: "1012", productName: "Brašno T-500", quantity: 1, unit: "kom", supplierId: "s1", supplierName: "Metro" },
    { productId: "p2", code: "2210", productName: "Paradajz", quantity: 3, unit: "kom", supplierId: "s2", supplierName: "Delta" },
  ] },
  { id: "o3", items: [] },
  { id: "o4" },
];

ok("parseQty: broj, tačka, zarez, smeće", () => {
  assert.equal(parseQty(4), 4); assert.equal(parseQty("2,5"), 2.5); assert.equal(parseQty("3.25"), 3.25);
  assert.equal(parseQty("abc"), 0); assert.equal(parseQty(null), 0); assert.equal(parseQty(undefined), 0);
});
ok("aggregateByItem: sabira količine istog artikla i jedinice", () => {
  const a = aggregateByItem(rows);
  const brasno = a.find((x) => x.code === "1012");
  assert.equal(brasno.quantity, 16);
  assert.equal(brasno.orderCount, 2);   // 2 narudžbine, iako ima 3 stavke
});
ok("aggregateByItem: različite jedinice mere se ne sabiraju", () => {
  const a = aggregateByItem(rows).filter((x) => x.code === "2210");
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((x) => x.unit).sort(), ["kg", "kom"]);
});
ok("aggregateByItem: sortirano po količini opadajuće", () => {
  const q = aggregateByItem(rows).map((x) => x.quantity);
  assert.deepEqual(q, [...q].sort((x, y) => y - x));
});
ok("aggregateByItem: narudžbine bez stavki ne smetaju; prazan ulaz", () => {
  assert.deepEqual(aggregateByItem([{ id: "x" }, { id: "y", items: [] }]), []);
  assert.deepEqual(aggregateByItem(undefined), []);
});
ok("aggregateByItem: bez productId koristi šifru pa naziv, ne razlikuje velika/mala slova", () => {
  const a = aggregateByItem([{ id: "o", items: [
    { productName: "Kafa", quantity: 1, unit: "kg" }, { productName: "kafa ", quantity: 2, unit: "KG" },
  ] }]);
  assert.equal(a.length, 1); assert.equal(a[0].quantity, 3);
});
ok("groupItemsBySupplier: grupiše po dobavljaču, redosled prvog pojavljivanja", () => {
  const g = groupItemsBySupplier(rows[1].items);
  assert.deepEqual(g.map((x) => x.name), ["Metro", "Delta"]);
  assert.equal(g[0].items.length, 2);
  assert.deepEqual(groupItemsBySupplier(undefined), []);
});
ok("fmtQty: do 3 decimale, bez nula viška", () => {
  assert.equal(fmtQty(10, "en-GB"), "10"); assert.equal(fmtQty(2.5, "en-GB"), "2.5"); assert.equal(fmtQty(1.23456, "en-GB"), "1.235");
});
ok("aggregateByItem: orders = lista narudžbina sa količinom tog artikla u svakoj", () => {
  const b = aggregateByItem(rows).find((x) => x.code === "1012");
  assert.deepEqual(b.orders.map((o) => [o.r.id, o.quantity]), [["o1", 10], ["o2", 6]]);
  assert.equal(b.orders.length, b.orderCount);
});
const sRows = [
  { id: "a", items: [{ supplierId: "s1", supplierName: "Hadrijan" }], purchases: [{ supplierId: "s1", supplierName: "Hadrijan", paidAmount: 100 }] },
  { id: "b", items: [{ supplierId: "s1", supplierName: "Hadrijan" }, { supplierId: "s1" }], purchases: [] },
  { id: "c", items: [{ supplierId: "s2", supplierName: "Metro" }], purchases: [{ supplierId: "s1", supplierName: "Hadrijan", paidAmount: 50 }, { supplierId: "s1", paidAmount: "25" }] },
  { id: "d" },
];
ok("aggregateBySupplier: unija stavki i nabavki, narudžbina se broji jednom", () => {
  const h = aggregateBySupplier(sRows).find((x) => x.key === "s1");
  assert.equal(h.orderCount, 3);                       // a (oba), b (samo stavke), c (samo nabavka)
  assert.deepEqual(h.orders.map((o) => o.r.id), ["a", "b", "c"]);
  assert.equal(h.total, 175);                          // iznos samo iz nabavki
  assert.deepEqual(h.orders.map((o) => o.amount), [100, 0, 75]);
});
ok("aggregateBySupplier: dobavljač samo u stavkama se vidi; prazan ulaz; sort po iznosu", () => {
  const a = aggregateBySupplier(sRows);
  assert.deepEqual(a.map((x) => x.key), ["s1", "s2"]);
  assert.equal(a[1].orderCount, 1); assert.equal(a[1].total, 0);
  assert.deepEqual(aggregateBySupplier(undefined), []);
});

const E = [
  { r: { id: "a", status: "zavrsena", createdAt: new Date("2026-10-01"), createdByUid: "u1", createdByName: "Pera", items: [{ supplierId: "s1", supplierName: "Metro" }, { supplierId: "s1", supplierName: "Metro" }, { supplierId: "s2", supplierName: "Imlek" }] } },
  { r: { id: "b", status: "zavrsena", createdAt: { seconds: Date.parse("2026-10-09") / 1000 }, createdByUid: "u1", createdByName: "Pera", items: [{ supplierId: "s1", supplierName: "Metro" }] } },
  { r: { id: "c", status: "otkazana", createdAt: { toDate: () => new Date("2026-10-05") }, createdByUid: "u2", createdByName: "Mika", items: [] } },
];
ok("itemKey: isti ključ kao u aggregateByItem; prazan bez oznake", () => {
  assert.equal(itemKey({ productId: "P1", unit: " KG " }), "p1|kg");
  assert.equal(itemKey({ code: "12", unit: "kom" }), "12|kom");
  assert.equal(itemKey({ unit: "kom" }), "");
  assert.equal(aggregateByItem(rows).find((x) => x.code === "1012").key, itemKey(rows[0].items[0]));
});
ok("toDate: Timestamp, Date, {seconds}, prazno", () => {
  assert.equal(toDate(new Date("2026-01-02")).getFullYear(), 2026); assert.equal(toDate({ seconds: 0 }).getTime(), 0);
  assert.equal(toDate({ toDate: () => new Date(5) }).getTime(), 5); assert.equal(toDate(null), null);
});
ok("summarizeOrders: broj po statusu (opadajuće) i poslednji datum", () => {
  const s = summarizeOrders(E);
  assert.equal(s.count, 3); assert.deepEqual(s.byStatus, [{ status: "zavrsena", count: 2 }, { status: "otkazana", count: 1 }]);
  assert.equal(s.last.toISOString().slice(0, 10), "2026-10-09");
  assert.deepEqual(summarizeOrders([]), { count: 0, byStatus: [], last: null });
});
ok("topBy + pickSuppliers: dobavljač se broji jednom po narudžbini; ograničenje n", () => {
  const top = topBy(E, pickSuppliers, 3);
  assert.deepEqual(top.map((x) => [x.name, x.weight]), [["Metro", 2], ["Imlek", 1]]);
  assert.equal(topBy(E, pickSuppliers, 1).length, 1);
});
ok("topBy: težine (količine) i jedinica; pickNarucilac", () => {
  const q = topBy(E, (e) => [{ key: "x", name: "Art", unit: "kg", weight: 2.5 }], 5);
  assert.deepEqual(q, [{ key: "x", name: "Art", unit: "kg", weight: 7.5 }]);
  assert.deepEqual(topBy(E, pickNarucilac, 2).map((x) => [x.name, x.weight]), [["Pera", 2], ["Mika", 1]]);
});
console.log(`\n${n} testova prošlo`);
