import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t, currentLang } from "./i18n.js";
import {
  listenOrder, listenOrderItems, listenOrderPurchases, listenDeliveryLocations,
  acceptOrder, rejectOrder, setOrderStatus, confirmReceipt, deleteOrderItem, assignOrder,
} from "./orders.js";
import { startPurchase, finishPurchase, markItemPurchased, markItemNotFound, markItemSubstitute, setPurchasePayment, calcOrderTotal } from "./purchases.js";
import { getSupplierLocations } from "./suppliers.js";
import { generateOrderPdf } from "./order-print.js";
import { markLocationDelivered, confirmLocationReceipt } from "./deliveries.js";
import { openClaim, resolveClaim, listenClaims } from "./claims.js";
import { sendMessageAndNotify, listenMessages } from "./chat.js";
import { uploadAttachment, listenAttachments } from "./attachments.js";
import { orderQrUrl, renderQrCode } from "./qrcode.js";
import { getIsporucioci } from "./users.js";
import { getCompanySettings } from "./settings.js";
import {
  formatDate, escapeHtml, toast, getParam, badgeClassForStatus,
  ORDER_STATUS, statusLabel, ORDER_STATUS_FLOW,
} from "./utils.js";
import { getISO, initDatepickers } from "./datepicker.js";

await loadLang();

const orderId = getParam("order");
if (!orderId) document.body.innerHTML = `<p style='padding:40px;'>${t("order_not_found_missing_id")}</p>`;

let companyId, uidValue, profile, companySettings = null;
let order = null, items = [], purchases = [], deliveryLocations = [], claims = [];

// Keš adresa lokacija preuzimanja: { [pickupLocationId]: address }. Popunjava se
// po potrebi za dobavljače koji se pojave u stavkama narudžbine (Poglavlje "Nabavke po dobavljaču").
let pickupLocationAddresses = {};
const fetchedSupplierIdsForPickup = new Set();
async function ensurePickupAddresses(itemsList) {
  const supplierIds = [...new Set(itemsList.map((i) => i.supplierId).filter(Boolean))];
  const toFetch = supplierIds.filter((sid) => !fetchedSupplierIdsForPickup.has(sid));
  if (!toFetch.length) return;
  toFetch.forEach((sid) => fetchedSupplierIdsForPickup.add(sid));
  const results = await Promise.all(toFetch.map((sid) => getSupplierLocations(companyId, sid)));
  results.forEach((locs) => locs.forEach((l) => { pickupLocationAddresses[l.id] = l.address || ""; }));
  renderAll();
}

requireAuth(null, (user, p) => {
  companyId = p.companyId; uidValue = user.uid; profile = p;
  renderNav({ companyId, uid: user.uid, profile });
  getCompanySettings(companyId).then((s) => { companySettings = s; renderAll(); });

  listenOrder(companyId, orderId, (o) => { order = o; renderAll(); });
  listenOrderItems(companyId, orderId, (i) => { items = i; renderAll(); ensurePickupAddresses(i); });
  listenOrderPurchases(companyId, orderId, (pu) => { purchases = pu; renderAll(); });
  listenDeliveryLocations(companyId, orderId, (dl) => { deliveryLocations = dl; renderAll(); });
  listenClaims(companyId, orderId, (c) => { claims = c; renderClaims(); });
  listenMessages(companyId, orderId, renderChat);
  listenAttachments(companyId, orderId, renderAttachments);

  if (getParam("confirm") === "1") {
    setTimeout(() => document.getElementById("receipt-panel")?.scrollIntoView({ behavior: "smooth" }), 600);
  }
});

function renderAll() {
  if (!order) return;
  renderHeader();
  renderStatusTrack();
  renderActionBar();
  renderItemsTable();
  renderPurchasesPanel();
  renderFinancePanel();
  renderDeliveryPanel();
  renderReceiptPanel();
  renderQrPanel();
}

// ---------------------------------------------------------------- HEADER
function renderHeader() {
  document.getElementById("order-number").textContent = order.orderNumber;
  document.getElementById("order-meta").innerHTML = `
    ${t("role_narucilac")}: <strong>${escapeHtml(order.createdByName || "—")}</strong> ·
    ${t("role_isporucilac")}: <strong>${escapeHtml(order.assignedToName || t("not_assigned"))}</strong> ·
    ${order.priority === "hitno" ? `<span class="badge badge-urgent">${t("urgent")}</span>` : `<span class="badge badge-gray">${t("standard")}</span>`}
    <span class="badge ${badgeClassForStatus(order.status)}">${statusLabel(order.status)}</span> ·
    ${t("created_label")} ${formatDate(order.createdAt)}
  `;
}

// ---------------------------------------------------------------- STATUS TRACK
function renderStatusTrack() {
  const flow = ORDER_STATUS_FLOW;
  const currentIdx = flow.indexOf(order.status);
  let html = flow.map((s, i) => {
    let cls = "status-step";
    if (order.status === ORDER_STATUS.REKLAMACIJA || order.status === ORDER_STATUS.ODBIJENA) {
      cls += i === 0 ? " done" : "";
    } else if (i < currentIdx) cls += " done";
    else if (i === currentIdx) cls += " current";
    return `<div class="${cls}"><div class="line"></div><div class="dot"></div><div class="step-label">${statusLabel(s)}</div></div>`;
  }).join("");
  if (order.status === ORDER_STATUS.REKLAMACIJA) html += `<div class="status-step current"><div class="line"></div><div class="dot"></div><div class="step-label">${t("status_reklamacija")}</div></div>`;
  if (order.status === ORDER_STATUS.ODBIJENA) html += `<div class="status-step current"><div class="line"></div><div class="dot"></div><div class="step-label">${t("status_odbijena")}</div></div>`;
  document.getElementById("status-track").innerHTML = html;
}

// ---------------------------------------------------------------- ACTION BAR
function renderActionBar() {
  const bar = document.getElementById("action-bar");
  bar.innerHTML = "";
  const role = profile.role;
  const S = ORDER_STATUS;

  if (role === "admin" && !order.assignedToUid && ![S.ZATVORENA, S.POTVRDJEN_PRIJEM, S.REKLAMACIJA].includes(order.status)) {
    getIsporucioci(companyId).then((list) => {
      bar.innerHTML = `
        <select id="assign-select" style="max-width:200px;">${list.map((u) => `<option value="${u.uid}" data-name="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join("") || `<option value=''>${t("no_fulfillers")}</option>`}</select>
        <button class="btn btn-amber" id="assign-btn">${t("assign_fulfiller_btn")}</button>
      `;
      document.getElementById("assign-btn")?.addEventListener("click", async () => {
        const sel = document.getElementById("assign-select");
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) return;
        await assignOrder(companyId, orderId, { assignedToUid: opt.value, assignedToName: opt.dataset.name, actorName: profile.name });
        toast(t("toast_fulfiller_assigned"), "success");
      });
    });
    return;
  }

  if (role === "isporucilac" && order.assignedToUid === uidValue) {
    if (order.status === S.CEKA_PRIHVATANJE) {
      bar.innerHTML = `<button class="btn btn-primary" id="accept-btn" data-i18n="accept">${t("accept")}</button><button class="btn btn-danger" id="reject-btn" data-i18n="reject">${t("reject")}</button>`;
      document.getElementById("accept-btn").addEventListener("click", async () => {
        await acceptOrder(companyId, orderId, { actorUid: uidValue, actorName: profile.name, orderCreatedByUid: order.createdByUid });
        toast(t("toast_order_accepted"), "success");
      });
      document.getElementById("reject-btn").addEventListener("click", async () => {
        const reason = prompt(t("prompt_rejection_reason"));
        if (reason === null) return;
        await rejectOrder(companyId, orderId, { reason, actorUid: uidValue, actorName: profile.name, orderCreatedByUid: order.createdByUid });
        toast(t("toast_order_rejected"), "success");
      });
    } else if (order.status === S.ZAVRSENA_NABAVKA) {
      bar.innerHTML = `<button class="btn btn-amber" id="start-delivery-btn" data-i18n="start_delivery">${t("start_delivery")}</button>`;
      document.getElementById("start-delivery-btn").addEventListener("click", async () => {
        await setOrderStatus(companyId, orderId, S.U_ISPORUCI, { actorUid: uidValue, actorName: profile.name });
        toast(t("toast_delivery_started"), "success");
      });
    } else if (order.status === S.U_ISPORUCI) {
      const allDelivered = deliveryLocations.length > 0 && deliveryLocations.every((l) => l.status !== "ceka");
      bar.innerHTML = `<button class="btn btn-amber" id="finish-delivery-btn" data-i18n="finish_delivery" ${allDelivered ? "" : "disabled"}>${t("finish_delivery")}</button>`;
      document.getElementById("finish-delivery-btn").addEventListener("click", async () => {
        await setOrderStatus(companyId, orderId, S.ISPORUCENA, { actorUid: uidValue, actorName: profile.name });
        toast(t("toast_goods_delivered"), "success");
      });
    }
  }

  if (role === "narucilac" && order.createdByUid === uidValue && order.status === S.REKLAMACIJA) {
    bar.innerHTML = `<span class="badge badge-red">${t("claim_in_progress")}</span>`;
  }
}

// ---------------------------------------------------------------- ITEMS TABLE
function renderItemsTable() {
  const body = document.getElementById("items-body");
  if (!items.length) { body.innerHTML = `<tr class="empty-row"><td colspan="7">${t("no_items")}</td></tr>`; return; }
  const canEdit = profile.role === "narucilac" && order.createdByUid === uidValue && [ORDER_STATUS.KREIRANA, ORDER_STATUS.CEKA_PRIHVATANJE].includes(order.status);

  const statusBadge = (st) => ({
    na_cekanju: `<span class="badge badge-gray">${t("item_status_pending")}</span>`,
    kupljeno: `<span class="badge badge-teal">✅ ${t("item_status_purchased")}</span>`,
    nije_pronadjeno: `<span class="badge badge-red">❌ ${t("item_status_not_found")}</span>`,
    zamena: `<span class="badge badge-amber">↺ ${t("substitution")}</span>`,
  }[st] || st);

  body.innerHTML = items.map((i) => `
    <tr>
      <td><strong>${escapeHtml(i.productName)}</strong></td>
      <td>${escapeHtml(i.supplierName)}</td>
      <td>${i.pickupLocationId && i.pickupLocationId !== "any" ? escapeHtml(i.pickupLocationName || "—") : "—"}</td>
      <td>${i.quantity} ${escapeHtml(i.unit)}</td>
      <td>${escapeHtml(i.deliveryLocationName || "—")}</td>
      <td class="muted">${escapeHtml(i.note || "—")}</td>
      <td>${statusBadge(i.purchaseStatus)} ${i.substituteName ? `<div class="muted" style="font-size:11px;">${escapeHtml(i.substituteName)}</div>` : ""}
        ${canEdit ? `<button class="btn btn-sm btn-ghost" data-remove="${i.id}">✕ ${t("remove")}</button>` : ""}
      </td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteOrderItem(companyId, orderId, btn.dataset.remove);
      toast(t("toast_item_removed"), "success");
    });
  });
}

// ---------------------------------------------------------------- PURCHASES PANEL (Poglavlje 4.3, 5.1)
function renderPurchasesPanel() {
  const panel = document.getElementById("purchases-panel");
  if (!purchases.length) { panel.innerHTML = ""; return; }
  const canWork = profile.role === "isporucilac" && order.assignedToUid === uidValue
    && [ORDER_STATUS.PRIHVACENA, ORDER_STATUS.U_NABAVCI].includes(order.status);

  // Finansijski unos je dozvoljen isporučiocu sve dok narudžbina nije prešla u fazu isporuke
  const canEditFinance = profile.role === "isporucilac" && order.assignedToUid === uidValue
    && [ORDER_STATUS.PRIHVACENA, ORDER_STATUS.U_NABAVCI, ORDER_STATUS.ZAVRSENA_NABAVKA].includes(order.status);

  panel.innerHTML = `<div class="panel-head"><h2>${t("purchases_by_supplier_title")}</h2></div>` + purchases.map((p) => {
    const supplierItems = items.filter((i) => i.supplierId === p.supplierId);
    const statusBadge = { ceka: `<span class="badge badge-gray">${t("purchase_status_waiting")}</span>`, u_toku: `<span class="badge badge-amber">${t("purchase_status_in_progress")}</span>`, zavrsena: `<span class="badge badge-teal">${t("purchase_status_finished")}</span>` }[p.status];
    const showControls = canWork && p.status === "u_toku";

    // Grupisanje stavki po lokaciji preuzimanja (redosled po prvom pojavljivanju u narudžbini)
    const locGroups = [];
    const locIndex = {};
    supplierItems.forEach((i) => {
      const key = (i.pickupLocationId && i.pickupLocationId !== "any") ? i.pickupLocationId : "any";
      if (!(key in locIndex)) {
        locIndex[key] = locGroups.length;
        locGroups.push({
          name: key === "any" ? t("any_location") : (i.pickupLocationName || t("location")),
          address: key === "any" ? "" : (pickupLocationAddresses[key] || ""),
          items: [],
        });
      }
      locGroups[locIndex[key]].items.push(i);
    });

    const itemRowHtml = (i) => `
          <div class="item-row" data-item-id="${i.id}" style="grid-template-columns:1.4fr 90px 1fr auto;">
            <div>${escapeHtml(i.productName)} <span class="muted">(${i.quantity} ${escapeHtml(i.unit)})</span></div>
            <input type="number" class="purchase-qty" value="${i.purchasedQty || i.quantity}" ${showControls ? "" : "disabled"} style="${showControls ? "" : "opacity:.5;"}" />
            <input type="text" class="purchase-substitute" placeholder="${t('substitute_name_placeholder')}" value="${escapeHtml(i.substituteName || "")}" ${showControls ? "" : "disabled"} style="${showControls ? "" : "opacity:.5;"}" />
            <div style="display:flex;gap:4px;">
              ${showControls ? `
                <button class="btn btn-sm btn-outline" data-action="kupljeno">✅</button>
                <button class="btn btn-sm btn-outline" data-action="nije">❌</button>
                <button class="btn btn-sm btn-outline" data-action="zamena">↺</button>
              ` : ""}
            </div>
          </div>`;

    const locGroupsHtml = locGroups.map((g) => `
        <div class="pickup-location-head" style="margin:12px 0 6px;padding-top:10px;border-top:1px dashed var(--line);">
          <div style="font-weight:600;">📍 ${escapeHtml(g.name)}</div>
          ${g.address ? `<div class="muted" style="font-size:12px;">${escapeHtml(g.address)}</div>` : ""}
        </div>
        ${g.items.map(itemRowHtml).join("")}
    `).join("");

    return `
      <div class="supplier-block">
        <div class="supplier-block-head"><h3>${escapeHtml(p.supplierName)}</h3>${statusBadge}</div>
        ${locGroupsHtml}
        ${canWork && p.status === "ceka" ? `<button class="btn btn-sm btn-amber" data-start-purchase="${p.id}" style="margin-top:10px;">${t("start_this_purchase")}</button>` : ""}
        ${canWork && p.status === "u_toku" ? `<button class="btn btn-sm btn-primary" data-finish-purchase="${p.id}" style="margin-top:10px;">${t("finish_this_purchase")}</button>` : ""}
        <div class="form-row payment-form" data-purchase="${p.id}" style="margin-top:12px;align-items:end;">
          <div class="field"><label>${t("paid_amount_label")} (${companyCurrency()})</label><input type="number" step="0.01" min="0" class="pay-amount" value="${p.paidAmount ?? ""}" placeholder="0.00" ${canEditFinance ? "" : "disabled"} /></div>
          <div class="field"><label>${t("receipt_number_label")}</label><input type="text" class="pay-receipt-number" value="${escapeHtml(p.receiptNumber || "")}" ${canEditFinance ? "" : "disabled"} /></div>
          <div class="field"><label>${t("receipt_date_label")}</label><input type="text" class="js-datepicker pay-receipt-date" data-value="${escapeHtml(p.receiptDate || "")}" ${canEditFinance ? "" : "disabled"} /></div>
          ${canEditFinance ? `<button type="button" class="btn btn-sm btn-primary" data-save-payment="${p.id}">💾 ${t("save")}</button>` : ""}
        </div>
        ${!canEditFinance && (p.paidAmount || p.receiptNumber) ? `<p class="muted" style="margin-top:4px;">${t("paid_label")}: <strong>${formatCurrency(p.paidAmount)}</strong>${p.receiptNumber ? ` · ${t("receipt_no_short")} ${escapeHtml(p.receiptNumber)}` : ""}${p.receiptDate ? ` ${t("from_date_prefix")} ${formatDateShort2(p.receiptDate)}` : ""}</p>` : ""}
      </div>
    `;
  }).join("");

  initDatepickers(panel);

  panel.querySelectorAll("button[data-start-purchase]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await startPurchase(companyId, orderId, btn.dataset.startPurchase, profile.name);
      if (order.status === ORDER_STATUS.PRIHVACENA) {
        await setOrderStatus(companyId, orderId, ORDER_STATUS.U_NABAVCI, { actorUid: uidValue, actorName: profile.name });
      }
      toast(t("toast_purchase_started"), "success");
    });
  });
  panel.querySelectorAll("button[data-finish-purchase]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await finishPurchase(companyId, orderId, btn.dataset.finishPurchase, profile.name);
      const stillOpen = purchases.some((p) => p.id !== btn.dataset.finishPurchase && p.status !== "zavrsena");
      if (!stillOpen) {
        await setOrderStatus(companyId, orderId, ORDER_STATUS.ZAVRSENA_NABAVKA, { actorUid: uidValue, actorName: profile.name });
        toast(t("toast_all_purchases_finished"), "success");
      } else {
        toast(t("toast_purchase_finished_for_supplier"), "success");
      }
    });
  });
  panel.querySelectorAll("button[data-save-payment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = panel.querySelector(`.payment-form[data-purchase="${btn.dataset.savePayment}"]`);
      const paidAmount = Number(row.querySelector(".pay-amount").value) || 0;
      const receiptNumber = row.querySelector(".pay-receipt-number").value.trim();
      const receiptDate = getISO(row.querySelector(".pay-receipt-date"));
      await setPurchasePayment(companyId, orderId, btn.dataset.savePayment, { paidAmount, receiptNumber, receiptDate }, profile.name);
      toast(t("toast_finance_saved"), "success");
    });
  });
  panel.querySelectorAll(".item-row[data-item-id] button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".item-row");
      const itemId = row.dataset.itemId;
      const qty = Number(row.querySelector(".purchase-qty").value) || 0;
      const substitute = row.querySelector(".purchase-substitute").value.trim();
      if (btn.dataset.action === "kupljeno") await markItemPurchased(companyId, orderId, itemId, { purchasedQty: qty, substituteName: "" });
      if (btn.dataset.action === "nije") await markItemNotFound(companyId, orderId, itemId);
      if (btn.dataset.action === "zamena") await markItemSubstitute(companyId, orderId, itemId, { purchasedQty: qty, substituteName: substitute || t("substitution") });
      toast(t("toast_updated"), "success");
    });
  });
}

// ---------------------------------------------------------------- FINANCE PANEL (finansijski pregled narudžbine)
function renderFinancePanel() {
  const panel = document.getElementById("finance-panel");
  if (!purchases.length) { panel.innerHTML = ""; return; }
  const total = calcOrderTotal(purchases);
  const isClosed = [ORDER_STATUS.ZATVORENA, ORDER_STATUS.POTVRDJEN_PRIJEM].includes(order.status);
  if (total === 0 && !isClosed) { panel.innerHTML = ""; return; }

  panel.innerHTML = `
    <div class="panel-head"><h2>${t("finance_overview_title")}</h2>${isClosed ? `<span class="badge badge-green">${t("order_closed_badge")}</span>` : ""}</div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>${t("supplier")}</th><th>${t("receipt_number_label")}</th><th>${t("receipt_date_label")}</th><th>${t("amount_label")}</th></tr></thead>
        <tbody>
          ${purchases.map((p) => `
            <tr>
              <td>${escapeHtml(p.supplierName)}</td>
              <td>${escapeHtml(p.receiptNumber || "—")}</td>
              <td>${p.receiptDate ? formatDateShort2(p.receiptDate) : "—"}</td>
              <td class="mono">${formatCurrency(p.paidAmount)}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr><td colspan="3" style="text-align:right;"><strong>${t("order_total_label")}:</strong></td><td class="mono"><strong>${formatCurrency(total)}</strong></td></tr>
        </tfoot>
      </table>
    </div>
  `;
}

function companyCurrency() { return companySettings?.currency || "RSD"; }
function formatCurrency(amount) {
  const n = Number(amount) || 0;
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${companyCurrency()}`;
}
// Formatira datum u formatu YYYY-MM-DD (iz <input type="date">) u sr-RS prikaz — formatDateShort iz utils.js očekuje Firestore Timestamp
function formatDateShort2(isoDateStr) {
  if (!isoDateStr) return "—";
  const d = new Date(isoDateStr + "T00:00:00");
  if (isNaN(d)) return isoDateStr;
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ---------------------------------------------------------------- DELIVERY PANEL (Poglavlje 5.2)
function renderDeliveryPanel() {
  const panel = document.getElementById("delivery-panel");
  if (!deliveryLocations.length) { panel.innerHTML = ""; return; }
  const isDeliverer = profile.role === "isporucilac" && order.assignedToUid === uidValue && order.status === ORDER_STATUS.U_ISPORUCI;
  const isOrderer = profile.role === "narucilac" && order.createdByUid === uidValue;

  const statusBadge = { ceka: `<span class="badge badge-gray">${t("delivery_status_waiting")}</span>`, isporuceno: `<span class="badge badge-amber">${t("delivery_status_delivered")}</span>`, potvrdjeno: `<span class="badge badge-teal">${t("delivery_status_confirmed")}</span>` };

  panel.innerHTML = `<div class="panel-head"><h2>${t("delivery_locations_title")}</h2></div>` + deliveryLocations.map((l) => `
    <div class="item-row" data-loc-id="${l.id}" style="grid-template-columns:1.6fr 1fr auto;">
      <div><strong>${escapeHtml(l.locationName)}</strong></div>
      <div>${statusBadge[l.status]}</div>
      <div>
        ${isDeliverer && l.status === "ceka" ? `<button class="btn btn-sm btn-amber" data-deliver="${l.id}">${t("mark_delivered_btn")}</button>` : ""}
      </div>
    </div>
  `).join("");

  panel.querySelectorAll("button[data-deliver]").forEach((btn) => {
    btn.addEventListener("click", () => markLocationDelivered(companyId, orderId, btn.dataset.deliver, profile.name));
  });
}

// ---------------------------------------------------------------- RECEIPT PANEL (Poglavlje 6)
function renderReceiptPanel() {
  const panel = document.getElementById("receipt-panel");
  const isOrderer = profile.role === "narucilac" && order.createdByUid === uidValue;
  if (!isOrderer || order.status !== ORDER_STATUS.ISPORUCENA) { panel.innerHTML = ""; return; }

  panel.innerHTML = `
    <div class="panel-head"><h2 data-i18n="confirm_receipt">${t("confirm_receipt")}</h2></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>${t("item_label")}</th><th data-i18n="requested">${t("requested")}</th><th data-i18n="received">${t("received")}</th></tr></thead>
        <tbody>
          ${items.map((i) => `
            <tr data-item-id="${i.id}" data-product="${escapeHtml(i.productName)}" data-supplier="${escapeHtml(i.supplierId)}" data-supplier-name="${escapeHtml(i.supplierName)}" data-unit="${escapeHtml(i.unit)}" data-requested="${i.quantity}">
              <td>${escapeHtml(i.productName)}</td>
              <td>${i.quantity} ${escapeHtml(i.unit)}</td>
              <td><input type="number" class="received-qty" value="${i.purchaseStatus === "nije_pronadjeno" ? 0 : (i.purchasedQty || i.quantity)}" style="width:90px;" /></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn btn-primary" id="confirm-receipt-btn" data-i18n="confirm_receipt">${t("confirm_receipt")}</button>
      <button class="btn btn-danger" id="open-claim-btn" data-i18n="open_claim">${t("open_claim")}</button>
    </div>
  `;

  document.getElementById("confirm-receipt-btn").addEventListener("click", async () => {
    const rows = Array.from(panel.querySelectorAll("tbody tr"));
    const missing = rows.filter((r) => Number(r.querySelector(".received-qty").value) < Number(r.dataset.requested));
    let carryOver = [];
    if (missing.length) {
      const wantsCarryOver = confirm(t("confirm_carry_over_missing", { count: missing.length }));
      if (wantsCarryOver) {
        carryOver = missing.map((r) => ({
          supplierId: r.dataset.supplier, supplierName: r.dataset.supplierName,
          productId: "", productName: r.dataset.product, unit: r.dataset.unit,
          quantity: Number(r.dataset.requested) - Number(r.querySelector(".received-qty").value),
          note: t("auto_carried_over_note"), priority: order.priority,
          pickupLocationId: "any", pickupLocationName: t("any_location"),
        }));
      }
    }
    await confirmReceipt(companyId, orderId, { actorUid: uidValue, actorName: profile.name, missingItemsToCarryOver: carryOver });
    await Promise.all(deliveryLocations.map((l) => confirmLocationReceipt(companyId, orderId, l.id, profile.name)));
    toast(t("toast_receipt_confirmed_closed"), "success");
  });

  document.getElementById("open-claim-btn").addEventListener("click", () => {
    const claimSelect = document.getElementById("claim-item");
    claimSelect.innerHTML = items.map((i) =>
      `<option value="${escapeHtml(i.productName)}" data-qty="${i.quantity}">${escapeHtml(i.productName)} (${i.quantity} ${escapeHtml(i.unit)})</option>`
    ).join("");
    if (claimSelect.options.length) {
      document.getElementById("claim-requested").value = claimSelect.options[0].dataset.qty || "";
    }
    document.getElementById("claim-modal").classList.remove("hidden");
  });
}

// ---------------------------------------------------------------- CLAIMS PANEL (Poglavlje 6)
function renderClaims() {
  const panel = document.getElementById("claims-panel");
  if (!claims.length) { panel.innerHTML = ""; return; }
  const canResolve = profile.role === "admin" || (profile.role === "isporucilac" && order?.assignedToUid === uidValue);

  panel.innerHTML = `<div class="panel-head"><h2>${t("claims_title")}</h2></div>` + claims.map((c) => `
    <div class="supplier-block">
      <div class="supplier-block-head">
        <h3>${escapeHtml(c.itemName)}</h3>
        <span class="badge ${c.status === "otvorena" ? "badge-red" : "badge-teal"}">${c.status === "otvorena" ? t("claim_status_open") : t("status_zatvorena")}</span>
      </div>
      <p>${t("requested")}: ${c.requestedQty} · ${t("received")}: ${c.receivedQty}</p>
      <p class="muted">${escapeHtml(c.description || "")}</p>
      ${c.resolutionNote ? `<p><strong>${t("resolution_label")}:</strong> ${escapeHtml(c.resolutionNote)}</p>` : ""}
      ${canResolve && c.status === "otvorena" ? `<button class="btn btn-sm btn-primary" data-resolve="${c.id}">${t("close_claim_btn")}</button>` : ""}
    </div>
  `).join("");

  panel.querySelectorAll("button[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const note = prompt(t("prompt_claim_resolution_note")) || "";
      await resolveClaim(companyId, orderId, btn.dataset.resolve, { resolutionNote: note, actorName: profile.name });
      toast(t("toast_claim_closed"), "success");
    });
  });
}

document.getElementById("close-claim-modal").addEventListener("click", () => document.getElementById("claim-modal").classList.add("hidden"));
document.getElementById("claim-item").addEventListener("change", (e) => {
  const opt = e.target.options[e.target.selectedIndex];
  document.getElementById("claim-requested").value = opt?.dataset.qty || "";
});

document.getElementById("claim-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await openClaim(companyId, orderId, {
    itemName: document.getElementById("claim-item").value.trim(),
    requestedQty: Number(document.getElementById("claim-requested").value),
    receivedQty: Number(document.getElementById("claim-received").value),
    description: document.getElementById("claim-desc").value.trim(),
    actorUid: uidValue, actorName: profile.name, notifyUid: order.assignedToUid,
  });
  toast(t("toast_claim_opened"), "success");
  document.getElementById("claim-modal").classList.add("hidden");
  e.target.reset();
});

// ---------------------------------------------------------------- QR PANEL (Poglavlje 11.1)
async function renderQrPanel() {
  const panel = document.getElementById("qr-panel");
  panel.innerHTML = `<div class="panel-head"><h2 data-i18n="qr_code">${t("qr_code")}</h2></div><div class="qr-box"><div id="qr-canvas"></div><p class="muted" style="text-align:center;">${t("qr_scan_hint")}</p></div>`;
  await renderQrCode(document.getElementById("qr-canvas"), orderQrUrl(companyId, orderId));
}

// ---------------------------------------------------------------- CHAT (Poglavlje 2.2-2.4)
function renderChat(messages) {
  const host = document.getElementById("chat-messages");
  host.innerHTML = messages.length
    ? messages.map((m) => `<div class="chat-msg ${m.fromUid === uidValue ? "mine" : ""}">${escapeHtml(m.text)}<span class="meta">${escapeHtml(m.fromName)} · ${formatDate(m.createdAt)}</span></div>`).join("")
    : `<p class="muted">${t("no_messages_yet")}</p>`;
  host.scrollTop = host.scrollHeight;
}
document.getElementById("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !order) return;
  const toUid = uidValue === order.createdByUid ? order.assignedToUid : order.createdByUid;
  await sendMessageAndNotify(companyId, orderId, { fromUid: uidValue, fromName: profile.name, text, toUid });
  input.value = "";
});

// ---------------------------------------------------------------- ATTACHMENTS (Poglavlje 11)
function renderAttachments(list) {
  const host = document.getElementById("attachments-list");
  host.innerHTML = list.length
    ? list.map((a) => `
      <div class="attachment-item">
        <a href="${a.url}" target="_blank" rel="noopener">${a.type === "racun" ? "🧾" : "📷"} ${escapeHtml(a.fileName)}</a>
        ${a.receiptNumber ? `<span class="muted">· ${t("receipt_hash")} ${escapeHtml(a.receiptNumber)}</span>` : ""}
        <span class="muted" style="margin-left:auto;">${escapeHtml(a.uploadedByName || "")}</span>
      </div>`).join("")
    : `<p class="muted">${t("no_attachments")}</p>`;
}
// ---------------------------------------------------------------- PDF NARUDŽBENICA (štampa/izvoz)
document.getElementById("print-pdf-btn").addEventListener("click", async (e) => {
  if (!order) return;
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = t("generating_pdf_ellipsis");
  try {
    await generateOrderPdf({ company: companySettings, order, items, purchases, deliveryLocations, companyId });
  } catch (err) {
    console.error(err);
    toast(t("toast_pdf_generate_error"), "error");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

document.getElementById("upload-btn").addEventListener("click", async () => {
  const file = document.getElementById("attachment-file").files[0];
  if (!file) { toast(t("toast_select_file"), "error"); return; }
  const type = document.getElementById("attachment-type").value;
  const receiptNumber = document.getElementById("receipt-number").value.trim();
  try {
    await uploadAttachment(companyId, orderId, file, { type, uploadedByUid: uidValue, uploadedByName: profile.name, receiptNumber });
    toast(t("toast_attachment_uploaded"), "success");
    document.getElementById("attachment-file").value = "";
  } catch (err) {
    console.error(err);
    toast(t("toast_upload_error"), "error");
  }
});
