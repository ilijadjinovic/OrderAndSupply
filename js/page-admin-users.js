import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { listenCompanyUsers, createCompanyUser, updateCompanyUser } from "./users.js";
import { escapeHtml, toast, ROLES, roleLabel } from "./utils.js";

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
  if (!users.length) { body.innerHTML = `<tr class="empty-row"><td colspan="5">${t("no_users")}</td></tr>`; return; }
  body.innerHTML = users.map((u) => `
    <tr>
      <td><strong>${escapeHtml(u.name)}</strong></td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge badge-blue">${roleLabel(u.role)}</span></td>
      <td>${u.active === false ? `<span class="badge badge-red">${t("inactive")}</span>` : `<span class="badge badge-teal">${t("active")}</span>`}</td>
      <td><button class="btn btn-sm btn-outline" data-id="${u.id}" data-active="${u.active !== false}">${u.active === false ? t("activate") : t("deactivate")}</button></td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateCompanyUser(companyId, btn.dataset.id, { active: btn.dataset.active !== "true" });
      toast(t("toast_user_status_updated"), "success");
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
    toast(t("toast_user_created"), "success");
    modal.classList.add("hidden");
    e.target.reset();
  } catch (err) {
    console.error(err);
    toast(err.message || t("toast_user_create_error"), "error");
  } finally {
    btn.disabled = false;
  }
});
