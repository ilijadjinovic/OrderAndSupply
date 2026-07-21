import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import {
  listenOrder, listenOrderItems, listenOrderPurchases, listenDeliveryLocations,
  acceptOrder, rejectOrder, setOrderStatus, confirmReceipt, deleteOrderItem, assignOrder,
} from "./orders.js";
import { startPurchase, finishPurchase, markItemPurchased, markItemNotFound, markItemSubstitute, setPurchaseReceiptNumber } from "./purchases.js";
import { markLocationDelivered, confirmLocationReceipt } from "./deliveries.js";
import { openClaim, resolveClaim, listenClaims } from "./claims.js";
import { sendMessageAndNotify, listenMessages } from "./chat.js";
import { uploadAttachment, listenAttachments } from "./attachments.js";
import { orderQrUrl, renderQrCode } from "./qrcode.js";
import { getIsporucioci } from "./users.js";
import {
  formatDate, escapeHtml, toast, getParam, badgeClassForStatus,
  ORDER_STATUS, ORDER_STATUS_LABELS, ORDER_STATUS_FLOW,
} from "./utils.js";

await loadLang();

const orderId = getParam("order");
if (!orderId) document.body.innerHTML = "<p style='padding:40px;'>Narudžbina nije pronađena (nedostaje ID u URL-u).</p>";

let companyId, uidValue, profile;
let order = null, items = [], purchases = [], deliveryLocations = [], claims = [];

requireAuth(null, (user, p) => {
  companyId = p.companyId; uidValue = user.uid; profile = p;
  renderNav({ companyId, uid: user.uid, profile });

  listenOrder(companyId, orderId, (o) => { order = o; renderAll(); });
  listenOrderItems(companyId, orderId, (i) => { items = i; renderAll(); });
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
  renderDeliveryPanel();
  renderReceiptPanel();
  renderQrPanel();
}

// ---------------------------------------------------------------- HEADER
function renderHeader() {
  document.getElementById("order-number").textContent = order.orderNumber;
  document.getElementById("order-meta").innerHTML = `
    Naručilac: <strong>${escapeHtml(order.createdByName || "—")}</strong> ·
    Isporučilac: <strong>${escapeHtml(order.assignedToName || "nije dodeljen")}</strong> ·
    ${order.priority === "hitno" ? '<span class="badge badge-urgent">Hitno</span>' : '<span class="badge badge-gray">Standardno</span>'}
    <span class="badge ${badgeClassForStatus(order.status)}">${ORDER_STATUS_LABELS[order.status] || order.status}</span> ·
    Kreirana ${formatDate(order.createdAt)}
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
    return `<div class="${cls}"><div class="line"></div><div class="dot"></div><div class="step-label">${ORDER_STATUS_LABELS[s]}</div></div>`;
  }).join("");
  if (order.status === ORDER_STATUS.REKLAMACIJA) html += `<div class="status-step current"><div class="line"></div><div class="dot"></div><div class="step-label">Reklamacija</div></div>`;
  if (order.status === ORDER_STATUS.ODBIJENA) html += `<div class="status-step current"><div class="line"></div><div class="dot"></div><div class="step-label">Odbijena</div></div>`;
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
        <select id="assign-select" style="max-width:200px;">${list.map((u) => `<option value="${u.uid}" data-name="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join("") || "<option value=''>Nema isporučilaca</option>"}</select>
        <button class="btn btn-amber" id="assign-btn">Dodeli isporučioca</button>
      `;
      document.getElementById("assign-btn")?.addEventListener("click", async () => {
        const sel = document.getElementById("assign-select");
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) return;
        await assignOrder(companyId, orderId, { assignedToUid: opt.value, assignedToName: opt.dataset.name, actorName: profile.name });
        toast("Isporučilac dodeljen.", "success");
      });
    });
    return;
  }

  if (role === "isporucilac" && order.assignedToUid === uidValue) {
    if (order.status === S.CEKA_PRIHVATANJE) {
      bar.innerHTML = `<button class="btn btn-primary" id="accept-btn" data-i18n="accept">Prihvati</button><button class="btn btn-danger" id="reject-btn" data-i18n="reject">Odbij</button>`;
      document.getElementById("accept-btn").addEventListener("click", async () => {
        await acceptOrder(companyId, orderId, { actorUid: uidValue, actorName: profile.name, orderCreatedByUid: order.createdByUid });
        toast("Narudžbina prihvaćena.", "success");
      });
      document.getElementById("reject-btn").addEventListener("click", async () => {
        const reason = prompt("Razlog odbijanja:");
        if (reason === null) return;
        await rejectOrder(companyId, orderId, { reason, actorUid: uidValue, actorName: profile.name, orderCreatedByUid: order.createdByUid });
        toast("Narudžbina odbijena.", "success");
      });
    } else if (order.status === S.ZAVRSENA_NABAVKA) {
      bar.innerHTML = `<button class="btn btn-amber" id="start-delivery-btn" data-i18n="start_delivery">Počni isporuku</button>`;
      document.getElementById("start-delivery-btn").addEventListener("click", async () => {
        await setOrderStatus(companyId, orderId, S.U_ISPORUCI, { actorUid: uidValue, actorName: profile.name });
        toast("Isporuka je počela.", "success");
      });
    } else if (order.status === S.U_ISPORUCI) {
      const allDelivered = deliveryLocations.length > 0 && deliveryLocations.every((l) => l.status !== "ceka");
      bar.innerHTML = `<button class="btn btn-amber" id="finish-delivery-btn" data-i18n="finish_delivery" ${allDelivered ? "" : "disabled"}>Završi isporuku</button>`;
      document.getElementById("finish-delivery-btn").addEventListener("click", async () => {
        await setOrderStatus(companyId, orderId, S.ISPORUCENA, { actorUid: uidValue, actorName: profile.name });
        toast("Roba je isporučena.", "success");
      });
    }
  }

  if (role === "narucilac" && order.createdByUid === uidValue && order.status === S.REKLAMACIJA) {
    bar.innerHTML = `<span class="badge badge-red">Reklamacija u obradi</span>`;
  }
}

// ---------------------------------------------------------------- ITEMS TABLE
function renderItemsTable() {
  const body = document.getElementById("items-body");
  if (!items.length) { body.innerHTML = `<tr class="empty-row"><td colspan="6">Nema artikala.</td></tr>`; return; }
  const canEdit = profile.role === "narucilac" && order.createdByUid === uidValue && [ORDER_STATUS.KREIRANA, ORDER_STATUS.CEKA_PRIHVATANJE].includes(order.status);

  const statusBadge = (st) => ({
    na_cekanju: '<span class="badge badge-gray">Na čekanju</span>',
    kupljeno: '<span class="badge badge-teal">✅ Kupljeno</span>',
    nije_pronadjeno: '<span class="badge badge-red">❌ Nije pronađeno</span>',
    zamena: '<span class="badge badge-amber">↺ Zamena</span>',
  }[st] || st);

  body.innerHTML = items.map((i) => `
    <tr>
      <td><strong>${escapeHtml(i.productName)}</strong></td>
      <td>${escapeHtml(i.supplierName)}</td>
      <td>${i.quantity} ${escapeHtml(i.unit)}</td>
      <td>${escapeHtml(i.deliveryLocationName || "—")}</td>
      <td class="muted">${escapeHtml(i.note || "—")}</td>
      <td>${statusBadge(i.purchaseStatus)} ${i.substituteName ? `<div class="muted" style="font-size:11px;">${escapeHtml(i.substituteName)}</div>` : ""}
        ${canEdit ? `<button class="btn btn-sm btn-ghost" data-remove="${i.id}">✕ Ukloni</button>` : ""}
      </td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteOrderItem(companyId, orderId, btn.dataset.remove);
      toast("Artikal uklonjen.", "success");
    });
  });
}

// ---------------------------------------------------------------- PURCHASES PANEL (Poglavlje 4.3, 5.1)
function renderPurchasesPanel() {
  const panel = document.getElementById("purchases-panel");
  if (!purchases.length) { panel.innerHTML = ""; return; }
  const canWork = profile.role === "isporucilac" && order.assignedToUid === uidValue
    && [ORDER_STATUS.PRIHVACENA, ORDER_STATUS.U_NABAVCI].includes(order.status);

  panel.innerHTML = `<div class="panel-head"><h2>Nabavke po dobavljaču</h2></div>` + purchases.map((p) => {
    const supplierItems = items.filter((i) => i.supplierId === p.supplierId);
    const statusBadge = { ceka: '<span class="badge badge-gray">Čeka</span>', u_toku: '<span class="badge badge-amber">U toku</span>', zavrsena: '<span class="badge badge-teal">Završena</span>' }[p.status];
    const showControls = canWork && p.status === "u_toku";
    return `
      <div class="supplier-block">
        <div class="supplier-block-head"><h3>${escapeHtml(p.supplierName)}</h3>${statusBadge}</div>
        ${supplierItems.map((i) => `
          <div class="item-row" data-item-id="${i.id}" style="grid-template-columns:1.4fr 90px 1fr auto;">
            <div>${escapeHtml(i.productName)} <span class="muted">(${i.quantity} ${escapeHtml(i.unit)})</span></div>
            <input type="number" class="purchase-qty" value="${i.purchasedQty || i.quantity}" ${showControls ? "" : "disabled"} style="${showControls ? "" : "opacity:.5;"}" />
            <input type="text" class="purchase-substitute" placeholder="Naziv zamene (ako ima)" value="${escapeHtml(i.substituteName || "")}" ${showControls ? "" : "disabled"} style="${showControls ? "" : "opacity:.5;"}" />
            <div style="display:flex;gap:4px;">
              ${showControls ? `
                <button class="btn btn-sm btn-outline" data-action="kupljeno">✅</button>
                <button class="btn btn-sm btn-outline" data-action="nije">❌</button>
                <button class="btn btn-sm btn-outline" data-action="zamena">↺</button>
              ` : ""}
            </div>
          </div>
        `).join("")}
        ${canWork && p.status === "ceka" ? `<button class="btn btn-sm btn-amber" data-start-purchase="${p.id}" style="margin-top:10px;">Počni ovu nabavku</button>` : ""}
        ${canWork && p.status === "u_toku" ? `<button class="btn btn-sm btn-primary" data-finish-purchase="${p.id}" style="margin-top:10px;">Završi ovu nabavku</button>` : ""}
        <div class="field" style="margin-top:10px;max-width:220px;">
          <label>Broj računa</label>
          <input type="text" class="receipt-number-input" data-purchase="${p.id}" value="${escapeHtml(p.receiptNumber || "")}" ${canWork ? "" : "disabled"} />
        </div>
      </div>
    `;
  }).join("");

  panel.querySelectorAll("button[data-start-purchase]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await startPurchase(companyId, orderId, btn.dataset.startPurchase, profile.name);
      if (order.status === ORDER_STATUS.PRIHVACENA) {
        await setOrderStatus(companyId, orderId, ORDER_STATUS.U_NABAVCI, { actorUid: uidValue, actorName: profile.name });
      }
      toast("Nabavka je počela.", "success");
    });
  });
  panel.querySelectorAll("button[data-finish-purchase]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await finishPurchase(companyId, orderId, btn.dataset.finishPurchase, profile.name);
      const stillOpen = purchases.some((p) => p.id !== btn.dataset.finishPurchase && p.status !== "zavrsena");
      if (!stillOpen) {
        await setOrderStatus(companyId, orderId, ORDER_STATUS.ZAVRSENA_NABAVKA, { actorUid: uidValue, actorName: profile.name });
        toast("Sve nabavke su završene — narudžbina prelazi u isporuku.", "success");
      } else {
        toast("Nabavka za ovog dobavljača je završena.", "success");
      }
    });
  });
  panel.querySelectorAll(".receipt-number-input").forEach((inp) => {
    inp.addEventListener("change", () => setPurchaseReceiptNumber(companyId, orderId, inp.dataset.purchase, inp.value.trim()));
  });
  panel.querySelectorAll(".item-row[data-item-id] button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".item-row");
      const itemId = row.dataset.itemId;
      const qty = Number(row.querySelector(".purchase-qty").value) || 0;
      const substitute = row.querySelector(".purchase-substitute").value.trim();
      if (btn.dataset.action === "kupljeno") await markItemPurchased(companyId, orderId, itemId, { purchasedQty: qty, substituteName: "" });
      if (btn.dataset.action === "nije") await markItemNotFound(companyId, orderId, itemId);
      if (btn.dataset.action === "zamena") await markItemSubstitute(companyId, orderId, itemId, { purchasedQty: qty, substituteName: substitute || "Zamena" });
      toast("Ažurirano.", "success");
    });
  });
}

// ---------------------------------------------------------------- DELIVERY PANEL (Poglavlje 5.2)
function renderDeliveryPanel() {
  const panel = document.getElementById("delivery-panel");
  if (!deliveryLocations.length) { panel.innerHTML = ""; return; }
  const isDeliverer = profile.role === "isporucilac" && order.assignedToUid === uidValue && order.status === ORDER_STATUS.U_ISPORUCI;
  const isOrderer = profile.role === "narucilac" && order.createdByUid === uidValue;

  const statusBadge = { ceka: '<span class="badge badge-gray">Čeka</span>', isporuceno: '<span class="badge badge-amber">Isporučeno</span>', potvrdjeno: '<span class="badge badge-teal">Potvrđeno</span>' };

  panel.innerHTML = `<div class="panel-head"><h2>Lokacije isporuke</h2></div>` + deliveryLocations.map((l) => `
    <div class="item-row" data-loc-id="${l.id}" style="grid-template-columns:1.6fr 1fr auto;">
      <div><strong>${escapeHtml(l.locationName)}</strong></div>
      <div>${statusBadge[l.status]}</div>
      <div>
        ${isDeliverer && l.status === "ceka" ? `<button class="btn btn-sm btn-amber" data-deliver="${l.id}">Označi isporučeno</button>` : ""}
        ${isOrderer && l.status === "isporuceno" ? `<button class="btn btn-sm btn-primary" data-confirm-loc="${l.id}">Potvrdi prijem</button>` : ""}
      </div>
    </div>
  `).join("");

  panel.querySelectorAll("button[data-deliver]").forEach((btn) => {
    btn.addEventListener("click", () => markLocationDelivered(companyId, orderId, btn.dataset.deliver, profile.name));
  });
  panel.querySelectorAll("button[data-confirm-loc]").forEach((btn) => {
    btn.addEventListener("click", () => confirmLocationReceipt(companyId, orderId, btn.dataset.confirmLoc, profile.name));
  });
}

// ---------------------------------------------------------------- RECEIPT PANEL (Poglavlje 6)
function renderReceiptPanel() {
  const panel = document.getElementById("receipt-panel");
  const isOrderer = profile.role === "narucilac" && order.createdByUid === uidValue;
  if (!isOrderer || order.status !== ORDER_STATUS.ISPORUCENA) { panel.innerHTML = ""; return; }

  panel.innerHTML = `
    <div class="panel-head"><h2 data-i18n="confirm_receipt">Potvrda prijema</h2></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Artikal</th><th data-i18n="requested">Traženo</th><th data-i18n="received">Primljeno</th></tr></thead>
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
      <button class="btn btn-primary" id="confirm-receipt-btn" data-i18n="confirm_receipt">Potvrdi prijem</button>
      <button class="btn btn-danger" id="open-claim-btn" data-i18n="open_claim">Otvori reklamaciju</button>
    </div>
  `;

  document.getElementById("confirm-receipt-btn").addEventListener("click", async () => {
    const rows = Array.from(panel.querySelectorAll("tbody tr"));
    const missing = rows.filter((r) => Number(r.querySelector(".received-qty").value) < Number(r.dataset.requested));
    let carryOver = [];
    if (missing.length) {
      const wantsCarryOver = confirm(`${missing.length} artikala nije stiglo u punoj količini. Da li želite da ih automatski dodate u sledeću nabavku?`);
      if (wantsCarryOver) {
        carryOver = missing.map((r) => ({
          supplierId: r.dataset.supplier, supplierName: r.dataset.supplierName,
          productId: "", productName: r.dataset.product, unit: r.dataset.unit,
          quantity: Number(r.dataset.requested) - Number(r.querySelector(".received-qty").value),
          note: "Automatski preneto iz prethodne narudžbine", priority: order.priority,
          pickupLocationId: "any", pickupLocationName: "Bilo koja lokacija",
        }));
      }
    }
    await confirmReceipt(companyId, orderId, { actorUid: uidValue, actorName: profile.name, missingItemsToCarryOver: carryOver });
    toast("Prijem potvrđen. Narudžbina je zatvorena.", "success");
  });

  document.getElementById("open-claim-btn").addEventListener("click", () => document.getElementById("claim-modal").classList.remove("hidden"));
}

// ---------------------------------------------------------------- CLAIMS PANEL (Poglavlje 6)
function renderClaims() {
  const panel = document.getElementById("claims-panel");
  if (!claims.length) { panel.innerHTML = ""; return; }
  const canResolve = profile.role === "admin" || (profile.role === "isporucilac" && order?.assignedToUid === uidValue);

  panel.innerHTML = `<div class="panel-head"><h2>Reklamacije</h2></div>` + claims.map((c) => `
    <div class="supplier-block">
      <div class="supplier-block-head">
        <h3>${escapeHtml(c.itemName)}</h3>
        <span class="badge ${c.status === "otvorena" ? "badge-red" : "badge-teal"}">${c.status === "otvorena" ? "Otvorena" : "Zatvorena"}</span>
      </div>
      <p>Traženo: ${c.requestedQty} · Primljeno: ${c.receivedQty}</p>
      <p class="muted">${escapeHtml(c.description || "")}</p>
      ${c.resolutionNote ? `<p><strong>Rešenje:</strong> ${escapeHtml(c.resolutionNote)}</p>` : ""}
      ${canResolve && c.status === "otvorena" ? `<button class="btn btn-sm btn-primary" data-resolve="${c.id}">Zatvori reklamaciju</button>` : ""}
    </div>
  `).join("");

  panel.querySelectorAll("button[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const note = prompt("Napomena o rešenju reklamacije:") || "";
      await resolveClaim(companyId, orderId, btn.dataset.resolve, { resolutionNote: note, actorName: profile.name });
      toast("Reklamacija zatvorena.", "success");
    });
  });
}

document.getElementById("close-claim-modal").addEventListener("click", () => document.getElementById("claim-modal").classList.add("hidden"));
document.getElementById("claim-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await openClaim(companyId, orderId, {
    itemName: document.getElementById("claim-item").value.trim(),
    requestedQty: Number(document.getElementById("claim-requested").value),
    receivedQty: Number(document.getElementById("claim-received").value),
    description: document.getElementById("claim-desc").value.trim(),
    actorUid: uidValue, actorName: profile.name, notifyUid: order.assignedToUid,
  });
  toast("Reklamacija otvorena.", "success");
  document.getElementById("claim-modal").classList.add("hidden");
  e.target.reset();
});

// ---------------------------------------------------------------- QR PANEL (Poglavlje 11.1)
async function renderQrPanel() {
  const panel = document.getElementById("qr-panel");
  panel.innerHTML = `<div class="panel-head"><h2 data-i18n="qr_code">QR kod</h2></div><div class="qr-box"><div id="qr-canvas"></div><p class="muted" style="text-align:center;">Skeniranjem se otvara ekran za potvrdu prijema.</p></div>`;
  await renderQrCode(document.getElementById("qr-canvas"), orderQrUrl(companyId, orderId));
}

// ---------------------------------------------------------------- CHAT (Poglavlje 2.2-2.4)
function renderChat(messages) {
  const host = document.getElementById("chat-messages");
  host.innerHTML = messages.length
    ? messages.map((m) => `<div class="chat-msg ${m.fromUid === uidValue ? "mine" : ""}">${escapeHtml(m.text)}<span class="meta">${escapeHtml(m.fromName)} · ${formatDate(m.createdAt)}</span></div>`).join("")
    : `<p class="muted">Nema poruka još.</p>`;
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
        ${a.receiptNumber ? `<span class="muted">· račun #${escapeHtml(a.receiptNumber)}</span>` : ""}
        <span class="muted" style="margin-left:auto;">${escapeHtml(a.uploadedByName || "")}</span>
      </div>`).join("")
    : `<p class="muted">Nema priloga.</p>`;
}
document.getElementById("upload-btn").addEventListener("click", async () => {
  const file = document.getElementById("attachment-file").files[0];
  if (!file) { toast("Izaberite fajl.", "error"); return; }
  const type = document.getElementById("attachment-type").value;
  const receiptNumber = document.getElementById("receipt-number").value.trim();
  try {
    await uploadAttachment(companyId, orderId, file, { type, uploadedByUid: uidValue, uploadedByName: profile.name, receiptNumber });
    toast("Prilog otpremljen.", "success");
    document.getElementById("attachment-file").value = "";
  } catch (err) {
    console.error(err);
    toast("Greška pri otpremanju.", "error");
  }
});
