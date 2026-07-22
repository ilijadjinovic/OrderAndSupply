import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { getSuppliers } from "./suppliers.js";
import { getNarucioci, getIsporucioci } from "./users.js";
import { getCompanySettings } from "./settings.js";
import {
  buildReportDataset, applyReportFilters,
  aggregateByNarucilac, aggregateByIsporucilac, aggregateBySupplier, financialSummary,
} from "./reports.js";
import { exportCsv, exportExcel, exportPdf } from "./import-export.js";
import { escapeHtml, toast, formatDate, ROLES, ORDER_STATUS_LABELS, badgeClassForStatus } from "./utils.js";

await loadLang();

let companyId, actorName, currency = "RSD";
let fullDataset = [];   // narudžbine (sa items+purchases) unutar izabranog perioda, bez narucilac/isporucilac/dobavljac/status filtera
let filteredRows = [];  // posle primene svih filtera — osnova za sve tabove

requireAuth([ROLES.ADMIN], async (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });

  const settings = await getCompanySettings(companyId);
  currency = settings?.currency || "RSD";

  const [suppliers, narucioci, isporucioci] = await Promise.all([
    getSuppliers(companyId), getNarucioci(companyId), getIsporucioci(companyId),
  ]);

  document.getElementById("f-supplier").innerHTML += suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  document.getElementById("f-narucilac").innerHTML += narucioci.map((u) => `<option value="${u.uid}">${escapeHtml(u.name)}</option>`).join("");
  document.getElementById("f-isporucilac").innerHTML += isporucioci.map((u) => `<option value="${u.uid}">${escapeHtml(u.name)}</option>`).join("");
  document.getElementById("f-status").innerHTML += Object.entries(ORDER_STATUS_LABELS).map(([val, label]) => `<option value="${val}">${escapeHtml(label)}</option>`).join("");

  await runReport();
});

function fmtAmount(n) {
  return `${(Number(n) || 0).toLocaleString("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

async function runReport() {
  const dateFromVal = document.getElementById("f-date-from").value;
  const dateToVal = document.getElementById("f-date-to").value;
  const dateFrom = dateFromVal ? new Date(dateFromVal + "T00:00:00") : null;
  const dateTo = dateToVal ? new Date(dateToVal + "T23:59:59") : null;

  const btn = document.getElementById("run-report-btn");
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Učitavanje...";
  try {
    fullDataset = await buildReportDataset(companyId, { dateFrom, dateTo });
    applyFiltersAndRender();
  } catch (err) {
    console.error(err);
    toast("Greška pri učitavanju izveštaja.", "error");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

function applyFiltersAndRender() {
  filteredRows = applyReportFilters(fullDataset, {
    narucilacUid: document.getElementById("f-narucilac").value,
    isporucilacUid: document.getElementById("f-isporucilac").value,
    supplierId: document.getElementById("f-supplier").value,
    status: document.getElementById("f-status").value,
  });
  document.getElementById("report-meta").textContent = `${filteredRows.length} narudžbina u izveštaju.`;
  renderOrdersTab();
  renderNarucioci();
  renderIsporucioci();
  renderSuppliersTab();
  renderFinanceTab();
}

// --------------------------------------------------------------- PO NARUDŽBENICAMA
function renderOrdersTab() {
  const body = document.getElementById("orders-body");
  if (!filteredRows.length) { body.innerHTML = `<tr class="empty-row"><td colspan="7">Nema narudžbina za izabrane filtere.</td></tr>`; return; }
  body.innerHTML = filteredRows.map((r) => `
    <tr>
      <td class="mono"><a href="./order-detail.html?order=${r.id}">${escapeHtml(r.orderNumber)}</a></td>
      <td>${formatDate(r.createdAt)}</td>
      <td>${escapeHtml(r.createdByName || "—")}</td>
      <td>${escapeHtml(r.assignedToName || "—")}</td>
      <td><span class="badge ${badgeClassForStatus(r.status)}">${escapeHtml(ORDER_STATUS_LABELS[r.status] || r.status)}</span></td>
      <td>${r.itemCount ?? (r.items || []).length}</td>
      <td>${r.total > 0 ? `<strong>${fmtAmount(r.total)}</strong>` : "—"}</td>
    </tr>
  `).join("");
}

// --------------------------------------------------------------- PO NARUČIOCIMA
function renderNarucioci() {
  const body = document.getElementById("narucioci-body");
  const agg = aggregateByNarucilac(filteredRows);
  if (!agg.length) { body.innerHTML = `<tr class="empty-row"><td colspan="3">Nema podataka.</td></tr>`; return; }
  body.innerHTML = agg.map((a) => `
    <tr><td>${escapeHtml(a.name)}</td><td>${a.orderCount}</td><td><strong>${fmtAmount(a.total)}</strong></td></tr>
  `).join("");
}

// --------------------------------------------------------------- PO ISPORUČIOCIMA
function renderIsporucioci() {
  const body = document.getElementById("isporucioci-body");
  const agg = aggregateByIsporucilac(filteredRows);
  if (!agg.length) { body.innerHTML = `<tr class="empty-row"><td colspan="3">Nema podataka.</td></tr>`; return; }
  body.innerHTML = agg.map((a) => `
    <tr><td>${escapeHtml(a.name)}</td><td>${a.orderCount}</td><td><strong>${fmtAmount(a.total)}</strong></td></tr>
  `).join("");
}

// --------------------------------------------------------------- PO DOBAVLJAČIMA
function renderSuppliersTab() {
  const body = document.getElementById("suppliers-body-report");
  const agg = aggregateBySupplier(filteredRows);
  if (!agg.length) { body.innerHTML = `<tr class="empty-row"><td colspan="3">Nema podataka.</td></tr>`; return; }
  body.innerHTML = agg.map((a) => `
    <tr><td>${escapeHtml(a.name)}</td><td>${a.orderCount}</td><td><strong>${fmtAmount(a.total)}</strong></td></tr>
  `).join("");
}

// --------------------------------------------------------------- FINANSIJSKI PREGLED
function renderFinanceTab() {
  const s = financialSummary(filteredRows);
  document.getElementById("finance-stats").innerHTML = `
    <div class="stat-card"><div class="stat-label">Ukupno narudžbina</div><div class="stat-value">${s.totalOrders}</div></div>
    <div class="stat-card teal"><div class="stat-label">Sa unetim iznosom</div><div class="stat-value">${s.ordersWithFinance}</div></div>
    <div class="stat-card amber"><div class="stat-label">Bez unetog iznosa</div><div class="stat-value">${s.ordersWithoutFinance}</div></div>
    <div class="stat-card"><div class="stat-label">Ukupan iznos</div><div class="stat-value" style="font-size:22px;">${fmtAmount(s.totalAmount)}</div></div>
  `;
}

// --------------------------------------------------------------- IZVOZ
function rowsForExport(view) {
  if (view === "orders") {
    return filteredRows.map((r) => ({
      "Broj narudžbine": r.orderNumber,
      "Datum": formatDate(r.createdAt),
      "Naručilac": r.createdByName || "—",
      "Isporučilac": r.assignedToName || "—",
      "Status": ORDER_STATUS_LABELS[r.status] || r.status,
      "Broj artikala": r.itemCount ?? (r.items || []).length,
      [`Ukupan iznos (${currency})`]: r.total.toFixed(2),
    }));
  }
  if (view === "narucioci") {
    return aggregateByNarucilac(filteredRows).map((a) => ({ "Naručilac": a.name, "Broj narudžbina": a.orderCount, [`Ukupan iznos (${currency})`]: a.total.toFixed(2) }));
  }
  if (view === "isporucioci") {
    return aggregateByIsporucilac(filteredRows).map((a) => ({ "Isporučilac": a.name, "Broj narudžbina": a.orderCount, [`Ukupan iznos (${currency})`]: a.total.toFixed(2) }));
  }
  if (view === "suppliers") {
    return aggregateBySupplier(filteredRows).map((a) => ({ "Dobavljač": a.name, "Broj narudžbina": a.orderCount, [`Ukupno plaćeno (${currency})`]: a.total.toFixed(2) }));
  }
  return [];
}

document.querySelectorAll("button[data-export]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const view = btn.dataset.view;
    const rows = rowsForExport(view);
    if (!rows.length) { toast("Nema podataka za izvoz.", "error"); return; }
    const filename = `izvestaj-${view}-${new Date().toISOString().slice(0, 10)}`;
    try {
      if (btn.dataset.export === "csv") exportCsv(filename, rows);
      if (btn.dataset.export === "excel") await exportExcel(filename, rows, "Izveštaj");
      if (btn.dataset.export === "pdf") await exportPdf(filename, "Izveštaj — po narudžbenicama", rows);
    } catch (err) {
      console.error(err);
      toast("Greška pri izvozu.", "error");
    }
  });
});

// --------------------------------------------------------------- TABOVI + FILTERI
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    ["orders", "narucioci", "isporucioci", "suppliers", "finance"].forEach((tab) => {
      document.getElementById(`tab-${tab}`).classList.toggle("hidden", btn.dataset.tab !== tab);
    });
  });
});

document.getElementById("run-report-btn").addEventListener("click", runReport);
document.getElementById("reset-filters-btn").addEventListener("click", () => {
  document.getElementById("f-date-from").value = "";
  document.getElementById("f-date-to").value = "";
  document.getElementById("f-narucilac").value = "";
  document.getElementById("f-isporucilac").value = "";
  document.getElementById("f-supplier").value = "";
  document.getElementById("f-status").value = "";
  runReport();
});
// Filteri koji ne zahtevaju ponovno učitavanje iz baze (narucilac/isporucilac/dobavljac/status)
// primenjuju se odmah nad već učitanim setom narudžbina za izabrani period.
["f-narucilac", "f-isporucilac", "f-supplier", "f-status"].forEach((id) => {
  document.getElementById(id).addEventListener("change", applyFiltersAndRender);
});
