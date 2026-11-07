// ============================================================================
// REPORT-POPOVERS — plutajući prikaz (balon) za redove tabela na stranici Izveštaji.
// Sve se računa iz već učitanih narudžbina (stavke + nabavke), pa nema novih čitanja.
//  • Po narudžbenicama: hover na prvu ćeliju (isti balon kao na kontrolnoj tabli + status i plaćeno)
//  • Po naručiocima / isporučiocima / dobavljačima / artiklima: hover na ceo red
// ============================================================================
import { t } from "./i18n.js";
import { statusLabel, formatDate } from "./utils.js";
import { attachRowPopover, popHead, popKv, popSection, popList } from "./row-popover.js";
import { orderPopoverHtml } from "./order-items-popover.js";
import { summarizeOrders, topBy, pickSuppliers, pickNarucilac, itemKey, parseQty, fmtQty } from "./report-logic.js";

// ctx: { getOrder(id), getAgg(tab), getSupplier(id), fmtAmount(n), locale() }
export function attachReportPopovers(ctx) {
  const { getOrder, getAgg, getSupplier, fmtAmount, locale } = ctx;
  const q = (n) => fmtQty(n, locale());
  const skipOpen = (row) => row.getAttribute("aria-expanded") === "true";   // otvoren red već prikazuje svoju listu

  // ---- Po narudžbenicama
  const ordersBody = document.getElementById("orders-body");
  attachRowPopover(ordersBody, {
    hoverSelector: "tr.rep-order-row > td:first-child",
    skip: () => document.getElementById("f-detailed").checked,   // „Detaljno": detalji su već ispod reda
    getContent: (row) => {
      const r = getOrder(row.dataset.id);
      if (!r) return "";
      // Plaćeno po dobavljaču (samo nabavke sa unetim iznosom)
      const paid = new Map();
      (r.purchases || []).forEach((p) => { if (Number(p.paidAmount)) paid.set(p.supplierName || "—", (paid.get(p.supplierName || "—") || 0) + Number(p.paidAmount)); });
      const rows = [...paid.entries()].map(([name, amount]) => [name, fmtAmount(amount)]);
      if (paid.size > 1) rows.push([t("order_total_label_caps"), fmtAmount(r.total)]);
      const footHtml = rows.length ? popSection(t("report_pop_paid")) + popList(rows, { max: 6 }) : "";
      return orderPopoverHtml(r, r.items || [], { withStatus: true, footHtml });
    },
  });

  // ---- Zajednički delovi agregatnih balona
  const sec = (label, html) => (html ? popSection(label) + html : "");   // odeljak se ne prikazuje ako je prazan
  const lastLine = (s) => (s.last ? formatDate(s.last) : "—");
  const statusRows = (s) => s.byStatus.map(({ status, count }) => [statusLabel(status), count]);
  const topRows = (arr, withQty = false) => arr.map((x) => [x.name, withQty ? `${q(x.weight)}${x.unit ? ` ${x.unit}` : ""}` : `${x.weight}×`]);

  const builders = {
    narucioci: (a) => {
      const s = summarizeOrders(a.orders);
      return popHead(a.name)
        + popKv([[t("export_col_order_count"), s.count], [t("export_col_total_amount"), fmtAmount(a.total)], [t("report_pop_last_order"), lastLine(s)]])
        + sec(t("report_pop_by_status"), popList(statusRows(s)))
        + sec(t("report_pop_top_suppliers"), popList(topRows(topBy(a.orders, pickSuppliers, 3))));
    },
    isporucioci: (a) => {
      const s = summarizeOrders(a.orders);
      return popHead(a.name)
        + popKv([[t("export_col_order_count"), s.count], [t("export_col_total_amount"), fmtAmount(a.total)], [t("report_pop_last_order"), lastLine(s)]])
        + sec(t("report_pop_by_status"), popList(statusRows(s)))
        + sec(t("report_pop_top_narucioci"), popList(topRows(topBy(a.orders, pickNarucilac, 3))))
        + sec(t("report_pop_top_suppliers"), popList(topRows(topBy(a.orders, pickSuppliers, 3))));
    },
    suppliers: (a) => {
      const s = summarizeOrders(a.orders);
      const sup = getSupplier(a.key);
      // Najtraženiji artikli OVOG dobavljača po ukupnoj količini
      const items = topBy(a.orders, (e) => (e.r.items || []).filter((it) => it.supplierId === a.key && itemKey(it))
        .map((it) => ({ key: itemKey(it), name: it.productName, unit: it.unit, weight: parseQty(it.quantity) })), 5);
      const contact = [sup?.contact, sup?.phone].filter(Boolean).join(" · ");
      return popHead(a.name)
        + popKv([[t("export_col_order_count"), s.count], [t("export_col_total_paid"), fmtAmount(a.total)], [t("report_pop_last_order"), lastLine(s)], [t("contact_person_label"), contact]])
        + sec(t("report_pop_top_items"), popList(topRows(items, true)));
    },
    items: (a) => {
      const s = summarizeOrders(a.orders);
      const who = topBy(a.orders, (e) => [{ key: e.r.createdByUid || e.r.createdByName, name: e.r.createdByName, weight: e.quantity }], 3);
      const from = topBy(a.orders, (e) => (e.r.items || []).filter((it) => itemKey(it) === a.key && it.supplierName)
        .map((it) => ({ key: it.supplierId || it.supplierName, name: it.supplierName, weight: parseQty(it.quantity) })), 3);
      const unit = a.unit ? ` ${a.unit}` : "";
      return popHead(a.name)
        + popKv([[t("code"), a.code], [t("report_col_total_quantity"), `${q(a.quantity)}${unit}`], [t("export_col_order_count"), s.count], [t("report_pop_last_order"), lastLine(s)]])
        + sec(t("report_pop_top_narucioci"), popList(who.map((x) => [x.name, `${q(x.weight)}${unit}`])))
        + sec(t("report_pop_top_suppliers"), popList(from.map((x) => [x.name, `${q(x.weight)}${unit}`])));
    },
  };

  const bodyIds = { narucioci: "narucioci-body", isporucioci: "isporucioci-body", suppliers: "suppliers-body-report", items: "items-body" };
  Object.entries(bodyIds).forEach(([tab, id]) => {
    attachRowPopover(document.getElementById(id), {
      hoverSelector: "tr.rep-drill-toggle",
      skip: skipOpen,
      getContent: (row) => {
        const a = (getAgg(tab) || []).find((x) => x.key === row.dataset.key);
        return a ? builders[tab](a) : "";
      },
    });
  });
}
