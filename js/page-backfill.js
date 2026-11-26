// Jednokratna dopuna narudžbina nastalih pre izmena na kontrolnim tablama (admin).
// Dopunjava: searchText / supplierNames / deliveryLocationNames, assignedAt, closedAt, processingMs,
// invoiceStatus / invoicedTotal (status računa: za oznaku i karticu "Čeka račun" na starim narudžbinama).
// Idempotentno: narudžbine koje već imaju ta polja se preskaču.
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { db, collection, getDocs, query, orderBy, limit, startAfter, writeBatch } from "./firebase-init.js";
import { getOrderItems, getOrderDeliveryLocations } from "./orders.js";
import { buildSearchFields, CLOSED_STATUSES } from "./dash-logic.js";
import { ROLES } from "./utils.js";
import { computeInvoiceStatus } from "./invoice-logic.js";
import { getOrderPurchases } from "./orders.js";

await loadLang();

requireAuth([ROLES.ADMIN], (user, profile) => {
  renderNav({ companyId: profile.companyId, uid: user.uid, profile });
  const btn = document.getElementById("run-btn");
  const progress = document.getElementById("progress");

  btn.addEventListener("click", async () => {
    const dry = document.getElementById("dry-run").checked;
    btn.disabled = true;
    let done = 0, changed = 0, cursor = null, batch = writeBatch(db), inBatch = 0;
    try {
      while (true) {
        const parts = [orderBy("createdAt", "desc")];
        if (cursor) parts.push(startAfter(cursor));
        parts.push(limit(100));
        const snap = await getDocs(query(collection(db, "companies", profile.companyId, "orders"), ...parts));
        if (!snap.docs.length) break;

        for (const d of snap.docs) {
          const o = d.data();
          const upd = {};
          if (!Array.isArray(o.supplierNames) || !Array.isArray(o.deliveryLocationNames) || !o.searchText) {
            const [items, locs] = await Promise.all([getOrderItems(profile.companyId, d.id), getOrderDeliveryLocations(profile.companyId, d.id)]);
            Object.assign(upd, buildSearchFields(o, items, locs));
          }
          if (o.assignedToUid && !o.assignedAt && o.createdAt) upd.assignedAt = o.createdAt;
          if (CLOSED_STATUSES.includes(o.status) && !o.closedAt) {
            const when = o.confirmedAt || o.updatedAt || o.createdAt;
            if (when) upd.closedAt = when;
          }
          // Vreme obrade za tačan prosek na Admin tabli (zatvorene narudžbine koje imaju confirmedAt)
          if (o.status === "zatvorena" && o.createdAt && o.confirmedAt && typeof o.processingMs !== "number") {
            upd.processingMs = Math.max(0, o.confirmedAt.toMillis() - o.createdAt.toMillis());
          }
          // Status računa: iz preuzetih stavki i već unetih iznosa (raniji ručni unos računa se kao račun)
          if (typeof o.invoiceStatus !== "string") {
            const [pu, it] = await Promise.all([getOrderPurchases(profile.companyId, d.id), getOrderItems(profile.companyId, d.id)]);
            upd.invoiceStatus = computeInvoiceStatus(pu, it);
            upd.invoicedTotal = Math.round(pu.reduce((s, p) => s + (Number(p.paidAmount) || 0), 0) * 100) / 100;
          }
          done++;
          if (Object.keys(upd).length) {
            changed++;
            if (!dry) {
              batch.update(d.ref, upd); inBatch++;
              if (inBatch >= 300) { await batch.commit(); batch = writeBatch(db); inBatch = 0; }
            }
          }
          if (done % 20 === 0) progress.textContent = t("backfill_progress", { done, changed });
        }
        cursor = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < 100) break;
      }
      if (inBatch) await batch.commit();
      progress.textContent = t(dry ? "backfill_done_dry" : "backfill_done", { total: done, changed });
    } catch (err) {
      console.error(err);
      progress.textContent = t("backfill_error", { message: err.message || String(err) });
    } finally {
      btn.disabled = false;
    }
  });
});
