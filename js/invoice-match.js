// ============================================================================
// INVOICE-MATCH — čista logika uparivanja i usaglašavanja stavki računa sa artiklima narudžbine
// (bez Firebase-a i DOM-a; testira se u Node-u).
//   • autoMatch: predlog para po šifri ili sličnosti naziva (ćirilica/latinica, dijakritici, padeži)
//   • reconcile: po artiklu poredi NARUČENO / PREUZETO / NA RAČUNU i daje status:
//       ok · less (na računu manje od preuzetog) · more (na računu više od preuzetog) ·
//       missing_on_invoice (preuzeto, ali nema na računu)
//     + stavke računa koje "nemaju svog para" (nerešene) i višak preuzete robe
//   • narudžbina se NE menja: ispravke "preuzeto" su predlozi (overrides) koje korisnik potvrđuje pri unosu računa
// ============================================================================
import { RESOLUTION, MATCH_STATUS } from "./invoice-lines.js";

const CYR = { а:"a",б:"b",в:"v",г:"g",д:"d",ђ:"dj",е:"e",ж:"z",з:"z",и:"i",ј:"j",к:"k",л:"l",љ:"lj",м:"m",н:"n",њ:"nj",о:"o",п:"p",р:"r",с:"s",т:"t",ћ:"c",у:"u",ф:"f",х:"h",ц:"c",ч:"c",џ:"dz",ш:"s" };
export function normalizeName(s) {
  return String(s || "").toLowerCase()
    .replace(/[а-џ]/g, (c) => CYR[c] ?? c).replace(/đ/g, "dj")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
// Koren reči (prvih 5 slova) toleriše padeže: "cement" / "cementa" / "cementu"
const stems = (s) => new Set(normalizeName(s).split(" ").filter((w) => w.length > 1 || /\d/.test(w)).map((w) => (/\d/.test(w) ? w : w.slice(0, 5))));

export function nameScore(a, b) {
  const A = stems(a), B = stems(b);
  if (!A.size || !B.size) return 0;
  let common = 0; A.forEach((w) => { if (B.has(w)) common++; });
  return (2 * common) / (A.size + B.size);
}
const sameCode = (a, b) => { const x = normalizeName(a).replace(/ /g, ""), y = normalizeName(b).replace(/ /g, ""); return !!x && x === y; };

export function itemScore(line, item) {
  if (sameCode(line.code, item.code)) return 1;
  return Math.max(nameScore(line.name, item.productName), item.substituteName ? nameScore(line.name, item.substituteName) : 0);
}

// Predlog para za stavke koje još nisu rešene: [{ lineId, itemId, score }]
export function autoMatch(lines, items, { threshold = 0.5 } = {}) {
  const out = [];
  for (const l of lines) {
    if (l.resolution === RESOLUTION.ITEM || l.resolution === RESOLUTION.EXTRA || l.resolution === RESOLUTION.SURPLUS) continue;
    let best = null;
    for (const it of items) {
      const score = itemScore(l, it);
      if (score < threshold) continue;
      const qtyGap = Math.abs((Number(l.qty) || 0) - (Number(it.purchasedQty) || 0));
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && qtyGap < best.qtyGap)) best = { itemId: it.id, score, qtyGap };
    }
    if (best) out.push({ lineId: l.id, itemId: best.itemId, score: Math.round(best.score * 100) / 100 });
  }
  return out;
}

const round3 = (n) => Math.round(n * 1000) / 1000;
const EPS = 1e-6;

// items: artikli JEDNOG dobavljača; lines: stavke računa; overrides: { [itemId]: predložena preuzeta količina }
export function reconcile({ items, lines, overrides = {} }) {
  const rows = items.map((it) => {
    const ordered = Number(it.quantity) || 0;
    const purchased = Number(it.purchasedQty) || 0;
    const effective = Object.prototype.hasOwnProperty.call(overrides, it.id) ? Number(overrides[it.id]) : purchased;
    const invoiced = round3(lines.filter((l) => l.resolution === RESOLUTION.ITEM && l.link === it.id).reduce((s, l) => s + (Number(l.qty) || 0), 0));
    let status = "ok";
    if (invoiced < EPS && effective < EPS) status = "ok";
    else if (invoiced < EPS) status = "missing_on_invoice";
    else if (Math.abs(invoiced - effective) < EPS) status = "ok";
    else status = invoiced < effective ? "less" : "more";
    return {
      item: it, ordered, purchased, effectivePurchased: effective, invoiced, status,
      corrected: effective !== purchased,
      diff: round3(invoiced - effective),
      overOrdered: round3(Math.max(0, effective - ordered)),     // preuzeto više nego što je naručeno
    };
  });
  const unresolved = lines.filter((l) => l.resolution === RESOLUTION.NONE || (l.resolution === RESOLUTION.ITEM && !l.link));
  const extras = lines.filter((l) => l.resolution === RESOLUTION.EXTRA);
  const surplusLines = lines.filter((l) => l.resolution === RESOLUTION.SURPLUS);
  const differences = rows.filter((r) => r.status !== "ok");
  return { rows, unresolved, extras, surplusLines, differences, status: matchStatusOf({ unresolved, differences }) };
}

export function matchStatusOf({ unresolved, differences }) {
  if (unresolved.length) return MATCH_STATUS.NIJE;
  return differences.length ? MATCH_STATUS.RAZLIKE : MATCH_STATUS.OK;
}

// Predlog ispravke preuzete količine: izjednačiti sa računom (nula kad artikla nema na računu)
export const suggestedPurchased = (row) => row.invoiced;

// Novi status nabavke artikla posle ispravke preuzete količine
export function purchaseStatusAfterCorrection(currentStatus, qty) {
  if (!(qty > 0)) return "nije_pronadjeno";
  return currentStatus === "zamena" ? "zamena" : "kupljeno";
}

// Višak preuzete robe (za dodatnu narudžbinu): artikli preuzeti preko naručene količine + stavke "višak" bez svog para
export function surplusRows(rec, supplier = {}) {
  const fromItems = rec.rows.filter((r) => r.overOrdered > EPS).map((r) => ({ itemId: r.item.id, missingQty: r.overOrdered }));
  const synth = rec.surplusLines.map((l) => ({
    id: `surplus_${l.id}`, supplierId: supplier.supplierId || "", supplierName: supplier.supplierName || "",
    productName: l.name, code: l.code || "", unit: l.unit || "", manualEntry: true, quantity: Number(l.qty) || 0,
  }));
  return { fromItems, synthetic: synth, shortages: [...fromItems, ...synth.map((s) => ({ itemId: s.id, missingQty: s.quantity }))] };
}
