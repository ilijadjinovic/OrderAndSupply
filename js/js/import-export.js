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

// --- IZVOZ PDF (jednostavna tabela) ---
export async function exportPdf(filename, title, rows) {
  await ensureLibs();
  // eslint-disable-next-line no-undef
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  let y = 26;
  doc.setFontSize(9);
  if (rows.length) {
    const headers = Object.keys(rows[0]);
    doc.text(headers.join("  |  "), 14, y);
    y += 6;
    rows.forEach((r) => {
      const line = headers.map((h) => String(r[h] ?? "")).join("  |  ");
      doc.text(line.slice(0, 110), 14, y);
      y += 6;
      if (y > 280) { doc.addPage(); y = 16; }
    });
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
