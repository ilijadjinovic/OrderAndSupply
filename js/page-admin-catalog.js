import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { getSuppliers } from "./suppliers.js";
import { addCategory, deleteCategory, getCategories, addProduct, deleteProduct, listenProducts } from "./catalog.js";
import { escapeHtml, toast, getParam, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName, categories = [], unsubProducts = null;

requireAuth([ROLES.ADMIN], async (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });

  categories = await getCategories(companyId);
  renderCategories(categories);
  fillCategorySelect();

  const suppliers = await getSuppliers(companyId);
  const select = document.getElementById("supplier-select");
  select.innerHTML = suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  const preselect = getParam("supplier");
  if (preselect) select.value = preselect;
  if (suppliers.length) loadProducts(select.value);
  select.addEventListener("change", () => loadProducts(select.value));
});

function loadProducts(supplierId) {
  if (unsubProducts) unsubProducts();
  if (!supplierId) return;
  unsubProducts = listenProducts(companyId, supplierId, (products) => renderProducts(products, supplierId));
}

function renderProducts(products, supplierId) {
  const body = document.getElementById("products-body");
  if (!products.length) { body.innerHTML = `<tr class="empty-row"><td colspan="7">Nema proizvoda za ovog dobavljača.</td></tr>`; return; }
  body.innerHTML = products.map((p) => {
    const catName = categories.find((c) => c.id === p.categoryId)?.name || "—";
    return `<tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td class="mono">${escapeHtml(p.code || "—")}</td>
      <td>${escapeHtml(p.unit)}</td>
      <td>${escapeHtml(catName)}</td>
      <td>${p.vatRate}%</td>
      <td>${p.minQuantity}</td>
      <td><button class="btn btn-sm btn-danger" data-id="${p.id}" data-supplier="${supplierId}">Obriši</button></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteProduct(companyId, btn.dataset.supplier, btn.dataset.id);
      toast("Proizvod obrisan.", "success");
    });
  });
}

function fillCategorySelect() {
  document.getElementById("p-category").innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") || `<option value="">Bez kategorije</option>`;
}

document.getElementById("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const supplierId = document.getElementById("supplier-select").value;
  if (!supplierId) { toast("Prvo izaberite dobavljača.", "error"); return; }
  const lastCategory = document.getElementById("p-category").value; // zapamti izabranu kategoriju
  await addProduct(companyId, supplierId, {
    name: document.getElementById("p-name").value.trim(),
    code: document.getElementById("p-code").value.trim(),
    barcode: document.getElementById("p-barcode").value.trim(),
    unit: document.getElementById("p-unit").value.trim(),
    categoryId: lastCategory,
    vatRate: Number(document.getElementById("p-vat").value) || 0,
    minQuantity: Number(document.getElementById("p-min").value) || 1,
    actorName,
  });
  toast("Proizvod dodat.", "success");
  e.target.reset();
  document.getElementById("p-unit").value = "kom";
  document.getElementById("p-vat").value = 20;
  document.getElementById("p-min").value = 1;
  document.getElementById("p-category").value = lastCategory; // ostavi istu kategoriju aktivnu
});

function renderCategories(cats) {
  document.getElementById("categories-body").innerHTML = cats.length
    ? cats.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td><button class="btn btn-sm btn-danger" data-id="${c.id}">Obriši</button></td></tr>`).join("")
    : `<tr class="empty-row"><td colspan="2">Nema kategorija.</td></tr>`;
  document.querySelectorAll("#categories-body button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteCategory(companyId, btn.dataset.id);
      categories = await getCategories(companyId);
      renderCategories(categories); fillCategorySelect();
    });
  });
}

document.getElementById("category-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addCategory(companyId, document.getElementById("c-name").value.trim());
  e.target.reset();
  categories = await getCategories(companyId);
  renderCategories(categories); fillCategorySelect();
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-products").classList.toggle("hidden", btn.dataset.tab !== "products");
    document.getElementById("tab-categories").classList.toggle("hidden", btn.dataset.tab !== "categories");
  });
});
