// ============================================================================
// REKLAMACIJE — Poglavlje 2.3, 6
//
// Tok jedne reklamacije (po jedna za svaki reklamirani artikal):
//   otvorena  →  resena (čeka potvrdu naručioca)  →  zatvorena
//                    ↑__________ vraćena ___________|   (naručilac vraća na obradu)
//
//  • Naručilac jednom prijavi više artikala (openClaims) — nastaje po jedna reklamacija po artiklu.
//  • Isporučilac (ili admin) unese rešenje (resolveClaim) → "resena".
//  • Naručilac potvrdi rešenje (confirmClaims) ili ga vrati na obradu (returnClaim).
//  • Narudžbina ostaje u statusu "reklamacija" dok je bar jedna reklamacija nezatvorena. Kad je
//    poslednja zatvorena, narudžbina se zatvara kao potvrda prijema (confirmReceiptFull).
//  • Admin sme da zatvori reklamaciju i bez potvrde naručioca (ostaje trag u reviziji).
// Brojači claimsOpen / claimsPendingConfirm na narudžbini služe kontrolnim tablama.
// ============================================================================
import { db, doc, collection, updateDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "./firebase-init.js";
import { ORDER_STATUS } from "./utils.js";
import { logAudit } from "./audit.js";
import { createNotification, NOTIF_EVENTS } from "./notifications.js";
import { confirmReceiptFull } from "./orders.js";
import { countClaims } from "./dash-logic.js";

export const CLAIM_STATUS = { OPEN: "otvorena", RESOLVED: "resena", CLOSED: "zatvorena" };

const claimsCol = (companyId, orderId) => collection(db, "companies", companyId, "orders", orderId, "claims");
const orderRef = (companyId, orderId) => doc(db, "companies", companyId, "orders", orderId);
const claimRef = (companyId, orderId, claimId) => doc(db, "companies", companyId, "orders", orderId, "claims", claimId);

// Pročita reklamacije, upiše brojače na narudžbinu i vrati ih. Ako više nema nezatvorenih,
// narudžbina se zatvara kao potvrda prijema (jedno mesto za to: confirmReceiptFull).
async function syncOrderClaimState(companyId, orderId, { actorUid, actorName }) {
  const counts = countClaims(await getClaims(companyId, orderId));
  if (counts.total > 0 && counts.open === 0 && counts.pending === 0) {
    await confirmReceiptFull(companyId, orderId, { actorUid, actorName });
    await updateDoc(orderRef(companyId, orderId), { claimsOpen: 0, claimsPendingConfirm: 0 });
    return { ...counts, orderClosed: true };
  }
  await updateDoc(orderRef(companyId, orderId), {
    claimsOpen: counts.open, claimsPendingConfirm: counts.pending, updatedAt: serverTimestamp(),
    status: ORDER_STATUS.REKLAMACIJA,
  });
  return { ...counts, orderClosed: false };
}

// items: [{ itemId, itemName, requestedQty, receivedQty, note }]  — svaki red postaje jedna reklamacija.
export async function openClaims(companyId, orderId, { items, description = "", actorUid, actorName, notifyUid }) {
  if (!items?.length) throw new Error("no_claim_items");
  const batch = writeBatch(db);
  const ids = [];
  items.forEach((it) => {
    const ref = doc(claimsCol(companyId, orderId));
    ids.push(ref.id);
    batch.set(ref, {
      itemId: it.itemId || null, itemName: it.itemName, requestedQty: it.requestedQty, receivedQty: it.receivedQty,
      description: [it.note, description].map((x) => (x || "").trim()).filter(Boolean).join(" — "),
      status: CLAIM_STATUS.OPEN, returnCount: 0,
      createdByUid: actorUid, createdByName: actorName, createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
  const counts = countClaims(await getClaims(companyId, orderId));
  await updateDoc(orderRef(companyId, orderId), {
    status: ORDER_STATUS.REKLAMACIJA, claimsOpen: counts.open, claimsPendingConfirm: counts.pending, updatedAt: serverTimestamp(),
  });
  const names = items.map((i) => i.itemName);
  await logAudit(companyId, { action: "claim_opened", entity: "Orders", entityId: orderId, actorUid, actorName, details: names.join(", ") });
  if (notifyUid) {
    await createNotification(companyId, {
      toUid: notifyUid, event: NOTIF_EVENTS.REKLAMACIJA_OTVORENA, orderId,
      titleKey: "notif_claim_opened_title", bodyKey: "notif_claim_opened_body",
      bodyParams: { name: actorName, item: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] },
    });
  }
  return ids;
}

// Isporučilac / admin: unosi rešenje → reklamacija čeka potvrdu naručioca.
export async function resolveClaim(companyId, orderId, claimId, { resolutionNote, actorUid, actorName, notifyUid, itemName = "" }) {
  await updateDoc(claimRef(companyId, orderId, claimId), {
    status: CLAIM_STATUS.RESOLVED, resolutionNote, resolvedAt: serverTimestamp(), resolvedByUid: actorUid || null, resolvedByName: actorName,
  });
  await syncOrderClaimState(companyId, orderId, { actorUid, actorName });
  await logAudit(companyId, { action: "claim_resolved", entity: "Orders", entityId: orderId, actorUid, actorName, details: itemName });
  if (notifyUid) {
    await createNotification(companyId, {
      toUid: notifyUid, event: NOTIF_EVENTS.REKLAMACIJA_RESENA, orderId,
      titleKey: "notif_claim_resolved_title", bodyKey: "notif_claim_resolved_body", bodyParams: { name: actorName, item: itemName },
    });
  }
}

// Naručilac potvrđuje rešenje (jedne ili više reklamacija). Kad je poslednja zatvorena, zatvara se i narudžbina.
// byAdmin: admin zatvara bez potvrde naručioca — dozvoljeno i za "otvorena" (tada se unosi resolutionNote).
export async function confirmClaims(companyId, orderId, claimIds, { actorUid, actorName, byAdmin = false, resolutionNote = null }) {
  const batch = writeBatch(db);
  claimIds.forEach((id) => {
    const patch = byAdmin
      ? { status: CLAIM_STATUS.CLOSED, confirmedAt: serverTimestamp(), closedByAdminUid: actorUid || null, closedByAdminName: actorName, closedWithoutOrdererConfirm: true }
      : { status: CLAIM_STATUS.CLOSED, confirmedAt: serverTimestamp(), confirmedByUid: actorUid || null, confirmedByName: actorName };
    if (byAdmin && resolutionNote) Object.assign(patch, { resolutionNote, resolvedAt: serverTimestamp(), resolvedByName: actorName });
    batch.update(claimRef(companyId, orderId, id), patch);
  });
  await batch.commit();
  await logAudit(companyId, {
    action: "claim_closed", entity: "Orders", entityId: orderId, actorUid, actorName,
    details: byAdmin ? `bez potvrde naručioca (${claimIds.length})` : `potvrdio naručilac (${claimIds.length})`,
  });
  return syncOrderClaimState(companyId, orderId, { actorUid, actorName });
}

// Naručilac nije zadovoljan rešenjem → nazad na obradu (uz obaveznu napomenu).
export async function returnClaim(companyId, orderId, claimId, { returnNote, returnCount = 0, actorUid, actorName, notifyUid, itemName = "" }) {
  await updateDoc(claimRef(companyId, orderId, claimId), {
    status: CLAIM_STATUS.OPEN, returnNote, returnedAt: serverTimestamp(), returnCount: returnCount + 1,
  });
  await syncOrderClaimState(companyId, orderId, { actorUid, actorName });
  await logAudit(companyId, { action: "claim_returned", entity: "Orders", entityId: orderId, actorUid, actorName, details: itemName });
  if (notifyUid) {
    await createNotification(companyId, {
      toUid: notifyUid, event: NOTIF_EVENTS.REKLAMACIJA_VRACENA, orderId,
      titleKey: "notif_claim_returned_title", bodyKey: "notif_claim_returned_body", bodyParams: { name: actorName, item: itemName },
    });
  }
}

export async function getClaims(companyId, orderId) {
  const snap = await getDocs(query(claimsCol(companyId, orderId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenClaims(companyId, orderId, callback) {
  return onSnapshot(query(claimsCol(companyId, orderId), orderBy("createdAt", "desc")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
