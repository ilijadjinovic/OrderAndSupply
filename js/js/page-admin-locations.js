import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { listenLocations, addLocation, deleteLocation } from "./locations.js";
import { escapeHtml, toast, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName;

requireAuth([ROLES.ADMIN], (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });
  listenLocations(companyId, render);
});

function render(locations) {
  const body = document.getElementById("loc-body");
  if (!locations.length) { body.innerHTML = `<tr class="empty-row"><td colspan="3">Nema lokacija.</td></tr>`; return; }
  body.innerHTML = locations.map((l) => `
    <tr>
      <td><strong>${escapeHtml(l.name)}</strong></td>
      <td>${escapeHtml(l.address || "—")}</td>
      <td><button class="btn btn-sm btn-danger" data-id="${l.id}">Obriši</button></td>
    </tr>
  `).join("");
  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Obrisati lokaciju?")) return;
      await deleteLocation(companyId, btn.dataset.id);
      toast("Lokacija obrisana.", "success");
    });
  });
}

document.getElementById("loc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addLocation(companyId, { name: document.getElementById("loc-name").value.trim(), address: document.getElementById("loc-address").value.trim(), actorName });
  toast("Lokacija dodata.", "success");
  e.target.reset();
});
