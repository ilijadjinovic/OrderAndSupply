import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import {
  listenAllCompanies, loadMetricsFor, blockCompany, archiveCompany, restoreCompany, purgeCompany,
} from "./companies.js";
import { getRecentAuditLogs, auditDetailsText, getRecentPlatformLogs, platformActionLabel } from "./audit.js";
import { formatDate, escapeHtml, toast, ROLES } from "./utils.js";
import { attachRowPopover, itemsInfoBtnHtml } from "./row-popover.js";
import { companyPopHtml, auditPopHtml } from "./table-popovers.js";

await loadLang();

let companies = [];
let metrics = {};              // companyId -> { users, orders, orders30, lastActivity }
let attempted = new Set();     // firme za koje je učitavanje metrika već pokušano (bez beskonačnog ponavljanja)
let latestLogs = [];
let filterText = "", filterStatus = "all", sortBy = "created_desc";
const DAY_MS = 24 * 60 * 60 * 1000;

requireAuth([ROLES.MASTER_ADMIN], (user, profile) => {
  renderNav({ companyId: "platform", uid: user.uid, profile });
  listenAllCompanies(onCompanies, (err) => showError(err));
  loadPlatformLogs();
});

// ---------------------------------------------------------------------------
// Greške — umesto praznog ekrana prikaži razlog (najčešće: pravila nisu objavljena)
// ---------------------------------------------------------------------------
function showError(err) {
  const box = document.getElementById("global-error");
  document.getElementById("global-error-text").textContent =
    `${err?.code || ""} ${err?.message || err}`.trim() + " — " + t("master_load_error_hint");
  box.classList.remove("hidden");
}
function clearError() { document.getElementById("global-error").classList.add("hidden"); }

// ---------------------------------------------------------------------------
// Podaci
// ---------------------------------------------------------------------------
function onCompanies(list) {
  companies = list;
  renderStats();
  renderCompanies();
  loadMissingMetrics();
}

async function loadMissingMetrics() {
  const ids = companies.map((c) => c.id).filter((id) => !metrics[id] && !attempted.has(id));
  if (!ids.length) return;
  ids.forEach((id) => attempted.add(id));
  try {
    await loadMetricsFor(ids, (id, m) => { metrics[id] = m; renderStats(); renderCompanies(); });
    clearError();
  } catch (err) {
    console.error("Metrike firmi:", err);
    showError(err);
  }
}

document.getElementById("refresh-btn").addEventListener("click", () => {
  metrics = {}; attempted = new Set();
  clearError();
  renderStats(); renderCompanies();
  loadMissingMetrics();
  loadPlatformLogs();
});

// ---------------------------------------------------------------------------
// Globalna statistika
// ---------------------------------------------------------------------------
function renderStats() {
  const total = companies.length;
  const blocked = companies.filter((c) => c.status === "blocked").length;
  const archived = companies.filter((c) => c.status === "deleted").length;
  const active = total - blocked - archived;
  const since = Date.now() - 30 * DAY_MS;
  const newCompanies = companies.filter((c) => (c.createdAt?.toMillis?.() ?? 0) >= since).length;

  const allLoaded = total > 0 && companies.every((c) => metrics[c.id]);
  const sum = (key) => (allLoaded ? companies.reduce((a, c) => a + (metrics[c.id][key] || 0), 0) : "…");

  const card = (cls, label, value) =>
    `<div class="stat-card ${cls}"><div class="stat-label">${t(label)}</div><div class="stat-value">${value}</div></div>`;
  document.getElementById("global-stats").innerHTML = [
    card("", "stat_total_companies", total),
    card("teal", "stat_active_companies", active),
    card("red", "stat_blocked_companies", blocked),
    card("", "stat_archived_companies", archived),
    card("", "stat_total_users", sum("users")),
    card("amber", "stat_total_orders", sum("orders")),
    card("amber", "stat_orders_30d", sum("orders30")),
    card("teal", "stat_new_companies_30d", newCompanies),
  ].join("");
}

// ---------------------------------------------------------------------------
// Tabela firmi
// ---------------------------------------------------------------------------
function visibleCompanies() {
  const q = filterText.trim().toLowerCase();
  let list = companies.filter((c) => {
    const st = c.status || "active";
    if (filterStatus !== "all" && st !== filterStatus) return false;
    if (!q) return true;
    return [c.name, c.pib, c.email, c.maticniBroj, c.mb].some((v) => String(v || "").toLowerCase().includes(q));
  });
  const ms = (c) => c.createdAt?.toMillis?.() ?? 0;
  const m = (c, k) => metrics[c.id]?.[k] ?? -1;
  const act = (c) => metrics[c.id]?.lastActivity?.toMillis?.() ?? -1;
  list = [...list];
  if (sortBy === "created_asc") list.sort((a, b) => ms(a) - ms(b));
  else if (sortBy === "name") list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sr"));
  else if (sortBy === "orders") list.sort((a, b) => m(b, "orders") - m(a, "orders"));
  else if (sortBy === "users") list.sort((a, b) => m(b, "users") - m(a, "users"));
  else if (sortBy === "activity") list.sort((a, b) => act(b) - act(a));
  else list.sort((a, b) => ms(b) - ms(a));
  return list;
}

function statusBadge(c) {
  if (c.status === "blocked") return `<span class="badge badge-red">${t("blocked")}</span>`;
  if (c.status === "deleted") return `<span class="badge badge-gray">${t("company_status_deleted")}</span>`;
  return `<span class="badge badge-teal">${t("active")}</span>`;
}

function renderCompanies() {
  const body = document.getElementById("companies-body");
  if (!companies.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">${t("no_registered_companies")}</td></tr>`;
    return;
  }
  const list = visibleCompanies();
  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">${t("no_data")}</td></tr>`;
    return;
  }
  body.innerHTML = list.map((c) => {
    const m = metrics[c.id];
    const st = c.status || "active";
    const actions = st === "deleted"
      ? `<button class="btn btn-sm btn-amber" data-action="restore" data-id="${c.id}">${t("restore_btn")}</button>
         <button class="btn btn-sm btn-danger" data-action="purge" data-id="${c.id}">${t("purge_btn")}</button>`
      : `<button class="btn btn-sm ${st === "blocked" ? "btn-amber" : "btn-outline"}" data-action="block" data-id="${c.id}">${st === "blocked" ? t("unblock") : t("block")}</button>
         <button class="btn btn-sm btn-danger" data-action="archive" data-id="${c.id}">${t("delete")}</button>`;
    return `
    <tr data-id="${c.id}">
      <td><a href="./master-company.html?id=${encodeURIComponent(c.id)}"><strong>${escapeHtml(c.name)}</strong></a>${itemsInfoBtnHtml()}</td>
      <td>${escapeHtml(c.pib || "—")}</td>
      <td>${escapeHtml(c.email || "—")}</td>
      <td>${statusBadge(c)}</td>
      <td>${m ? m.users : "…"}</td>
      <td>${m ? `${m.orders} <span class="muted">(${m.orders30})</span>` : "…"}</td>
      <td>${m ? formatDate(m.lastActivity) : "…"}</td>
      <td>${formatDate(c.createdAt)}</td>
      <td style="white-space:nowrap;">
        <a class="btn btn-sm btn-primary" href="./master-company.html?id=${encodeURIComponent(c.id)}">${t("details_btn")}</a>
        <button class="btn btn-sm btn-outline" data-action="logs" data-id="${c.id}">${t("audit_log_short")}</button>
        ${actions}
      </td>
    </tr>`;
  }).join("");
}

document.getElementById("company-search").addEventListener("input", (e) => { filterText = e.target.value; renderCompanies(); });
document.getElementById("status-filter").addEventListener("change", (e) => { filterStatus = e.target.value; renderCompanies(); });
document.getElementById("company-sort").addEventListener("change", (e) => { sortBy = e.target.value; renderCompanies(); });

// Akcije u redu (delegirano, jedan slušalac — tabela se često iscrtava ponovo)
document.getElementById("companies-body").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const company = companies.find((c) => c.id === btn.dataset.id);
  if (!company) return;
  btn.disabled = true;
  try {
    await runAction(btn.dataset.action, company);
  } catch (err) {
    console.error(err);
    toast(`${t("toast_generic_error")} ${err?.code || err?.message || ""}`.trim(), "error");
  } finally {
    btn.disabled = false;
  }
});

async function runAction(action, company) {
  if (action === "logs") return loadLogs(company.id);

  if (action === "block") {
    if (company.status === "blocked") {
      await blockCompany(company, false);
    } else {
      const reason = prompt(t("block_reason_prompt", { name: company.name }));
      if (reason === null) return;
      await blockCompany(company, true, reason.trim());
    }
    toast(t("toast_company_status_updated"), "success");
  }

  if (action === "archive") {
    if (!confirm(t("confirm_archive_company", { name: company.name }))) return;
    await archiveCompany(company);
    toast(t("toast_company_archived"), "success");
  }

  if (action === "restore") {
    if (!confirm(t("confirm_restore_company", { name: company.name }))) return;
    await restoreCompany(company);
    toast(t("toast_company_restored"), "success");
  }

  if (action === "purge") {
    const typed = prompt(t("purge_confirm_prompt", { name: company.name }));
    if (typed === null) return;
    if (typed.trim() !== (company.name || "").trim()) { toast(t("purge_name_mismatch"), "error"); return; }
    await runPurge(company);
  }

  loadPlatformLogs();
}

async function runPurge(company) {
  const panel = document.getElementById("purge-result");
  const progress = document.getElementById("purge-progress");
  const emailsBox = document.getElementById("purge-emails");
  panel.classList.remove("hidden");
  emailsBox.innerHTML = "";
  progress.textContent = t("purge_running", { name: company.name, count: 0 });
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const result = await purgeCompany(company, ({ deleted }) => {
    progress.textContent = t("purge_running", { name: company.name, count: deleted });
  });
  delete metrics[company.id];
  progress.textContent = t("purge_done", { name: company.name, count: result.deleted });
  emailsBox.innerHTML = result.emails.length
    ? `<p><strong>${t("purge_auth_hint")}</strong></p>
       <ul>${result.emails.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`
    : "";
  toast(t("toast_company_purged"), "success");
}

// ---------------------------------------------------------------------------
// Dnevnici
// ---------------------------------------------------------------------------
async function loadLogs(companyId) {
  const body = document.getElementById("audit-body");
  body.innerHTML = `<tr class="empty-row"><td colspan="4">${t("loading_ellipsis")}</td></tr>`;
  try {
    const logs = await getRecentAuditLogs(companyId, 50);
    if (!logs.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="4">${t("no_logged_actions")}</td></tr>`;
      return;
    }
    latestLogs = logs;
    body.innerHTML = logs.map((l, i) => `
      <tr data-id="${i}">
        <td>${formatDate(l.createdAt)}${itemsInfoBtnHtml()}</td>
        <td>${escapeHtml(l.action)}</td>
        <td>${escapeHtml(l.actorName || t("system_actor_fallback"))}</td>
        <td>${escapeHtml(auditDetailsText(l) || "—")}</td>
      </tr>
    `).join("");
  } catch (err) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">${escapeHtml(err?.message || String(err))}</td></tr>`;
  }
  document.getElementById("audit-body").closest(".panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function loadPlatformLogs() {
  const body = document.getElementById("platform-log-body");
  try {
    const logs = await getRecentPlatformLogs(50);
    if (!logs.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="5">${t("no_logged_actions")}</td></tr>`;
      return;
    }
    body.innerHTML = logs.map((l) => `
      <tr>
        <td>${formatDate(l.createdAt)}</td>
        <td>${escapeHtml(platformActionLabel(l.action))}</td>
        <td>${escapeHtml(l.companyName || "—")}</td>
        <td>${escapeHtml(l.actorName || "—")}</td>
        <td>${escapeHtml(l.details || "—")}</td>
      </tr>`).join("");
  } catch (err) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">${escapeHtml(err?.message || String(err))}</td></tr>`;
  }
}

// Plutajući prikaz: uz red firme (PIB, email, registracija...) i uz red dnevnika (ceo zapis sa punim tekstom detalja)
attachRowPopover(document.getElementById("companies-body"), {
  hoverSelector: "tr[data-id]",
  getContent: (row) => { const c = companies.find((x) => x.id === row.dataset.id); return c ? companyPopHtml(c) : ""; },
});
attachRowPopover(document.getElementById("audit-body"), {
  hoverSelector: "tr[data-id]",
  getContent: (row) => { const l = latestLogs[Number(row.dataset.id)]; return l ? auditPopHtml(l, auditDetailsText(l)) : ""; },
});
