// ============================================================================
// RAČUNI — prikaz i unos na stranici narudžbine (blok "Računi" unutar svakog dobavljača)
// Unos/izmena: isporučilac narudžbine, naručilac koji ju je napravio, admin firme — i na ZATVORENIM
// narudžbinama (naknadni unos). Račun nema bar kod (faktura): unosi se ukupan iznos i PDV;
// stavke sa cenama i usaglašavanje dolaze u sledećoj fazi.
// ============================================================================
import { t } from "./i18n.js";
import { escapeHtml, toast } from "./utils.js";
import { getISO, initDatepickers } from "./datepicker.js";
import { addInvoice, updateInvoice, deleteInvoice, setPurchaseNoInvoice } from "./invoices.js";
import {
  VAT_RATES, INVOICE_SOURCE, fromGross, fromNet, round2, parseAmount, validateInvoice, isLegacyPurchaseAmount,
} from "./invoice-logic.js";

const fmtDate = (iso, lang) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString(lang === "en" ? "en-GB" : "sr-RS", { day: "2-digit", month: "2-digit", year: "numeric" });
};

// ctx: { companyId, orderId, uid, profile, canManage, currency, money(amount), lang }
export function invoiceBlockHtml(purchase, invoices, ctx) {
  const mine = invoices.filter((i) => i.supplierId === purchase.supplierId);
  const legacy = isLegacyPurchaseAmount(purchase) && !mine.length;
  const canDel = (i) => ctx.canManage && (ctx.profile.role === "admin" || i.createdByUid === ctx.uid);
  const sum = (k) => round2(mine.reduce((s, i) => s + (Number(i[k]) || 0), 0));

  const rows = mine.map((i) => `
    <tr data-invoice="${i.id}">
      <td>${escapeHtml(i.number || "—")}${i.legacy ? ` <span class="muted" style="font-size:11px;">(${t("inv_legacy_tag")})</span>` : ""}</td>
      <td>${fmtDate(i.date, ctx.lang)}</td>
      <td class="mono">${ctx.money(i.netAmount)}</td>
      <td class="mono">${ctx.money(i.vatAmount)}${i.vatRate != null ? ` <span class="muted" style="font-size:11px;">(${i.vatRate}%)</span>` : ""}</td>
      <td class="mono"><strong>${ctx.money(i.grossAmount)}</strong></td>
      <td class="muted" style="font-size:12px;">${escapeHtml(i.createdByName || "—")}${i.attachmentUrl ? ` · <a href="${escapeHtml(i.attachmentUrl)}" target="_blank" rel="noopener">📎</a>` : ""}</td>
      <td style="white-space:nowrap;">
        ${ctx.canManage ? `<button type="button" class="btn btn-sm btn-ghost" data-inv-edit="${i.id}" title="${escapeHtml(t("edit"))}">✏</button>` : ""}
        ${canDel(i) ? `<button type="button" class="btn btn-sm btn-ghost" data-inv-del="${i.id}" title="${escapeHtml(t("delete"))}">🗑</button>` : ""}
      </td>
    </tr>`).join("");

  const legacyRow = legacy ? `
    <tr><td colspan="4" class="muted">${t("inv_legacy_row", { number: escapeHtml(purchase.receiptNumber || "—") })}</td>
      <td class="mono"><strong>${ctx.money(purchase.paidAmount)}</strong></td><td></td>
      <td>${ctx.canManage ? `<button type="button" class="btn btn-sm btn-ghost" data-inv-legacy="1" title="${escapeHtml(t("edit"))}">✏</button>` : ""}</td></tr>` : "";

  const empty = !mine.length && !legacy;
  const noInvoiceNote = empty && purchase.noInvoice;
  return `
    <div class="invoices-block" data-purchase="${purchase.id}" style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--line);">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
        <strong>🧾 ${t("invoices_title")}</strong>
        ${empty && !noInvoiceNote ? `<span class="badge badge-amber">${t("awaiting_invoice_badge")}</span>` : ""}
        ${noInvoiceNote ? `<span class="badge badge-gray">${t("inv_none_badge")}</span>` : ""}
        ${ctx.canManage ? `<button type="button" class="btn btn-sm btn-primary" data-inv-add="${purchase.id}">＋ ${t("inv_add_btn")}</button>` : ""}
        ${ctx.canManage && empty ? `<label class="muted" style="font-size:13px;display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" data-inv-none="${purchase.id}" ${purchase.noInvoice ? "checked" : ""} /> ${t("inv_none_label")}</label>` : ""}
      </div>
      ${empty ? "" : `
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>${t("receipt_number_label")}</th><th>${t("receipt_date_label")}</th><th>${t("inv_net")}</th><th>${t("inv_vat")}</th><th>${t("inv_gross")}</th><th>${t("inv_entered_by")}</th><th></th></tr></thead>
        <tbody>${rows}${legacyRow}</tbody>
        ${mine.length > 1 ? `<tfoot><tr><td colspan="2" style="text-align:right;"><strong>${t("inv_sum")}:</strong></td><td class="mono">${ctx.money(sum("netAmount"))}</td><td class="mono">${ctx.money(sum("vatAmount"))}</td><td class="mono"><strong>${ctx.money(sum("grossAmount"))}</strong></td><td colspan="2"></td></tr></tfoot>` : ""}
      </table></div>`}
    </div>`;
}

export function bindInvoiceBlocks(panel, purchases, invoices, ctx) {
  const actor = { uid: ctx.uid, name: ctx.profile.name };
  const purchaseById = (id) => purchases.find((p) => p.id === id);
  const done = (res, msgKey) => { toast(t(msgKey), "success"); if (res?.attachmentError) toast(t("inv_attachment_failed"), "error"); };

  panel.querySelectorAll("[data-inv-add]").forEach((b) => b.addEventListener("click", () => {
    const p = purchaseById(b.dataset.invAdd);
    openInvoiceModal({ purchase: p, invoices, ctx, onSave: async (data) => done(await addInvoice(ctx.companyId, ctx.orderId, p, data, actor), "toast_invoice_saved") });
  }));
  panel.querySelectorAll("[data-inv-legacy]").forEach((b) => b.addEventListener("click", () => {
    const p = purchaseById(b.closest(".invoices-block").dataset.purchase);
    openInvoiceModal({
      purchase: p, invoices, ctx,
      initial: { number: p.receiptNumber || "", date: p.receiptDate || "", gross: p.paidAmount, vatRate: 20 },
      onSave: async (data) => done(await addInvoice(ctx.companyId, ctx.orderId, p, data, actor, { replaceLegacy: true }), "toast_invoice_saved"),
    });
  }));
  panel.querySelectorAll("[data-inv-edit]").forEach((b) => b.addEventListener("click", () => {
    const inv = invoices.find((i) => i.id === b.dataset.invEdit);
    const p = purchases.find((x) => x.supplierId === inv.supplierId) || { id: inv.purchaseId, supplierId: inv.supplierId, supplierName: inv.supplierName };
    openInvoiceModal({
      purchase: p, invoices, ctx, editing: inv,
      initial: { number: inv.number, date: inv.date, gross: inv.grossAmount, net: inv.netAmount, vat: inv.vatAmount, vatRate: inv.vatRate, note: inv.note },
      onSave: async (data) => done(await updateInvoice(ctx.companyId, ctx.orderId, inv, data, actor), "toast_invoice_saved"),
    });
  }));
  panel.querySelectorAll("[data-inv-del]").forEach((b) => b.addEventListener("click", async () => {
    const inv = invoices.find((i) => i.id === b.dataset.invDel);
    if (!confirm(t("inv_confirm_delete", { number: inv.number || "—", amount: ctx.money(inv.grossAmount) }))) return;
    try { await deleteInvoice(ctx.companyId, ctx.orderId, inv, actor); toast(t("toast_invoice_deleted"), "success"); }
    catch (e) { console.error(e); toast(t("inv_save_error"), "error"); }
  }));
  panel.querySelectorAll("[data-inv-none]").forEach((c) => c.addEventListener("change", async () => {
    try { await setPurchaseNoInvoice(ctx.companyId, ctx.orderId, purchaseById(c.dataset.invNone), c.checked, actor); }
    catch (e) { console.error(e); c.checked = !c.checked; toast(t("inv_save_error"), "error"); }
  }));
}

// ----------------------------------------------------------------------------
// Modal za unos/izmenu računa
// ----------------------------------------------------------------------------
export function openInvoiceModal({ purchase, invoices, ctx, editing = null, initial = {}, onSave }) {
  const rateOpts = [...VAT_RATES.map((r) => `<option value="${r}">${r}%</option>`), `<option value="manual">${t("inv_vat_manual")}</option>`].join("");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const amt = (v) => (v === undefined || v === null || v === "" ? "" : String(round2(v)));
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:560px;">
      <div class="modal-head"><h2>${editing ? t("inv_edit_title") : t("inv_add_title")}</h2><button type="button" class="icon-btn" data-close>✕</button></div>
      <p class="muted" style="margin-top:0;">${escapeHtml(purchase.supplierName || "")}</p>
      <div class="form-row">
        <div class="field"><label>${t("receipt_number_label")} *</label><input type="text" id="inv-number" value="${escapeHtml(initial.number || "")}" /></div>
        <div class="field"><label>${t("receipt_date_label")}</label><input type="text" class="js-datepicker" id="inv-date" data-value="${escapeHtml(initial.date || "")}" /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>${t("inv_vat_rate")}</label><select id="inv-rate">${rateOpts}</select></div>
        <div class="field"><label>${t("inv_gross")} (${escapeHtml(ctx.currency)}) *</label><input type="text" inputmode="decimal" id="inv-gross" value="${amt(initial.gross)}" placeholder="0.00" /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>${t("inv_net")} (${escapeHtml(ctx.currency)})</label><input type="text" inputmode="decimal" id="inv-net" value="${amt(initial.net)}" placeholder="0.00" /></div>
        <div class="field"><label>${t("inv_vat")} (${escapeHtml(ctx.currency)})</label><input type="text" inputmode="decimal" id="inv-vat" value="${amt(initial.vat)}" placeholder="0.00" /></div>
      </div>
      <p class="muted" style="font-size:12px;margin:0 0 10px;">${t("inv_vat_hint")}</p>
      <div class="field"><label>${t("inv_file_label")}</label><input type="file" id="inv-file" accept="image/*,application/pdf" /></div>
      <div class="field"><label>${t("note")}</label><input type="text" id="inv-note" value="${escapeHtml(initial.note || "")}" /></div>
      <div id="inv-error" class="error-text" style="color:var(--color-danger,#c0392b);font-size:13px;min-height:18px;margin:4px 0 8px;"></div>
      <div class="modal-actions" style="display:flex;gap:10px;justify-content:flex-end;">
        <button type="button" class="btn btn-outline" data-close>${t("cancel")}</button>
        <button type="button" class="btn btn-primary" id="inv-save">💾 ${t("save")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  initDatepickers(overlay);

  const $ = (id) => overlay.querySelector(id);
  const rate = $("#inv-rate"), gross = $("#inv-gross"), net = $("#inv-net"), vat = $("#inv-vat"), err = $("#inv-error");
  rate.value = initial.vatRate === undefined || initial.vatRate === null ? (editing ? "manual" : "20") : String(initial.vatRate);
  if (![...rate.options].some((o) => o.value === rate.value)) rate.value = "manual";
  const set = (el, v) => { el.value = Number.isFinite(v) ? v.toFixed(2) : ""; };
  const val = (el) => parseAmount(el.value);
  const manual = () => rate.value === "manual";

  gross.addEventListener("input", () => {
    const g = val(gross); if (Number.isNaN(g)) return;
    if (!manual()) { const r = fromGross(g, rate.value); set(net, r.net); set(vat, r.vat); }
    else if (!Number.isNaN(val(net))) set(vat, round2(g - val(net)));
  });
  net.addEventListener("input", () => {
    const n = val(net); if (Number.isNaN(n)) return;
    if (!manual()) { const r = fromNet(n, rate.value); set(vat, r.vat); set(gross, r.gross); }
    else set(gross, round2(n + (Number.isNaN(val(vat)) ? 0 : val(vat))));
  });
  vat.addEventListener("input", () => {
    const v = val(vat), n = val(net); if (Number.isNaN(v) || Number.isNaN(n)) return;
    set(gross, round2(n + v));
  });
  rate.addEventListener("change", () => {
    if (manual()) return;
    if (!Number.isNaN(val(gross))) { const r = fromGross(val(gross), rate.value); set(net, r.net); set(vat, r.vat); }
    else if (!Number.isNaN(val(net))) { const r = fromNet(val(net), rate.value); set(vat, r.vat); set(gross, r.gross); }
  });
  // početni prikaz kad je zadat samo ukupan iznos (raniji unos)
  if (!Number.isNaN(val(gross)) && Number.isNaN(val(net)) && !manual()) { const r = fromGross(val(gross), rate.value); set(net, r.net); set(vat, r.vat); }

  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));

  $("#inv-save").addEventListener("click", async () => {
    err.textContent = "";
    const data = {
      number: $("#inv-number").value.trim(), date: getISO($("#inv-date")),
      vatRate: manual() ? null : Number(rate.value),
      netAmount: val(net), vatAmount: val(vat), grossAmount: val(gross),
      currency: ctx.currency, note: $("#inv-note").value, source: INVOICE_SOURCE.RUCNO_UKUPNO,
      file: $("#inv-file").files?.[0] || null,
    };
    // PDV prazan = 0 (npr. račun bez PDV-a); osnovica prazna uz zadat ukupan iznos i stopu — izračunaj
    if (Number.isNaN(data.vatAmount)) data.vatAmount = 0;
    if (Number.isNaN(data.netAmount) && !Number.isNaN(data.grossAmount)) data.netAmount = round2(data.grossAmount - data.vatAmount);
    const others = invoices.filter((i) => i.supplierId === purchase.supplierId && i.id !== editing?.id).map((i) => i.number);
    const errors = validateInvoice({ number: data.number, net: data.netAmount, vat: data.vatAmount, gross: data.grossAmount }, { existingNumbers: others });
    const blocking = errors.filter((e) => e !== "duplicate_number");
    if (blocking.length) { err.textContent = t(`inv_err_${blocking[0]}`); return; }
    if (errors.includes("duplicate_number") && !confirm(t("inv_err_duplicate_number"))) return;
    const btn = $("#inv-save"); btn.disabled = true;
    try { await onSave(data); close(); }
    catch (e) { console.error(e); err.textContent = t("inv_save_error"); btn.disabled = false; }
  });
}
