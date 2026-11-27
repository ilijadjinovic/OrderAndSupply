// ============================================================================
// INVOICE-LINES — čista logika stavki računa (bez Firebase-a i DOM-a; testira se u Node-u).
// Stavka računa: naziv, količina, jedinica, jedinična cena, rabat %, PDV %, iznos.
//   • cene na fakturi su obično BEZ PDV-a (pricesIncludeVat=false); fiskalni računi imaju cene SA PDV-om
//   • iznos stavke se računa iz količine, cene i rabata; može se ručno zadati ("kako piše na računu")
//     — zbog zaokruživanja cena sa više decimala (netOverride)
// Veza sa stavkom narudžbine (resolution):
//   "item"    — upareno sa artiklom iz narudžbine (link = id artikla)
//   "extra"   — nema svog para u narudžbini: dodatni trošak (dostava, ambalaža...)
//   "surplus" — nema svog para u narudžbini: preuzeta roba koja nije naručena (višak)
//   ""        — nema svog para i još nije rešeno (mora se rešiti pre potvrde unosa)
// ============================================================================
import { round2 } from "./invoice-logic.js";

export const RESOLUTION = { ITEM: "item", EXTRA: "extra", SURPLUS: "surplus", NONE: "" };
export const DEFAULT_VAT = 20;
export const MATCH_STATUS = { NIJE: "nije_usaglaseno", OK: "usaglaseno", RAZLIKE: "usaglaseno_uz_razlike" };

const toNum = (v) => (v === "" || v == null ? NaN : Number(String(v).replace(",", ".")));

// Iznosi jedne stavke: { net, vat, gross, valid }
export function lineAmounts(line, { pricesIncludeVat = false } = {}) {
  const qty = toNum(line.qty), price = toNum(line.unitPrice);
  const disc = Number.isNaN(toNum(line.discountPct)) ? 0 : toNum(line.discountPct);
  const rate = Number.isNaN(toNum(line.vatRate)) ? 0 : toNum(line.vatRate);
  const override = toNum(line.netOverride);
  let base;
  if (!Number.isNaN(override)) base = override;
  else if (Number.isNaN(qty) || Number.isNaN(price) || qty < 0 || price < 0) return { net: 0, vat: 0, gross: 0, valid: false };
  else base = qty * price * (1 - disc / 100);
  if (pricesIncludeVat) {
    const gross = round2(base), net = round2(gross / (1 + rate / 100));
    return { net, vat: round2(gross - net), gross, valid: true };
  }
  const net = round2(base), vat = round2(net * rate / 100);
  return { net, vat, gross: round2(net + vat), valid: true };
}

// Zbir svih stavki + PDV po stopama: { net, vat, gross, byRate: [{ rate, net, vat }] }
export function sumLines(lines, opts = {}) {
  const byRate = new Map();
  let net = 0, vat = 0, gross = 0;
  for (const l of lines || []) {
    const a = lineAmounts(l, opts);
    net += a.net; vat += a.vat; gross += a.gross;
    const r = Number(toNum(l.vatRate)) || 0;
    const cur = byRate.get(r) || { rate: r, net: 0, vat: 0 };
    cur.net += a.net; cur.vat += a.vat; byRate.set(r, cur);
  }
  return {
    net: round2(net), vat: round2(vat), gross: round2(gross),
    byRate: [...byRate.values()].sort((a, b) => b.rate - a.rate).map((x) => ({ rate: x.rate, net: round2(x.net), vat: round2(x.vat) })),
  };
}

// Greške stavki (šifre): naziv, količina, cena — samo za stavke koje imaju bilo šta upisano
export function lineProblems(line, opts = {}) {
  const errors = [];
  if (!String(line.name || "").trim()) errors.push("name_required");
  const q = toNum(line.qty);
  if (Number.isNaN(q) || q <= 0) errors.push("qty_invalid");
  if (!lineAmounts(line, opts).valid) errors.push("price_invalid");
  return errors;
}

export const isBlankLine = (l) => !String(l.name || "").trim() && ["qty", "unitPrice", "netOverride"].every((k) => l[k] === "" || l[k] == null);

// Čist oblik stavke za upis u bazu (brojevi umesto stringova, izračunati iznosi)
export function normalizeLine(l, opts = {}) {
  const a = lineAmounts(l, opts);
  const ov = toNum(l.netOverride);
  return {
    id: l.id, name: String(l.name || "").trim(), code: String(l.code || "").trim(), unit: String(l.unit || "").trim(),
    qty: round3(toNum(l.qty) || 0), unitPrice: Number.isNaN(toNum(l.unitPrice)) ? null : toNum(l.unitPrice),
    discountPct: Number.isNaN(toNum(l.discountPct)) ? 0 : toNum(l.discountPct),
    vatRate: Number.isNaN(toNum(l.vatRate)) ? DEFAULT_VAT : toNum(l.vatRate),
    netOverride: Number.isNaN(ov) ? null : ov,
    net: a.net, vat: a.vat, gross: a.gross,
    link: l.resolution === RESOLUTION.ITEM ? (l.link || null) : null,
    resolution: l.resolution || RESOLUTION.NONE,
  };
}
const round3 = (n) => Math.round(n * 1000) / 1000;

// Početne stavke iz narudžbine: po jedan red za svaki preuzeti artikal dobavljača (korisnik upisuje samo cene)
export function linesFromItems(items, newId) {
  return (items || []).filter((i) => (Number(i.purchasedQty) || 0) > 0).map((i) => ({
    id: newId(), name: i.substituteName || i.productName || "", code: i.code || "", unit: i.unit || "",
    qty: Number(i.purchasedQty), unitPrice: "", discountPct: 0, vatRate: DEFAULT_VAT, netOverride: null,
    resolution: RESOLUTION.ITEM, link: i.id,
  }));
}

// Jedinstvena stopa PDV-a na svim stavkama (ili null kad ih ima više)
export function commonVatRate(lines) {
  const rates = new Set((lines || []).map((l) => Number(toNum(l.vatRate)) || 0));
  return rates.size === 1 ? [...rates][0] : null;
}
