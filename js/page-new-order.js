import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { getSuppliers, getSupplierLocations } from "./suppliers.js";
import { getProducts } from "./catalog.js";
import { getLocations } from "./locations.js";
import { createOrder, assignOrder } from "./orders.js";
import { getIsporucioci } from "./users.js";
import { getTemplates, saveTemplate } from "./templates.js";
import { getCompanySettings } from "./settings.js";
import { escapeHtml, toast, uid, getParam } from "./utils.js";

await loadLang();

let companyId, uidValue, actorName;
let suppliers = [], companyLocations = [], assignmentMode = "admin_bira";
let cart = [];               // {tempId, supplierId, supplierName, productId, productName, unit, quantity, note, pickupLocationId, pickupLocationName, deliveryLocationId, deliveryLocationName}
let chosenDeliveryLocations = []; // {locationId, locationName}

requireAuth(["narucilac"], async (user, profile) => {
  companyId = profile.companyId; uidValue = user.uid; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });

  const settings = await getCompanySettings(companyId);
  assignmentMode = settings?.assignmentMode || "admin_bira";

  suppliers = await getSuppliers(companyId);
  document.getElementById("supplier-select").innerHTML += suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");

  companyLocations = await getLocations(companyId);
  renderDeliveryLocationOptions();

  const templates = await getTemplates(companyId);
  document.getElementById("template-select").innerHTML += templates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${t.type})</option>`).join("");

  if (assignmentMode === "narucilac_bira") {
    document.getElementById("isporucilac-panel").classList.remove("hidden");
    document.getElementById("priority-step-title").textContent = "5. Prioritet";
    document.getElementById("save-step-title").textContent = "6. Sačuvaj kao (opciono)";
    const isporucioci = await getIsporucioci(companyId);
    document.getElementById("isporucilac-select").innerHTML += isporucioci
      .map((u) => `<option value="${u.uid}">${escapeHtml(u.name)}</option>`).join("");
  }

  const preselect = getParam("template");
  if (preselect && templates.some((t) => t.id === preselect)) {
    document.getElementById("template-select").value = preselect;
    document.getElementById("template-select").dispatchEvent(new Event("change"));
  }
});

// --- Supplier -> pickup locations + products ---
document.getElementById("supplier-select").addEventListener("change", async (e) => {
  const supplierId = e.target.value;
  const pickupSelect = document.getElementById("pickup-select");
  const productList = document.getElementById("product-list");
  const searchInput = document.getElementById("product-search");
  pickupSelect.innerHTML = `<option value="any">Bilo koja lokacija</option>`;
  productList.innerHTML = `<tr class="empty-row"><td colspan="6">Izaberite dobavljača.</td></tr>`;
  searchInput.value = "";
  if (!supplierId) return;

  const [locs, products] = await Promise.all([getSupplierLocations(companyId, supplierId), getProducts(companyId, supplierId)]);
  pickupSelect.innerHTML += locs.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");

  if (!products.length) { productList.innerHTML = `<tr class="empty-row"><td colspan="6">Ovaj dobavljač još nema proizvoda u katalogu.</td></tr>`; return; }
  const supplier = suppliers.find((s) => s.id === supplierId);
  productList.innerHTML = products.map((p) => `
    <tr data-product-id="${p.id}" data-name="${escapeHtml(p.name.toLowerCase())}">
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.unit)}</td>
      <td class="mono">${escapeHtml(p.code || "—")}</td>
      <td><input type="number" min="0.1" step="0.1" value="1" class="qty-input" style="width:80px;" /></td>
      <td><input type="text" placeholder="Napomena" class="note-input" /></td>
      <td><button class="btn btn-sm btn-amber" data-add="${p.id}">+ Dodaj</button></td>
    </tr>
  `).join("") + `<tr class="empty-row hidden" id="product-search-empty"><td colspan="6">Nema proizvoda za taj upit.</td></tr>`;

  productList.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest("tr");
      const product = products.find((p) => p.id === btn.dataset.add);
      const qty = Number(row.querySelector(".qty-input").value) || 1;
      const note = row.querySelector(".note-input").value.trim();
      const pickupOpt = pickupSelect.options[pickupSelect.selectedIndex];
      cart.push({
        tempId: uid("item"), supplierId, supplierName: supplier?.name || "Dobavljač",
        productId: product.id, productName: product.name, unit: product.unit, quantity: qty, note,
        pickupLocationId: pickupSelect.value, pickupLocationName: pickupOpt ? pickupOpt.textContent : "Bilo koja lokacija",
        deliveryLocationId: chosenDeliveryLocations[0]?.locationId || "", deliveryLocationName: chosenDeliveryLocations[0]?.locationName || "",
      });
      toast(`Dodato: ${product.name}`, "success");
      renderCart();
    });
  });
});

// --- Pretraga kataloga (filtrira tabelu po nazivu, ne dira već unete količine/napomene) ---
document.getElementById("product-search").addEventListener("input", (e) => {
  const term = e.target.value.trim().toLowerCase();
  let anyVisible = false;
  document.querySelectorAll("#product-list tr[data-product-id]").forEach((row) => {
    const match = !term || row.dataset.name.includes(term);
    row.classList.toggle("hidden", !match);
    if (match) anyVisible = true;
  });
  const emptyRow = document.getElementById("product-search-empty");
  if (emptyRow) emptyRow.classList.toggle("hidden", anyVisible);
});

// --- Entry mode tabs (Iz kataloga / Slobodan unos) ---
document.querySelectorAll("#entry-mode-tabs .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#entry-mode-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("catalog-entry").classList.toggle("hidden", btn.dataset.mode !== "catalog");
    document.getElementById("manual-entry").classList.toggle("hidden", btn.dataset.mode !== "manual");
  });
});

// --- Slobodan (ručni) unos stavke — samo naziv, količina, JM, napomena ---
document.getElementById("manual-add-btn").addEventListener("click", () => {
  const supplierId = document.getElementById("supplier-select").value;
  if (!supplierId) { toast("Prvo izaberite dobavljača.", "error"); return; }

  const name = document.getElementById("manual-name").value.trim();
  if (!name) { toast("Unesite naziv artikla.", "error"); return; }
  const qty = Number(document.getElementById("manual-qty").value) || 1;
  const unit = document.getElementById("manual-unit").value.trim() || "kom";
  const note = document.getElementById("manual-note").value.trim();

  const supplier = suppliers.find((s) => s.id === supplierId);
  const pickupSelect = document.getElementById("pickup-select");
  const pickupOpt = pickupSelect.options[pickupSelect.selectedIndex];

  cart.push({
    tempId: uid("item"), supplierId, supplierName: supplier?.name || "Dobavljač",
    productId: "", productName: name, unit, quantity: qty, note,
    pickupLocationId: pickupSelect.value, pickupLocationName: pickupOpt ? pickupOpt.textContent : "Bilo koja lokacija",
    deliveryLocationId: chosenDeliveryLocations[0]?.locationId || "", deliveryLocationName: chosenDeliveryLocations[0]?.locationName || "",
    manualEntry: true,
  });

  toast(`Dodato: ${name}`, "success");
  document.getElementById("manual-name").value = "";
  document.getElementById("manual-qty").value = "1";
  document.getElementById("manual-note").value = "";
  document.getElementById("manual-name").focus();
  renderCart();
});

// --- Delivery locations ---
function renderDeliveryLocationOptions() {
  const host = document.getElementById("delivery-locations");
  if (!companyLocations.length) { host.innerHTML = `<p class="muted">Nema definisanih lokacija firme. Dodajte ih u Admin → Lokacije.</p>`; return; }
  host.innerHTML = companyLocations.map((l) => `
    <label class="checkbox-row" style="border:1px solid var(--line);border-radius:8px;padding:10px 12px;">
      <input type="checkbox" class="delivery-loc-check" value="${l.id}" data-name="${escapeHtml(l.name)}" />
      <span>${escapeHtml(l.name)}</span>
    </label>
  `).join("");
  host.querySelectorAll(".delivery-loc-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      chosenDeliveryLocations = Array.from(host.querySelectorAll(".delivery-loc-check:checked"))
        .map((c) => ({ locationId: c.value, locationName: c.dataset.name }));
      renderCart();
    });
  });
}

// --- Cart rendering ---
function renderCart() {
  const host = document.getElementById("cart-host");
  if (!cart.length) { host.innerHTML = `<p class="muted">Još niste dodali artikle.</p>`; return; }

  const bySupplier = {};
  cart.forEach((i) => { (bySupplier[i.supplierId] ||= { name: i.supplierName, items: [] }).items.push(i); });

  const deliveryOptions = chosenDeliveryLocations.length
    ? chosenDeliveryLocations.map((l) => `<option value="${l.locationId}">${escapeHtml(l.locationName)}</option>`).join("")
    : `<option value="">— izaberite lokaciju isporuke —</option>`;

  host.innerHTML = Object.entries(bySupplier).map(([supplierId, group]) => `
    <div class="supplier-block">
      <div class="supplier-block-head"><h3>${escapeHtml(group.name)}</h3><span class="muted">${group.items.length} artikala</span></div>
      ${group.items.map((item) => `
        <div class="item-row" data-temp-id="${item.tempId}">
          <div><strong>${escapeHtml(item.productName)}</strong>${item.manualEntry ? ' <span class="badge badge-gray">Ručni unos</span>' : ""}<div class="muted" style="font-size:12px;">${escapeHtml(item.pickupLocationName)}</div></div>
          <input type="number" min="0.1" step="0.1" value="${item.quantity}" class="cart-qty" />
          <span class="muted">${escapeHtml(item.unit)}</span>
          <input type="text" value="${escapeHtml(item.note)}" placeholder="Napomena" class="cart-note" />
          <select class="cart-delivery">${deliveryOptions}</select>
          <button class="btn btn-sm btn-danger" data-remove="${item.tempId}">✕</button>
        </div>
      `).join("")}
    </div>
  `).join("");

  // Preselect delivery values + wire events
  cart.forEach((item) => {
    const row = host.querySelector(`.item-row[data-temp-id="${item.tempId}"]`);
    if (!row) return;
    row.querySelector(".cart-delivery").value = item.deliveryLocationId || "";
    row.querySelector(".cart-qty").addEventListener("input", (e) => { item.quantity = Number(e.target.value) || 0; });
    row.querySelector(".cart-note").addEventListener("input", (e) => { item.note = e.target.value; });
    row.querySelector(".cart-delivery").addEventListener("change", (e) => {
      const opt = e.target.options[e.target.selectedIndex];
      item.deliveryLocationId = e.target.value;
      item.deliveryLocationName = opt ? opt.textContent : "";
    });
    row.querySelector("button[data-remove]").addEventListener("click", () => {
      cart = cart.filter((i) => i.tempId !== item.tempId);
      renderCart();
    });
  });
}

// --- Template loading ---
document.getElementById("template-select").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (!id) return;
  const templates = await getTemplates(companyId);
  const tpl = templates.find((t) => t.id === id);
  if (!tpl) return;
  cart = tpl.items.map((i) => ({ ...i, tempId: uid("item"), deliveryLocationId: chosenDeliveryLocations[0]?.locationId || "", deliveryLocationName: chosenDeliveryLocations[0]?.locationName || "" }));
  toast(`Učitano iz: ${tpl.name}`, "success");
  renderCart();
});

document.getElementById("save-as-type").addEventListener("change", (e) => {
  document.getElementById("recurring-days").classList.toggle("hidden", e.target.value !== "ponavljajuca");
});

// --- Submit ---
document.getElementById("submit-order").addEventListener("click", async () => {
  if (!cart.length) { toast("Dodajte bar jedan artikal.", "error"); return; }
  if (!chosenDeliveryLocations.length) { toast("Izaberite bar jednu lokaciju isporuke.", "error"); return; }
  const missingDelivery = cart.find((i) => !i.deliveryLocationId);
  if (missingDelivery) { toast(`Izaberite lokaciju isporuke za: ${missingDelivery.productName}`, "error"); return; }
  const isporucilacSelect = document.getElementById("isporucilac-select");
  if (assignmentMode === "narucilac_bira" && !isporucilacSelect.value) {
    toast("Izaberite isporučioca.", "error"); return;
  }

  const priority = document.querySelector('input[name="priority"]:checked').value;
  const btn = document.getElementById("submit-order");
  btn.disabled = true;

  try {
    const items = cart.map(({ tempId, ...rest }) => rest);
    const orderId = await createOrder(companyId, {
      createdByUid: uidValue, createdByName: actorName, priority, items,
      deliveryLocations: chosenDeliveryLocations, assignmentMode,
    });

    if (assignmentMode === "narucilac_bira" && isporucilacSelect.value) {
      const chosenOpt = isporucilacSelect.options[isporucilacSelect.selectedIndex];
      await assignOrder(companyId, orderId, { assignedToUid: isporucilacSelect.value, assignedToName: chosenOpt.textContent, actorName });
    }

    const saveAsType = document.getElementById("save-as-type").value;
    const saveAsName = document.getElementById("save-as-name").value.trim();
    if (saveAsType && saveAsName) {
      const recurringDays = Array.from(document.querySelectorAll(".recur-day:checked")).map((c) => c.value);
      await saveTemplate(companyId, { name: saveAsName, type: saveAsType, items, ownerUid: uidValue, recurringDays, actorName });
    }

    toast("Narudžbina je poslata.", "success");
    window.location.href = `./order-detail.html?order=${orderId}`;
  } catch (err) {
    console.error(err);
    toast("Greška pri slanju narudžbine.", "error");
    btn.disabled = false;
  }
});
