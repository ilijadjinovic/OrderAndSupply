// ============================================================================
// I18N — Poglavlje 13. Tekstovi izdvojeni u prevodne fajlove (sr, en)
// ============================================================================
let dict = {};
export let currentLang = localStorage.getItem("lang") || "sr";

export async function loadLang(lang = currentLang) {
  const res = await fetch(`./i18n/${lang}.json`);
  dict = await res.json();
  currentLang = lang;
  localStorage.setItem("lang", lang);
  applyTranslations();
}

export function t(key) {
  return dict[key] || key;
}

export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
}

export async function setLang(lang) {
  await loadLang(lang);
}
