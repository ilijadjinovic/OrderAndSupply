// ============================================================================
// ROW-POPOVER — opšti plutajući prikaz (balon) uz red bilo koje tabele.
// Jedan balon na stranici, jedan delegirani slušalac po telu tabele (preživljava
// ponovno iscrtavanje redova). Svaka tabela samo kaže:
//   hoverSelector — element nad kojim se miš zadržava (ćelija ili ceo red),
//   getContent(red) — HTML balona ILI Promise sa HTML-om (asinhrono učitavanje),
//   getLoading(red) — (opciono) HTML dok traje učitavanje,
//   skip(red)       — (opciono) true = za ovaj red balon se ne prikazuje,
//   ignore          — selektor elemenata (dugmad, polja) iznad kojih se balon ne prikazuje.
// Telefon/tablet (bez hovera): balon se otvara dodirom na ikonicu „i" (itemsInfoBtnHtml).
// ============================================================================
import { t } from "./i18n.js";
import { escapeHtml } from "./utils.js";

const SHOW_DELAY_MS = 180;   // mali odmak da balon ne bljesne dok miš samo prolazi preko tabele
const DEFAULT_IGNORE = "button, input, select, textarea, .btn";
const touchOnly = () => window.matchMedia("(hover: none)").matches;

let pop = null;
function ensurePop() {
  if (pop) return pop;
  pop = document.createElement("div");
  pop.className = "items-pop";
  pop.setAttribute("role", "tooltip");
  document.body.appendChild(pop);
  return pop;
}

// x != null → balon se vezuje za položaj miša (ceo red); inače za levu ivicu elementa
function position(anchor, x = null) {
  const p = ensurePop();
  const r = anchor.getBoundingClientRect();
  const w = p.offsetWidth, h = p.offsetHeight, gap = 8;
  const base = x != null ? x - 24 : r.left;
  const left = Math.min(Math.max(8, base), window.innerWidth - w - 8);
  let top = r.bottom + gap;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - gap); // nema mesta ispod → iznad
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;
}

// Ikonica (i) u ćeliji reda — vidljiva samo na ekranima na dodir (vidi CSS)
export const itemsInfoBtnHtml = () =>
  `<button type="button" class="items-info-btn" data-items-btn aria-label="${escapeHtml(t("items_pop_label"))}">i</button>`;

// ---------------------------------------------------------------- građevni blokovi sadržaja
// Vrednosti se escape-uju; za gotov HTML preda se { html: "..." }.
const val = (v) => (v && typeof v === "object" && "html" in v ? v.html : escapeHtml(String(v ?? "")));

// Naslov balona: title (broj / naziv), opciono značka (badgeHtml) sa desne strane
export function popHead(title, { mono = false, badgeHtml = "" } = {}) {
  return `<div class="items-pop-head"><span class="${mono ? "items-pop-num" : "items-pop-title"}">${escapeHtml(title || "—")}</span>${badgeHtml}</div>`;
}

// Parovi oznaka → vrednost; prazne vrednosti se preskaču
export function popKv(pairs) {
  const rows = (pairs || []).filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—")
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${val(v)}</dd>`).join("");
  return rows ? `<dl class="items-pop-kv">${rows}</dl>` : "";
}

// Naslov odeljka unutar balona
export const popSection = (label) => `<div class="items-pop-sec">${escapeHtml(label)}</div>`;

// Lista „naziv — vrednost" (npr. artikal — količina); višak se skraćuje na „+ još N"
export function popList(rows, { max = 8 } = {}) {
  if (!rows?.length) return "";
  const lis = rows.slice(0, max).map(([name, value]) =>
    `<li><span class="items-pop-name">${val(name || "—")}</span>${value !== undefined && value !== "" ? `<span class="items-pop-qty">${val(value)}</span>` : ""}</li>`).join("");
  const more = rows.length > max ? `<div class="items-pop-more">${t("items_pop_more", { count: rows.length - max })}</div>` : "";
  return `<ul class="items-pop-list">${lis}</ul>${more}`;
}

export const popEmpty = (text) => `<div class="items-pop-empty">${escapeHtml(text)}</div>`;

// ---------------------------------------------------------------- priključivanje na tabelu
export function attachRowPopover(body, opts) {
  const { hoverSelector, getContent, getLoading = null, skip = null, ignore = DEFAULT_IGNORE } = opts;
  if (!body || body.dataset.rowPop) return;
  body.dataset.rowPop = "1";
  const keyOf = opts.getKey || ((row) => row.dataset.id || row.dataset.key || row.dataset.itemId || "");
  let timer = null, hideTimer = null, current = null, token = 0;   // current = { anchor, row, key }

  const hide = () => {
    clearTimeout(timer); clearTimeout(hideTimer); timer = hideTimer = null; current = null; token++;
    if (pop) pop.classList.remove("show");
  };
  const scheduleHide = () => { clearTimeout(timer); current = null; clearTimeout(hideTimer); hideTimer = setTimeout(hide, 80); };

  const show = async (anchor, row, x) => {
    const mine = ++token;
    const p = ensurePop();
    let res;
    try { res = getContent(row); } catch (err) { console.error("Plutajući prikaz:", err); hide(); return; }
    if (res && typeof res.then === "function") {
      p.innerHTML = getLoading ? getLoading(row) : popEmpty(t("loading_ellipsis"));
      p.classList.add("show");
      position(anchor, x);
      let html = null;
      try { html = await res; } catch (err) { console.error("Plutajući prikaz:", err); }
      if (mine !== token || !anchor.isConnected) return;   // miš je u međuvremenu otišao na drugi red
      if (!html) { hide(); return; }
      p.innerHTML = html;
      position(anchor, x);
    } else {
      if (!res) { hide(); return; }
      p.innerHTML = res;
      p.classList.add("show");
      position(anchor, x);
    }
  };

  const hitOf = (el) => {
    const target = el?.closest?.(hoverSelector);
    if (!target || !body.contains(target)) return null;
    const row = target.closest("tr");
    return row ? { target, row } : null;
  };

  body.addEventListener("mouseover", (e) => {
    if (touchOnly()) return;
    const hit = hitOf(e.target);
    if (!hit) return;
    if (ignore && e.target.closest(ignore)) { if (current) scheduleHide(); return; }   // iznad dugmeta/polja balon ne treba
    if (skip?.(hit.row)) { if (current) scheduleHide(); return; }
    clearTimeout(hideTimer);   // prelazak na sledeći red: balon ostaje otvoren i samo menja sadržaj
    if (current?.anchor === hit.target) return;
    clearTimeout(timer);
    current = { anchor: hit.target, row: hit.row, key: keyOf(hit.row) };
    const x = hit.target.tagName === "TR" ? e.clientX : null;
    const { anchor, row } = current;
    timer = setTimeout(() => show(anchor, row, x), pop?.classList.contains("show") ? 0 : SHOW_DELAY_MS);
  });

  body.addEventListener("mouseout", (e) => {
    if (touchOnly()) return;
    const hit = hitOf(e.target);
    if (!hit || hit.target.contains(e.relatedTarget)) return;
    if (current?.anchor !== hit.target) return;
    scheduleHide();
  });

  // Telefon: dodir na ikonicu otvara/zatvara balon; dodir bilo gde drugde, skrol i promena prozora ga zatvaraju.
  // Hvata se u fazi hvatanja da dodir na ikonicu ne otvori i sam red (detalje/izmenu).
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-items-btn]");
    if (!btn) { hide(); return; }
    e.stopPropagation();
    const row = btn.closest("tr");
    if (!row) return;
    const anchor = row.matches(hoverSelector) ? row : (btn.closest("td") || row);
    if (current?.anchor === anchor && pop?.classList.contains("show")) { hide(); return; }
    clearTimeout(timer); clearTimeout(hideTimer);
    current = { anchor, row, key: keyOf(row) };
    show(anchor, row, null);
  }, true);
  document.addEventListener("click", (e) => { if (!body.contains(e.target)) hide(); });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  // Red je ponovo iscrtan (uživo osvežavanje, otvaranje reda) dok je balon otvoren → zatvori
  new MutationObserver(() => { if (current && !current.anchor.isConnected) hide(); }).observe(body, { childList: true, subtree: true });
}
