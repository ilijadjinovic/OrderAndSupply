// Pokretanje: node tests/worker.test.mjs
// Proverava cloudflare/worker.js (parsiranje računa, PDV, više Firebase projekata) bez mreže.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let src = fs.readFileSync(path.join(here, "..", "cloudflare", "worker.js"), "utf8");
src = src.replace("export default {", "const __handler = {") + "\nexport { __handler, parseJournal, finalize, extractJournal, verifyFirebaseToken, parseTaxRecap, resolveVat, taxLabelOf };\n";
const tmp = path.join(os.tmpdir(), `worker_test_${Date.now()}.mjs`);
fs.writeFileSync(tmp, src);
const W = await import(pathToFileURL(tmp).href);

let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log("  ✓", name); };

// Izmišljen žurnal prodavnice materijala (ćirilica), oblik kao na SUF stranici
const JOURNAL = `============ ФИСКАЛНИ РАЧУН ============
123456789
ПРОДАВНИЦА МАТЕРИЈАЛА ДОО
Продајно место Центар
Улица Главна 5
ШАБАЦ
Касир:                   Петар
ЕСИР број:               12/3.4.5
-----------ПРОДАЈА----------
Артикли
========================================
Назив   Цена         Кол.         Укупно
Клема ШКАРО 4 пол. 4-16мм2 (Ђ)
        120,00        30        3.600,00
Прекидач обичан (Ђ)
        250,00         6        1.500,00
Цев ПВЦ 20мм (Е)
         90,00        10          900,00
----------------------------------------
Укупан износ:              6.000,00
Готовина:                  6.000,00
========================================
Ознака       Име      Стопа        Порез
Ђ           О-ПДВ     20,00%      850,00
Е           П-ПДВ     10,00%       81,82
----------------------------------------
Укупан износ пореза:               931,82
ПФР време:          27.11.2026. 10:15:00
ПФР број рачуна:    ABCD1234-ABCD1234-12345
Бројач рачуна:      100/123ЂЂ
======== КРАЈ ФИСКАЛНОГ РАЧУНА ========`;

await ok("žurnal: zaglavlje, PFR, vreme, ukupno, stavke", () => {
  const r = W.finalize(W.parseJournal(W.extractJournal(JOURNAL)));
  assert.equal(r.pib, "123456789");
  assert.equal(r.pfr, "ABCD1234-ABCD1234-12345");
  assert.equal(r.time, "2026-11-27T10:15:00");
  assert.equal(r.total, 6000);
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items.map((i) => [i.quantity, i.unitPrice, i.total]), [[30, 120, 3600], [6, 250, 1500], [10, 90, 900]]);
  assert.equal(r.items[0].name, "Klema ŠKARO 4 pol. 4-16mm2");
});
await ok("PDV: oznaka po stavci i stopa iz rekapitulacije računa", () => {
  const r = W.finalize(W.parseJournal(W.extractJournal(JOURNAL)));
  assert.deepEqual(r.items.map((i) => [i.taxLabel, i.vatRate, i.vatSource]), [["Đ", 20, "recap"], ["Đ", 20, "recap"], ["E", 10, "recap"]]);
  assert.deepEqual(r.taxes, [{ label: "Đ", name: "O-PDV", rate: 20, tax: 850 }, { label: "E", name: "P-PDV", rate: 10, tax: 81.82 }]);
  assert.equal(r.totalTax, 931.82);
});
await ok("PDV: rekapitulacija ima prednost nad tabelom (račun sa drugačijom stopom)", () => {
  const j = JOURNAL.replace("Е           П-ПДВ     10,00%", "Е           П-ПДВ      8,00%");
  const r = W.finalize(W.parseJournal(W.extractJournal(j)));
  assert.equal(r.items[2].vatRate, 8); assert.equal(r.items[2].vatSource, "recap");
});
await ok("PDV: bez rekapitulacije koristi tabelu (Đ=20, E=10, G=0, A=0), nepoznata oznaka → null", () => {
  const cut = JOURNAL.replace(/Ознака[\s\S]*?Укупан износ пореза:\s*931,82\n/, "").replace("Цев ПВЦ 20мм (Е)", "Цев ПВЦ 20мм (Ж)");
  const r = W.finalize(W.parseJournal(W.extractJournal(cut)));
  assert.equal(r.taxes.length, 0); assert.equal(r.totalTax, null);
  assert.deepEqual(r.items.map((i) => [i.vatRate, i.vatSource]), [[20, "table"], [20, "table"], [null, null]]);
  assert.deepEqual(["Ђ", "Е", "Г", "А"].map((l) => W.resolveVat(l === "Ђ" ? "Đ" : l === "Е" ? "E" : l === "Г" ? "G" : "A", []).rate), [20, 10, 0, 0]);
});
await ok("stavka bez oznake → vatRate null (korisnik bira stopu u aplikaciji)", () => {
  const j = JOURNAL.replace("Прекидач обичан (Ђ)", "Прекидач обичан");
  const r = W.finalize(W.parseJournal(W.extractJournal(j)));
  assert.equal(r.items[1].taxLabel, null); assert.equal(r.items[1].vatRate, null);
});
await ok("gorivo (FleetManager) i dalje radi: naziv, tarifa, vrsta goriva + PDV 20%", () => {
  const fuel = JOURNAL.replace("Клема ШКАРО 4 пол. 4-16мм2 (Ђ)", "ЕВРО ПРЕМИЈУМ БМБ-95,2710124500 /ЛИТ (Ђ )");
  const r = W.finalize(W.parseJournal(W.extractJournal(fuel)));
  assert.equal(r.items[0].name, "EVRO PREMIJUM BMB-95"); assert.equal(r.items[0].tariff, "2710124500");
  assert.equal(r.items[0].fuelType, "petrol"); assert.equal(r.items[0].vatRate, 20);
});
await ok("parseTaxRecap: tačka kao decimalni separator stope, bez lažnih pogodaka", () => {
  const { taxes } = W.parseTaxRecap(["Ђ  О-ПДВ  20.00%  120,00", "Клема 4 пол. 120,00 30 3.600,00", "Укупан износ: 6.000,00"]);
  assert.deepEqual(taxes, [{ label: "Đ", name: "O-PDV", rate: 20, tax: 120 }]);
});

// ---- Firebase tokeni iz više projekata ----
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
globalThis.fetch = async (u) => { assert.ok(String(u).includes("securetoken@system.gserviceaccount.com")); return { ok: true, json: async () => ({ keys: [jwk] }) }; };
async function token(project, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: project, iss: `https://securetoken.google.com/${project}`, sub: "u1", iat: now - 10, exp: now + 3600, ...over }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
await ok("token: prihvata oba projekta sa spiska (FleetManager i OrderAndSupply)", async () => {
  const list = ["fleet-manager-cfd6c", "orderandsupply"];
  assert.equal((await W.verifyFirebaseToken(await token("fleet-manager-cfd6c"), list)).aud, "fleet-manager-cfd6c");
  assert.equal((await W.verifyFirebaseToken(await token("orderandsupply"), list)).aud, "orderandsupply");
});
await ok("token: odbija projekat koji nije na spisku, istekao token i pogrešan izdavalac", async () => {
  const list = ["fleet-manager-cfd6c", "orderandsupply"];
  await assert.rejects(W.verifyFirebaseToken(await token("tudj-projekat"), list));
  await assert.rejects(W.verifyFirebaseToken(await token("orderandsupply", { exp: Math.floor(Date.now() / 1000) - 5 }), list));
  await assert.rejects(W.verifyFirebaseToken(await token("orderandsupply", { iss: "https://securetoken.google.com/fleet-manager-cfd6c" }), list));
  await assert.rejects(W.verifyFirebaseToken(await token("orderandsupply"), []));
});
await ok("handler: adresa van spiska 403; bez tokena 401; ispravna adresa + token ide dalje do provere linka (400)", async () => {
  const env = { ALLOWED_ORIGINS: "https://x.github.io", FIREBASE_PROJECT_ID: "fleet-manager-cfd6c, orderandsupply" };
  const call = (origin, headers = {}, body = {}) => W.__handler.fetch(new Request("https://w.example/", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), env);
  assert.equal((await call("https://evil.example")).status, 403);
  assert.equal((await call("https://x.github.io")).status, 401);
  assert.equal((await call("https://x.github.io", { Authorization: `Bearer ${await token("orderandsupply")}` }, { url: "https://evil.example/v/?vl=1" })).status, 400);
});
console.log(`\n${n} testova prošlo.`);
