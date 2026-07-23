import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang } from "./i18n.js";
import { getTemplates, deleteTemplate, isDueToday } from "./templates.js";
import { escapeHtml, toast, ROLES } from "./utils.js";

await loadLang();
let companyId;
let activeType = "sablon";

requireAuth([ROLES.NARUCILAC], (user, profile) => {
  companyId = profile.companyId;
  renderNav({ companyId, uid: user.uid, profile });
  load();
});

async function load() {
  const body = document.getElementById("templates-body");
  body.innerHTML = `<tr class="empty-row"><td colspan="4">Učitavanje...</td></tr>`;
  const list = await getTemplates(companyId, activeType);
  if (!list.length) { body.innerHTML = `<tr class="empty-row"><td colspan="4">Nema sačuvanih stavki u ovoj kategoriji.</td></tr>`; return; }

  body.innerHTML = list.map((t) => {
    const preview = t.items.slice(0, 3).map((i) => `${escapeHtml(i.productName)} (${i.quantity} ${escapeHtml(i.unit)})`).join(", ");
    const more = t.items.length > 3 ? ` + ${t.items.length - 3} još` : "";
    const recurring = t.type === "ponavljajuca"
      ? `${(t.recurringDays || []).join(", ") || "—"} ${isDueToday(t) ? '<span class="badge badge-amber">Danas</span>' : ""}`
      : `<span class="muted">—</span>`;
    return `
      <tr>
        <td><strong>${escapeHtml(t.name)}</strong><div class="muted" style="font-size:12px;">${t.items.length} artikala</div></td>
        <td class="muted" style="font-size:13px;">${preview}${more}</td>
        <td>${recurring}</td>
        <td>
          <a class="btn btn-sm btn-amber" href="./new-order.html?template=${t.id}">Naruči</a>
          <button class="btn btn-sm btn-danger" data-id="${t.id}">Obriši</button>
        </td>
      </tr>`;
  }).join("");

  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Obrisati ovu stavku?")) return;
      await deleteTemplate(companyId, btn.dataset.id);
      toast("Obrisano.", "success");
      load();
    });
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeType = btn.dataset.type;
    load();
  });
});
