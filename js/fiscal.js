// ============================================================================
// FISCAL — preuzimanje fiskalnog računa (QR) preko Cloudflare Worker-a + evidencija upotrebe računa (PFR).
// Isti fiskalni račun sme da se učita više puta (npr. stavke se odnose na različite narudžbine), ali korisnik
// dobija UPOZORENJE sa spiskom gde je već unet. Evidencija: companies/{c}/fiscalReceipts/{PFR}, uses[invoiceId].
// ============================================================================
import { auth, db, doc, getDoc, setDoc } from "./firebase-init.js";
import { RECEIPT_WORKER_URL } from "./receipt-config.js";
import { receiptKey, usageList } from "./fiscal-logic.js";

export const scanningConfigured = () => !!String(RECEIPT_WORKER_URL || "").trim();

// Greške imaju .code (fiscal_err_<code> u i18n): not_configured, no_user, network, unauthorized, bad_url,
// page_unavailable, journal_not_found, journal_unparsed, fetch_failed, generic
const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

export async function fetchReceipt(url) {
  if (!scanningConfigured()) throw fail("not_configured");
  const user = auth.currentUser;
  if (!user) throw fail("no_user");
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetch(RECEIPT_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
    });
  } catch { throw fail("network"); }
  let data = null;
  try { data = await res.json(); } catch { /* nije JSON */ }
  if (res.status === 403) throw fail("forbidden");
  if (!res.ok || !data?.ok) throw fail(data?.error || "generic", { diag: data?.diag });
  return { ...data.receipt, _diag: data.diag };
}

const usageRef = (companyId, pfr) => doc(db, "companies", companyId, "fiscalReceipts", receiptKey(pfr));

export async function getReceiptUsage(companyId, pfr, opts = {}) {
  if (!pfr) return [];
  const snap = await getDoc(usageRef(companyId, pfr));
  return snap.exists() ? usageList(snap.data(), opts) : [];
}

// use: { orderId, orderNumber, supplierName, number, byName }
export async function registerReceiptUse(companyId, pfr, invoiceId, use) {
  if (!pfr || !invoiceId) return;
  await setDoc(usageRef(companyId, pfr), { pfr, uses: { [invoiceId]: { ...use, at: new Date().toISOString() } } }, { merge: true });
}

export async function unregisterReceiptUse(companyId, pfr, invoiceId) {
  if (!pfr || !invoiceId) return;
  const ref = usageRef(companyId, pfr);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const uses = { ...(snap.data().uses || {}) };
  delete uses[invoiceId];
  await setDoc(ref, { pfr, uses });
}
