import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { getSuppliers } from "./suppliers.js";
import { addCategory, deleteCategory, getCategories, addProduct, updateProduct, deleteProduct, listenProducts } from "./catalog.js";
import { escapeHtml, toast, getParam, ROLES } from "./utils.js";

await loadLang();
let companyId, actorName, currentUid, currentRole, categories = [], unsubProducts = null;

requireAuth([ROLES.ADMIN, ROLES.NARUCILAC], async (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  currentUid = user.uid; currentRole = profile.role;
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
  const isAdmin = currentRole === ROLES.ADMIN;
  const body = document.getElementById("products-body");
  if (!products.length) { body.innerHTML = `<tr class="empty-row"><td colspan="7">${t("no_products_for_supplier")}</td></tr>`; return; }
  body.innerHTML = products.map((p) => {
    const catName = categories.find((c) => c.id === p.categoryId)?.name || "—";
    return `<tr class="row-link" data-id="${p.id}" title="${t("details_label")}">
      <td class="mono">${escapeHtml(p.code || "—")}</td>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.unit)}</td>
      <td>${escapeHtml(catName)}</td>
      <td>${p.vatRate}%</td>
      <td>${p.minQuantity}</td>
      <td>${isAdmin ? `<button class="btn btn-sm btn-danger" data-id="${p.id}" data-supplier="${supplierId}">${t("delete")}</button>` : ""}</td>
    </tr>`;
  }).join("");
  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteProduct(companyId, btn.dataset.supplier, btn.dataset.id);
      toast(t("toast_product_deleted"), "success");
    });
  });

  // Klik bilo gde na redu (van dugmeta za brisanje) otvara formu za izmenu —
  // dostupno i adminu i naručiocu (Poglavlje "Izmena kataloga").
  body.querySelectorAll("tr.row-link").forEach((row) => {
    row.addEventListener("click", () => {
      const product = products.find((x) => x.id === row.dataset.id);
      if (product) openProductDetail(product, supplierId);
    });
  });
}

const productDetailModal = document.getElementById("product-detail-modal");
document.getElementById("close-product-detail-modal").addEventListener("click", () => productDetailModal.classList.add("hidden"));

let editingProduct = null; // { id, supplierId } — proizvod trenutno otvoren u formi za izmenu

function openProductDetail(product, supplierId) {
  editingProduct = { id: product.id, supplierId };
  document.getElementById("product-detail-title").textContent = product.name || product.code || t("details_label");
  document.getElementById("pd-name").value = product.name || "";
  document.getElementById("pd-code").value = product.code || "";
  document.getElementById("pd-barcode").value = product.barcode || "";
  document.getElementById("pd-unit").value = product.unit || "kom";
  document.getElementById("pd-vat").value = product.vatRate ?? 20;
  document.getElementById("pd-min").value = product.minQuantity ?? 1;
  const catSelect = document.getElementById("pd-category");
  catSelect.innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") || `<option value="">${t("no_category")}</option>`;
  catSelect.value = product.categoryId || "";
  productDetailModal.classList.remove("hidden");
}

document.getElementById("product-edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingProduct) return;
  await updateProduct(companyId, editingProduct.supplierId, editingProduct.id, {
    name: document.getElementById("pd-name").value.trim(),
    code: document.getElementById("pd-code").value.trim(),
    barcode: document.getElementById("pd-barcode").value.trim(),
    unit: document.getElementById("pd-unit").value.trim(),
    categoryId: document.getElementById("pd-category").value,
    vatRate: Number(document.getElementById("pd-vat").value) || 0,
    minQuantity: Number(document.getElementById("pd-min").value) || 1,
  });
  toast(t("toast_product_updated"), "success");
  productDetailModal.classList.add("hidden");
});

function fillCategorySelect() {
  document.getElementById("p-category").innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") || `<option value="">${t("no_category")}</option>`;
}

document.getElementById("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const supplierId = document.getElementById("supplier-select").value;
  if (!supplierId) { toast(t("toast_select_supplier_first"), "error"); return; }
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
    createdBy: currentUid,
  });
  toast(t("toast_product_added"), "success");
  e.target.reset();
  document.getElementById("p-unit").value = "kom";
  document.getElementById("p-vat").value = 20;
  document.getElementById("p-min").value = 1;
  document.getElementById("p-category").value = lastCategory; // ostavi istu kategoriju aktivnu
});

function renderCategories(cats) {
  const isAdmin = currentRole === ROLES.ADMIN;
  document.getElementById("categories-body").innerHTML = cats.length
    ? cats.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${isAdmin ? `<button class="btn btn-sm btn-danger" data-id="${c.id}">${t("delete")}</button>` : ""}</td></tr>`).join("")
    : `<tr class="empty-row"><td colspan="2">${t("no_categories")}</td></tr>`;
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
