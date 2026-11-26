// ============================================================================
// INVOICE-LOGIC — čista logika računa (bez Firebase-a i bez DOM-a), da može da se
// testira u Node-u (vidi tests/invoice-logic.test.mjs).
//   • PDV: iznos bez PDV-a, PDV, ukupno sa PDV-om (zaokruživanje na 2 decimale)
//   • provera unosa računa
//   • zbir računa po dobavljaču (ide u nabavku kao paidAmount = UKUPNO SA PDV-om)
//   • status računa na narudžbini (invoiceStatus) za oznaku "Čeka račun"
//   • ko sme da unosi / menja račune
// Faza 1: račun ima ukupne iznose; polje `lines` (stavke sa cenama) je rezervisano za fazu 2.
// ============================================================================

export const VAT_RATES = [20, 10, 0];            // opšta, posebna, bez PDV-a (Srbija)
export const INVOICE_SOURCE = { FAKTURA: "faktura", FISKALNI_QR: "fiskalni_qr", RUCNO_UKUPNO: "rucno_ukupno" };
export const INVOICE_STATUS = { BEZ: "bez_racuna", DELIMICNO: "delimicno", KOMPLETNO: "kompletno", NIJE_POTREBAN: "nije_potreban" };
// Statusi narudžbine u kojima račun ne može da se unosi (nije još kod isporučioca ili je odbijena)
export const NO_INVOICE_STATUSES = ["kreirana", "ceka_prihvatanje", "odbijena"];

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === "" || v == null ? NaN : Number(String(v).replace(",", ".")));
export const parseAmount = num;

// Iz ukupnog iznosa (donji red fakture) i stope PDV-a: osnovica i PDV
export function fromGross(gross, ratePct) {
  const g = round2(gross), r = Number(ratePct) || 0;
  const net = round2(g / (1 + r / 100));
  return { net, vat: round2(g - net), gross: g };
}
// Iz osnovice i stope PDV-a: PDV i ukupno
export function fromNet(net, ratePct) {
  const n = round2(net), r = Number(ratePct) || 0;
  const vat = round2(n * r / 100);
  return { net: n, vat, gross: round2(n + vat) };
}

// Vraća listu šifara grešaka (prazna = ispravno)
export function validateInvoice({ number, net, vat, gross }, { existingNumbers = [] } = {}) {
  const errors = [];
  const n = num(net), v = num(vat), g = num(gross);
  if (!String(number || "").trim()) errors.push("number_required");
  if (!(g > 0)) errors.push("gross_required");
  if ([n, v].some((x) => Number.isNaN(x) || x < 0)) errors.push("negative_or_missing");
  else if (g > 0 && Math.abs(round2(n + v) - round2(g)) > 0.01) errors.push("sum_mismatch");
  const norm = (s) => String(s || "").trim().toLowerCase();
  if (norm(number) && existingNumbers.map(norm).includes(norm(number))) errors.push("duplicate_number");
  return errors;
}

// Zbir računa jedne nabavke (dobavljača) — upisuje se u dokument nabavke.
// paidAmount = ukupno SA PDV-om (to je iznos koji se stvarno plaća i koji čitaju izveštaji).
export function summarizeInvoices(invoices) {
  const list = invoices || [];
  const dates = list.map((i) => i.date).filter(Boolean).sort();
  return {
    paidAmount: round2(list.reduce((s, i) => s + (Number(i.grossAmount) || 0), 0)),
    netAmount: round2(list.reduce((s, i) => s + (Number(i.netAmount) || 0), 0)),
    vatAmount: round2(list.reduce((s, i) => s + (Number(i.vatAmount) || 0), 0)),
    invoiceCount: list.length,
    receiptNumber: list.map((i) => i.number).filter(Boolean).join(", "),
    receiptDate: dates.length ? dates[dates.length - 1] : "",
  };
}

// Nabavka (dobavljač) ima račun: ima bar jedan račun, ili je to raniji ručni unos iznosa (pre računa).
export function purchaseHasInvoice(p) {
  if (!p) return false;
  if (typeof p.invoiceCount === "number") return p.invoiceCount > 0;
  return (Number(p.paidAmount) || 0) > 0;
}
// Raniji unos iznosa koji još nije pretvoren u račun
export function isLegacyPurchaseAmount(p) {
  return !!p && typeof p.invoiceCount !== "number" && (Number(p.paidAmount) || 0) > 0;
}

// Status računa na nivou narudžbine. Računa se samo za dobavljače kod kojih je išta preuzeto.
// p.noInvoice = true: isporučilac/naručilac/admin označio da za tog dobavljača račun ne postoji.
export function computeInvoiceStatus(purchases, items) {
  const bought = new Set((items || []).filter((i) => (Number(i.purchasedQty) || 0) > 0).map((i) => i.supplierId));
  const needing = (purchases || []).filter((p) => bought.has(p.supplierId) || purchaseHasInvoice(p));
  if (!needing.length) return INVOICE_STATUS.NIJE_POTREBAN;
  const withInvoice = needing.filter(purchaseHasInvoice);
  const covered = needing.filter((p) => purchaseHasInvoice(p) || p.noInvoice);
  if (covered.length === needing.length) return withInvoice.length ? INVOICE_STATUS.KOMPLETNO : INVOICE_STATUS.NIJE_POTREBAN;
  return covered.length ? INVOICE_STATUS.DELIMICNO : INVOICE_STATUS.BEZ;
}
export const isAwaitingInvoice = (o) => o?.status === "zatvorena"
  && [INVOICE_STATUS.BEZ, INVOICE_STATUS.DELIMICNO].includes(o.invoiceStatus);

// Ko sme da unosi / menja račune: admin firme; naručilac koji je napravio narudžbinu;
// isporučilac kome je narudžbina dodeljena. Uz to narudžbina mora biti prihvaćena (ne odbijena).
export function canManageInvoices(profile, order, uid) {
  if (!profile || !order || !uid) return false;
  if (NO_INVOICE_STATUSES.includes(order.status)) return false;
  if (profile.role === "admin") return true;
  if (profile.role === "narucilac") return order.createdByUid === uid;
  if (profile.role === "isporucilac") return order.assignedToUid === uid;
  return false;
}
