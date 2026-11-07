// ============================================================================
// CATALOG-SEARCH — čista logika pretrage i filtera kataloga proizvoda (bez Firebase-a, testira se u Node-u)
// Pretraga ne pravi razliku između velikih i malih slova ni kvačica (š→s, č/ć→c, ž→z, đ→dj, dž→dz),
// razume i ćirilicu, a kod više reči moraju da se nađu sve (redosled nije bitan).
// ============================================================================

const CYR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj",
  м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "c", у: "u", ф: "f", х: "h", ц: "c", ч: "c", џ: "dz", ш: "s",
};

const CYR_RE = new RegExp(`[${Object.keys(CYR).join("")}]`, "g");   // ђ, ј, љ, њ, ћ, џ nisu u opsegu а-я, pa se nabrajaju

export function normalizeSearch(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(CYR_RE, (ch) => CYR[ch])
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/\s+/g, " ")
    .trim();
}

// Tekst po kome se artikal traži: naziv, šifra, barkod
export const productHaystack = (p) => normalizeSearch(`${p?.name ?? ""} ${p?.code ?? ""} ${p?.barcode ?? ""}`);

// products: lista artikala dobavljača; isActive(p) → bool.
// filters: { query: "", categoryId: "", status: "" | "active" | "passive" }
export function filterProducts(products, { query = "", categoryId = "", status = "" } = {}, isActive = () => true) {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  return (products || []).filter((p) => {
    if (categoryId && (p.categoryId || "") !== categoryId) return false;
    if (status === "active" && !isActive(p)) return false;
    if (status === "passive" && isActive(p)) return false;
    if (!terms.length) return true;
    const hay = productHaystack(p);
    return terms.every((term) => hay.includes(term));
  });
}

// Da li je neki filter aktivan (za poruku „Nema artikala za ovu pretragu" naspram „Dobavljač nema artikala")
export const hasActiveFilter = ({ query = "", categoryId = "", status = "" } = {}) => !!(normalizeSearch(query) || categoryId || status);
