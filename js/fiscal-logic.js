// ============================================================================
// FISCAL-LOGIC — čista logika fiskalnog računa sa QR koda (bez Firebase-a i DOM-a; testira se u Node-u).
// Račun se preuzima preko Cloudflare Worker-a (cloudflare/worker.js) sa suf.purs.gov.rs; ovde se samo
//   • prepoznaje link iz QR koda,
//   • odgovor Worker-a pretvara u nacrt računa sa stavkama (cene SA PDV-om, stopa po stavci),
//   • proverava PDV iz stavki prema ukupnom porezu sa računa,
//   • pravi ključ za zaštitu od duplikata (PFR broj).
// ============================================================================
import { round2 } from "./invoice-logic.js";
import { RESOLUTION } from "./invoice-lines.js";

// Link iz QR koda fiskalnog računa: https://suf.purs.gov.rs/v/?vl=...  (QR može sadržati i okolni tekst)
export function extractReceiptUrl(text) {
  const m = /https:\/\/suf\.purs\.gov\.rs\/v\/\?[^\s"'<>]+/i.exec(String(text || "").trim());
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    return u.hostname === "suf.purs.gov.rs" && u.pathname.startsWith("/v") && u.searchParams.get("vl") ? u.href : null;
  } catch { return null; }
}

// ID dokumenta za evidenciju upotrebe računa (PFR broj: slova, cifre i crtice)
export const receiptKey = (pfr) => String(pfr || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "_");

// Datum (yyyy-mm-dd) iz "2026-11-27T10:15:00"
export const receiptDate = (time) => (/^\d{4}-\d{2}-\d{2}/.exec(String(time || "")) || [""])[0];

// Odgovor Worker-a → nacrt za ekran "Račun sa stavkama".
// Cene na fiskalnom računu su SA PDV-om; iznos stavke je štampani ukupan iznos (netOverride), pa se zbir slaže sa računom.
export function receiptToDraft(receipt, { newId }) {
  const items = receipt.items || [];
  const lines = items.map((it) => ({
    id: newId(), name: it.name || "", code: "", unit: "", qty: it.quantity, unitPrice: it.unitPrice, discountPct: 0,
    vatRate: it.vatRate == null ? "" : it.vatRate,        // "" = nepoznata stopa → korisnik bira
    netOverride: it.total, resolution: RESOLUTION.NONE, link: null,
  }));
  return {
    number: receipt.pfr || "", date: receiptDate(receipt.time), pricesIncludeVat: true,
    controlGross: Number.isFinite(receipt.total) ? receipt.total : null,
    unknownVat: lines.filter((l) => l.vatRate === "").length,
    lines,
    fiscal: {
      pfr: receipt.pfr || "", time: receipt.time || "", pib: receipt.pib || "", chain: receipt.chain || "",
      object: receipt.object || "", address: receipt.address || "", city: receipt.city || "",
      total: Number.isFinite(receipt.total) ? receipt.total : null,
      totalTax: Number.isFinite(receipt.totalTax) ? receipt.totalTax : null,
      taxes: (receipt.taxes || []).map((t) => ({ label: t.label, name: t.name, rate: t.rate, tax: t.tax })),
    },
  };
}

// PDV iz stavki prema ukupnom porezu sa računa: { computed, reported, diff, ok } (ok kad je razlika do 0,05)
export function vatCheck(vatFromLines, reportedTax) {
  if (!Number.isFinite(reportedTax)) return null;
  const computed = round2(vatFromLines), reported = round2(reportedTax), diff = round2(computed - reported);
  return { computed, reported, diff, ok: Math.abs(diff) <= 0.05 };
}

// Ranija upotreba istog fiskalnog računa: uses je mapa { [invoiceId]: { orderId, orderNumber, supplierName, number, byName, at } }
export function usageList(doc, { exceptInvoiceId = null } = {}) {
  return Object.entries(doc?.uses || {}).filter(([id]) => id !== exceptInvoiceId).map(([invoiceId, u]) => ({ invoiceId, ...u }));
}
