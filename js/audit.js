// ============================================================================
// AUDIT LOG — Poglavlje 9.3: svaka izmena se evidentira trajno
// ============================================================================
import { auth, db, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from "./firebase-init.js";
import { t } from "./i18n.js";

// action primeri: order_created, order_accepted, order_rejected, order_status_changed,
// item_purchased, claim_opened, claim_closed, user_created, supplier_created, ...
// Napomena: actorName ostaje null kad nije prosleđen — prikaz "sistemske" akcije
// se prevodi u trenutku prikaza (page-master-admin.js), ne u trenutku upisa,
// da bi poštovao jezik onoga ko GLEDA log, ne onoga ko je akciju izazvao.
//
// Bezbednost: actorUid se UVEK postavlja na uid prijavljenog korisnika (firestore.rules
// odbija zapis sa tuđim uid-om), pa se zapis ne može pripisati drugoj osobi.
export async function logAudit(companyId, { action, entity, entityId, actorUid = null, actorName = null, details = "", detailsKey = null, detailsParams = null }) {
  try {
    await addDoc(collection(db, "companies", companyId, "auditLogs"), {
      action, entity, entityId, actorUid: auth.currentUser?.uid ?? actorUid, actorName, details,
      // Strukturirani detalji: prevode se pri PRIKAZU (jezik onoga ko gleda log), a ne pri upisu.
      ...(detailsKey ? { detailsKey, detailsParams: detailsParams || {} } : {}),
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("Audit log greška:", e);
  }
}

export async function getRecentAuditLogs(companyId, max = 50) {
  const q = query(collection(db, "companies", companyId, "auditLogs"), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Detalji se prevode pri prikazu. Stariji zapisi (pre detailsKey) imaju srpski tekst, pa ih prepoznajemo.
export function auditDetailsText(l) {
  if (l.detailsKey) return t(l.detailsKey, l.detailsParams || {});
  const m = /^Iznos: (.*) · Račun: (.*) \((.*)\)$/.exec(l.details || "");
  if (m) return t("audit_payment_details", { amount: m[1], receipt: m[2], date: m[3] });
  return l.details || "";
}

// ---------------------------------------------------------------------------
// PLATFORMSKI DNEVNIK — akcije master admina (blokiranje, brisanje, uvid u firmu...).
// Kolekcija platformAuditLogs je nepromenljiva (firestore.rules): samo upis i čitanje,
// samo za master admina. Napomena: upis radi klijent, pa dnevnik beleži šta je master
// admin uradio kroz aplikaciju; izmene direktno u Firebase konzoli se ne beleže ovde.
// ---------------------------------------------------------------------------
export async function logPlatformAudit(action, { companyId = null, companyName = null, details = "" } = {}) {
  try {
    const u = auth.currentUser;
    await addDoc(collection(db, "platformAuditLogs"), {
      action, companyId, companyName, details,
      actorUid: u?.uid ?? null, actorName: u?.displayName || u?.email || null,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("Platformski audit log greška:", e);
  }
}

export async function getRecentPlatformLogs(max = 50) {
  const q = query(collection(db, "platformAuditLogs"), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Čitljiv naziv platformske akcije (prevod ako postoji, inače sirov kod).
export function platformActionLabel(action) {
  const key = `platform_action_${action}`;
  const label = t(key);
  return label === key ? action : label;
}
