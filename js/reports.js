// ============================================================================
// REPORTS — pomoćne funkcije za jednokratno učitavanje podataka (izvoz, PDF)
// ============================================================================
import { db, collection, getDocs, orderBy, query, limit } from "./firebase-init.js";

export async function getAllOrdersOnce(companyId, max = 500) {
  const q = query(collection(db, "companies", companyId, "orders"), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
