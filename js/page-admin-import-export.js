import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { getSuppliers, addSupplier } from "./suppliers.js";
import { addProduct } from "./catalog.js";
import { getAllOrdersOnce } from "./reports.js";
import { importFile, exportCsv, exportExcel, exportPdf } from "./import-export.js";
import { escapeHtml, toast, formatDate, ORDER_STATUS_LABELS, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName;

requireAuth([ROLES.ADMIN], async (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });
  const suppliers = await getSuppliers(companyId);
  document.getElementById("import-supplier").innerHTML = suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
});

document.getElementById("import-type").addEventListener("change", (e) => {
  document.getElementById("import-supplier-field").classList.toggle("hidden", e.target.value !== "products");
});

document.getElementById("import-btn").addEventListener("click", async () => {
  const file = document.getElementById("import-file").files[0];
  if (!file) { toast("Izaberite fajl.", "error"); return; }
  const type = document.getElementById("import-type").value;
  const rows = await importFile(file);
  document.getElementById("import-preview").innerHTML = `<p class="muted">Pronađeno ${rows.length} redova. Uvozim...</p>`;

  let count = 0;
  if (type === "suppliers") {
    for (const r of rows) {
      if (!r.name && !r.Naziv) continue;
      await addSupplier(companyId, { name: r.name || r.Naziv, contact: r.contact || r.Kontakt || "", phone: r.phone || r.Telefon || "", email: r.email || r.Email || "", actorName });
      count++;
    }
  } else {
    const supplierId = document.getElementById("import-supplier").value;
    if (!supplierId) { toast("Izaberite dobavljača za uvoz proizvoda.", "error"); return; }
    for (const r of rows) {
      const name = r.name || r.Naziv;
      if (!name) continue;
      await addProduct(companyId, supplierId, {
        name, code: r.code || r.Sifra || "", barcode: r.barcode || r.Barkod || "",
        unit: r.unit || r.JedinicaMere || "kom", vatRate: Number(r.vatRate || r.PDV || 20),
        minQuantity: Number(r.minQuantity || r.MinKolicina || 1), actorName,
      });
      count++;
    }
  }
  document.getElementById("import-preview").innerHTML = `<p style="color:var(--accent-teal);font-weight:700;">✓ Uvezeno ${count} stavki.</p>`;
  toast("Uvoz završen.", "success");
});

document.getElementById("export-csv").addEventListener("click", async () => exportCsv("narudzbine", await getExportRows()));
document.getElementById("export-excel").addEventListener("click", async () => exportExcel("narudzbine", await getExportRows()));
document.getElementById("export-pdf").addEventListener("click", async () => exportPdf("narudzbine", "Narudžbine", await getExportRows()));

async function getExportRows() {
  const orders = await getAllOrdersOnce(companyId);
  return orders.map((o) => ({
    Broj: o.orderNumber, Naručilac: o.createdByName || "", Isporučilac: o.assignedToName || "",
    Prioritet: o.priority, Status: ORDER_STATUS_LABELS[o.status] || o.status, Kreirana: formatDate(o.createdAt),
  }));
}
