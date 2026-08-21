// ============================================================================
// NAV — zajednička navigacija (sidebar + topbar), učitava se na svakoj strani
// ============================================================================
import { logout } from "./auth.js";
import { listenNotifications, markAsRead } from "./notifications.js";
import { setLang, currentLang, t } from "./i18n.js";
import { formatDate, roleLabel } from "./utils.js";

const MENUS = {
  master_admin: [
    { href: "master-admin.html", label: "companies", icon: "🏢" },
  ],
  admin: [
    { href: "admin-dashboard.html", label: "dashboard", icon: "📊" },
    { href: "admin-users.html", label: "users", icon: "👥" },
    { href: "admin-locations.html", label: "locations", icon: "📍" },
    { href: "admin-suppliers.html", label: "suppliers", icon: "🚚" },
    { href: "admin-reports.html", label: "reports", icon: "📈" },
    { href: "admin-import-export.html", label: "import_export", icon: "⇅" },
    { href: "admin-settings.html", label: "settings", icon: "⚙️" },
  ],
  narucilac: [
    { href: "narucilac-dashboard.html", label: "dashboard", icon: "📊" },
    { href: "new-order.html", label: "new_order", icon: "➕" },
    { href: "templates.html", label: "templates", icon: "🗂️" },
    { href: "admin-suppliers.html", label: "suppliers", icon: "🚚" },
    { href: "admin-locations.html", label: "locations", icon: "📍" },
    { href: "admin-users.html", label: "users", icon: "👥" },
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
        <img class="brand-mark" src="./assets/icon-192.png" alt="Order & Supply" />
        <span class="brand-name" title="${t("app_name")}">O&amp;S</span>
      </div>
      <nav class="side-menu">
        ${menu.map((m) => `
          <a class="side-link ${page === m.href ? "active" : ""}" href="./${m.href}">
            <span class="side-icon">${m.icon}</span>
            <span data-i18n="${m.label}">${t(m.label)}</span>
          </a>`).join("")}
      </nav>
      <div class="side-menu-bottom">
        <button type="button" class="side-link" id="about-btn">
          <span class="side-icon">ℹ️</span>
          <span data-i18n="about">O aplikaciji</span>
        </button>
      </div>
      <div class="side-footer">
        <span class="role-pill">${roleLabel(profile.role)}</span>
      </div>
    </aside>
    <div class="modal-overlay hidden" id="about-modal">
      <div class="modal-card">
        <div class="modal-head">
          <h3 data-i18n="about_title">O aplikaciji</h3>
          <button class="icon-btn" id="about-close" aria-label="${t("close")}">✕</button>
        </div>
        <div class="about-author">
          <span class="about-avatar">ИБ</span>
          <div>
            <strong>Ilija Đinović, d.i.e.</strong>
            <div class="muted" data-i18n="about_author_role">Osmislio i implementirao</div>
          </div>
        </div>
        <hr class="about-sep" />
        <div class="about-list">
          <div class="about-row"><span class="about-icon">🧠</span><span>Order &amp; Supply v1.0</span></div>
          <div class="about-row"><span class="about-icon">🏢</span><span>Biro za veštačenja</span></div>
          <div class="about-row"><span class="about-icon">✉️</span><span>info@bzv.rs</span></div>
          <div class="about-row"><span class="about-icon">🌐</span><a href="https://www.bzv.rs" target="_blank" rel="noopener">www.bzv.rs</a></div>
          <div class="about-row"><span class="about-icon">📞</span><span>+381(0)62303303</span></div>
        </div>
      </div>
    </div>
    <header class="topbar">
      <button class="icon-btn" id="menu-toggle" aria-label="${t("menu_aria")}">☰</button>
      <div class="topbar-spacer"></div>
      <div class="lang-toggle" id="lang-toggle" role="group" aria-label="${t("language_aria")}">
        <button type="button" class="lang-option" data-lang="sr">SR</button>
        <button type="button" class="lang-option" data-lang="en">EN</button>
      </div>
      <div class="notif-wrap">
        <button class="icon-btn" id="notif-btn" aria-label="${t("notifications_aria")}">🔔<span id="notif-dot" class="notif-dot hidden"></span></button>
        <div class="notif-panel hidden" id="notif-panel"></div>
      </div>
      <div class="user-chip" title="${profile.name || profile.email}">
        <span class="user-avatar">${(profile.name || "?").charAt(0).toUpperCase()}</span>
        <span class="user-name">${profile.name || profile.email}</span>
      </div>
      <button class="btn btn-ghost" id="logout-btn" title="${t("logout")}">
        <span class="logout-icon">⏻</span><span class="logout-label" data-i18n="logout">Odjava</span>
      </button>
    </header>
  `;

  const langToggle = document.getElementById("lang-toggle");
  const syncLangToggle = () => {
    langToggle.querySelectorAll(".lang-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === currentLang);
    });
  };
  syncLangToggle();
  langToggle.querySelectorAll(".lang-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.lang === currentLang) return;
      await setLang(btn.dataset.lang);
      syncLangToggle();
    });
  });
  document.getElementById("logout-btn").addEventListener("click", () => logout());
  document.getElementById("menu-toggle").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("open");
  });

  const aboutModal = document.getElementById("about-modal");
  document.getElementById("about-btn").addEventListener("click", () => aboutModal.classList.remove("hidden"));
  document.getElementById("about-close").addEventListener("click", () => aboutModal.classList.add("hidden"));
  aboutModal.addEventListener("click", (e) => {
    if (e.target === aboutModal) aboutModal.classList.add("hidden");
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
          <strong>${n.titleKey ? t(n.titleKey) : (n.title || "")}</strong>
          <p>${n.bodyKey ? t(n.bodyKey, n.bodyParams || {}) : (n.body || "")}</p>
          <span class="notif-time">${formatDate(n.createdAt)}</span>
        </div>`).join("")
      : `<div class="notif-empty">${t("no_data")}</div>`;

    notifPanel.querySelectorAll(".notif-item").forEach((el) => {
      el.addEventListener("click", () => markAsRead(companyId, el.dataset.id));
    });
  });
}

// ============================================================================
// TABELE NA MOBILNOM — nagoveštaj za horizontalno skrolovanje
// Ovaj fajl (nav.js) se importuje na svakoj strani, pa je zgodno mesto da se
// centralno obradi ponašanje svih ".table-wrap" tabela. Za svaku tabelu se
// proverava da li sadržaj stvarno prelazi vidljivu širinu (što se često zna
// tek kad Firestore listener napuni tbody, zato se proverava i sa malim
// zakašnjenjem i preko ResizeObserver-a), pa se po potrebi ispod tabele
// prikazuje kratka poruka "prevucite za više". Poruka nestaje čim korisnik
// jednom skroluje tu konkretnu tabelu.
// ============================================================================
function initTableScrollHints() {
  document.querySelectorAll(".table-wrap").forEach((wrap) => {
    if (wrap.dataset.scrollHintReady) return;
    wrap.dataset.scrollHintReady = "1";

    const hint = document.createElement("div");
    hint.className = "table-scroll-hint";
    hint.textContent = t("table_scroll_hint");
    wrap.insertAdjacentElement("afterend", hint);

    const sync = () => {
      const scrollable = wrap.scrollWidth > wrap.clientWidth + 4;
      wrap.classList.toggle("has-h-scroll", scrollable);
      if (!scrollable) hint.classList.remove("show");
    };

    sync();
    if (window.ResizeObserver) {
      new ResizeObserver(sync).observe(wrap);
    } else {
      window.addEventListener("resize", sync);
    }

    wrap.addEventListener("scroll", () => {
      wrap.classList.remove("has-h-scroll");
      hint.classList.remove("show");
    }, { once: true, passive: true });
  });
}

// Pokreni odmah (za tabele koje su već u statičkom HTML-u pri učitavanju) i
// ponovo malo kasnije (za slučaj da async podaci proširе tabelu nakon toga).
document.addEventListener("DOMContentLoaded", initTableScrollHints);
if (document.readyState !== "loading") initTableScrollHints();
setTimeout(initTableScrollHints, 800);
