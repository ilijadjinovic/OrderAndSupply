// ============================================================================
// RAČUNI (Invoices) — posebna podkolekcija narudžbine: companies/{c}/orders/{o}/invoices
// Račun (faktura ili fiskalni račun) pripada jednom dobavljaču narudžbine (purchaseId/supplierId).
// Jedna nabavka može imati više računa. Posle svake izmene računa ovde se preračunava:
//   • nabavka (purchases): paidAmount (= UKUPNO SA PDV-om), netAmount, vatAmount, invoiceCount,
//     receiptNumber, receiptDate — pa izveštaji i PDF-ovi koji čitaju paidAmount rade kao i ranije
//   • narudžbina: invoiceStatus (bez_racuna / delimicno / kompletno / nije_potreban) i invoicedTotal
//     — za oznaku i karticu "Čeka račun" (i za zatvorene narudžbine)
// Ko sme: admin firme, naručilac koji je napravio narudžbinu, isporučilac kome je dodeljena
// (firestore.rules + canManageInvoices u invoice-logic.js).
// Faza 1: ukupni iznosi sa PDV-om; `lines` (stavke sa cenama) i `matchStatus` su rezervisani za fazu 2.
// ============================================================================
import {
  db, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, orderBy, serverTimestamp,
} from "./firebase-init.js";
import { logAudit } from "./audit.js";
import { uploadAttachment } from "./attachments.js";
import {
  summarizeInvoices, computeInvoiceStatus, isLegacyPurchaseAmount, round2, INVOICE_SOURCE, parseAmount,
} from "./invoice-logic.js";

const invCol = (c, o) => collection(db, "companies", c, "orders", o, "invoices");
const orderRef = (c, o) => doc(db, "companies", c, "orders", o);
const purchaseRef = (c, o, p) => doc(db, "companies", c, "orders", o, "purchases", p);

export function listenInvoices(companyId, orderId, callback) {
  const q = query(invCol(companyId, orderId), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Preračuna nabavku dobavljača i status računa narudžbine iz STVARNOG stanja u bazi.
async function recalc(companyId, orderId, supplierId) {
  const [invSnap, puSnap, itSnap] = await Promise.all([
    getDocs(invCol(companyId, orderId)),
    getDocs(collection(db, "companies", companyId, "orders", orderId, "purchases")),
    getDocs(collection(db, "companies", companyId, "orders", orderId, "items")),
  ]);
  const invoices = invSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let purchases = puSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const items = itSnap.docs.map((d) => d.data());

  const target = supplierId ? purchases.find((p) => p.supplierId === supplierId) : null;
  if (target) {
    const sum = summarizeInvoices(invoices.filter((i) => i.supplierId === supplierId));
    await updateDoc(purchaseRef(companyId, orderId, target.id), { ...sum, paymentSetAt: serverTimestamp() });
    purchases = purchases.map((p) => (p.id === target.id ? { ...p, ...sum } : p));
  }
  const invoiceStatus = computeInvoiceStatus(purchases, items);
  const invoicedTotal = round2(purchases.reduce((s, p) => s + (Number(p.paidAmount) || 0), 0));
  await updateDoc(orderRef(companyId, orderId), { invoiceStatus, invoicedTotal });
  return { invoiceStatus, invoicedTotal };
}
export { recalc as recalcInvoiceState };

// data: { number, date, source, vatRate (ili null), netAmount, vatAmount, grossAmount, currency, file? }
function invoiceDoc(purchase, data, actor) {
  return {
    supplierId: purchase.supplierId, supplierName: purchase.supplierName || "", purchaseId: purchase.id,
    number: String(data.number || "").trim(), date: data.date || "",
    source: data.source || INVOICE_SOURCE.RUCNO_UKUPNO,
    vatRate: data.vatRate ?? null,
    netAmount: round2(parseAmount(data.netAmount)), vatAmount: round2(parseAmount(data.vatAmount)), grossAmount: round2(parseAmount(data.grossAmount)),
    currency: data.currency || "RSD",
    lines: data.lines || [],               // faza 2: stavke računa (naziv, količina, jedinična cena, rabat, iznos)
    matchStatus: data.matchStatus || "nije_usaglaseno", // faza 2: usaglašavanje sa stavkama narudžbine
    note: String(data.note || "").trim(),
  };
}
const auditParams = (inv, supplierName) => ({ number: inv.number || "—", amount: String(inv.grossAmount), supplier: supplierName || inv.supplierName || "—" });

// Dodaje račun. Ako nabavka ima raniji ručni iznos (pre računa) koji se ne zamenjuje (replaceLegacy=false),
// on se prvo sačuva kao poseban račun da se ne izgubi.
export async function addInvoice(companyId, orderId, purchase, data, actor, { replaceLegacy = false } = {}) {
  if (isLegacyPurchaseAmount(purchase) && !replaceLegacy) {
    await addDoc(invCol(companyId, orderId), {
      ...invoiceDoc(purchase, {
        number: purchase.receiptNumber || "", date: purchase.receiptDate || "", source: INVOICE_SOURCE.RUCNO_UKUPNO,
        netAmount: purchase.paidAmount, vatAmount: 0, grossAmount: purchase.paidAmount, currency: data.currency,
        note: "Raniji unos iznosa (pre uvođenja računa)",
      }, actor),
      legacy: true, createdByUid: actor.uid, createdByName: actor.name, createdAt: serverTimestamp(),
    });
  }
  const d = invoiceDoc(purchase, data, actor);
  if (data.file) {
    try {
      const url = await uploadAttachment(companyId, orderId, data.file, { type: "racun", uploadedByUid: actor.uid, uploadedByName: actor.name, receiptNumber: d.number });
      d.attachmentUrl = url; d.attachmentName = data.file.name;
    } catch (e) { console.error("Prilog računa nije sačuvan:", e); d.attachmentError = true; }
  }
  const ref = await addDoc(invCol(companyId, orderId), { ...d, createdByUid: actor.uid, createdByName: actor.name, createdAt: serverTimestamp() });
  await logAudit(companyId, { action: "invoice_added", entity: "Invoices", entityId: ref.id, actorName: actor.name, detailsKey: "audit_invoice_details", detailsParams: auditParams(d, purchase.supplierName) });
  const state = await recalc(companyId, orderId, purchase.supplierId);
  return { id: ref.id, ...state, attachmentError: !!d.attachmentError };
}

export async function updateInvoice(companyId, orderId, invoice, data, actor) {
  const d = invoiceDoc({ id: invoice.purchaseId, supplierId: invoice.supplierId, supplierName: invoice.supplierName }, data, actor);
  const upd = {
    number: d.number, date: d.date, vatRate: d.vatRate, netAmount: d.netAmount, vatAmount: d.vatAmount, grossAmount: d.grossAmount,
    currency: d.currency, note: d.note, updatedByUid: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp(),
  };
  if (invoice.legacy) upd.legacy = false;
  if (data.file) {
    try {
      upd.attachmentUrl = await uploadAttachment(companyId, orderId, data.file, { type: "racun", uploadedByUid: actor.uid, uploadedByName: actor.name, receiptNumber: d.number });
      upd.attachmentName = data.file.name;
    } catch (e) { console.error("Prilog računa nije sačuvan:", e); }
  }
  await updateDoc(doc(invCol(companyId, orderId), invoice.id), upd);
  await logAudit(companyId, {
    action: "invoice_updated", entity: "Invoices", entityId: invoice.id, actorName: actor.name,
    detailsKey: "audit_invoice_changed_details", detailsParams: { ...auditParams(d, invoice.supplierName), was: String(invoice.grossAmount) },
  });
  return recalc(companyId, orderId, invoice.supplierId);
}

export async function deleteInvoice(companyId, orderId, invoice, actor) {
  await deleteDoc(doc(invCol(companyId, orderId), invoice.id));
  await logAudit(companyId, { action: "invoice_deleted", entity: "Invoices", entityId: invoice.id, actorName: actor.name, detailsKey: "audit_invoice_details", detailsParams: auditParams(invoice) });
  return recalc(companyId, orderId, invoice.supplierId);
}

// "Za ovog dobavljača račun ne postoji" (npr. roba bez računa) — da narudžbina ne ostane večito na "Čeka račun".
export async function setPurchaseNoInvoice(companyId, orderId, purchase, flag, actor) {
  await updateDoc(purchaseRef(companyId, orderId, purchase.id), { noInvoice: !!flag });
  await logAudit(companyId, {
    action: flag ? "invoice_marked_none" : "invoice_unmarked_none", entity: "Purchases", entityId: purchase.id, actorName: actor.name,
    detailsKey: "audit_invoice_none_details", detailsParams: { supplier: purchase.supplierName || "—" },
  });
  return recalc(companyId, orderId, purchase.supplierId);
}
