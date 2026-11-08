// ============================================================================
// TABLE-POPOVERS — sadržaj plutajućih balona za ostale tabele aplikacije
// (dobavljači, katalog, lokacije, šabloni, korisnici, firme, dnevnik, stavke narudžbine).
// Funkcije samo prave HTML iz podataka koje stranica već ima; priključivanje na tabelu
// radi stranica preko attachRowPopover (vidi row-popover.js).
// ============================================================================
import { t } from "./i18n.js";
import { escapeHtml, formatDate, roleLabel } from "./utils.js";
import { popHead, popKv, popSection, popList, popEmpty } from "./row-popover.js";

const hasCoords = (o) => Number.isFinite(Number(o?.lat)) && Number.isFinite(Number(o?.lng)) && o?.lat !== null && o?.lng !== null && o?.lat !== "" && o?.lng !== "";
const badge = (cls, text) => `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
const sec = (label, html) => (html ? popSection(label) + html : "");

// Oznaka tačnosti koordinata: ✅ tačno / ručno · ⚠ približno · ❌ bez koordinata (isto kao coordsBadgeHtml u geo-ui.js)
function geoMark(o) {
  if (!hasCoords(o)) return "❌";
  return o.geoSource === "manual" || o.geoQuality === "tacno" ? "✅" : "⚠";
}
function geoLabel(o) {
  if (!hasCoords(o)) return t("geo_no_coords");
  return o.geoSource === "manual" ? t("geo_q_manual") : t(`geo_q_${o.geoQuality || "naselje"}`);
}
const coordsText = (o) => `${Number(o.lat).toFixed(6)}, ${Number(o.lng).toFixed(6)}`;

// ---- Dobavljač (locs === null → lokacije se još učitavaju)
export function supplierPopHtml(s, locs) {
  const contact = [s.contact, s.phone].filter(Boolean).join(" · ");
  const head = popHead(s.name) + popKv([
    [t("pib_label"), s.pib], [t("company_id_label"), s.maticniBroj],
    [t("contact_person_label"), contact], [t("email"), s.email],
    [t("address_label"), s.address], [t("working_hours_label"), s.workingHours], [t("note_label"), s.note],
  ]);
  if (locs === null) return head + popEmpty(t("loading_ellipsis"));
  const rows = locs.map((l) => [
    { html: `${escapeHtml(l.name || "—")}${l.address ? `<div class="items-pop-sub">${escapeHtml(l.address)}</div>` : ""}` },
    { html: `<span title="${escapeHtml(geoLabel(l))}">${geoMark(l)}</span>` },
  ]);
  return head + (rows.length ? sec(t("pickup_locations_title"), popList(rows, { max: 8 })) : sec(t("pickup_locations_title"), popEmpty(t("pop_no_locations"))));
}

// ---- Artikal kataloga
export function productPopHtml(p, categoryName, active) {
  return popHead(p.name, { badgeHtml: badge(active ? "badge-teal" : "badge-gray", active ? t("active") : t("product_passive")) })
    + popKv([
      [t("code"), p.code], [t("barcode"), p.barcode], [t("category"), categoryName],
      [t("unit"), p.unit], [t("vat_rate"), p.vatRate !== undefined && p.vatRate !== "" ? `${p.vatRate}%` : ""],
      [t("min_quantity"), p.minQuantity],
    ]);
}

// ---- Lokacija firme (magacin...)
export function locationPopHtml(l) {
  return popHead(l.name) + popKv([
    [t("address_label"), l.address],
    [t("geo_coords_col"), hasCoords(l) ? coordsText(l) : ""],
    [t("pop_geo_accuracy"), { html: `${geoMark(l)} ${escapeHtml(geoLabel(l))}` }],
    [t("pop_geo_updated"), hasCoords(l) && l.geoUpdatedAt ? formatDate(l.geoUpdatedAt) : ""],
  ]);
}

// ---- Šablon / lista
const DAY_KEYS = { ned: "day_sun", pon: "day_mon", uto: "day_tue", sre: "day_wed", cet: "day_thu", pet: "day_fri", sub: "day_sat" };
export function templatePopHtml(tp) {
  const days = (tp.recurringDays || []).map((d) => (DAY_KEYS[d] ? t(DAY_KEYS[d]) : d)).join(", ");
  const rows = (tp.items || []).map((i) => [i.productName, `${i.quantity ?? ""}${i.unit ? ` ${i.unit}` : ""}`.trim()]);
  return popHead(tp.name)
    + popKv([[t("recurrence_label"), tp.type === "ponavljajuca" ? (days || "—") : ""]])
    + (rows.length ? sec(t("items_count", { count: rows.length }), popList(rows, { max: 12 })) : popEmpty(t("items_pop_empty")));
}

// ---- Korisnik (samo podaci koji su već u listi)
export function userPopHtml(u) {
  return popHead(u.name, { badgeHtml: u.active === false ? badge("badge-red", t("inactive")) : badge("badge-teal", t("active")) })
    + popKv([[t("email"), u.email], [t("role_label"), roleLabel(u.role)], [t("registered_label"), u.createdAt ? formatDate(u.createdAt) : ""]]);
}

// ---- Firma (master admin)
export function companyPopHtml(c) {
  const st = c.status || "active";
  const cls = st === "blocked" ? "badge-red" : st === "deleted" ? "badge-gray" : "badge-teal";
  const label = st === "blocked" ? t("blocked") : st === "deleted" ? t("company_status_deleted") : t("active");
  return popHead(c.name, { badgeHtml: badge(cls, label) })
    + popKv([[t("pib_label"), c.pib], [t("company_id_label"), c.mb || c.maticniBroj], [t("email"), c.email], [t("phone_label"), c.phone], [t("address_label"), c.address],
      [t("registered_label"), c.createdAt ? formatDate(c.createdAt) : ""],
      ...(st === "blocked" && c.blockReason ? [[t("master_block_reason"), c.blockReason]] : [])]);
}

// ---- Zapis dnevnika (master admin): ceo zapis, uključujući pun tekst detalja
export function auditPopHtml(l, detailsText) {
  return popHead(l.action)
    + popKv([[t("pop_audit_time"), l.createdAt ? formatDate(l.createdAt) : ""], [t("pop_audit_who"), l.actorName || t("system_actor_fallback")], [t("pop_audit_details"), detailsText]]);
}

// ---- Stavka narudžbine (detalj narudžbine). purchase = nabavka istog dobavljača (ili undefined);
//      money = funkcija za prikaz iznosa
export function orderItemPopHtml(it, purchase, money) {
  const status = {
    na_cekanju: [t("item_status_pending"), "badge-gray"], kupljeno: [t("item_status_purchased"), "badge-teal"],
    nije_pronadjeno: [t("item_status_not_found"), "badge-red"], zamena: [t("substitution"), "badge-amber"],
  }[it.purchaseStatus];
  const qty = (n) => `${n}${it.unit ? ` ${it.unit}` : ""}`;
  const bought = it.purchaseStatus && it.purchaseStatus !== "na_cekanju" && it.purchasedQty !== undefined && it.purchasedQty !== null && it.purchasedQty !== "" ? qty(it.purchasedQty) : "";
  const receipt = purchase ? [purchase.receiptNumber, Number(purchase.paidAmount) ? money(purchase.paidAmount) : ""].filter(Boolean).join(" · ") : "";
  return popHead(it.productName, { badgeHtml: status ? badge(status[1], status[0]) : "" })
    + popKv([
      [t("code"), it.code], [t("supplier"), it.supplierName],
      [t("pickup_location_label"), it.pickupLocationId && it.pickupLocationId !== "any" ? it.pickupLocationName : ""],
      [t("delivery_label"), it.deliveryLocationName],
      [t("requested"), qty(it.quantity)], [t("purchased"), bought],
      [t("substitution"), it.substituteName], [t("note"), it.note], [t("receipt_number_label"), receipt],
    ]);
}
