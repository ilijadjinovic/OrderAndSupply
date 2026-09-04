import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { listenMyOrders, getOrderItems, getOrderDeliveryLocations, getOrderPurchases } from "./orders.js";
import { getCompanySettings } from "./settings.js";
import { generateOrderPdf } from "./order-print.js";
import { formatDate, escapeHtml, badgeClassForStatus, statusLabel, ROLES, toast } from "./utils.js";

await loadLang();

let companyIdValue;
let latestOrders = [];
let activeFilter = "all"; // "all" | "late" | "in_purchase" | "finished_today"

// Definicije filtera — ISTA logika koja se koristi i za brojanje na karticama,
// da broj na kartici uvek odgovara broju redova kad se ta kartica filtrira.
const FILTERS = {
  all: { labelKey: "my_orders", predicate: () => true },
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

requireAuth([ROLES.NARUCILAC], (user, profile) => {
  companyIdValue = profile.companyId;
  renderNav({ companyId: profile.companyId, uid: user.uid, profile });
  listenMyOrders(profile.companyId, user.uid, (orders) => {
    latestOrders = orders;
    renderStats(orders);
    renderFilterChip();
    renderTable(orders.filter(FILTERS[activeFilter].predicate));
  });
});

function selectFilter(key) {
  activeFilter = activeFilter === key && key !== "all" ? "all" : key; // drugi klik na istu karticu vraća na "sve"
  renderStats(latestOrders);
  renderFilterChip();
  renderTable(latestOrders.filter(FILTERS[activeFilter].predicate));
}

function renderFilterChip() {
  const host = document.getElementById("filter-chip");
  if (activeFilter === "all") { host.innerHTML = ""; return; }
  host.innerHTML = `
    <span class="muted" style="font-size:13px;">${t("showing_filter_label")}: <strong>${t(FILTERS[activeFilter].labelKey)}</strong></span>
    <button type="button" class="btn btn-sm btn-ghost" id="reset-filter-btn">${t("show_all_orders_btn")}</button>
  `;
  document.getElementById("reset-filter-btn").addEventListener("click", () => selectFilter("all"));
}

function renderStats(orders) {
  const active = orders.filter((o) => !["zatvorena", "odbijena"].includes(o.status)).length;
  const inPurchase = orders.filter((o) => o.status === "u_nabavci").length;
  const today = new Date().toDateString();
  const finishedToday = orders.filter((o) => o.status === "zatvorena" && (o.closedAt || o.updatedAt)?.toDate?.().toDateString() === today).length;
  const late = orders.filter((o) => o.priority === "hitno" && !["zatvorena", "odbijena", "potvrdjen_prijem"].includes(o.status)).length;

  const cardCls = (key) => `stat-card${activeFilter === key ? " active" : ""}`;
  document.getElementById("stat-cards").innerHTML = `
    <div class="${cardCls("all")}" data-filter="all" role="button" tabindex="0"><div class="stat-label" data-i18n="my_orders">Moje narudžbine</div><div class="stat-value">${orders.length}</div></div>
    <div class="${cardCls("late")} red" data-filter="late" role="button" tabindex="0"><div class="stat-label" data-i18n="late">Kasne</div><div class="stat-value">${late}</div></div>
    <div class="${cardCls("in_purchase")} amber" data-filter="in_purchase" role="button" tabindex="0"><div class="stat-label" data-i18n="in_purchase">U nabavci</div><div class="stat-value">${inPurchase}</div></div>
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
    const msg = activeFilter === "all" ? t("no_orders_yet") : t("no_orders_for_filter");
    body.innerHTML = `<tr class="empty-row"><td colspan="7">${msg}</td></tr>`;
    return;
  }
  body.innerHTML = orders.map((o) => `
    <tr class="row-link" data-id="${o.id}">
      <td class="mono">${o.orderNumber}</td>
      <td>${o.priority === "hitno" ? `<span class="badge badge-urgent">${t("urgent")}</span>` : `<span class="badge badge-gray">${t("standard")}</span>`}</td>
      <td><span class="badge ${badgeClassForStatus(o.status)}">${statusLabel(o.status)}</span></td>
      <td>${escapeHtml(o.assignedToName || "—")}</td>
      <td>${formatDate(o.createdAt)}</td>
      <td>${o.status === "zatvorena" && (o.closedAt || o.updatedAt) ? formatDate(o.closedAt || o.updatedAt) : t("not_closed_yet")}</td>
      <td><button class="btn btn-sm btn-outline pdf-btn" data-pdf-id="${o.id}" data-pdf-number="${escapeHtml(o.orderNumber)}" title="${t('download_order_pdf_title')}">🖨️ PDF</button></td>
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
      btn.disabled = true; btn.textContent = t("generating_ellipsis");
      try {
        await downloadOrderPdf(btn.dataset.pdfId);
      } catch (err) {
        console.error(err);
        toast(t("toast_pdf_generate_error"), "error");
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
  if (!order) { toast(t("toast_order_not_found"), "error"); return; }
  await generateOrderPdf({ company, order, items, purchases, deliveryLocations, companyId: companyIdValue });
}
