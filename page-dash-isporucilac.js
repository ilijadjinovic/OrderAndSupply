import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { listenAssignedOrders } from "./orders.js";
import { formatDate, escapeHtml, badgeClassForStatus, ORDER_STATUS_LABELS, ROLES } from "./utils.js";

await loadLang();

requireAuth([ROLES.ISPORUCILAC], (user, profile) => {
  renderNav({ companyId: profile.companyId, uid: user.uid, profile });
  listenAssignedOrders(profile.companyId, user.uid, (orders) => {
    renderStats(orders);
    renderTable(orders);
  });
});

function renderStats(orders) {
  const inProgress = orders.filter((o) => !["zatvorena", "odbijena"].includes(o.status)).length;
  const inPurchase = orders.filter((o) => o.status === "u_nabavci").length;
  const today = new Date().toDateString();
  const finishedToday = orders.filter((o) => o.status === "zatvorena" && o.updatedAt?.toDate?.().toDateString() === today).length;
  const late = orders.filter((o) => o.priority === "hitno" && !["zatvorena", "odbijena", "potvrdjen_prijem"].includes(o.status)).length;

  document.getElementById("stat-cards").innerHTML = `
    <div class="stat-card"><div class="stat-label" data-i18n="my_deliveries">Moje isporuke</div><div class="stat-value">${inProgress}</div></div>
    <div class="stat-card red"><div class="stat-label" data-i18n="late">Kasne</div><div class="stat-value">${late}</div></div>
    <div class="stat-card amber"><div class="stat-label">U toku</div><div class="stat-value">${inPurchase}</div></div>
    <div class="stat-card teal"><div class="stat-label" data-i18n="finished_today">Danas završeno</div><div class="stat-value">${finishedToday}</div></div>
  `;
}

function renderTable(orders) {
  const body = document.getElementById("orders-body");
  if (!orders.length) { body.innerHTML = `<tr class="empty-row"><td colspan="5">Nemate dodeljenih narudžbina.</td></tr>`; return; }
  body.innerHTML = orders.map((o) => `
    <tr class="row-link" data-id="${o.id}">
      <td class="mono">${o.orderNumber}</td>
      <td>${escapeHtml(o.createdByName || "—")}</td>
      <td>${o.priority === "hitno" ? '<span class="badge badge-urgent">Hitno</span>' : '<span class="badge badge-gray">Standardno</span>'}</td>
      <td><span class="badge ${badgeClassForStatus(o.status)}">${ORDER_STATUS_LABELS[o.status] || o.status}</span></td>
      <td>${formatDate(o.createdAt)}</td>
    </tr>
  `).join("");
  body.querySelectorAll(".row-link").forEach((row) => {
    row.addEventListener("click", () => window.location.href = `./order-detail.html?order=${row.dataset.id}`);
  });
}
