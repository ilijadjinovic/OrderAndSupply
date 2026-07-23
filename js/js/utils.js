// ============================================================================
// UTILS — zajedničke pomoćne funkcije i konstante (vidi Poglavlje 2 i 3 spec.)
// ============================================================================

export const ROLES = {
  MASTER_ADMIN: "master_admin",
  ADMIN: "admin",
  NARUCILAC: "narucilac",
  ISPORUCILAC: "isporucilac",
};

export const ROLE_LABELS = {
  master_admin: "Master Admin",
  admin: "Admin firme",
  narucilac: "Naručilac",
  isporucilac: "Isporučilac",
};

// Statusi narudžbine — Poglavlje 3
export const ORDER_STATUS = {
  KREIRANA: "kreirana",
  CEKA_PRIHVATANJE: "ceka_prihvatanje",
  PRIHVACENA: "prihvacena",
  U_NABAVCI: "u_nabavci",
  ZAVRSENA_NABAVKA: "zavrsena_nabavka",
  U_ISPORUCI: "u_isporuci",
  ISPORUCENA: "isporucena",
  POTVRDJEN_PRIJEM: "potvrdjen_prijem",
  REKLAMACIJA: "reklamacija",
  ZATVORENA: "zatvorena",
  ODBIJENA: "odbijena",
};

export const ORDER_STATUS_LABELS = {
  kreirana: "Kreirana",
  ceka_prihvatanje: "Čeka prihvatanje",
  prihvacena: "Prihvaćena",
  u_nabavci: "U nabavci",
  zavrsena_nabavka: "Završena nabavka",
  u_isporuci: "U isporuci",
  isporucena: "Isporučena",
  potvrdjen_prijem: "Potvrđen prijem",
  reklamacija: "Reklamacija",
  zatvorena: "Zatvorena",
  odbijena: "Odbijena",
};

// Redosled toka za progres-traku (Poglavlje 3)
export const ORDER_STATUS_FLOW = [
  ORDER_STATUS.KREIRANA, ORDER_STATUS.CEKA_PRIHVATANJE, ORDER_STATUS.PRIHVACENA,
  ORDER_STATUS.U_NABAVCI, ORDER_STATUS.ZAVRSENA_NABAVKA, ORDER_STATUS.U_ISPORUCI,
  ORDER_STATUS.ISPORUCENA, ORDER_STATUS.POTVRDJEN_PRIJEM, ORDER_STATUS.ZATVORENA,
];

export const PRIORITY = { HITNO: "hitno", STANDARDNO: "standardno" };

export const DELIVERY_LOCATION_STATUS = { CEKA: "ceka", ISPORUCENO: "isporuceno", POTVRDJENO: "potvrdjeno" };

export const ITEM_PURCHASE_STATUS = { NA_CEKANJU: "na_cekanju", KUPLJENO: "kupljeno", NIJE_PRONADJENO: "nije_pronadjeno", ZAMENA: "zamena" };

export const ASSIGNMENT_MODE = { AUTOMATSKI: "automatski", ADMIN_BIRA: "admin_bira", NARUCILAC_BIRA: "narucilac_bira" };

export function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("sr-RS", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDateShort(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("sr-RS", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function toast(message, type = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3800);
}

export function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function badgeClassForStatus(status) {
  const map = {
    kreirana: "badge-gray", ceka_prihvatanje: "badge-amber", prihvacena: "badge-blue",
    u_nabavci: "badge-blue", zavrsena_nabavka: "badge-blue", u_isporuci: "badge-blue",
    isporucena: "badge-teal", potvrdjen_prijem: "badge-green", zatvorena: "badge-green",
    reklamacija: "badge-red", odbijena: "badge-red",
  };
  return map[status] || "badge-gray";
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
