import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { listenAllOrders, assignOrder, listenUnassignedOrders } from "./orders.js";
import { getIsporucioci } from "./users.js";
import { formatDate, escapeHtml, badgeClassForStatus, ORDER_STATUS_LABELS, ROLES, debounce } from "./utils.js";

await loadLang();

let allOrders = [];

requireAuth([ROLES.ADMIN], (user, profile) => {
  renderNav({ companyId: profile.companyId, uid: user.uid, profile });
  document.getElementById("company-name-eyebrow").textContent = profile.name ? "Admin firme" : "Admin firme";

  listenAllOrders(profile.companyId, (orders) => {
    allOrders = orders;
    renderStats(orders);
    renderChart(orders);
    renderMetrics(orders);
    renderOrdersTable(orders);
  });
});

document.getElementById("order-search").addEventListener("input", debounce((e) => {
  const term = e.target.value.trim().toLowerCase();
  const filtered = term ? allOrders.filter((o) => o.orderNumber.toLowerCase().includes(term)) : allOrders;
  renderOrdersTable(filtered);
}, 250));

function renderStats(orders) {
  const active = orders.filter((o) => !["zatvorena", "odbijena"].includes(o.status)).length;
  const inPurchase = orders.filter((o) => o.status === "u_nabavci").length;
  const today = new Date().toDateString();
  const finishedToday = orders.filter((o) => o.status === "zatvorena" && o.updatedAt?.toDate?.().toDateString() === today).length;
  const late = orders.filter((o) => o.priority === "hitno" && !["zatvorena", "odbijena", "potvrdjen_prijem"].includes(o.status)).length;

  document.getElementById("stat-cards").innerHTML = `
    <div class="stat-card"><div class="stat-label" data-i18n="active_orders">Aktivne narudžbine</div><div class="stat-value">${active}</div></div>
    <div class="stat-card red"><div class="stat-label" data-i18n="late">Kasne</div><div class="stat-value">${late}</div></div>
    <div class="stat-card amber"><div class="stat-label" data-i18n="in_purchase">U nabavci</div><div class="stat-value">${inPurchase}</div></div>
    <div class="stat-card teal"><div class="stat-label" data-i18n="finished_today">Danas završeno</div><div class="stat-value">${finishedToday}</div></div>
  `;
}

function renderChart(orders) {
  const days = [...Array(14)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d;
  });
  const counts = days.map((d) => orders.filter((o) => o.createdAt?.toDate?.().toDateString() === d.toDateString()).length);
  const max = Math.max(1, ...counts);
  document.getElementById("chart-orders").innerHTML = days.map((d, i) => `
    <div title="${d.toLocaleDateString("sr-RS")}: ${counts[i]}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;">
      <div style="width:70%;background:var(--brand-500);border-radius:4px 4px 0 0;height:${(counts[i] / max) * 100}%;min-height:2px;"></div>
      <span style="font-size:9px;color:var(--ink-300);margin-top:4px;">${d.getDate()}/${d.getMonth() + 1}</span>
    </div>
  `).join("");
}

function renderMetrics(orders) {
  const closed = orders.filter((o) => o.status === "zatvorena" && o.createdAt && o.confirmedAt);
  if (closed.length) {
    const avgMs = closed.reduce((sum, o) => sum + (o.confirmedAt.toDate() - o.createdAt.toDate()), 0) / closed.length;
    const hours = (avgMs / 3600000).toFixed(1);
    document.getElementById("avg-processing-time").textContent = `${hours} h`;
  } else {
    document.getElementById("avg-processing-time").textContent = "—";
  }
  const claims = orders.filter((o) => o.status === "reklamacija").length;
  const rate = orders.length ? (100 - (claims / orders.length) * 100).toFixed(0) : 100;
  document.getElementById("success-rate").textContent = `${rate}% uspešno · ${claims} reklamacija`;
}

function renderOrdersTable(orders) {
  const body = document.getElementById("orders-body");
  if (!orders.length) { body.innerHTML = `<tr class="empty-row"><td colspan="6">Nema narudžbina.</td></tr>`; return; }
  body.innerHTML = orders.slice(0, 100).map((o) => `
    <tr class="row-link" data-id="${o.id}">
      <td class="mono">${o.orderNumber}</td>
      <td>${escapeHtml(o.createdByName || "—")}</td>
      <td>${escapeHtml(o.assignedToName || "—")}</td>
      <td>${o.priority === "hitno" ? '<span class="badge badge-urgent">Hitno</span>' : '<span class="badge badge-gray">Standardno</span>'}</td>
      <td><span class="badge ${badgeClassForStatus(o.status)}">${ORDER_STATUS_LABELS[o.status] || o.status}</span></td>
      <td>${formatDate(o.createdAt)}</td>
    </tr>
  `).join("");

  body.querySelectorAll(".row-link").forEach((row) => {
    row.addEventListener("click", () => { window.location.href = `./order-detail.html?order=${row.dataset.id}`; });
  });
}
