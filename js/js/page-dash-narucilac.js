import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { listenMyOrders, getOrderItems, getOrderDeliveryLocations, getOrderPurchases } from "./orders.js";
import { getCompanySettings } from "./settings.js";
import { generateOrderPdf } from "./order-print.js";
import { formatDate, escapeHtml, badgeClassForStatus, ORDER_STATUS_LABELS, ROLES, toast } from "./utils.js";

await loadLang();

let companyIdValue;
let latestOrders = [];

requireAuth([ROLES.NARUCILAC], (user, profile) => {
  companyIdValue = profile.companyId;
  renderNav({ companyId: profile.companyId, uid: user.uid, profile });
  listenMyOrders(profile.companyId, user.uid, (orders) => {
    latestOrders = orders;
    renderStats(orders);
    renderTable(orders);
  });
});

function renderStats(orders) {
  const active = orders.filter((o) => !["zatvorena", "odbijena"].includes(o.status)).length;
  const inPurchase = orders.filter((o) => o.status === "u_nabavci").length;
  const today = new Date().toDateString();
  const finishedToday = orders.filter((o) => o.status === "zatvorena" && o.updatedAt?.toDate?.().toDateString() === today).length;
  const late = orders.filter((o) => o.priority === "hitno" && !["zatvorena", "odbijena", "potvrdjen_prijem"].includes(o.status)).length;

  document.getElementById("stat-cards").innerHTML = `
    <div class="stat-card"><div class="stat-label" data-i18n="my_orders">Moje narudžbine</div><div class="stat-value">${orders.length}</div></div>
    <div class="stat-card red"><div class="stat-label" data-i18n="late">Kasne</div><div class="stat-value">${late}</div></div>
    <div class="stat-card amber"><div class="stat-label" data-i18n="in_purchase">U nabavci</div><div class="stat-value">${inPurchase}</div></div>
    <div class="stat-card teal"><div class="stat-label" data-i18n="finished_today">Danas završeno</div><div class="stat-value">${finishedToday}</div></div>
  `;
}

function renderTable(orders) {
  const body = document.getElementById("orders-body");
  if (!orders.length) { body.innerHTML = `<tr class="empty-row"><td colspan="6">Još uvek nemate narudžbina.</td></tr>`; return; }
  body.innerHTML = orders.map((o) => `
    <tr class="row-link" data-id="${o.id}">
      <td class="mono">${o.orderNumber}</td>
      <td>${o.priority === "hitno" ? '<span class="badge badge-urgent">Hitno</span>' : '<span class="badge badge-gray">Standardno</span>'}</td>
      <td><span class="badge ${badgeClassForStatus(o.status)}">${ORDER_STATUS_LABELS[o.status] || o.status}</span></td>
      <td>${escapeHtml(o.assignedToName || "—")}</td>
      <td>${formatDate(o.createdAt)}</td>
      <td><button class="btn btn-sm btn-outline pdf-btn" data-pdf-id="${o.id}" data-pdf-number="${escapeHtml(o.orderNumber)}" title="Preuzmi narudžbenicu kao PDF">🖨️ PDF</button></td>
    </tr>
  `).join("");
  body.querySelectorAll(".row-link").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".pdf-btn")) return; // klik na PDF dugme ne otvara detalje
      window.location.href = `./order-detail.html?order=${row.dataset.id}`;
    });
  });
  body.querySelectorAll(".pdf-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = "Generisanje...";
      try {
        await downloadOrderPdf(btn.dataset.pdfId);
      } catch (err) {
        console.error(err);
        toast("Greška pri generisanju PDF-a.", "error");
      } finally {
        btn.disabled = false; btn.textContent = original;
      }
    });
  });
}

// Učitava sve podatke potrebne za PDF (stavke, nabavke, lokacije isporuke, podaci o firmi)
// direktno iz liste narudžbina — koristi se za "brzi" PDF sa kontrolne table.
async function downloadOrderPdf(orderId) {
  const [items, deliveryLocations, purchases, company] = await Promise.all([
    getOrderItems(companyIdValue, orderId),
    getOrderDeliveryLocations(companyIdValue, orderId),
    getOrderPurchases(companyIdValue, orderId),
    getCompanySettings(companyIdValue),
  ]);
  const order = latestOrders.find((o) => o.id === orderId);
  if (!order) { toast("Narudžbina nije pronađena.", "error"); return; }
  await generateOrderPdf({ company, order, items, purchases, deliveryLocations });
}
