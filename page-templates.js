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
  const grid = document.getElementById("templates-grid");
  grid.innerHTML = `<p class="muted">Učitavanje...</p>`;
  const list = await getTemplates(companyId, activeType);
  if (!list.length) { grid.innerHTML = `<p class="muted">Nema sačuvanih stavki u ovoj kategoriji.</p>`; return; }

  grid.innerHTML = list.map((t) => `
    <div class="click-card">
      <h3>${escapeHtml(t.name)}</h3>
      <p class="muted">${t.items.length} artikala</p>
      ${t.type === "ponavljajuca" ? `<p style="font-size:12.5px;">Ponavlja se: ${(t.recurringDays || []).join(", ") || "—"} ${isDueToday(t) ? '<span class="badge badge-amber">Danas je na redu</span>' : ""}</p>` : ""}
      <ul style="font-size:12.5px;color:var(--ink-500);padding-left:16px;margin:8px 0;">
        ${t.items.slice(0, 4).map((i) => `<li>${escapeHtml(i.productName)} — ${i.quantity} ${escapeHtml(i.unit)}</li>`).join("")}
        ${t.items.length > 4 ? `<li>+ ${t.items.length - 4} još...</li>` : ""}
      </ul>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <a class="btn btn-sm btn-amber" href="./new-order.html?template=${t.id}">Naruči</a>
        <button class="btn btn-sm btn-danger" data-id="${t.id}">Obriši</button>
      </div>
    </div>
  `).join("");

  grid.querySelectorAll("button[data-id]").forEach((btn) => {
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
