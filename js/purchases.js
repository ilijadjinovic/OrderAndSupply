// ============================================================================
// NABAVKE (Purchases po dobavljaču) — Poglavlje 4.3, 5.1
// ============================================================================
import { db, doc, updateDoc, serverTimestamp } from "./firebase-init.js";
import { ITEM_PURCHASE_STATUS } from "./utils.js";
import { logAudit } from "./audit.js";

export function startPurchase(companyId, orderId, purchaseId, actorName) {
  logAudit(companyId, { action: "purchase_started", entity: "Purchases", entityId: purchaseId, actorName });
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "purchases", purchaseId), {
    status: "u_toku", startedAt: serverTimestamp(),
  });
}

export function finishPurchase(companyId, orderId, purchaseId, actorName) {
  logAudit(companyId, { action: "purchase_finished", entity: "Purchases", entityId: purchaseId, actorName });
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "purchases", purchaseId), {
    status: "zavrsena", finishedAt: serverTimestamp(),
  });
}

// Isporučilac označava stavku: kupljeno / nije pronađeno / zamena — Poglavlje 4.3
export function markItemPurchased(companyId, orderId, itemId, { purchasedQty, substituteName = "" }) {
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "items", itemId), {
    purchaseStatus: ITEM_PURCHASE_STATUS.KUPLJENO, purchasedQty, substituteName,
  });
}
export function markItemNotFound(companyId, orderId, itemId) {
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "items", itemId), {
    purchaseStatus: ITEM_PURCHASE_STATUS.NIJE_PRONADJENO, purchasedQty: 0,
  });
}
export function markItemSubstitute(companyId, orderId, itemId, { purchasedQty, substituteName }) {
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "items", itemId), {
    purchaseStatus: ITEM_PURCHASE_STATUS.ZAMENA, purchasedQty, substituteName,
  });
}

// Broj računa uz fiskalni račun (opcija unosa) — sam prilog ide kroz attachments.js
export function setPurchaseReceiptNumber(companyId, orderId, purchaseId, receiptNumber) {
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "purchases", purchaseId), { receiptNumber });
}
