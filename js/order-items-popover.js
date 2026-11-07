// ============================================================================
// ORDER-ITEMS-POPOVER — balon sa listom artikala kad se mišem pređe preko broja
// narudžbenice u tabeli (kontrolne table Naručioca, Isporučioca i Admina, izveštaji).
// Artikli se čitaju tek pri prvom prelasku (jedno čitanje po narudžbini) i pamte u
// memoriji; dok je čitanje u toku, balon pokazuje „Učitavanje...". Mehanika balona
// (pozicija, zadržavanje, dodir na telefonu) je u row-popover.js.
// ============================================================================
import { t } from "./i18n.js";
import { escapeHtml, statusLabel, badgeClassForStatus } from "./utils.js";
import { getOrderItems } from "./orders.js";
import { attachRowPopover, itemsInfoBtnHtml } from "./row-popover.js";

export { itemsInfoBtnHtml };

const MAX_ITEMS = 12;
const cache = new Map();     // orderId -> Promise<items[]>

function fmtQty(it) {
  const q = it.quantity ?? "";
  return `${q}${it.unit ? ` ${it.unit}` : ""}`.trim();
}

const ICON_USER = `<svg class="items-pop-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>`;
const ICON_TRUCK = `<svg class="items-pop-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>`;

// Jedinstveni dobavljači iz SVIH stavki narudžbine (ne samo prvih MAX_ITEMS), redosled prvog pojavljivanja
function supplierNames(items) {
  const seen = new Set();
  (items || []).forEach((it) => { const n = (it.supplierName || "").trim(); if (n) seen.add(n); });
  return [...seen];
}

// Sadržaj balona jedne narudžbine. items === null → „Učitavanje...".
// extra (opciono, izveštaji): { withStatus: true → značka statusa pored broja, footHtml → dodatni odeljak ispod stavki }
export function orderPopoverHtml(order, items, extra = {}) {
  // Zaglavlje: red 1 = broj narudžbenice (+ status); red 2 = ime osobe (ako je uneto) · dobavljači.
  // Dugačka lista dobavljača se lomi u najviše dva reda (CSS), ostatak se skraćuje tri tačke.
  const by = (order?.requestedByName || "").trim();
  const sup = supplierNames(items);
  const byHtml = by ? `<span class="items-pop-by">${ICON_USER}<strong>${escapeHtml(by)}</strong></span>` : "";
  const supHtml = sup.length ? `<span class="items-pop-sup" title="${escapeHtml(t("items_pop_suppliers"))}">${ICON_TRUCK}<span class="items-pop-sup-text">${escapeHtml(sup.join(", "))}</span></span>` : "";
  const meta = (byHtml || supHtml) ? `<div class="items-pop-meta">${byHtml}${byHtml && supHtml ? '<span class="items-pop-dot">·</span>' : ""}${supHtml}</div>` : "";
  const badge = extra.withStatus && order?.status
    ? `<span class="badge ${badgeClassForStatus(order.status)}">${escapeHtml(statusLabel(order.status))}</span>` : "";
  const head = `<div class="items-pop-head"><span class="items-pop-num">${escapeHtml(order?.orderNumber || "")}</span>${badge}</div>${meta}`;
  if (items === null) return `${head}<div class="items-pop-empty">${t("loading_ellipsis")}</div>`;
  if (!items.length) return `${head}<div class="items-pop-empty">${t("items_pop_empty")}</div>${extra.footHtml || ""}`;
  const rows = items.slice(0, MAX_ITEMS).map((it) => `
    <li><span class="items-pop-name">${escapeHtml(it.productName || "—")}</span><span class="items-pop-qty">${escapeHtml(fmtQty(it))}</span></li>`).join("");
  const more = items.length > MAX_ITEMS ? `<div class="items-pop-more">${t("items_pop_more", { count: items.length - MAX_ITEMS })}</div>` : "";
  return `${head}<ul class="items-pop-list">${rows}</ul>${more}${extra.footHtml || ""}`;
}

// body: <tbody> tabele; getOrder(id) vraća narudžbinu iz liste (za broj u naslovu balona)
export function attachOrderItemsPopover(body, { companyId, getOrder }) {
  attachRowPopover(body, {
    hoverSelector: "tr.row-link > td:first-child",
    getLoading: (row) => orderPopoverHtml(getOrder?.(row.dataset.id) || { orderNumber: "" }, null),
    getContent: (row) => {
      const id = row.dataset.id;
      const order = getOrder?.(id) || { orderNumber: "" };
      if (!cache.has(id)) {
        cache.set(id, getOrderItems(companyId, id).catch((err) => { console.error("Artikli narudžbine:", err); cache.delete(id); return []; }));
      }
      return cache.get(id).then((items) => orderPopoverHtml(order, items));
    },
  });
}
