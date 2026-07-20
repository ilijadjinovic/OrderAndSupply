// ============================================================================
// NAV — zajednička navigacija (sidebar + topbar), učitava se na svakoj strani
// ============================================================================
import { logout } from "./auth.js";
import { listenNotifications, markAsRead } from "./notifications.js";
import { setLang, currentLang, t } from "./i18n.js";
import { formatDate, ROLE_LABELS } from "./utils.js";

const MENUS = {
  master_admin: [
    { href: "master-admin.html", label: "companies", icon: "🏢" },
  ],
  admin: [
    { href: "admin-dashboard.html", label: "dashboard", icon: "📊" },
    { href: "admin-users.html", label: "users", icon: "👥" },
    { href: "admin-locations.html", label: "locations", icon: "📍" },
    { href: "admin-suppliers.html", label: "suppliers", icon: "🚚" },
    { href: "admin-catalog.html", label: "catalog", icon: "📦" },
    { href: "admin-import-export.html", label: "import_export", icon: "⇅" },
    { href: "admin-settings.html", label: "settings", icon: "⚙️" },
  ],
  narucilac: [
    { href: "narucilac-dashboard.html", label: "dashboard", icon: "📊" },
    { href: "new-order.html", label: "new_order", icon: "➕" },
    { href: "templates.html", label: "templates", icon: "🗂️" },
  ],
  isporucilac: [
    { href: "isporucilac-dashboard.html", label: "dashboard", icon: "📊" },
  ],
};

export function renderNav({ companyId, uid, profile }) {
  const page = window.location.pathname.split("/").pop();
  const menu = MENUS[profile.role] || [];
  const host = document.getElementById("app-nav");
  if (!host) return;

  host.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">N</span>
        <span class="brand-name" data-i18n="app_name">Nabavka</span>
      </div>
      <nav class="side-menu">
        ${menu.map((m) => `
          <a class="side-link ${page === m.href ? "active" : ""}" href="./${m.href}">
            <span class="side-icon">${m.icon}</span>
            <span data-i18n="${m.label}">${t(m.label)}</span>
          </a>`).join("")}
      </nav>
      <div class="side-footer">
        <span class="role-pill">${ROLE_LABELS[profile.role] || profile.role}</span>
      </div>
    </aside>
    <header class="topbar">
      <button class="icon-btn" id="menu-toggle" aria-label="Meni">☰</button>
      <div class="topbar-spacer"></div>
      <select id="lang-switch" class="lang-switch" aria-label="Jezik">
        <option value="sr">SR</option>
        <option value="en">EN</option>
      </select>
      <div class="notif-wrap">
        <button class="icon-btn" id="notif-btn" aria-label="Notifikacije">🔔<span id="notif-dot" class="notif-dot hidden"></span></button>
        <div class="notif-panel hidden" id="notif-panel"></div>
      </div>
      <div class="user-chip">
        <span class="user-avatar">${(profile.name || "?").charAt(0).toUpperCase()}</span>
        <span class="user-name">${profile.name || profile.email}</span>
      </div>
      <button class="btn btn-ghost" id="logout-btn" data-i18n="logout">Odjava</button>
    </header>
  `;

  document.getElementById("lang-switch").value = currentLang;
  document.getElementById("lang-switch").addEventListener("change", (e) => setLang(e.target.value));
  document.getElementById("logout-btn").addEventListener("click", () => logout());
  document.getElementById("menu-toggle").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("open");
  });

  const notifBtn = document.getElementById("notif-btn");
  const notifPanel = document.getElementById("notif-panel");
  notifBtn.addEventListener("click", () => notifPanel.classList.toggle("hidden"));

  if (profile.role === "master_admin") {
    notifBtn.classList.add("hidden");
    return;
  }

  listenNotifications(companyId, uid, (notifs) => {
    const unread = notifs.filter((n) => !n.read).length;
    document.getElementById("notif-dot").classList.toggle("hidden", unread === 0);
    notifPanel.innerHTML = notifs.length
      ? notifs.map((n) => `
        <div class="notif-item ${n.read ? "" : "unread"}" data-id="${n.id}">
          <strong>${n.title}</strong>
          <p>${n.body || ""}</p>
          <span class="notif-time">${formatDate(n.createdAt)}</span>
        </div>`).join("")
      : `<div class="notif-empty">${t("no_data")}</div>`;

    notifPanel.querySelectorAll(".notif-item").forEach((el) => {
      el.addEventListener("click", () => markAsRead(companyId, el.dataset.id));
    });
  });
}
