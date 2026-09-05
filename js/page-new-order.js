import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { getSuppliers, getSupplierLocations } from "./suppliers.js";
import { getProducts, addProduct, updateProduct } from "./catalog.js";
import { getLocations } from "./locations.js";
import { createOrder, assignOrder } from "./orders.js";
import { getIsporucioci } from "./users.js";
import { getTemplates, saveTemplate } from "./templates.js";
import { getCompanySettings } from "./settings.js";
import { escapeHtml, toast, uid, getParam, findClosestCatalogMatch } from "./utils.js";

await loadLang();

let companyId, uidValue, actorName;
let suppliers = [], companyLocations = [], assignmentMode = "admin_bira";
let cart = [];               // {tempId, supplierId, supplierName, productId, productName, unit, quantity, note, pickupLocationId, pickupLocationName, deliveryLocationId, deliveryLocationName}
let chosenDeliveryLocations = []; // {locationId, locationName}

// Katalog trenutno izabranog dobavljača (osvežava se pri promeni dobavljača) —
// koristi se za detekciju duplikata/sličnih naziva pri slobodnom (ručnom) unosu.
let currentSupplierCatalog = [];

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
  document.getElementById("template-select").innerHTML += templates.map((tp) => `<option value="${tp.id}">${escapeHtml(tp.name)} (${tp.type})</option>`).join("");

  document.getElementById("priority-step-title").textContent = `4. ${t("priority")}`;
  document.getElementById("save-step-title").textContent = `5. ${t("save_as_optional_title")}`;

  if (assignmentMode === "narucilac_bira") {
    document.getElementById("isporucilac-panel").classList.remove("hidden");
    document.getElementById("priority-step-title").textContent = `5. ${t("priority")}`;
    document.getElementById("save-step-title").textContent = `6. ${t("save_as_optional_title")}`;
    const isporucioci = await getIsporucioci(companyId);
    document.getElementById("isporucilac-select").innerHTML += isporucioci
      .map((u) => `<option value="${u.uid}">${escapeHtml(u.name)}</option>`).join("");
  }

  const preselect = getParam("template");
  if (preselect && templates.some((tp) => tp.id === preselect)) {
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
  pickupSelect.innerHTML = `<option value="any">${t("any_location")}</option>`;
  productList.innerHTML = `<tr class="empty-row"><td colspan="6">${t("select_supplier_prompt")}</td></tr>`;
  searchInput.value = "";
  if (!supplierId) return;

  const [locs, products] = await Promise.all([getSupplierLocations(companyId, supplierId), getProducts(companyId, supplierId)]);
  pickupSelect.innerHTML += locs.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
  currentSupplierCatalog = products;

  if (!products.length) { productList.innerHTML = `<tr class="empty-row"><td colspan="6">${t("no_products_in_catalog")}</td></tr>`; return; }
  const supplier = suppliers.find((s) => s.id === supplierId);
  productList.innerHTML = products.map((p) => `
    <tr data-product-id="${p.id}" data-name="${escapeHtml(p.name.toLowerCase())}">
      <td><input type="text" class="row-code-input mono" value="${escapeHtml(p.code || "")}" placeholder="${t('code_optional_placeholder')}" style="width:90px;" /></td>
      <td><input type="text" class="row-name-input" value="${escapeHtml(p.name)}" style="min-width:160px;" /></td>
      <td>${escapeHtml(p.unit)}</td>
      <td><input type="number" min="0.1" step="0.1" value="1" class="qty-input" style="width:80px;" /></td>
      <td><input type="text" placeholder="${t('note')}" class="note-input" /></td>
      <td><button class="btn btn-sm btn-amber" data-add="${p.id}">+ ${t("add")}</button></td>
    </tr>
  `).join("") + `<tr class="empty-row hidden" id="product-search-empty"><td colspan="6">${t("no_products_for_query")}</td></tr>`;

  productList.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest("tr");
      const product = products.find((p) => p.id === btn.dataset.add);
      const qty = Number(row.querySelector(".qty-input").value) || 1;
      const note = row.querySelector(".note-input").value.trim();
      const editedCode = row.querySelector(".row-code-input").value.trim();
      const editedName = row.querySelector(".row-name-input").value.trim() || product.name;
      const pickupOpt = pickupSelect.options[pickupSelect.selectedIndex];
      cart.push({
        tempId: uid("item"), supplierId, supplierName: supplier?.name || t("supplier"),
        productId: product.id, productName: editedName, code: editedCode, unit: product.unit, quantity: qty, note,
        pickupLocationId: pickupSelect.value, pickupLocationName: pickupOpt ? pickupOpt.textContent : t("any_location"),
        deliveryLocationId: chosenDeliveryLocations[0]?.locationId || "", deliveryLocationName: chosenDeliveryLocations[0]?.locationName || "",
      });
      toast(t("toast_item_added", { name: editedName }), "success");
      renderCart();

      // Ako je korisnik ispravio šifru i/ili naziv u odnosu na katalog (npr. razdvojio
      // šifru koja je bila slepljena sa nazivom), sačuvaj ispravku i u katalogu
      // dobavljača, da se greška ne ponavlja pri sledećoj narudžbini.
      if (editedCode !== (product.code || "") || editedName !== product.name) {
        updateProduct(companyId, supplierId, product.id, { code: editedCode, name: editedName })
          .then(() => {
            product.code = editedCode; product.name = editedName;
            toast(t("toast_catalog_entry_updated", { name: editedName }), "success");
          })
          .catch((err) => console.error(err));
      }
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
// Pri dodavanju u listu, stavka se automatski (samo)katalogizuje kod tog dobavljača:
// - Ako je naziv IDENTIČAN nekoj postojećoj stavci u katalogu (bez obzira na velika/mala
//   slova i razmake) -> ne dupliramo katalog, stavka se poveže sa postojećim proizvodom.
// - Ako je naziv VRLO SLIČAN (Levenštajnova distanca u kombinaciji apsolutnog i
//   relativnog praga) -> pitamo korisnika preko modala (similar-item-modal) da li ipak
//   želi da doda kao novu stavku u katalog.
// - Ako nema poklapanja -> stavka se dodaje u narudžbenicu I automatski upisuje u katalog.
document.getElementById("manual-add-btn").addEventListener("click", () => {
  const supplierId = document.getElementById("supplier-select").value;
  if (!supplierId) { toast(t("toast_select_supplier_first"), "error"); return; }

  const name = document.getElementById("manual-name").value.trim();
  if (!name) { toast(t("toast_enter_item_name"), "error"); return; }
  const code = document.getElementById("manual-code").value.trim();
  const qty = Number(document.getElementById("manual-qty").value) || 1;
  const unit = document.getElementById("manual-unit").value.trim() || "kom";
  const note = document.getElementById("manual-note").value.trim();

  processManualItem({ supplierId, name, code, qty, unit, note });
});

function resetManualEntryForm() {
  document.getElementById("manual-name").value = "";
  document.getElementById("manual-code").value = "";
  document.getElementById("manual-qty").value = "1";
  document.getElementById("manual-note").value = "";
  document.getElementById("manual-name").focus();
}

function addManualItemToCartAndOptionallyCatalog({ supplierId, name, qty, unit, note, productId = "", code = "", createInCatalog = false }) {
  const supplier = suppliers.find((s) => s.id === supplierId);
  const pickupSelect = document.getElementById("pickup-select");
  const pickupOpt = pickupSelect.options[pickupSelect.selectedIndex];

  const newItem = {
    tempId: uid("item"), supplierId, supplierName: supplier?.name || t("supplier"),
    productId, productName: name, code, unit, quantity: qty, note,
    pickupLocationId: pickupSelect.value, pickupLocationName: pickupOpt ? pickupOpt.textContent : t("any_location"),
    deliveryLocationId: chosenDeliveryLocations[0]?.locationId || "", deliveryLocationName: chosenDeliveryLocations[0]?.locationName || "",
    manualEntry: !productId,
  };
  cart.push(newItem);
  renderCart();

  if (createInCatalog) {
    addProduct(companyId, supplierId, { name, code, unit, actorName, createdBy: uidValue, source: "auto_from_order" })
      .then((newId) => {
        currentSupplierCatalog.push({ id: newId, name, code, unit });
        newItem.productId = newId;
        newItem.manualEntry = false;
        renderCart(); // osveži badge "Ručni unos" pošto je stavka sad povezana sa katalogom
        toast(t("toast_item_added_to_catalog", { name }), "success");
      })
      .catch((err) => {
        console.error(err);
        // Stavka ostaje u narudžbenici i ako upis u katalog ne uspe (npr. mrežni problem) —
        // korisnik ne treba da izgubi već uneti podatak zbog greške u katalogizaciji.
        toast(t("toast_item_added", { name }), "success");
      });
  } else if (productId) {
    toast(t("toast_item_matched_catalog", { name }), "success");
  } else {
    toast(t("toast_item_added", { name }), "success");
  }
}

let pendingSimilarItem = null; // { supplierId, name, qty, unit, note, existingProduct }

function processManualItem({ supplierId, name, code, qty, unit, note }) {
  const match = findClosestCatalogMatch(name, currentSupplierCatalog);

  if (match?.type === "exact") {
    // Tačan duplikat -> ne upisujemo novi proizvod u katalog, samo povežemo stavku
    // sa postojećim proizvodom i dodamo je u narudžbenicu (bez pitanja korisniku).
    // Ako korisnik sada unese šifru za proizvod koji je u katalogu bez nje,
    // popuni je (ne prepisuje šifru koja već postoji).
    const finalCode = match.product.code || code || "";
    if (code && !match.product.code) {
      updateProduct(companyId, supplierId, match.product.id, { code }).then(() => { match.product.code = code; }).catch((err) => console.error(err));
    }
    addManualItemToCartAndOptionallyCatalog({
      supplierId, name: match.product.name, qty, unit, note, productId: match.product.id, code: finalCode, createInCatalog: false,
    });
    resetManualEntryForm();
    return;
  }

  if (match?.type === "similar") {
    pendingSimilarItem = { supplierId, name, code, qty, unit, note, existingProduct: match.product };
    openSimilarItemModal(match.product.name, name);
    return; // sačekaj odgovor korisnika (DODAJ / ODBACI STAVKU)
  }

  // Nema poklapanja -> nova stavka, automatski se katalogizuje.
  addManualItemToCartAndOptionallyCatalog({ supplierId, name, code, qty, unit, note, createInCatalog: true });
  resetManualEntryForm();
}

// --- Modal: "Slična stavka postoji" ---
const similarItemModal = document.getElementById("similar-item-modal");
function openSimilarItemModal(existingName, newName) {
  document.getElementById("similar-item-existing-name").textContent = existingName;
  document.getElementById("similar-item-new-name").textContent = newName;
  similarItemModal.classList.remove("hidden");
}
function closeSimilarItemModal() {
  similarItemModal.classList.add("hidden");
  pendingSimilarItem = null;
}
document.getElementById("close-similar-item-modal").addEventListener("click", closeSimilarItemModal);
document.getElementById("similar-item-discard-btn").addEventListener("click", () => {
  toast(t("toast_item_discarded"), "info");
  closeSimilarItemModal();
});
document.getElementById("similar-item-add-btn").addEventListener("click", () => {
  if (!pendingSimilarItem) return;
  const { supplierId, name, code, qty, unit, note } = pendingSimilarItem;
  addManualItemToCartAndOptionallyCatalog({ supplierId, name, code, qty, unit, note, createInCatalog: true });
  closeSimilarItemModal();
  resetManualEntryForm();
});

// --- Delivery locations ---
function renderDeliveryLocationOptions() {
  const host = document.getElementById("delivery-locations");
  if (!companyLocations.length) { host.innerHTML = `<p class="muted">${t("no_company_locations_hint")}</p>`; return; }
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
      applyAutoDeliveryLocation();
      renderCart();
    });
  });
}

// Kada je izabrana tačno jedna lokacija isporuke, automatski je dodeli svim artiklima u listi
// (bez potrebe za ručnim biranjem po artiklu). Kad ih ima više, ostaje ručni izbor po artiklu.
function applyAutoDeliveryLocation() {
  if (chosenDeliveryLocations.length === 1) {
    const only = chosenDeliveryLocations[0];
    cart.forEach((item) => {
      item.deliveryLocationId = only.locationId;
      item.deliveryLocationName = only.locationName;
    });
  }
}

// --- Cart rendering ---
function renderCart() {
  const host = document.getElementById("cart-host");
  if (!cart.length) { host.innerHTML = `<p class="muted">${t("no_items_added_yet")}</p>`; return; }

  const bySupplier = {};
  cart.forEach((i) => { (bySupplier[i.supplierId] ||= { name: i.supplierName, items: [] }).items.push(i); });

  // Kad je izabrana samo jedna lokacija isporuke, ona se automatski dodeljuje svim artiklima
  // i ne prikazuje se poseban izbor po artiklu. Kad ih ima više, izbor po artiklu je obavezan.
  const needsManualDeliveryPick = chosenDeliveryLocations.length > 1;
  const deliveryOptions = chosenDeliveryLocations.length
    ? chosenDeliveryLocations.map((l) => `<option value="${l.locationId}">${escapeHtml(l.locationName)}</option>`).join("")
    : `<option value="">${t("choose_delivery_location_placeholder")}</option>`;

  host.innerHTML = Object.entries(bySupplier).map(([supplierId, group]) => `
    <div class="supplier-block">
      <div class="supplier-block-head"><h3>${escapeHtml(group.name)}</h3><span class="muted">${t("items_count", { count: group.items.length })}</span></div>
      ${group.items.map((item) => `
        <div class="item-row" data-temp-id="${item.tempId}" style="grid-template-columns:80px 1.5fr 90px 110px 1fr 90px auto;">
          <input type="text" class="cart-code mono" value="${escapeHtml(item.code || "")}" placeholder="${t('code_optional_placeholder')}" />
          <div>
            <input type="text" class="cart-name" value="${escapeHtml(item.productName)}" style="width:100%;font-weight:600;" />
            ${item.manualEntry ? ` <span class="badge badge-gray">${t("manual_entry_badge")}</span>` : ""}
            <div class="muted" style="font-size:12px;">${escapeHtml(item.pickupLocationName)}</div>
          </div>
          <input type="number" min="0.1" step="0.1" value="${item.quantity}" class="cart-qty" />
          <span class="muted">${escapeHtml(item.unit)}</span>
          <input type="text" value="${escapeHtml(item.note)}" placeholder="${t('note')}" class="cart-note" />
          ${needsManualDeliveryPick
            ? `<select class="cart-delivery">${deliveryOptions}</select>`
            : `<span class="muted" title="${escapeHtml(item.deliveryLocationName || "")}">${escapeHtml(item.deliveryLocationName || "—")}</span>`}
          <button class="btn btn-sm btn-danger" data-remove="${item.tempId}">✕</button>
        </div>
      `).join("")}
    </div>
  `).join("");

  // Preselect delivery values + wire events
  cart.forEach((item) => {
    const row = host.querySelector(`.item-row[data-temp-id="${item.tempId}"]`);
    if (!row) return;
    const deliverySelect = row.querySelector(".cart-delivery");
    if (deliverySelect) {
      deliverySelect.value = item.deliveryLocationId || "";
      deliverySelect.addEventListener("change", (e) => {
        const opt = e.target.options[e.target.selectedIndex];
        item.deliveryLocationId = e.target.value;
        item.deliveryLocationName = opt ? opt.textContent : "";
      });
    }
    row.querySelector(".cart-qty").addEventListener("input", (e) => {
      // Količina ne sme ostati prazna/0 — ako je uneta vrednost nevalidna, zadrži poslednju važeću.
      const val = Number(e.target.value);
      if (val > 0) { item.quantity = val; }
    });
    row.querySelector(".cart-qty").addEventListener("blur", (e) => { e.target.value = item.quantity; });
    row.querySelector(".cart-note").addEventListener("input", (e) => { item.note = e.target.value; });
    // Šifra i naziv se mogu ispraviti i ovde (npr. kad se šifra slučajno slepi sa
    // nazivom pri slobodnom unosu) — na blur se ispravka upisuje i u katalog
    // dobavljača ako je stavka povezana sa postojećim proizvodom, da se ne ponavlja.
    row.querySelector(".cart-code").addEventListener("input", (e) => { item.code = e.target.value; });
    row.querySelector(".cart-name").addEventListener("input", (e) => { item.productName = e.target.value; });
    row.querySelector(".cart-code").addEventListener("blur", () => syncItemCorrectionToCatalog(item));
    row.querySelector(".cart-name").addEventListener("blur", () => syncItemCorrectionToCatalog(item));
    row.querySelector("button[data-remove]").addEventListener("click", () => {
      cart = cart.filter((i) => i.tempId !== item.tempId);
      renderCart();
    });
  });
}

// Ako je stavka povezana sa proizvodom iz kataloga i korisnik je ovde ispravio
// šifru/naziv, upiši ispravku i u katalog dobavljača (ne dira stavke bez productId
// — ručni unos koji nikad nije katalogizovan).
function syncItemCorrectionToCatalog(item) {
  if (!item.productId) return;
  const catalogEntry = currentSupplierCatalog.find((p) => p.id === item.productId);
  const currentCode = catalogEntry?.code || "";
  const currentName = catalogEntry?.name || "";
  const newName = item.productName.trim() || currentName;
  if (item.code === currentCode && newName === currentName) return;
  updateProduct(companyId, item.supplierId, item.productId, { code: item.code, name: newName })
    .then(() => {
      if (catalogEntry) { catalogEntry.code = item.code; catalogEntry.name = newName; }
      toast(t("toast_catalog_entry_updated", { name: newName }), "success");
    })
    .catch((err) => console.error(err));
}

// --- Template loading ---
document.getElementById("template-select").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (!id) return;
  const templates = await getTemplates(companyId);
  const tpl = templates.find((tp) => tp.id === id);
  if (!tpl) return;
  cart = tpl.items.map((i) => ({ ...i, tempId: uid("item"), deliveryLocationId: chosenDeliveryLocations[0]?.locationId || "", deliveryLocationName: chosenDeliveryLocations[0]?.locationName || "" }));
  toast(t("toast_loaded_from_template", { name: tpl.name }), "success");
  renderCart();
});

document.getElementById("save-as-type").addEventListener("change", (e) => {
  document.getElementById("recurring-days").classList.toggle("hidden", e.target.value !== "ponavljajuca");
});

// --- Submit ---
document.getElementById("submit-order").addEventListener("click", async () => {
  if (!cart.length) { toast(t("toast_add_at_least_one_item"), "error"); return; }
  const missingName = cart.find((i) => !i.productName || !i.productName.trim());
  if (missingName) { toast(t("toast_enter_item_name"), "error"); return; }
  const invalidQty = cart.find((i) => !(i.quantity > 0));
  if (invalidQty) { toast(t("toast_invalid_quantity", { name: invalidQty.productName }), "error"); return; }
  if (!chosenDeliveryLocations.length) { toast(t("toast_select_at_least_one_delivery_location"), "error"); return; }
  const missingDelivery = cart.find((i) => !i.deliveryLocationId);
  if (missingDelivery) { toast(t("toast_select_delivery_location_for", { name: missingDelivery.productName }), "error"); return; }
  const isporucilacSelect = document.getElementById("isporucilac-select");
  if (assignmentMode === "narucilac_bira" && !isporucilacSelect.value) {
    toast(t("toast_select_fulfiller"), "error"); return;
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

    toast(t("toast_order_submitted"), "success");
    window.location.href = `./order-detail.html?order=${orderId}`;
  } catch (err) {
    console.error(err);
    toast(t("toast_order_submit_error"), "error");
    btn.disabled = false;
  }
});
