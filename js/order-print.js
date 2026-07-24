// ============================================================================
// PDF NARUDŽBENICA — izvoz za štampu (Poglavlje 4/5)
// Zaglavlje firme + stavke grupisane po dobavljaču (kao u app-u) + finansijski
// pregled (ako je uneto) + mesta za potpis naručioca/isporučioca i overu.
//
// Koristi jsPDF .html() (uz html2canvas) umesto ručnog upisivanja teksta na
// koordinate, jer tako ispravno renderuje srpske dijakritičke znakove
// (č, ć, š, ž, đ) — ugrađeni jsPDF fontovi (WinAnsi) ih ne podržavaju.
// ============================================================================
import { escapeHtml, formatDate } from "./utils.js";

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
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
  ]);
}

async function loadLibsAndFont() {
  await ensureLibs();
  // Font se učitava dinamički (lazy) — fajl je ~2MB base64, ne opterećuje običan prikaz stranice.
  const { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } = await import("./fonts-dejavu.js");
  ensureFontFace(DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64);
  // Sačekaj da font zaista bude spreman pre nego što html2canvas snimi sadržaj — u suprotnom
  // može doći do "flash" efekta gde se prvo renderuje sistemski font.
  await document.fonts.load("400 12px 'DejaVu Sans'");
  await document.fonts.load("700 12px 'DejaVu Sans'");
  await document.fonts.ready;
  return { regularB64: DEJAVU_SANS_REGULAR_B64, boldB64: DEJAVU_SANS_BOLD_B64 };
}

function fontFaceCss(regularB64, boldB64) {
  return `
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
}

// Font-face pravilo se dodaje i u <head> (da bi document.fonts.load/ready mogao da ga učita
// unapred), ALI jsPDF-ov .html()/html2canvas ne "vidi" stilove iz <head> dokumenta — on snima
// samo prosleđeni element. Zato se isto @font-face pravilo mora ponoviti i kao <style> UNUTAR
// kontejnera koji se predaje doc.html() (vidi generateOrderPdf) — inače font tiho pada nazad
// na Arial/Helvetica iako je "učitan".
function ensureFontFace(regularB64, boldB64) {
  if (document.getElementById("dejavu-font-face")) return;
  const style = document.createElement("style");
  style.id = "dejavu-font-face";
  style.textContent = fontFaceCss(regularB64, boldB64);
  document.head.appendChild(style);
}

function fmtAmount(n, currency) {
  return `${(Number(n) || 0).toLocaleString("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function fmtIsoDate(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr + "T00:00:00");
  if (isNaN(d)) return escapeHtml(isoStr);
  return d.toLocaleDateString("sr-RS", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function buildOrderHtml({ company, order, items, purchases, deliveryLocations }) {
  const currency = company?.currency || "RSD";
  const bySupplier = {};
  items.forEach((i) => {
    (bySupplier[i.supplierId] ||= { name: i.supplierName, items: [] }).items.push(i);
  });

  const supplierBlocks = Object.values(bySupplier).map((group) => `
    <div style="margin-top:16px; border:1px solid #d8dde3; border-radius:6px; overflow:hidden;">
      <div style="background:#f3f5f8; padding:8px 12px; font-weight:700; font-size:13px; border-bottom:1px solid #d8dde3;">
        Dobavljač: ${escapeHtml(group.name)}
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:11.5px;">
        <thead>
          <tr style="background:#fafbfc;">
            <th style="text-align:left; padding:6px 12px; border-bottom:1px solid #e5e8ec;">Proizvod</th>
            <th style="text-align:left; padding:6px 12px; border-bottom:1px solid #e5e8ec;">Količina</th>
            <th style="text-align:left; padding:6px 12px; border-bottom:1px solid #e5e8ec;">Lokacija isporuke</th>
            <th style="text-align:left; padding:6px 12px; border-bottom:1px solid #e5e8ec;">Napomena</th>
          </tr>
        </thead>
        <tbody>
          ${group.items.map((it) => `
            <tr>
              <td style="padding:6px 12px; border-bottom:1px solid #f0f2f4;">${escapeHtml(it.productName)}</td>
              <td style="padding:6px 12px; border-bottom:1px solid #f0f2f4;">${it.quantity} ${escapeHtml(it.unit)}</td>
              <td style="padding:6px 12px; border-bottom:1px solid #f0f2f4;">${escapeHtml(it.deliveryLocationName || "—")}</td>
              <td style="padding:6px 12px; border-bottom:1px solid #f0f2f4; color:#555;">${escapeHtml(it.note || "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `).join("");

  const total = (purchases || []).reduce((s, p) => s + (Number(p.paidAmount) || 0), 0);
  const financeSection = total > 0 ? `
    <div style="margin-top:22px;">
      <div style="font-weight:700; font-size:13px; margin-bottom:6px;">Finansijski pregled</div>
      <table style="width:100%; border-collapse:collapse; font-size:11.5px;">
        <thead>
          <tr style="background:#fafbfc;">
            <th style="text-align:left; padding:6px 12px; border-bottom:1px solid #e5e8ec;">Dobavljač</th>
            <th style="text-align:left; padding:6px 12px; border-bottom:1px solid #e5e8ec;">Broj računa</th>
            <th style="text-align:left; padding:6px 12px; border-bottom:1px solid #e5e8ec;">Datum računa</th>
            <th style="text-align:right; padding:6px 12px; border-bottom:1px solid #e5e8ec;">Iznos</th>
          </tr>
        </thead>
        <tbody>
          ${purchases.filter((p) => p.paidAmount).map((p) => `
            <tr>
              <td style="padding:6px 12px; border-bottom:1px solid #f0f2f4;">${escapeHtml(p.supplierName)}</td>
              <td style="padding:6px 12px; border-bottom:1px solid #f0f2f4;">${escapeHtml(p.receiptNumber || "—")}</td>
              <td style="padding:6px 12px; border-bottom:1px solid #f0f2f4;">${fmtIsoDate(p.receiptDate)}</td>
              <td style="padding:6px 12px; border-bottom:1px solid #f0f2f4; text-align:right;">${fmtAmount(p.paidAmount, currency)}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:8px 12px; text-align:right; font-weight:700;">UKUPNO ZA NARUDŽBINU:</td>
            <td style="padding:8px 12px; text-align:right; font-weight:700;">${fmtAmount(total, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  ` : "";

  const generatedAt = new Date().toLocaleString("sr-RS", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return `
    <div style="font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif; color:#1a1d21; width:760px; padding:0;">

      <!-- ZAGLAVLJE FIRME -->
      <div style="border-bottom:2px solid #1a1d21; padding-bottom:10px; margin-bottom:16px;">
        <div style="font-size:19px; font-weight:700;">${escapeHtml(company?.name || "Firma")}</div>
        <div style="font-size:11px; color:#555; margin-top:4px; line-height:1.5;">
          ${company?.address ? `Adresa: ${escapeHtml(company.address)}<br/>` : ""}
          ${company?.pib ? `PIB: ${escapeHtml(company.pib)}${company?.maticniBroj ? ` &nbsp;·&nbsp; Matični broj: ${escapeHtml(company.maticniBroj)}` : ""}<br/>` : ""}
          ${company?.phone ? `Telefon: ${escapeHtml(company.phone)}` : ""}
        </div>
      </div>

      <!-- NASLOV + META -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="font-size:17px; font-weight:700;">NARUDŽBENICA br. ${escapeHtml(order.orderNumber)}</div>
        <div style="font-size:11px; color:#555; text-align:right;">
          Datum kreiranja: ${formatDate(order.createdAt)}<br/>
          Prioritet: ${order.priority === "hitno" ? "Hitno" : "Standardno"}
        </div>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:12px;">
        <tr>
          <td style="padding:4px 0; width:120px; color:#555;">Naručilac:</td>
          <td style="padding:4px 0; font-weight:600;">${escapeHtml(order.createdByName || "—")}</td>
          <td style="padding:4px 0; width:120px; color:#555;">Isporučilac:</td>
          <td style="padding:4px 0; font-weight:600;">${escapeHtml(order.assignedToName || "—")}</td>
        </tr>
        <tr>
          <td style="padding:4px 0; color:#555;">Lokacije isporuke:</td>
          <td colspan="3" style="padding:4px 0; font-weight:600;">${(deliveryLocations || []).map((l) => escapeHtml(l.locationName)).join(", ") || "—"}</td>
        </tr>
      </table>

      <!-- STAVKE GRUPISANE PO DOBAVLJAČU -->
      ${supplierBlocks}

      ${financeSection}

      <!-- OVERA -->
      <div style="margin-top:26px; padding-top:14px; border-top:1px solid #d8dde3; font-size:12px;">
        <div style="margin-bottom:10px;">☐ &nbsp;Narudžbina je realizovana i po istoj je postupljeno u celosti.</div>
        <div>Datum overe: ______________________</div>
      </div>

      <!-- POTPISI -->
      <table style="width:100%; border-collapse:collapse; margin-top:36px; font-size:11.5px;">
        <tr>
          <td style="width:33%; padding-right:14px;">
            <div style="border-top:1px solid #1a1d21; padding-top:6px;">Naručilac</div>
            <div style="margin-top:18px; color:#555;">Datum: ______________</div>
          </td>
          <td style="width:33%; padding-right:14px;">
            <div style="border-top:1px solid #1a1d21; padding-top:6px;">Isporučilac</div>
            <div style="margin-top:18px; color:#555;">Datum: ______________</div>
          </td>
          <td style="width:34%;">
            <div style="border-top:1px solid #1a1d21; padding-top:6px;">Overio (rukovodilac)</div>
            <div style="margin-top:18px; color:#555;">Datum: ______________</div>
          </td>
        </tr>
      </table>

      <div style="margin-top:24px; font-size:9px; color:#999;">Dokument generisan iz sistema za naručivanje i nabavku — ${generatedAt}</div>
    </div>
  `;
}

// company: dokument firme (name, address, pib, maticniBroj, phone, currency)
// order: dokument narudžbine
// items: sve stavke narudžbine (OrderItems)
// purchases: nabavke po dobavljaču (za finansijski pregled, može biti prazan niz)
// deliveryLocations: lokacije isporuke narudžbine
export async function generateOrderPdf({ company, order, items, purchases = [], deliveryLocations = [] }) {
  const { regularB64, boldB64 } = await loadLibsAndFont();
  // eslint-disable-next-line no-undef
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "pt", "a4");

  const container = document.createElement("div");
  // VAŽNO: ne sme se pomerati van vidljivog prostora (npr. left:-9999px) — html2canvas
  // snima sadržaj unutar virtuelnog prozora veličine windowWidth, pa bi element van tog
  // prostora bio nevidljiv i PDF bi ispao prazan. Umesto toga ostaje na (0,0) i sakriva
  // se iza ostatka stranice pomoću negativnog z-index-a.
  container.style.cssText = "position:absolute; top:0; left:0; z-index:-9999; background:#fff;";
  // @font-face MORA biti unutar kontejnera (ne samo u <head>) — jsPDF/html2canvas snima
  // samo prosleđeni element i ne "vidi" stilove definisane van njega.
  container.innerHTML = `<style>${fontFaceCss(regularB64, boldB64)}</style>`
    + buildOrderHtml({ company, order, items, purchases, deliveryLocations });
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

  doc.save(`Narudzbenica-${order.orderNumber}.pdf`);
}
