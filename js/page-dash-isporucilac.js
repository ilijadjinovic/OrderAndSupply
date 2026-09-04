import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { listenAssignedOrders } from "./orders.js";
import { formatDate, escapeHtml, badgeClassForStatus, statusLabel, ROLES } from "./utils.js";

await loadLang();

let latestOrders = [];
let activeFilter = null; // null (bez filtera) | "in_progress" | "late" | "in_purchase" | "finished_today"

// Definicije filtera — ISTA logika koja se koristi i za brojanje na karticama,
// da broj na kartici uvek odgovara broju redova kad se ta kartica filtrira.
const FILTERS = {
  in_progress: { labelKey: "my_deliveries", predicate: (o) => !["zatvorena", "odbijena"].includes(o.status) },
  late: {
    labelKey: "late",
    predicate: (o) => o.priority === "hitno" && !["zatvorena", "odbijena", "potvrdjen_prijem"].includes(o.status),
  },
  in_purchase: { labelKey: "in_purchase", predicate: (o) => o.status === "u_nabavci" },
  finished_today: {
    labelKey: "finished_today",
    predicate: (o) => o.status === "zatvorena" && (o.closedAt || o.updatedAt)?.toDate?.().toDateString() === new Date().toDateString(),
  },
};

requireAuth([ROLES.ISPORUCILAC], (user, profile) => {
  renderNav({ companyId: profile.companyId, uid: user.uid, profile });
  listenAssignedOrders(profile.companyId, user.uid, (orders) => {
    latestOrders = orders;
    renderStats(orders);
    renderFilterChip();
    renderTable(activeFilter ? orders.filter(FILTERS[activeFilter].predicate) : orders);
  });
});

function selectFilter(key) {
  activeFilter = activeFilter === key ? null : key; // drugi klik na istu karticu ukida filter
  renderStats(latestOrders);
  renderFilterChip();
  renderTable(activeFilter ? latestOrders.filter(FILTERS[activeFilter].predicate) : latestOrders);
}

function renderFilterChip() {
  const host = document.getElementById("filter-chip");
  if (!activeFilter) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <span class="muted" style="font-size:13px;">${t("showing_filter_label")}: <strong>${t(FILTERS[activeFilter].labelKey)}</strong></span>
    <button type="button" class="btn btn-sm btn-ghost" id="reset-filter-btn">${t("show_all_orders_btn")}</button>
  `;
  document.getElementById("reset-filter-btn").addEventListener("click", () => selectFilter(activeFilter));
}

function renderStats(orders) {
  const inProgress = orders.filter((o) => !["zatvorena", "odbijena"].includes(o.status)).length;
  const inPurchase = orders.filter((o) => o.status === "u_nabavci").length;
  const today = new Date().toDateString();
  const finishedToday = orders.filter((o) => o.status === "zatvorena" && (o.closedAt || o.updatedAt)?.toDate?.().toDateString() === today).length;
  const late = orders.filter((o) => o.priority === "hitno" && !["zatvorena", "odbijena", "potvrdjen_prijem"].includes(o.status)).length;

  const cardCls = (key) => `stat-card${activeFilter === key ? " active" : ""}`;
  document.getElementById("stat-cards").innerHTML = `
    <div class="${cardCls("in_progress")}" data-filter="in_progress" role="button" tabindex="0"><div class="stat-label" data-i18n="my_deliveries">Moje isporuke</div><div class="stat-value">${inProgress}</div></div>
    <div class="${cardCls("late")} red" data-filter="late" role="button" tabindex="0"><div class="stat-label" data-i18n="late">Kasne</div><div class="stat-value">${late}</div></div>
    <div class="${cardCls("in_purchase")} amber" data-filter="in_purchase" role="button" tabindex="0"><div class="stat-label" data-i18n="in_purchase">${t("in_purchase")}</div><div class="stat-value">${inPurchase}</div></div>
    <div class="${cardCls("finished_today")} teal" data-filter="finished_today" role="button" tabindex="0"><div class="stat-label" data-i18n="finished_today">Danas završeno</div><div class="stat-value">${finishedToday}</div></div>
  `;
  document.getElementById("stat-cards").querySelectorAll("[data-filter]").forEach((card) => {
    card.addEventListener("click", () => selectFilter(card.dataset.filter));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectFilter(card.dataset.filter); } });
  });
}

function renderTable(orders) {
  const body = document.getElementById("orders-body");
  if (!orders.length) {
    const msg = activeFilter ? t("no_orders_for_filter") : t("no_assigned_orders");
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${msg}</td></tr>`;
    return;
  }
  body.innerHTML = orders.map((o) => `
    <tr class="row-link" data-id="${o.id}">
      <td class="mono">${o.orderNumber}</td>
      <td>${escapeHtml(o.createdByName || "—")}</td>
      <td>${o.priority === "hitno" ? `<span class="badge badge-urgent">${t("urgent")}</span>` : `<span class="badge badge-gray">${t("standard")}</span>`}</td>
      <td><span class="badge ${badgeClassForStatus(o.status)}">${statusLabel(o.status)}</span></td>
      <td>${formatDate(o.createdAt)}</td>
      <td>${o.status === "zatvorena" && (o.closedAt || o.updatedAt) ? formatDate(o.closedAt || o.updatedAt) : t("not_closed_yet")}</td>
    </tr>
  `).join("");
  body.querySelectorAll(".row-link").forEach((row) => {
    row.addEventListener("click", () => window.location.href = `./order-detail.html?order=${row.dataset.id}`);
  });
}
