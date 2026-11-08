// ============================================================================
// MASTER ADMIN — Poglavlje 2.1: uvid u sve firme, blokiranje, arhiviranje/brisanje,
// globalna statistika, pregled korisnika i statistike jedne firme, pretplate.
//
// Napomena (besplatan Firebase plan, bez Cloud Functions): sve se radi iz klijenta,
// a bezbednost drže firestore.rules. Statistika se računa preko count() upita
// (jedno čitanje po 1000 dokumenata) umesto učitavanja svih narudžbina.
// ============================================================================
import {
  db, auth, collection, doc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, orderBy, query,
  where, limit, writeBatch, serverTimestamp, Timestamp, getCountFromServer,
  sendPasswordResetEmail, storage, ref, deleteObject,
} from "./firebase-init.js";
import { logPlatformAudit, getRecentAuditLogs } from "./audit.js";
import { ORDER_STATUS_ALL } from "./utils.js";

const companiesCol = collection(db, "companies");
const DAY_MS = 24 * 60 * 60 * 1000;

const countOf = async (q) => (await getCountFromServer(q)).data().count;

// ---------------------------------------------------------------------------
// LISTA FIRMI
// ---------------------------------------------------------------------------
export async function getAllCompanies() {
  const snap = await getDocs(query(companiesCol, orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function listenAllCompanies(callback, onError) {
  return onSnapshot(
    query(companiesCol, orderBy("createdAt", "desc")),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error("Lista firmi:", err); if (onError) onError(err); },
  );
}

export async function getCompany(companyId) {
  const snap = await getDoc(doc(db, "companies", companyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------------------------------------------------------------------------
// METRIKE (za tabelu firmi i globalnu statistiku)
// ---------------------------------------------------------------------------
// Vraća { users, orders, orders30, lastActivity } za jednu firmu (4 jeftina upita).
export async function loadCompanyMetrics(companyId) {
  const since = Timestamp.fromMillis(Date.now() - 30 * DAY_MS);
  const ordersCol = collection(db, "companies", companyId, "orders");
  const [users, orders, orders30, logs] = await Promise.all([
    countOf(query(collection(db, "users"), where("companyId", "==", companyId))),
    countOf(ordersCol),
    countOf(query(ordersCol, where("createdAt", ">=", since))),
    getRecentAuditLogs(companyId, 1).catch(() => []),
  ]);
  return { users, orders, orders30, lastActivity: logs[0]?.createdAt || null };
}

// Učitava metrike za više firmi, najviše `concurrency` istovremeno.
// onEach(companyId, metrics) se zove čim je jedna firma gotova.
export async function loadMetricsFor(companyIds, onEach, concurrency = 4) {
  const queue = [...companyIds];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const m = await loadCompanyMetrics(id);
      onEach(id, m);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// STATISTIKA JEDNE FIRME
// ---------------------------------------------------------------------------
export async function getCompanyStats(companyId) {
  const ordersCol = collection(db, "companies", companyId, "orders");
  const now = new Date();

  // Poslednjih 6 meseci (kalendarski), po broju kreiranih narudžbina
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({ key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`, start, end, count: 0 });
  }

  const byStatus = {};
  const [total, suppliers, locations] = await Promise.all([
    countOf(ordersCol),
    countOf(collection(db, "companies", companyId, "suppliers")),
    countOf(collection(db, "companies", companyId, "locations")),
    ...ORDER_STATUS_ALL.map(async (s) => { byStatus[s] = await countOf(query(ordersCol, where("status", "==", s))); }),
    ...months.map(async (m) => {
      m.count = await countOf(query(ordersCol,
        where("createdAt", ">=", Timestamp.fromDate(m.start)),
        where("createdAt", "<", Timestamp.fromDate(m.end))));
    }),
  ]);

  // Raspodela po osobama i prioritetu iz poslednjih 200 narudžbina
  const SAMPLE = 200;
  const recentSnap = await getDocs(query(ordersCol, orderBy("createdAt", "desc"), limit(SAMPLE)));
  const tally = (arr) => Object.entries(arr).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const requesters = {}, fulfillers = {}, priorities = {};
  recentSnap.docs.forEach((d) => {
    const o = d.data();
    if (o.createdByName) requesters[o.createdByName] = (requesters[o.createdByName] || 0) + 1;
    if (o.assignedToName) fulfillers[o.assignedToName] = (fulfillers[o.assignedToName] || 0) + 1;
    if (o.priority) priorities[o.priority] = (priorities[o.priority] || 0) + 1;
  });

  return {
    total, byStatus, months, suppliers, locations,
    sampleSize: recentSnap.size, sampleCap: SAMPLE,
    topRequesters: tally(requesters), topFulfillers: tally(fulfillers), priorities,
  };
}

// ---------------------------------------------------------------------------
// KORISNICI FIRME (master admin čita users po companyId)
// ---------------------------------------------------------------------------
export async function getCompanyUsersForMaster(companyId) {
  const snap = await getDocs(query(collection(db, "users"), where("companyId", "==", companyId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function setUserActive(company, uidValue, active) {
  await updateDoc(doc(db, "users", uidValue), { active });
  // usersIndex ne mora da postoji za starije admin naloge — greška se ignoriše
  try { await updateDoc(doc(db, "companies", company.id, "usersIndex", uidValue), { active }); } catch { /* ignoriši */ }
  await logPlatformAudit(active ? "user_activated" : "user_deactivated", { companyId: company.id, companyName: company.name, details: uidValue });
}

export async function sendUserPasswordReset(company, email) {
  await sendPasswordResetEmail(auth, email);
  await logPlatformAudit("password_reset_sent", { companyId: company.id, companyName: company.name, details: email });
}

// ---------------------------------------------------------------------------
// STATUS FIRME: blokiranje, arhiviranje (meko brisanje), vraćanje
// ---------------------------------------------------------------------------
export async function blockCompany(company, blocked = true, reason = "") {
  const u = auth.currentUser;
  const data = blocked
    ? { status: "blocked", blockReason: reason || "", blockedAt: serverTimestamp(), blockedBy: u?.displayName || u?.email || null }
    : { status: "active", blockReason: null, blockedAt: null, blockedBy: null };
  await updateDoc(doc(db, "companies", company.id), data);
  await logPlatformAudit(blocked ? "company_blocked" : "company_unblocked", { companyId: company.id, companyName: company.name, details: reason });
}

// Meko brisanje: firma postaje nedostupna (isto kao blokirana), ali se ništa ne gubi i
// može da se vrati. Trajno brisanje (purgeCompany) je moguće samo za ovakve firme.
export async function archiveCompany(company) {
  const u = auth.currentUser;
  await updateDoc(doc(db, "companies", company.id), {
    status: "deleted", deletedAt: serverTimestamp(), deletedBy: u?.displayName || u?.email || null,
  });
  await logPlatformAudit("company_deleted", { companyId: company.id, companyName: company.name });
}

export async function restoreCompany(company) {
  await updateDoc(doc(db, "companies", company.id), {
    status: "active", deletedAt: null, deletedBy: null, restoredAt: serverTimestamp(),
    blockReason: null, blockedAt: null, blockedBy: null,
  });
  await logPlatformAudit("company_restored", { companyId: company.id, companyName: company.name });
}

// Zapis master admina o firmi (vidi samo master admin)
export async function updateMasterNote(company, note) {
  await updateDoc(doc(db, "companies", company.id), { masterNote: note || "" });
  await logPlatformAudit("master_note_updated", { companyId: company.id, companyName: company.name });
}

export async function updateSubscription(company, { plan, validUntil, status }) {
  await updateDoc(doc(db, "companies", company.id), { subscription: { plan: plan || "", validUntil: validUntil || null, status: status || "active" } });
  await logPlatformAudit("subscription_updated", { companyId: company.id, companyName: company.name, details: `${plan || "—"} / ${status || "—"}` });
}

export async function updatePlatformSettings(settings) {
  await updateDoc(doc(db, "platform", "settings"), { ...settings, updatedAt: serverTimestamp() });
}

// ---------------------------------------------------------------------------
// TRAJNO BRISANJE (purge) — samo za firmu u statusu "deleted" (firestore.rules).
// Briše redom: priloge u Storage-u, narudžbine sa podkolekcijama, dobavljače sa
// podkolekcijama, ostale kolekcije firme, korisničke dokumente i na kraju dokument firme.
// VAŽNO: Firebase Authentication nalozi se NE mogu obrisati iz klijenta (nema Admin SDK-a
// na besplatnom planu) — funkcija vraća listu emailova koje treba ručno ukloniti u
// Firebase konzoli (Authentication → Users), inače ti emailovi ostaju zauzeti.
// ---------------------------------------------------------------------------
const ORDER_SUBS = ["items", "purchases", "deliveryLocations", "claims", "messages", "attachments"];
const SUPPLIER_SUBS = ["locations", "products"];
const COMPANY_SUBS = ["locations", "categories", "templates", "counters", "notifications", "usersIndex", "auditLogs"];
const BATCH = 100;

async function deleteDocs(docs) {
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const batch = writeBatch(db);
    chunk.forEach((d) => batch.delete(d.ref));
    try {
      await batch.commit();
    } catch (e) {
      // Rezerva: ako grupno brisanje bude odbijeno (npr. ograničenje pristupa dokumentima
      // u pravilima), obriši pojedinačno.
      console.warn("Grupno brisanje nije uspelo, brišem pojedinačno:", e);
      for (const d of chunk) await deleteDoc(d.ref);
    }
  }
}

async function purgeCollection(colRef, onDeleted) {
  // Stranicu po stranicu (do 300 odjednom) dok kolekcija ne ostane prazna
  for (;;) {
    const snap = await getDocs(query(colRef, limit(300)));
    if (snap.empty) return;
    await deleteDocs(snap.docs);
    onDeleted(snap.size);
    if (snap.size < 300) return;
  }
}

export async function purgeCompany(company, onProgress = () => {}) {
  const cid = company.id;
  let deleted = 0;
  const bump = (n) => { deleted += n; onProgress({ deleted }); };

  // 0) Pre brisanja zapamti emailove korisnika (za ručno brisanje Auth naloga)
  const users = await getCompanyUsersForMaster(cid);
  const emails = users.map((u) => u.email).filter(Boolean);

  // 1) Narudžbine (+ podkolekcije i fajlovi priloga)
  const ordersCol = collection(db, "companies", cid, "orders");
  for (;;) {
    const orders = await getDocs(query(ordersCol, limit(50)));
    if (orders.empty) break;
    for (const o of orders.docs) {
      const attSnap = await getDocs(collection(o.ref, "attachments"));
      await Promise.all(attSnap.docs.map(async (a) => {
        const path = a.data().path;
        if (path) { try { await deleteObject(ref(storage, path)); } catch { /* fajl možda ne postoji */ } }
      }));
      for (const sub of ORDER_SUBS) await purgeCollection(collection(o.ref, sub), bump);
    }
    await deleteDocs(orders.docs);
    bump(orders.size);
  }

  // 2) Dobavljači (+ lokacije preuzimanja i proizvodi)
  const suppliersCol = collection(db, "companies", cid, "suppliers");
  for (;;) {
    const suppliers = await getDocs(query(suppliersCol, limit(50)));
    if (suppliers.empty) break;
    for (const s of suppliers.docs) {
      for (const sub of SUPPLIER_SUBS) await purgeCollection(collection(s.ref, sub), bump);
    }
    await deleteDocs(suppliers.docs);
    bump(suppliers.size);
  }

  // 3) Ostale kolekcije firme
  for (const sub of COMPANY_SUBS) await purgeCollection(collection(db, "companies", cid, sub), bump);

  // 4) Korisnički dokumenti (profili) firme
  await deleteDocs(users.map((u) => ({ ref: doc(db, "users", u.id) })));
  bump(users.length);

  // 5) Dokument firme (poslednji — pravila za podkolekcije čitaju njen status)
  await deleteDoc(doc(db, "companies", cid));
  bump(1);

  await logPlatformAudit("company_purged", { companyId: cid, companyName: company.name, details: `${deleted}` });
  return { deleted, emails };
}
