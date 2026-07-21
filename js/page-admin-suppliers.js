import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { listenSuppliers, addSupplier, deleteSupplier, addSupplierLocation, deleteSupplierLocation, getSupplierLocations } from "./suppliers.js";
import { escapeHtml, toast, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName, activeSupplierId, activeSupplierName;

requireAuth([ROLES.ADMIN], (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });
  listenSuppliers(companyId, render);
});

function render(suppliers) {
  const body = document.getElementById("suppliers-body");
  if (!suppliers.length) { body.innerHTML = `<tr class="empty-row"><td colspan="5">Nema dobavljača. Dodajte prvog dobavljača.</td></tr>`; return; }
  body.innerHTML = suppliers.map((s) => `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(s.contact || "—")}</td>
      <td>${escapeHtml(s.phone || "—")}</td>
      <td>${escapeHtml(s.email || "—")}</td>
      <td>
        <button class="btn btn-sm btn-outline" data-action="locations" data-id="${s.id}" data-name="${escapeHtml(s.name)}">📍 Lokacije</button>
        <a class="btn btn-sm btn-outline" href="./admin-catalog.html?supplier=${s.id}">📦 Katalog</a>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${s.id}">Obriši</button>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-action=delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Obrisati dobavljača?")) return;
      await deleteSupplier(companyId, btn.dataset.id);
      toast("Dobavljač obrisan.", "success");
    });
  });
  body.querySelectorAll("button[data-action=locations]").forEach((btn) => {
    btn.addEventListener("click", () => openLocations(btn.dataset.id, btn.dataset.name));
  });
}

const supplierModal = document.getElementById("supplier-modal");
document.getElementById("new-supplier-btn").addEventListener("click", () => supplierModal.classList.remove("hidden"));
document.getElementById("close-supplier-modal").addEventListener("click", () => supplierModal.classList.add("hidden"));
document.getElementById("supplier-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addSupplier(companyId, {
    name: document.getElementById("s-name").value.trim(),
    contact: document.getElementById("s-contact").value.trim(),
    phone: document.getElementById("s-phone").value.trim(),
    email: document.getElementById("s-email").value.trim(),
    actorName,
  });
  toast("Dobavljač dodat.", "success");
  supplierModal.classList.add("hidden");
  e.target.reset();
});

const locationModal = document.getElementById("location-modal");
document.getElementById("close-location-modal").addEventListener("click", () => locationModal.classList.add("hidden"));

async function openLocations(supplierId, name) {
  activeSupplierId = supplierId; activeSupplierName = name;
  document.querySelector("#location-modal h2").textContent = `Lokacije preuzimanja — ${name}`;
  locationModal.classList.remove("hidden");
  await refreshLocations();
}

async function refreshLocations() {
  const locs = await getSupplierLocations(companyId, activeSupplierId);
  const host = document.getElementById("location-list");
  host.innerHTML = locs.length
    ? locs.map((l) => `<div class="attachment-item"><span>📍 ${escapeHtml(l.name)} ${l.address ? "— " + escapeHtml(l.address) : ""}</span><button class="btn btn-sm btn-danger" data-id="${l.id}" style="margin-left:auto;">✕</button></div>`).join("")
    : `<p class="muted">Nema dodatih lokacija — koristiće se "bilo koja lokacija".</p>`;
  host.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteSupplierLocation(companyId, activeSupplierId, btn.dataset.id);
      refreshLocations();
    });
  });
}

document.getElementById("location-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addSupplierLocation(companyId, activeSupplierId, {
    name: document.getElementById("l-name").value.trim(),
    address: document.getElementById("l-address").value.trim(),
  });
  e.target.reset();
  refreshLocations();
});
