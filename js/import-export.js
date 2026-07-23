// ============================================================================
// UVOZ / IZVOZ — Poglavlje 12
// Uvoz: CSV i Excel za katalog proizvoda, dobavljače, korisnike
// Izvoz: PDF, Excel, CSV
// Koristi lagane CDN biblioteke (PapaParse, SheetJS, jsPDF) — bez build alata.
// ============================================================================

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureLibs() {
  await Promise.all([
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js"),
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"),
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
  ]);
}

// --- UVOZ ---
// file: File objekat (.csv ili .xlsx). Vraća niz objekata (redova) sa ključevima iz header-a.
export async function importFile(file) {
  await ensureLibs();
  const isCsv = file.name.toLowerCase().endsWith(".csv");
  if (isCsv) {
    const text = await file.text();
    // eslint-disable-next-line no-undef
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    return parsed.data;
  }
  const buf = await file.arrayBuffer();
  // eslint-disable-next-line no-undef
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // eslint-disable-next-line no-undef
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

// --- IZVOZ CSV ---
export function exportCsv(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")].concat(
    rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))
  );
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
}

// --- IZVOZ EXCEL ---
export async function exportExcel(filename, rows, sheetName = "Podaci") {
  await ensureLibs();
  // eslint-disable-next-line no-undef
  const ws = XLSX.utils.json_to_sheet(rows);
  // eslint-disable-next-line no-undef
  const wb = XLSX.utils.book_new();
  // eslint-disable-next-line no-undef
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  // eslint-disable-next-line no-undef
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// --- IZVOZ PDF (tabela) — koristi HTML + html2canvas + DejaVu Sans font, isto
// kao narudžbenica (order-print.js), da bi č/ć/š/ž/đ i traženi font bili ispravni.
async function ensureFontFace(regularB64, boldB64) {
  if (document.getElementById("dejavu-font-face")) return;
  const style = document.createElement("style");
  style.id = "dejavu-font-face";
  style.textContent = `
    @font-face {
      font-family: "DejaVu Sans";
      src: url(data:font/truetype;charset=utf-8;base64,${regularB64}) format("truetype");
      font-weight: normal;
      font-style: normal;
    }
    @font-face {
      font-family: "DejaVu Sans";
      src: url(data:font/truetype;charset=utf-8;base64,${boldB64}) format("truetype");
      font-weight: bold;
      font-style: normal;
    }
  `;
  document.head.appendChild(style);
}

async function ensureLibsAndFont() {
  await Promise.all([
    ensureLibs(),
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
  ]);
  // Font se učitava dinamički (lazy) — ne opterećuje običan prikaz stranice.
  const { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } = await import("./fonts-dejavu.js");
  ensureFontFace(DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64);
  await document.fonts.load("400 12px 'DejaVu Sans'");
  await document.fonts.load("700 12px 'DejaVu Sans'");
  await document.fonts.ready;
}

function escapeHtmlPdf(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function exportPdf(filename, title, rows) {
  await ensureLibsAndFont();
  // eslint-disable-next-line no-undef
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "pt", "a4");

  const headers = rows.length ? Object.keys(rows[0]) : [];
  const container = document.createElement("div");
  // Ne pomerati van vidljivog prostora (npr. left:-9999px) — html2canvas snima samo
  // unutar virtuelnog prozora veličine windowWidth, pa bi PDF ispao prazan.
  container.style.cssText = "position:absolute; top:0; left:0; z-index:-9999; background:#fff;";
  container.innerHTML = `
    <div style="font-family:'DejaVu Sans', Arial, Helvetica, sans-serif; color:#1a1d21; width:760px;">
      <div style="font-size:17px; font-weight:700; margin-bottom:14px;">${escapeHtmlPdf(title)}</div>
      <table style="width:100%; border-collapse:collapse; font-size:10.5px;">
        <thead>
          <tr style="background:#f3f5f8;">
            ${headers.map((h) => `<th style="text-align:left; padding:6px 8px; border-bottom:1px solid #d8dde3;">${escapeHtmlPdf(h)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              ${headers.map((h) => `<td style="padding:5px 8px; border-bottom:1px solid #f0f2f4;">${escapeHtmlPdf(r[h])}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  document.body.appendChild(container);

  try {
    await new Promise((resolve, reject) => {
      doc.html(container, {
        x: 20, y: 20, width: 555, windowWidth: 800,
        callback: () => resolve(),
        html2canvas: { scale: 0.7, useCORS: true },
      });
      setTimeout(() => reject(new Error("Isteklo vreme za generisanje PDF-a.")), 25000);
    });
  } finally {
    document.body.removeChild(container);
  }

  doc.save(`${filename}.pdf`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
