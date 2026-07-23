import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { listenCompanyUsers, createCompanyUser, updateCompanyUser } from "./users.js";
import { escapeHtml, toast, ROLES, ROLE_LABELS } from "./utils.js";

await loadLang();
let companyId, currentName;

requireAuth([ROLES.ADMIN], (user, profile) => {
  companyId = profile.companyId;
  currentName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });
  listenCompanyUsers(companyId, renderUsers);
});

function renderUsers(users) {
  const body = document.getElementById("users-body");
  if (!users.length) { body.innerHTML = `<tr class="empty-row"><td colspan="5">Nema korisnika.</td></tr>`; return; }
  body.innerHTML = users.map((u) => `
    <tr>
      <td><strong>${escapeHtml(u.name)}</strong></td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge badge-blue">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td>${u.active === false ? '<span class="badge badge-red">Neaktivan</span>' : '<span class="badge badge-teal">Aktivan</span>'}</td>
      <td><button class="btn btn-sm btn-outline" data-id="${u.id}" data-active="${u.active !== false}">${u.active === false ? "Aktiviraj" : "Deaktiviraj"}</button></td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateCompanyUser(companyId, btn.dataset.id, { active: btn.dataset.active !== "true" });
      toast("Status korisnika je ažuriran.", "success");
    });
  });
}

const modal = document.getElementById("user-modal");
document.getElementById("new-user-btn").addEventListener("click", () => modal.classList.remove("hidden"));
document.getElementById("close-modal").addEventListener("click", () => modal.classList.add("hidden"));

document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await createCompanyUser(companyId, {
      name: document.getElementById("u-name").value.trim(),
      email: document.getElementById("u-email").value.trim(),
      password: document.getElementById("u-password").value,
      role: document.getElementById("u-role").value,
      actorName: currentName,
    });
    toast("Korisnik je kreiran.", "success");
    modal.classList.add("hidden");
    e.target.reset();
  } catch (err) {
    console.error(err);
    toast(err.message || "Greška pri kreiranju korisnika.", "error");
  } finally {
    btn.disabled = false;
  }
});
