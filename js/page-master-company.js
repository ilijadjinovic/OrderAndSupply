// ============================================================================
// MASTER ADMIN — detalji jedne firme: pregled, korisnici, statistika, dnevnik, pretplata.
// Master admin ovde samo ČITA poslovne podatke (broj narudžbina, status, imena) i
// upravlja statusom firme/naloga; stavke, cene, poruke i prilozi mu nisu dostupni.
// ============================================================================
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import {
  getCompany, loadCompanyMetrics, getCompanyStats, getCompanyUsersForMaster, setUserActive,
  sendUserPasswordReset, blockCompany, restoreCompany, updateMasterNote, updateSubscription,
} from "./companies.js";
import { getRecentAuditLogs, auditDetailsText, logPlatformAudit } from "./audit.js";
import { Timestamp } from "./firebase-init.js";
import {
  formatDate, formatDateShort, escapeHtml, toast, ROLES, roleLabel, statusLabel, ORDER_STATUS_ALL, getParam,
} from "./utils.js";

await loadLang();

const companyId = getParam("id");
let company = null;
let users = [];
let metrics = null;
const loadedTabs = new Set();

const $ = (id) => document.getElementById(id);
const dash = (v) => (v === undefined || v === null || v === "" ? "—" : escapeHtml(String(v)));

requireAuth([ROLES.MASTER_ADMIN], async (user, profile) => {
  renderNav({ companyId: "platform", uid: user.uid, profile });
  if (!companyId) return showMissing();
  try {
    company = await getCompany(companyId);
  } catch (err) {
    console.error(err);
    toast(`${t("toast_generic_error")} ${err?.code || ""}`.trim(), "error");
  }
  if (!company) return showMissing();

  logPlatformAudit("company_viewed", { companyId: company.id, companyName: company.name });
  $("company-content").classList.remove("hidden");
  renderHeader();
  initTabs();
  await Promise.all([loadUsers(), loadMetrics()]);
  renderOverview();
});

function showMissing() { $("company-missing").classList.remove("hidden"); $("company-title").textContent = t("master_company_not_found"); }

async function loadUsers() {
  try { users = await getCompanyUsersForMaster(companyId); } catch (err) { console.error(err); toast(err?.message || String(err), "error"); }
}
async function loadMetrics() {
  try { metrics = await loadCompanyMetrics(companyId); } catch (err) { console.error(err); }
}

// ---------------------------------------------------------------------------
// Zaglavlje: naziv, status, akcije
// ---------------------------------------------------------------------------
function statusBadge(c) {
  if (c.status === "blocked") return `<span class="badge badge-red">${t("blocked")}</span>`;
  if (c.status === "deleted") return `<span class="badge badge-gray">${t("company_status_deleted")}</span>`;
  return `<span class="badge badge-teal">${t("active")}</span>`;
}

function renderHeader() {
  $("company-title").textContent = company.name || "—";
  document.title = `${company.name || ""} — Master Admin`;
  $("company-badges").innerHTML = statusBadge(company)
    + (company.status === "blocked" && company.blockReason ? ` <span class="muted">${escapeHtml(company.blockReason)}</span>` : "");
  const st = company.status || "active";
  $("company-actions").innerHTML = st === "deleted"
    ? `<button class="btn btn-amber" id="act-restore">${t("restore_btn")}</button>`
    : `<button class="btn ${st === "blocked" ? "btn-amber" : "btn-outline"}" id="act-block">${st === "blocked" ? t("unblock") : t("block")}</button>`;
  $("act-restore")?.addEventListener("click", () => guard(async () => {
    if (!confirm(t("confirm_restore_company", { name: company.name }))) return;
    await restoreCompany(company);
    toast(t("toast_company_restored"), "success");
    await refreshCompany();
  }));
  $("act-block")?.addEventListener("click", () => guard(async () => {
    if (st === "blocked") {
      await blockCompany(company, false);
    } else {
      const reason = prompt(t("block_reason_prompt", { name: company.name }));
      if (reason === null) return;
      await blockCompany(company, true, reason.trim());
    }
    toast(t("toast_company_status_updated"), "success");
    await refreshCompany();
  }));
}

async function refreshCompany() {
  company = await getCompany(companyId);
  renderHeader();
  renderOverview();
  if (loadedTabs.has("admin")) renderAdmin();
}

async function guard(fn) {
  try { await fn(); } catch (err) {
    console.error(err);
    toast(`${t("toast_generic_error")} ${err?.code || err?.message || ""}`.trim(), "error");
  }
}

// ---------------------------------------------------------------------------
// Tabovi (sadržaj se učitava tek pri prvom otvaranju)
// ---------------------------------------------------------------------------
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => openTab(btn.dataset.tab));
  });
}

function openTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("hidden", p.id !== `tab-${name}`));
  if (loadedTabs.has(name)) return;
  loadedTabs.add(name);
  if (name === "users") renderUsers();
  if (name === "stats") renderStats();
  if (name === "log") renderLog();
  if (name === "admin") renderAdmin();
}

// ---------------------------------------------------------------------------
// Pregled
// ---------------------------------------------------------------------------
const ASSIGNMENT_KEYS = { automatski: "assignment_opt_auto", admin_bira: "assignment_opt_admin", narucilac_bira: "assignment_opt_requester" };

function kv(rows) {
  return `<dl class="kv-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

function renderOverview() {
  const creator = users.find((u) => u.id === company.createdByUid);
  const sub = company.subscription;
  const num = (v) => (metrics ? v : "…");
  $("tab-overview").innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">${t("master_col_users")}</div><div class="stat-value">${users.length}</div></div>
      <div class="stat-card amber"><div class="stat-label">${t("stat_total_orders")}</div><div class="stat-value">${num(metrics?.orders)}</div></div>
      <div class="stat-card amber"><div class="stat-label">${t("stat_orders_30d")}</div><div class="stat-value">${num(metrics?.orders30)}</div></div>
      <div class="stat-card teal"><div class="stat-label">${t("master_col_activity")}</div><div class="stat-value" style="font-size:16px;">${metrics ? formatDate(metrics.lastActivity) : "…"}</div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>${t("master_company_data")}</h2></div>
      ${kv([
        [t("name"), dash(company.name)],
        [t("pib_label"), dash(company.pib)],
        [t("company_id_label"), dash(company.mb || company.maticniBroj)],
        ["Email", dash(company.email)],
        [t("phone_label"), dash(company.phone)],
        [t("address_label"), dash(company.address)],
        [t("registered_label"), formatDate(company.createdAt)],
        [t("master_created_by"), creator ? `${escapeHtml(creator.name || "")} (${escapeHtml(creator.email || "")})` : "—"],
        [t("status"), statusBadge(company)],
        ...(company.status === "blocked" ? [[t("master_block_reason"), `${dash(company.blockReason)} <span class="muted">${escapeHtml(company.blockedBy || "")} ${company.blockedAt ? "· " + formatDate(company.blockedAt) : ""}</span>`]] : []),
        ...(company.status === "deleted" ? [[t("master_deleted_info"), `${escapeHtml(company.deletedBy || "—")} ${company.deletedAt ? "· " + formatDate(company.deletedAt) : ""}`]] : []),
      ])}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>${t("master_company_settings")}</h2></div>
      ${kv([
        [t("currency_label"), dash(company.currency)],
        [t("language_label"), dash(company.language)],
        [t("timezone_label"), dash(company.timezone)],
        [t("fulfiller_assignment_title"), ASSIGNMENT_KEYS[company.assignmentMode] ? t(ASSIGNMENT_KEYS[company.assignmentMode]) : dash(company.assignmentMode)],
        [t("gps_tracking_title"), company.gpsTrackingEnabled ? t("master_yes") : t("master_no")],
        [t("master_subscription"), sub ? `${dash(sub.plan)} · ${dash(sub.status)}${sub.validUntil ? " · " + formatDateShort(sub.validUntil) : ""}` : "—"],
      ])}
    </div>`;
}

// ---------------------------------------------------------------------------
// Korisnici
// ---------------------------------------------------------------------------
function renderUsers() {
  const el = $("tab-users");
  if (!users.length) { el.innerHTML = `<div class="panel"><p>${t("no_users")}</p></div>`; return; }
  const byRole = {};
  users.forEach((u) => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
  const inactive = users.filter((u) => u.active === false).length;
  const chips = [ROLES.ADMIN, ROLES.NARUCILAC, ROLES.ISPORUCILAC]
    .map((r) => `<span class="badge badge-blue">${roleLabel(r)}: ${byRole[r] || 0}</span>`).join(" ")
    + (inactive ? ` <span class="badge badge-gray">${t("inactive")}: ${inactive}</span>` : "");
  const sorted = [...users].sort((a, b) => (a.role === ROLES.ADMIN ? 0 : 1) - (b.role === ROLES.ADMIN ? 0 : 1) || (a.name || "").localeCompare(b.name || "", "sr"));
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>${t("master_tab_users")}</h2><div>${chips}</div></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>${t("full_name_label")}</th><th>Email</th><th>${t("role_label")}</th><th>${t("status")}</th>
            <th>${t("master_col_activity")}</th><th>${t("registered_label")}</th><th></th>
          </tr></thead>
          <tbody>${sorted.map((u) => `
            <tr>
              <td><strong>${escapeHtml(u.name || "—")}</strong></td>
              <td>${escapeHtml(u.email || "—")}</td>
              <td><span class="badge badge-blue">${roleLabel(u.role)}</span></td>
              <td><span class="badge ${u.active === false ? "badge-gray" : "badge-teal"}">${u.active === false ? t("inactive") : t("active")}</span></td>
              <td>${formatDate(u.lastSeenAt)}</td>
              <td>${formatDate(u.createdAt)}</td>
              <td style="white-space:nowrap;">
                <button class="btn btn-sm ${u.active === false ? "btn-amber" : "btn-outline"}" data-user-action="toggle" data-id="${u.id}">${u.active === false ? t("master_activate_user") : t("master_deactivate_user")}</button>
                <button class="btn btn-sm btn-outline" data-user-action="reset" data-id="${u.id}">${t("master_send_reset")}</button>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  el.querySelectorAll("button[data-user-action]").forEach((btn) => {
    btn.addEventListener("click", () => guard(async () => {
      const u = users.find((x) => x.id === btn.dataset.id);
      if (!u) return;
      btn.disabled = true;
      try {
        if (btn.dataset.userAction === "toggle") {
          const activate = u.active === false;
          if (!confirm(t(activate ? "master_confirm_activate_user" : "master_confirm_deactivate_user", { name: u.name || u.email }))) return;
          await setUserActive(company, u.id, activate);
          u.active = activate;
          toast(t("toast_user_updated"), "success");
          renderUsers();
        } else {
          if (!confirm(t("master_confirm_send_reset", { email: u.email }))) return;
          await sendUserPasswordReset(company, u.email);
          toast(t("toast_reset_link_sent"), "success");
        }
      } finally { btn.disabled = false; }
    }));
  });
}

// ---------------------------------------------------------------------------
// Statistika
// ---------------------------------------------------------------------------
function bars(rows, max) {
  return rows.map(([label, value]) => `
    <div class="mbar-row">
      <span class="mbar-label">${label}</span>
      <span class="mbar"><span style="width:${max ? Math.round((value / max) * 100) : 0}%"></span></span>
      <span class="mbar-value">${value}</span>
    </div>`).join("");
}

async function renderStats() {
  const el = $("tab-stats");
  el.innerHTML = `<div class="panel"><p class="muted">${t("loading_ellipsis")}</p></div>`;
  let s;
  try { s = await getCompanyStats(companyId); } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="panel"><p>${escapeHtml(err?.message || String(err))}</p></div>`;
    loadedTabs.delete("stats");
    return;
  }
  const statusRows = ORDER_STATUS_ALL.map((st) => [escapeHtml(statusLabel(st)), s.byStatus[st] || 0]);
  const maxStatus = Math.max(1, ...statusRows.map((r) => r[1]));
  const maxMonth = Math.max(1, ...s.months.map((m) => m.count));
  const person = (arr) => (arr.length ? bars(arr.map(([n, c]) => [escapeHtml(n), c]), arr[0][1]) : `<p class="muted">${t("no_data")}</p>`);
  const prio = Object.entries(s.priorities).map(([p, c]) => [escapeHtml(p), c]);

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card amber"><div class="stat-label">${t("stat_total_orders")}</div><div class="stat-value">${s.total}</div></div>
      <div class="stat-card"><div class="stat-label">${t("suppliers")}</div><div class="stat-value">${s.suppliers}</div></div>
      <div class="stat-card"><div class="stat-label">${t("locations")}</div><div class="stat-value">${s.locations}</div></div>
      <div class="stat-card red"><div class="stat-label">${escapeHtml(statusLabel("reklamacija"))}</div><div class="stat-value">${s.byStatus.reklamacija || 0}</div></div>
    </div>
    <div class="panel"><div class="panel-head"><h2>${t("master_stats_by_status")}</h2></div>${bars(statusRows, maxStatus)}</div>
    <div class="panel"><div class="panel-head"><h2>${t("master_stats_by_month")}</h2></div>
      ${bars(s.months.map((m) => [m.key, m.count]), maxMonth)}</div>
    <div class="panel">
      <div class="panel-head"><h2>${t("master_stats_people")}</h2><span class="muted">${t("master_stats_sample", { n: s.sampleSize })}</span></div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:24px;">
        <div><h4>${t("tab_by_requester")}</h4>${person(s.topRequesters)}</div>
        <div><h4>${t("tab_by_fulfiller")}</h4>${person(s.topFulfillers)}</div>
        <div><h4>${t("priority")}</h4>${prio.length ? bars(prio, Math.max(...prio.map((r) => r[1]))) : `<p class="muted">${t("no_data")}</p>`}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Dnevnik firme
// ---------------------------------------------------------------------------
async function renderLog() {
  const el = $("tab-log");
  el.innerHTML = `<div class="panel"><p class="muted">${t("loading_ellipsis")}</p></div>`;
  let logs;
  try { logs = await getRecentAuditLogs(companyId, 200); } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="panel"><p>${escapeHtml(err?.message || String(err))}</p></div>`;
    loadedTabs.delete("log");
    return;
  }
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>${t("audit_log")}</h2>
        <input type="text" id="log-filter" placeholder="${escapeHtml(t("master_log_filter_ph"))}" style="min-width:240px;" />
      </div>
      <p class="muted" id="log-count"></p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>${t("time_label")}</th><th>${t("action_label")}</th><th>${t("who_label")}</th><th>${t("details_label")}</th></tr></thead>
        <tbody id="log-body"></tbody>
      </table></div>
    </div>`;
  const rows = logs.map((l) => ({ l, text: `${l.action} ${l.actorName || ""} ${auditDetailsText(l)}`.toLowerCase() }));
  const draw = () => {
    const q = $("log-filter").value.trim().toLowerCase();
    const shown = rows.filter((r) => !q || r.text.includes(q));
    $("log-count").textContent = t("master_log_count", { shown: shown.length, total: rows.length });
    $("log-body").innerHTML = shown.length
      ? shown.map(({ l }) => `
        <tr>
          <td>${formatDate(l.createdAt)}</td>
          <td>${escapeHtml(l.action)}</td>
          <td>${escapeHtml(l.actorName || t("system_actor_fallback"))}</td>
          <td>${escapeHtml(auditDetailsText(l) || "—")}</td>
        </tr>`).join("")
      : `<tr class="empty-row"><td colspan="4">${t("no_logged_actions")}</td></tr>`;
  };
  $("log-filter").addEventListener("input", draw);
  draw();
}

// ---------------------------------------------------------------------------
// Pretplata i beleška
// ---------------------------------------------------------------------------
const SUB_STATUSES = ["active", "trial", "expired", "suspended"];

function renderAdmin() {
  const sub = company.subscription || {};
  const validUntil = sub.validUntil?.toDate ? sub.validUntil.toDate().toISOString().slice(0, 10) : "";
  $("tab-admin").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>${t("master_subscription")}</h2></div>
      <p class="muted">${t("master_subscription_hint")}</p>
      <div class="field"><label for="sub-plan">${t("master_sub_plan")}</label>
        <input type="text" id="sub-plan" list="sub-plans" value="${escapeHtml(sub.plan || "")}" />
        <datalist id="sub-plans"><option value="trial"></option><option value="basic"></option><option value="standard"></option><option value="premium"></option></datalist></div>
      <div class="field"><label for="sub-status">${t("status")}</label>
        <select id="sub-status">${SUB_STATUSES.map((s) => `<option value="${s}" ${((sub.status || "active") === s) ? "selected" : ""}>${t("master_sub_status_" + s)}</option>`).join("")}</select></div>
      <div class="field"><label for="sub-valid">${t("master_sub_valid_until")}</label>
        <input type="date" id="sub-valid" value="${validUntil}" /></div>
      <button class="btn btn-primary" id="sub-save">${t("save")}</button>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>${t("master_note_title")}</h2></div>
      <p class="muted">${t("master_note_hint")}</p>
      <div class="field"><textarea id="master-note" rows="5">${escapeHtml(company.masterNote || "")}</textarea></div>
      <button class="btn btn-primary" id="note-save">${t("save")}</button>
    </div>`;

  $("sub-save").addEventListener("click", () => guard(async () => {
    const v = $("sub-valid").value;
    await updateSubscription(company, {
      plan: $("sub-plan").value.trim(),
      status: $("sub-status").value,
      validUntil: v ? Timestamp.fromDate(new Date(`${v}T23:59:59`)) : null,
    });
    toast(t("toast_saved"), "success");
    company = await getCompany(companyId);
    renderOverview();
  }));
  $("note-save").addEventListener("click", () => guard(async () => {
    await updateMasterNote(company, $("master-note").value.trim());
    toast(t("toast_saved"), "success");
    company = await getCompany(companyId);
  }));
}
