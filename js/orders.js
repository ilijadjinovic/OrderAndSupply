// ============================================================================
// NARUDŽBINE (Orders + OrderItems) — Poglavlje 3, 4, 5
// ============================================================================
import {
  db, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot,
  orderBy, where, query, limit, serverTimestamp, writeBatch,
} from "./firebase-init.js";
import { ORDER_STATUS, ORDER_STATUS_LABELS, uid } from "./utils.js";
import { logAudit } from "./audit.js";
import { createNotification, NOTIF_EVENTS } from "./notifications.js";
import { getIsporucioci } from "./users.js";

const ordersCol = (companyId) => collection(db, "companies", companyId, "orders");
const itemsCol = (companyId, orderId) => collection(db, "companies", companyId, "orders", orderId, "items");
const deliveryLocCol = (companyId, orderId) => collection(db, "companies", companyId, "orders", orderId, "deliveryLocations");
const purchasesCol = (companyId, orderId) => collection(db, "companies", companyId, "orders", orderId, "purchases");

// Statusi koji se računaju kao "aktivna" narudžbina kod brojanja opterećenja isporučioca
const ACTIVE_DELIVERY_STATUSES = [
  ORDER_STATUS.CEKA_PRIHVATANJE, ORDER_STATUS.PRIHVACENA, ORDER_STATUS.U_NABAVCI,
  ORDER_STATUS.ZAVRSENA_NABAVKA, ORDER_STATUS.U_ISPORUCI, ORDER_STATUS.ISPORUCENA,
];

// Bira isporučioca sa najmanje trenutno aktivnih (nezavršenih) narudžbina — Poglavlje 4.2 "automatski"
async function pickAvailableIsporucilac(companyId) {
  const isporucioci = await getIsporucioci(companyId);
  if (!isporucioci.length) return null;
  if (isporucioci.length === 1) return isporucioci[0];

  // Firestore ne dozvoljava dva "in" filtera u istom upitu, pa se broji preko jednog
  // upita po statusu, a raspodela po isporučiocu se radi na klijentu.
  const snap = await getDocs(query(ordersCol(companyId), where("status", "in", ACTIVE_DELIVERY_STATUSES)));
  const counts = Object.fromEntries(isporucioci.map((u) => [u.uid, 0]));
  snap.docs.forEach((d) => {
    const assignedToUid = d.data().assignedToUid;
    if (assignedToUid && assignedToUid in counts) counts[assignedToUid] += 1;
  });

  let chosen = isporucioci[0];
  for (const u of isporucioci) {
    if (counts[u.uid] < counts[chosen.uid]) chosen = u;
  }
  return chosen;
}

// items: [{supplierId, supplierName, productId, productName, unit, quantity, note, priority, pickupLocationId}]
// deliveryLocations: [{locationId, locationName, itemProductIds:[...]}]
export async function createOrder(companyId, {
  createdByUid, createdByName, priority, items, deliveryLocations, assignmentMode, recurring = null,
}) {
  const orderNumber = `NAR-${Date.now().toString().slice(-8)}`;

  let status = assignmentMode === "narucilac_bira" ? ORDER_STATUS.KREIRANA : ORDER_STATUS.CEKA_PRIHVATANJE;
  let assignedToUid = null, assignedToName = null;

  if (assignmentMode === "automatski") {
    const chosen = await pickAvailableIsporucilac(companyId);
    if (chosen) {
      assignedToUid = chosen.uid;
      assignedToName = chosen.name;
    }
    // Ako nema nijednog aktivnog isporučioca u firmi, narudžbina ostaje nedodeljena
    // (status i dalje CEKA_PRIHVATANJE) i Admin je može ručno dodeliti kasnije.
  }

  const orderRef = await addDoc(ordersCol(companyId), {
    orderNumber, createdByUid, createdByName, priority,
    status,
    assignedToUid, assignedToName,
    supplierIds: [...new Set(items.map((i) => i.supplierId))],
    itemCount: items.length, recurring,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  items.forEach((item) => {
    const itemRef = doc(itemsCol(companyId, orderRef.id));
    batch.set(itemRef, {
      ...item, purchaseStatus: "na_cekanju", purchasedQty: 0, substituteName: "",
      createdAt: serverTimestamp(),
    });
  });
  deliveryLocations.forEach((loc) => {
    const locRef = doc(deliveryLocCol(companyId, orderRef.id));
    batch.set(locRef, { ...loc, status: "ceka", createdAt: serverTimestamp() });
  });
  // Jedna "nabavka" (Purchase) po dobavljaču — Poglavlje 5.1
  const bySupplier = {};
  items.forEach((i) => { (bySupplier[i.supplierId] ||= { supplierId: i.supplierId, supplierName: i.supplierName, count: 0 }).count += 1; });
  Object.values(bySupplier).forEach((p) => {
    const pRef = doc(purchasesCol(companyId, orderRef.id));
    batch.set(pRef, { ...p, status: "ceka", createdAt: serverTimestamp() });
  });
  await batch.commit();

  if (assignedToUid) {
    await createNotification(companyId, {
      toUid: assignedToUid, event: NOTIF_EVENTS.NOVA_NARUDZBINA, orderId: orderRef.id,
      title: "Nova narudžbina dodeljena", body: "Sistem vam je automatski dodelio narudžbinu.",
    });
  }

  await logAudit(companyId, { action: "order_created", entity: "Orders", entityId: orderRef.id, actorUid: createdByUid, actorName: createdByName, details: orderNumber });
  return orderRef.id;
}

export async function getOrder(companyId, orderId) {
  const snap = await getDoc(doc(db, "companies", companyId, "orders", orderId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function listenOrder(companyId, orderId, callback) {
  return onSnapshot(doc(db, "companies", companyId, "orders", orderId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function getOrderItems(companyId, orderId) {
  const snap = await getDocs(query(itemsCol(companyId, orderId), orderBy("supplierName")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenOrderItems(companyId, orderId, callback) {
  return onSnapshot(query(itemsCol(companyId, orderId), orderBy("supplierName")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function getOrderDeliveryLocations(companyId, orderId) {
  const snap = await getDocs(deliveryLocCol(companyId, orderId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenDeliveryLocations(companyId, orderId, callback) {
  return onSnapshot(deliveryLocCol(companyId, orderId), (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function getOrderPurchases(companyId, orderId) {
  const snap = await getDocs(purchasesCol(companyId, orderId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenOrderPurchases(companyId, orderId, callback) {
  return onSnapshot(purchasesCol(companyId, orderId), (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// --- Liste narudžbina po ulozi ---
export function listenMyOrders(companyId, createdByUid, callback, max = 100) {
  const q = query(ordersCol(companyId), where("createdByUid", "==", createdByUid), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenAssignedOrders(companyId, assignedToUid, callback, max = 100) {
  const q = query(ordersCol(companyId), where("assignedToUid", "==", assignedToUid), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenAllOrders(companyId, callback, max = 200) {
  const q = query(ordersCol(companyId), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenUnassignedOrders(companyId, callback) {
  const q = query(ordersCol(companyId), where("status", "==", ORDER_STATUS.KREIRANA), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// --- Dodela isporučioca — Poglavlje 4.2 ---
export async function assignOrder(companyId, orderId, { assignedToUid, assignedToName, actorName }) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), {
    assignedToUid, assignedToName, status: ORDER_STATUS.CEKA_PRIHVATANJE, updatedAt: serverTimestamp(),
  });
  await logAudit(companyId, { action: "order_assigned", entity: "Orders", entityId: orderId, actorName, details: assignedToName });
  await createNotification(companyId, { toUid: assignedToUid, event: NOTIF_EVENTS.NOVA_NARUDZBINA, orderId, title: "Nova narudžbina dodeljena", body: "Otvorite narudžbinu za detalje." });
}

// --- Prihvatanje / odbijanje — Poglavlje 2.4, 4.3 ---
export async function acceptOrder(companyId, orderId, { actorUid, actorName, orderCreatedByUid }) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { status: ORDER_STATUS.PRIHVACENA, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await logAudit(companyId, { action: "order_accepted", entity: "Orders", entityId: orderId, actorUid, actorName });
  await createNotification(companyId, { toUid: orderCreatedByUid, event: NOTIF_EVENTS.NARUDZBINA_PRIHVACENA, orderId, title: "Narudžbina prihvaćena", body: `${actorName} je prihvatio narudžbinu.` });
}

export async function rejectOrder(companyId, orderId, { reason, actorUid, actorName, orderCreatedByUid }) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { status: ORDER_STATUS.ODBIJENA, rejectionReason: reason, updatedAt: serverTimestamp() });
  await logAudit(companyId, { action: "order_rejected", entity: "Orders", entityId: orderId, actorUid, actorName, details: reason });
  await createNotification(companyId, { toUid: orderCreatedByUid, event: NOTIF_EVENTS.NARUDZBINA_ODBIJENA, orderId, title: "Narudžbina odbijena", body: reason });
}

// --- Generički prelazak statusa (koristi se za u_nabavci, zavrsena_nabavka, u_isporuci, isporucena) ---
export async function setOrderStatus(companyId, orderId, status, { actorName, actorUid, extra = {} } = {}) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { status, updatedAt: serverTimestamp(), ...extra });
  await logAudit(companyId, { action: "order_status_changed", entity: "Orders", entityId: orderId, actorUid, actorName, details: ORDER_STATUS_LABELS[status] });
}

// --- Naručilac menja narudžbinu dok nije prihvaćena (Poglavlje 2.3) ---
export async function updateOrderItem(companyId, orderId, itemId, data) {
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "items", itemId), data);
}
export async function deleteOrderItem(companyId, orderId, itemId) {
  return deleteDoc(doc(db, "companies", companyId, "orders", orderId, "items", itemId));
}
export async function addOrderItem(companyId, orderId, item) {
  return addDoc(itemsCol(companyId, orderId), { ...item, purchaseStatus: "na_cekanju", purchasedQty: 0, createdAt: serverTimestamp() });
}

// --- Potvrda prijema + auto-prenos nedostajuće robe u sledeću nabavku (Poglavlje 6) ---
export async function confirmReceipt(companyId, orderId, { actorUid, actorName, missingItemsToCarryOver = [] }) {
  await setOrderStatus(companyId, orderId, ORDER_STATUS.POTVRDJEN_PRIJEM, { actorUid, actorName });
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { status: ORDER_STATUS.ZATVORENA, confirmedAt: serverTimestamp() });
  await createNotification(companyId, { toUid: null, event: NOTIF_EVENTS.PRIJEM_POTVRDJEN, orderId, title: "Prijem potvrđen", body: "Naručilac je potvrdio prijem robe." });

  // Ako postoje nedostajuće stavke i naručilac je izabrao "Da" — kreira se nova narudžbina
  if (missingItemsToCarryOver.length) {
    const order = await getOrder(companyId, orderId);
    const deliveryLocations = await getOrderDeliveryLocations(companyId, orderId);
    return createOrder(companyId, {
      createdByUid: order.createdByUid, createdByName: order.createdByName, priority: "standardno",
      items: missingItemsToCarryOver, deliveryLocations: deliveryLocations.map((l) => ({ locationId: l.id, locationName: l.locationName })),
      assignmentMode: "admin_bira",
    });
  }
  return null;
}
