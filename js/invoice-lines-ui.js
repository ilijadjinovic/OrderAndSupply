// ============================================================================
// RAČUN SA STAVKAMA — ekran za unos i USAGLAŠAVANJE (faza 2)
// Gore: stavke računa (naziv, količina, jedinična cena, rabat, PDV, iznos) i zbir; svaka stavka se UPARUJE sa
// artiklom iz narudžbine ili dobija rešenje "nema svog para" (dodatni trošak / višak).
// Dole: usaglašavanje po artiklu (naručeno · preuzeto · na računu). Naručene količine se NE menjaju;
// "Ispravi preuzeto" je predlog koji se primenjuje tek kad se unos potvrdi. Do tada račun može da stoji kao NACRT
// (ne ulazi u iznos nabavke). Logika: invoice-lines.js, invoice-match.js (testovi: tests/invoice-lines.test.mjs).
// ============================================================================
import { t } from "./i18n.js";
import { escapeHtml, toast, uid } from "./utils.js";
import { getISO, initDatepickers } from "./datepicker.js";
import { round2, parseAmount, INVOICE_SOURCE } from "./invoice-logic.js";
import {
  RESOLUTION, DEFAULT_VAT, MATCH_STATUS, lineAmounts, sumLines, lineProblems, isBlankLine, normalizeLine, linesFromItems, commonVatRate,
} from "./invoice-lines.js";
import { autoMatch, reconcile, suggestedPurchased, surplusRows } from "./invoice-match.js";

const h = escapeHtml;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "");
const qtyTxt = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000);

// ctx: { companyId, orderId, uid, profile, currency, money, items (svi artikli narudžbine), canCreateSurplus,
//        createSurplusOrder(rec, purchase, invoiceId) → Promise<{orderNumber}|null> }
// onSave(data, { corrections, draft, rec }) → Promise<{ id }>
export function openInvoiceLinesModal({ purchase, invoices, ctx, editing = null, onSave }) {
  const items = ctx.items.filter((i) => i.supplierId === purchase.supplierId);
  const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
  const st = {
    pricesIncludeVat: !!editing?.pricesIncludeVat,
    lines: (editing?.lines || []).map((l) => ({ ...l, resolution: l.resolution ?? RESOLUTION.NONE })),
    overrides: Object.fromEntries((editing?.pendingCorrections || []).map((c) => [c.itemId, Number(c.to)])),
    makeSurplus: false,
  };
  if (!st.lines.length) st.lines.push(blank());
  function blank() { return { id: uid("ln"), name: "", code: "", unit: "", qty: "", unitPrice: "", discountPct: 0, vatRate: DEFAULT_VAT, netOverride: null, resolution: RESOLUTION.NONE, link: null }; }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card wide" style="max-width:1220px;width:96vw;max-height:94vh;overflow:auto;">
      <div class="modal-head"><h2>${editing ? t("inv_edit_title") : t("inv_lines_title")}</h2><button type="button" class="icon-btn" data-close>✕</button></div>
      <p class="muted" style="margin-top:0;">${h(purchase.supplierName || "")}</p>
      <div class="form-row">
        <div class="field"><label>${t("receipt_number_label")} *</label><input type="text" id="il-number" value="${h(editing?.number || "")}" /></div>
        <div class="field"><label>${t("receipt_date_label")}</label><input type="text" class="js-datepicker" id="il-date" data-value="${h(editing?.date || "")}" /></div>
        <div class="field" style="align-self:end;"><label style="display:flex;gap:8px;align-items:center;cursor:pointer;"><input type="checkbox" id="il-incl" ${st.pricesIncludeVat ? "checked" : ""} /> ${t("inv_prices_incl_vat")}</label></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;">
        <button type="button" class="btn btn-sm btn-outline" id="il-add">＋ ${t("inv_add_line")}</button>
        <button type="button" class="btn btn-sm btn-outline" id="il-fill">📋 ${t("inv_fill_from_order")}</button>
        <button type="button" class="btn btn-sm btn-outline" id="il-match">🔗 ${t("inv_auto_match")}</button>
      </div>
      <div class="table-wrap"><table class="data-table" id="il-table">
        <thead><tr><th>#</th><th>${t("inv_col_name")}</th><th>${t("inv_col_code")}</th><th>${t("inv_col_qty")}</th><th>${t("inv_col_unit")}</th><th>${t("inv_col_price")}</th><th>${t("inv_col_discount")}</th><th>${t("inv_col_vat")}</th><th>${t("inv_col_net")}</th><th>${t("inv_col_gross")}</th><th>${t("inv_col_link")}</th><th></th></tr></thead>
        <tbody id="il-body"></tbody>
      </table></div>
      <div style="margin:12px 0;display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;">
        <div id="il-sumbox"></div>
        <div class="field" style="max-width:260px;"><label>${t("inv_control_gross")} (${h(ctx.currency)})</label>
          <input type="text" inputmode="decimal" id="il-control" value="${h(editing?.controlGross ?? "")}" />
          <div id="il-diff" style="font-size:12px;margin-top:4px;"></div></div>
      </div>
      <h3 style="margin:16px 0 6px;">${t("inv_reconcile_title")} <span id="il-match-badge"></span></h3>
      <div id="il-recon"></div>
      <div class="field" style="margin-top:12px;"><label>${t("note")}</label><input type="text" id="il-note" value="${h(editing?.note || "")}" /></div>
      <div class="field"><label>${t("inv_file_label")}</label><input type="file" id="il-file" accept="image/*,application/pdf" /></div>
      <div id="il-error" style="color:var(--color-danger,#c0392b);font-size:13px;min-height:18px;margin:6px 0;"></div>
      <div class="modal-actions" style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" class="btn btn-outline" data-close>${t("cancel")}</button>
        <button type="button" class="btn btn-outline" id="il-draft">📝 ${t("inv_btn_draft")}</button>
        <button type="button" class="btn btn-primary" id="il-confirm">✔ ${t("inv_btn_confirm")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  initDatepickers(overlay);
  const $ = (s) => overlay.querySelector(s);
  const opts = () => ({ pricesIncludeVat: st.pricesIncludeVat });
  const setHeaders = () => { const th = overlay.querySelectorAll("#il-table thead th"); th[8].textContent = t(st.pricesIncludeVat ? "inv_col_gross" : "inv_col_net"); th[9].textContent = t(st.pricesIncludeVat ? "inv_col_net" : "inv_col_gross"); };

  // ---------- stavke ----------
  const linkOptions = (l) => {
    const sel = l.resolution === RESOLUTION.ITEM ? `item:${l.link}` : l.resolution;
    const o = (v, label) => `<option value="${h(v)}" ${sel === v ? "selected" : ""}>${h(label)}</option>`;
    return `${o("", t("inv_link_none"))}
      <optgroup label="${h(t("inv_link_group_items"))}">${items.map((i) => o(`item:${i.id}`, `${i.substituteName || i.productName} (${qtyTxt(i.purchasedQty)} ${i.unit || ""})`)).join("")}</optgroup>
      <optgroup label="${h(t("inv_link_group_resolve"))}">${o(RESOLUTION.EXTRA, t("inv_link_extra"))}${o(RESOLUTION.SURPLUS, t("inv_link_surplus"))}</optgroup>`;
  };
  function renderLines() {
    $("#il-body").innerHTML = st.lines.map((l, i) => `
      <tr data-line="${l.id}">
        <td>${i + 1}</td>
        <td><input type="text" class="l-name" value="${h(l.name)}" style="min-width:170px;" /></td>
        <td><input type="text" class="l-code" value="${h(l.code || "")}" style="width:80px;" /></td>
        <td><input type="text" inputmode="decimal" class="l-qty" value="${h(l.qty ?? "")}" style="width:70px;" /></td>
        <td><input type="text" class="l-unit" value="${h(l.unit || "")}" style="width:50px;" /></td>
        <td><input type="text" inputmode="decimal" class="l-price" value="${h(l.unitPrice ?? "")}" style="width:90px;" /></td>
        <td><input type="text" inputmode="decimal" class="l-disc" value="${h(l.discountPct ?? 0)}" style="width:55px;" /></td>
        <td><select class="l-vat" style="width:70px;">${[20, 10, 0].map((r) => `<option value="${r}" ${Number(l.vatRate) === r ? "selected" : ""}>${r}%</option>`).join("")}</select></td>
        <td><input type="text" inputmode="decimal" class="l-net" value="" style="width:100px;" /></td>
        <td class="mono l-gross"></td>
        <td style="min-width:210px;"><select class="l-link" style="width:100%;">${linkOptions(l)}</select> <span class="l-badge"></span></td>
        <td><button type="button" class="btn btn-sm btn-ghost l-del" title="${h(t("inv_row_remove"))}">🗑</button></td>
      </tr>`).join("");
    setHeaders();
    st.lines.forEach(refreshLine);
    refreshAll();
  }
  function refreshLine(l) {
    const tr = $(`tr[data-line="${l.id}"]`); if (!tr) return;
    const a = lineAmounts(l, opts());
    const netInp = tr.querySelector(".l-net");
    if (document.activeElement !== netInp) netInp.value = l.netOverride != null && l.netOverride !== "" ? String(l.netOverride) : (a.valid ? fmt(st.pricesIncludeVat ? a.gross : a.net) : "");
    tr.querySelector(".l-gross").textContent = a.valid ? fmt(st.pricesIncludeVat ? a.net : a.gross) : "—";
    const unresolved = l.resolution === RESOLUTION.NONE || (l.resolution === RESOLUTION.ITEM && !l.link);
    tr.querySelector(".l-badge").innerHTML = unresolved && !isBlankLine(l) ? `<span class="badge badge-amber">${t("inv_no_pair_badge")}</span>` : "";
    tr.style.background = unresolved && !isBlankLine(l) ? "var(--accent-amber-100, #fff7e6)" : "";
  }
  const real = () => st.lines.filter((l) => !isBlankLine(l));

  // ---------- zbir + usaglašavanje ----------
  const controlGross = () => parseAmount($("#il-control")?.value);
  function refreshTotals() {
    const s = sumLines(real(), opts());
    const ctrl = controlGross();
    const diff = Number.isNaN(ctrl) ? null : round2(ctrl - s.gross);
    $("#il-sumbox").innerHTML = `
      <div class="muted" style="font-size:12px;">${t("inv_totals_title")}</div>
      <table class="data-table" style="width:auto;"><tbody>
        <tr><td>${t("inv_net")}</td><td class="mono">${ctx.money(s.net)}</td></tr>
        ${s.byRate.map((r) => `<tr><td>${t("inv_vat_at_rate", { rate: r.rate })}</td><td class="mono">${ctx.money(r.vat)}</td></tr>`).join("")}
        <tr><td><strong>${t("inv_gross")}</strong></td><td class="mono"><strong>${ctx.money(s.gross)}</strong></td></tr>
      </tbody></table>`;
    const d = $("#il-diff");
    d.style.color = diff === null ? "inherit" : Math.abs(diff) < 0.015 ? "var(--color-success,#1e8449)" : "var(--color-danger,#c0392b)";
    d.textContent = diff === null ? "" : Math.abs(diff) < 0.015 ? t("inv_control_ok") : t("inv_control_diff", { diff: fmt(diff) });
    return s;
  }
  const rec = () => reconcile({ items, lines: real().map((l) => ({ ...l, qty: parseAmount(l.qty) })), overrides: st.overrides });
  function refreshRecon() {
    const r = rec();
    const statusTxt = (x) => ({
      ok: `✅ ${t("inv_rec_ok")}`,
      less: `⚠ ${t("inv_rec_less", { diff: qtyTxt(x.diff) })}`,
      more: `⚠ ${t("inv_rec_more", { diff: qtyTxt(x.diff) })}`,
      missing_on_invoice: `❌ ${t("inv_rec_missing")}`,
    })[x.status];
    const shown = r.rows.filter((x) => x.ordered || x.purchased || x.invoiced);
    const surplus = surplusRows(r, purchase);
    const canSurplus = surplus.shortages.length > 0;
    $("#il-match-badge").innerHTML = `<span class="badge ${r.status === MATCH_STATUS.OK ? "badge-green" : r.status === MATCH_STATUS.RAZLIKE ? "badge-amber" : "badge-gray"}">${t(r.status === MATCH_STATUS.OK ? "inv_match_ok" : r.status === MATCH_STATUS.RAZLIKE ? "inv_match_diff" : "inv_match_no")}</span>`;
    $("#il-recon").innerHTML = `
      ${!shown.length ? `<p class="muted">${t("inv_items_none")}</p>` : `
      <div class="table-wrap"><table class="data-table"><thead><tr><th>${t("item_label")}</th><th>${t("inv_rec_ordered")}</th><th>${t("inv_rec_purchased")}</th><th>${t("inv_rec_invoiced")}</th><th>${t("inv_rec_status")}</th><th></th></tr></thead>
      <tbody>${shown.map((x) => `
        <tr>
          <td>${h(x.item.substituteName || x.item.productName)} <span class="muted" style="font-size:12px;">${h(x.item.unit || "")}</span></td>
          <td class="mono">${qtyTxt(x.ordered)}</td>
          <td class="mono">${x.corrected ? `<s class="muted">${qtyTxt(x.purchased)}</s> <strong>${qtyTxt(x.effectivePurchased)}</strong>` : qtyTxt(x.purchased)}</td>
          <td class="mono">${qtyTxt(x.invoiced)}</td>
          <td>${statusTxt(x)}</td>
          <td style="white-space:nowrap;">${x.corrected
            ? `<a href="#" data-undo="${x.item.id}">${t("inv_rec_undo")}</a>`
            : x.status !== "ok" ? `<button type="button" class="btn btn-sm btn-outline" data-fix="${x.item.id}">${t("inv_rec_fix", { qty: qtyTxt(suggestedPurchased(x)) })}</button>` : ""}</td>
        </tr>`).join("")}</tbody></table></div>`}
      ${r.unresolved.length ? `<p style="color:var(--color-warning,#b9770e);">⚠ ${t("inv_rec_unresolved", { n: r.unresolved.length })}</p>` : ""}
      ${Object.keys(st.overrides).length ? `<p class="muted" style="font-size:12px;">${t("inv_rec_note_corrections")}</p>` : ""}
      ${canSurplus ? (ctx.canCreateSurplus
        ? `<label style="display:flex;gap:8px;align-items:center;cursor:pointer;margin-top:6px;"><input type="checkbox" id="il-surplus" ${st.makeSurplus ? "checked" : ""} /> ${t("inv_rec_surplus_make", { n: surplus.shortages.length })}</label>`
        : `<p class="muted" style="font-size:12px;">${t("inv_rec_surplus_note")}</p>`) : ""}`;
    $("#il-recon").querySelectorAll("[data-fix]").forEach((b) => b.addEventListener("click", () => {
      const x = rec().rows.find((y) => y.item.id === b.dataset.fix); st.overrides[b.dataset.fix] = suggestedPurchased(x); refreshRecon();
    }));
    $("#il-recon").querySelectorAll("[data-undo]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); delete st.overrides[a.dataset.undo]; refreshRecon(); }));
    $("#il-surplus")?.addEventListener("change", (e) => { st.makeSurplus = e.target.checked; });
    return r;
  }
  function refreshAll() { refreshTotals(); refreshRecon(); }

  // ---------- događaji ----------
  const lineOf = (el) => st.lines.find((x) => x.id === el.closest("tr").dataset.line);
  const body = $("#il-body");
  body.addEventListener("input", (e) => {
    const l = lineOf(e.target), c = e.target.classList;
    if (c.contains("l-name")) l.name = e.target.value;
    else if (c.contains("l-code")) l.code = e.target.value;
    else if (c.contains("l-unit")) l.unit = e.target.value;
    else if (c.contains("l-qty")) { l.qty = e.target.value; l.netOverride = null; }
    else if (c.contains("l-price")) { l.unitPrice = e.target.value; l.netOverride = null; }
    else if (c.contains("l-disc")) { l.discountPct = e.target.value; l.netOverride = null; }
    else if (c.contains("l-net")) l.netOverride = e.target.value === "" ? null : e.target.value;
    else return;
    refreshLine(l); refreshAll();
  });
  body.addEventListener("change", (e) => {
    const l = lineOf(e.target), c = e.target.classList;
    if (c.contains("l-vat")) { l.vatRate = Number(e.target.value); refreshLine(l); refreshAll(); }
    else if (c.contains("l-link")) {
      const v = e.target.value;
      if (v.startsWith("item:")) { l.resolution = RESOLUTION.ITEM; l.link = v.slice(5); const it = itemById[l.link]; if (it && !l.unit) l.unit = it.unit || ""; }
      else { l.resolution = v; l.link = null; }
      renderLines();
    }
  });
  body.addEventListener("click", (e) => {
    if (!e.target.closest(".l-del")) return;
    st.lines = st.lines.filter((x) => x.id !== lineOf(e.target).id);
    if (!st.lines.length) st.lines.push(blank());
    renderLines();
  });
  $("#il-control").addEventListener("input", refreshTotals);
  $("#il-add").addEventListener("click", () => { st.lines.push(blank()); renderLines(); body.querySelector("tr:last-child .l-name")?.focus(); });
  $("#il-fill").addEventListener("click", () => {
    const have = new Set(st.lines.filter((l) => l.resolution === RESOLUTION.ITEM).map((l) => l.link));
    const add = linesFromItems(items.filter((i) => !have.has(i.id)), () => uid("ln"));
    st.lines = st.lines.filter((l) => !isBlankLine(l)).concat(add);
    if (!st.lines.length) st.lines.push(blank());
    renderLines();
  });
  $("#il-match").addEventListener("click", () => {
    const found = autoMatch(real(), items);
    found.forEach((m) => { const l = st.lines.find((x) => x.id === m.lineId); l.resolution = RESOLUTION.ITEM; l.link = m.itemId; });
    toast(t("toast_inv_auto_matched", { n: found.length }), found.length ? "success" : "error");
    renderLines();
  });
  $("#il-incl").addEventListener("change", (e) => { st.pricesIncludeVat = e.target.checked; st.lines.forEach((l) => { l.netOverride = null; }); renderLines(); });

  const close = () => overlay.remove();
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));

  // ---------- čuvanje ----------
  async function save(draft) {
    const err = $("#il-error"); err.textContent = "";
    const number = $("#il-number").value.trim();
    if (!number) { err.textContent = t("inv_err_number_required"); return; }
    const lines = real();
    if (!draft) {
      if (!lines.length) { err.textContent = t("inv_err_lines_required"); return; }
      const bad = st.lines.map((l, i) => ({ l, i })).filter(({ l }) => !isBlankLine(l) && lineProblems(l, opts()).length);
      if (bad.length) { err.textContent = t("inv_err_line_problem", { n: bad[0].i + 1 }); return; }
    }
    const r = rec();
    if (!draft && r.unresolved.length) { err.textContent = t("inv_err_unresolved"); return; }
    const totals = sumLines(lines, opts());
    const ctrl = controlGross();
    if (!draft) {
      if (!(totals.gross > 0)) { err.textContent = t("inv_err_gross_required"); return; }
      if (!Number.isNaN(ctrl) && Math.abs(ctrl - totals.gross) >= 0.015 && !confirm(t("inv_confirm_control_diff", { sum: ctx.money(totals.gross), control: ctx.money(ctrl) }))) return;
      if (r.differences.length && !confirm(t("inv_confirm_differences", { n: r.differences.length }))) return;
    }
    const corrections = Object.entries(st.overrides).map(([itemId, to]) => ({ itemId, name: itemById[itemId]?.productName || "", from: Number(itemById[itemId]?.purchasedQty) || 0, to }));
    const data = {
      number, date: getISO($("#il-date")), note: $("#il-note").value, currency: ctx.currency, source: INVOICE_SOURCE.FAKTURA,
      lines: lines.map((l) => normalizeLine({ ...l, id: l.id }, opts())), pricesIncludeVat: st.pricesIncludeVat,
      controlGross: Number.isNaN(ctrl) ? null : ctrl, vatRate: commonVatRate(lines),
      netAmount: totals.net, vatAmount: totals.vat, grossAmount: totals.gross,
      matchStatus: r.status, draft, pendingCorrections: draft ? corrections : [], file: $("#il-file").files?.[0] || null,
    };
    if (draft && !data.lines.length) { err.textContent = t("inv_err_lines_required"); return; }
    const btns = overlay.querySelectorAll("#il-draft, #il-confirm"); btns.forEach((b) => (b.disabled = true));
    try {
      const res = await onSave(data, { corrections: draft ? [] : corrections, draft });
      close();
      if (!draft && st.makeSurplus && ctx.canCreateSurplus) {
        try {
          const created = await ctx.createSurplusOrder(r, purchase, res?.id);
          if (created) toast(t("toast_surplus_order_created", { number: created.orderNumber || "" }), "success");
        } catch (e) { console.error(e); toast(t("toast_surplus_order_error"), "error"); }
      }
    } catch (e) { console.error(e); err.textContent = t("inv_save_error"); btns.forEach((b) => (b.disabled = false)); }
  }
  $("#il-draft").addEventListener("click", () => save(true));
  $("#il-confirm").addEventListener("click", () => save(false));

  renderLines();
}
