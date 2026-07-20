import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { listenAllCompanies, getGlobalStats, blockCompany, deleteCompany } from "./companies.js";
import { getRecentAuditLogs } from "./audit.js";
import { formatDate, escapeHtml, toast } from "./utils.js";
import { ROLES } from "./utils.js";

await loadLang();

requireAuth([ROLES.MASTER_ADMIN], (user, profile) => {
  renderNav({ companyId: "platform", uid: user.uid, profile });
  refreshStats();
  listenAllCompanies(renderCompanies);
});

async function refreshStats() {
  const stats = await getGlobalStats();
  document.getElementById("global-stats").innerHTML = `
    <div class="stat-card"><div class="stat-label">Ukupno firmi</div><div class="stat-value">${stats.totalCompanies}</div></div>
    <div class="stat-card teal"><div class="stat-label">Aktivne firme</div><div class="stat-value">${stats.activeCompanies}</div></div>
    <div class="stat-card red"><div class="stat-label">Blokirane firme</div><div class="stat-value">${stats.blockedCompanies}</div></div>
    <div class="stat-card amber"><div class="stat-label">Ukupno narudžbina</div><div class="stat-value">${stats.totalOrders}</div></div>
  `;
}

function renderCompanies(companies) {
  const body = document.getElementById("companies-body");
  if (!companies.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">Nema registrovanih firmi.</td></tr>`;
    return;
  }
  body.innerHTML = companies.map((c) => `
    <tr>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.pib || "—")}</td>
      <td>${escapeHtml(c.email || "—")}</td>
      <td><span class="badge ${c.status === "blocked" ? "badge-red" : "badge-teal"}">${c.status === "blocked" ? "Blokirana" : "Aktivna"}</span></td>
      <td>${formatDate(c.createdAt)}</td>
      <td>
        <button class="btn btn-sm btn-outline" data-action="logs" data-id="${c.id}">Log</button>
        <button class="btn btn-sm ${c.status === "blocked" ? "btn-amber" : "btn-outline"}" data-action="block" data-id="${c.id}" data-blocked="${c.status === "blocked"}">
          ${c.status === "blocked" ? "Odblokiraj" : "Blokiraj"}
        </button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${c.id}">Obriši</button>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === "logs") return loadLogs(id);
      if (btn.dataset.action === "block") {
        await blockCompany(id, btn.dataset.blocked !== "true");
        toast("Status firme je ažuriran.", "success");
      }
      if (btn.dataset.action === "delete") {
        if (!confirm("Da li ste sigurni da želite da obrišete firmu? Ova akcija je nepovratna.")) return;
        await deleteCompany(id);
        toast("Firma je obrisana.", "success");
        refreshStats();
      }
    });
  });
}

async function loadLogs(companyId) {
  const body = document.getElementById("audit-body");
  body.innerHTML = `<tr class="empty-row"><td colspan="4">Učitavanje...</td></tr>`;
  const logs = await getRecentAuditLogs(companyId, 50);
  if (!logs.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">Nema zabeleženih akcija.</td></tr>`;
    return;
  }
  body.innerHTML = logs.map((l) => `
    <tr>
      <td>${formatDate(l.createdAt)}</td>
      <td>${escapeHtml(l.action)}</td>
      <td>${escapeHtml(l.actorName || "—")}</td>
      <td>${escapeHtml(l.details || "—")}</td>
    </tr>
  `).join("");
}
