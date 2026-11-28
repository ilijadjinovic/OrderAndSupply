import { JSDOM } from "jsdom";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
const root = process.env.APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");   // Pokretanje: npm i jsdom && node tests/ui-smoke.mjs
const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event });
globalThis.fetch = async (u) => ({ json: async () => JSON.parse(fs.readFileSync(`${root}/${String(u).replace("./", "")}`, "utf8")) });
globalThis.confirm = () => true;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
const { loadLang } = await import(`${root}/js/i18n.js`);
await loadLang("sr");
const { openInvoiceLinesModal } = await import(`${root}/js/invoice-lines-ui.js`);

const items = [
  { id: "i1", supplierId: "s1", productName: "Cement 25kg", code: "CM25", unit: "kom", quantity: 10, purchasedQty: 10 },
  { id: "i2", supplierId: "s1", productName: "Šraf M8", unit: "kom", quantity: 100, purchasedQty: 100 },
  { id: "i3", supplierId: "s1", productName: "Lepak", unit: "kom", quantity: 4, purchasedQty: 4 },
  { id: "x9", supplierId: "s2", productName: "Tuđ artikal", quantity: 1, purchasedQty: 1 },
];
let saved = null;
const ctx = { companyId: "c", orderId: "o", uid: "u", profile: { role: "narucilac", name: "Pera" }, currency: "RSD", money: (a) => Number(a).toFixed(2), items, canCreateSurplus: true,
  createSurplusOrder: async () => ({ orderNumber: "N-1" }) };
openInvoiceLinesModal({ purchase: { id: "p1", supplierId: "s1", supplierName: "Dobavljač" }, invoices: [], ctx, onSave: async (data, o) => { saved = { data, o }; return { id: "inv1" }; } });
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
const ok = (c, m) => { if (!c) { console.error("✗", m); process.exitCode = 1; } else console.log("  ✓", m); };

ok($$("#il-body tr").length === 1, "počinje sa jednom praznom stavkom");
$("#il-fill").click();
ok($$("#il-body tr").length === 3, "'Popuni iz narudžbine' pravi 3 stavke (samo artikli dobavljača s1)");
// cene: cement 10 x 1000, šraf 100 x 5 uz rabat 10%, lepak 4 x 250
const rows = $$("#il-body tr");
const setv = (tr, cls, v) => { const el = tr.querySelector(cls); el.value = v; fire(el, "input"); };
setv(rows[0], ".l-price", "1000"); setv(rows[1], ".l-price", "5"); setv(rows[1], ".l-disc", "10"); setv(rows[2], ".l-price", "250");
ok(rows[0].querySelector(".l-net").value === "10000.00", "iznos stavke 1 = 10000.00");
ok(rows[1].querySelector(".l-net").value === "450.00", "rabat 10% → 450.00");
ok($("#il-sumbox").textContent.includes("11450.00") && $("#il-sumbox").textContent.includes("13740.00"), "zbir bez PDV 11450.00 i sa PDV 13740.00");
ok($("#il-recon").textContent.includes("Poklapa se"), "sve stavke upareno i poklapa se");
$("#il-control").value = "13740"; fire($("#il-control"), "input");
ok($("#il-diff").textContent.includes("Poklapa se"), "kontrola sa fakture se poklapa");

// dodatna stavka bez svog para
$("#il-add").click();
let r2 = $$("#il-body tr"); const last = r2[r2.length - 1];
setv(last, ".l-name", "Dostava"); setv(last, ".l-qty", "1"); setv(last, ".l-price", "500");
ok(last.querySelector(".l-badge").textContent.includes("Nema svog para"), "stavka bez veze dobija oznaku 'Nema svog para'");
$("#il-number").value = "FAK-1";
$("#il-confirm").click();
await new Promise((r) => setTimeout(r, 10));
ok(!saved && $("#il-error").textContent.includes("svog para"), "potvrda blokirana dok postoji stavka bez svog para");
const sel = last.querySelector(".l-link"); sel.value = "extra"; fire(sel, "change");
// razlika: šraf na računu 80 umesto 100 → ponudi ispravku preuzetog
const r3 = $$("#il-body tr"); setv(r3[1], ".l-qty", "80");
ok($("#il-recon").textContent.includes("Na računu manje"), "manje na računu → upozorenje");
const fix = $("#il-recon [data-fix]"); fix.click();
ok($("#il-recon").textContent.includes("Poklapa se") && !$("#il-recon").textContent.includes("Na računu manje"), "'Ispravi preuzeto' usaglašava prikaz (bez izmene narudžbine)");
$("#il-confirm").click();
await new Promise((r) => setTimeout(r, 20));
ok(!!saved, "unos potvrđen");
const d = saved.data;
ok(d.lines.length === 4 && d.draft === false, "sačuvane 4 stavke, nije nacrt");
ok(d.matchStatus === "usaglaseno", "matchStatus = usaglaseno");
ok(saved.o.corrections.length === 1 && saved.o.corrections[0].itemId === "i2" && saved.o.corrections[0].to === 80, "ispravka: samo preuzeto za šraf 100 → 80");
ok(d.grossAmount > 0 && d.netAmount > 0 && d.vatRate === 20, "zaglavlje iz stavki, jedinstvena stopa 20%");
ok(items[1].purchasedQty === 100, "narudžbina nije dirana pri unosu (ispravka se primenjuje u invoices.js)");
console.log("\nSmoke test završen.");


// ============================ Faza 3: fiskalni račun (QR) ============================
console.log("\nFiskalni račun (QR):");
const RECEIPT = {
  pib: "123456789", chain: "Prodavnica", object: "Centar", address: "Glavna 5", city: "ŠABAC", total: 6000, time: "2026-11-27T10:15:00",
  pfr: "ABCD1234-ABCD1234-12345", totalTax: 931.82,
  taxes: [{ label: "Đ", name: "O-PDV", rate: 20, tax: 850 }, { label: "E", name: "P-PDV", rate: 10, tax: 81.82 }],
  items: [
    { name: "Cement 25kg", quantity: 10, unitPrice: 360, total: 3600, vatRate: 20 },
    { name: "SRAF m8", quantity: 100, unitPrice: 15, total: 1500, vatRate: 20 },
    { name: "Lepak", quantity: 4, unitPrice: 225, total: 900, vatRate: null },   // nepoznata oznaka PDV-a
  ],
};
const items2 = [
  { id: "i1", supplierId: "s1", productName: "Cement 25kg", unit: "kom", quantity: 10, purchasedQty: 10 },
  { id: "i2", supplierId: "s1", productName: "Šraf M8", unit: "kom", quantity: 100, purchasedQty: 100 },
  { id: "i3", supplierId: "s1", productName: "Lepak", unit: "kom", quantity: 4, purchasedQty: 4 },
];
let saved2 = null, usage = [], fetchedUrl = null;
const ctx2 = { ...ctx, items: items2, scanConfigured: true,
  fetchReceipt: async (u) => { fetchedUrl = u; return RECEIPT; }, getReceiptUsage: async () => usage };
const open2 = (extra = {}) => openInvoiceLinesModal({ purchase: { id: "p1", supplierId: "s1", supplierName: "Dobavljač" }, invoices: [], ctx: ctx2, onSave: async (data, o) => { saved2 = { data, o }; return { id: "inv2" }; }, ...extra });

open2();
$("#il-scan").click();
ok(!!$("#qs-link"), "'Skeniraj QR' otvara skener sa poljem za lepljenje linka");
ok($("#qs-status").textContent.includes("Kamera nije dostupna"), "bez kamere skener javlja da nalepite link");
$("#qs-link").value = "tekst koji nije link"; $("#qs-go").click();
ok($("#qs-error").textContent.includes("nije QR kod"), "tuđi sadržaj se odbija");
$("#qs-link").value = "https://suf.purs.gov.rs/v/?vl=ABC123"; $("#qs-go").click();
await new Promise((r) => setTimeout(r, 30));
ok(fetchedUrl === "https://suf.purs.gov.rs/v/?vl=ABC123", "Worker se poziva sa linkom računa");
ok($("#il-number").value === "ABCD1234-ABCD1234-12345", "broj računa = PFR");
ok($("#il-incl").checked, "cene su označene kao sa PDV-om");
ok($$("#il-body tr").length === 3, "učitane 3 stavke");
ok($("#il-control").value === "6000", "kontrolni zbir = ukupno sa računa");
ok($$("#il-body tr")[0].querySelector(".l-link").value === "item:i1" && $$("#il-body tr")[1].querySelector(".l-link").value === "item:i2", "stavke automatski upareno (uključujući 'SRAF m8' ↔ 'Šraf M8')");
ok($$("#il-body tr")[2].querySelector(".l-vat").value === "" && $("#il-error").textContent.includes("PDV"), "stavka bez prepoznate stope traži izbor PDV-a");
$("#il-confirm").click(); await new Promise((r) => setTimeout(r, 10));
ok(!saved2 && $("#il-error").textContent.includes("PDV"), "potvrda blokirana dok stopa PDV-a nije izabrana");
const v3 = $$("#il-body tr")[2].querySelector(".l-vat"); v3.value = "20"; fire(v3, "change");
ok($("#il-taxcheck").textContent.includes("931.82"), "PDV po računu se prikazuje i poredi sa stavkama");
$("#il-confirm").click(); await new Promise((r) => setTimeout(r, 20));
ok(!!saved2, "unos potvrđen");
ok(saved2.data.source === "fiskalni_qr" && saved2.data.fiscal.pfr === "ABCD1234-ABCD1234-12345", "račun je sačuvan kao fiskalni_qr sa PFR brojem");
ok(saved2.data.pricesIncludeVat === true && saved2.data.grossAmount === 6000, "ukupno sa PDV-om = 6000.00");
ok(saved2.data.lines.length === 3 && saved2.data.lines.every((l) => l.vatRate != null), "sve stavke imaju stopu PDV-a");

// ponovno učitavanje istog računa → upozorenje, i kontrolni zbir se ne popunjava
usage = [{ invoiceId: "invX", orderNumber: "N-7", supplierName: "Dobavljač", byName: "Mika" }];
let asked = [];
globalThis.confirm = (m) => { asked.push(m); return true; };
open2(); $("#il-scan").click(); $("#qs-link").value = "https://suf.purs.gov.rs/v/?vl=ABC123"; $("#qs-go").click();
await new Promise((r) => setTimeout(r, 30));
ok(asked.some((m) => m.includes("već unet") && m.includes("N-7")), "upozorenje: račun je već unet (navodi narudžbinu)");
ok($("#il-control").value === "", "kod ponovne upotrebe računa kontrolni zbir se ne popunjava (račun se deli između narudžbina)");
// korisnik odbija
globalThis.confirm = () => false; usage = [{ invoiceId: "invX", orderNumber: "N-7" }];
document.querySelectorAll(".modal-overlay").forEach((o) => o.remove());
open2(); $("#il-scan").click(); $("#qs-link").value = "https://suf.purs.gov.rs/v/?vl=ABC123"; $("#qs-go").click();
await new Promise((r) => setTimeout(r, 30));
ok($$("#il-body tr").length === 1 && $("#il-number").value === "", "ako korisnik odbije upozorenje, ništa se ne učitava");
globalThis.confirm = () => true;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
// greška servisa
document.querySelectorAll(".modal-overlay").forEach((o) => o.remove());
ctx2.fetchReceipt = async () => { throw Object.assign(new Error("x"), { code: "journal_unparsed" }); };
open2(); $("#il-scan").click(); $("#qs-link").value = "https://suf.purs.gov.rs/v/?vl=ABC123"; $("#qs-go").click();
await new Promise((r) => setTimeout(r, 30));
ok($("#il-error").textContent.includes("stavke nisu pročitane"), "greška Worker-a se prikazuje razumljivo");
// nije podešeno
document.querySelectorAll(".modal-overlay").forEach((o) => o.remove());
ctx2.scanConfigured = false; open2(); $("#il-scan").click();
ok(!$("#qs-link"), "bez podešenog Worker-a skener se ne otvara");
console.log("\nSmoke test (faza 3) završen.");
