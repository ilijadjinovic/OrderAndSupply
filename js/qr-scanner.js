// ============================================================================
// QR SKENER — čitanje QR koda fiskalnog računa kamerom, ili unos (lepljenje) linka.
//   • kamera: ugrađeni BarcodeDetector gde postoji (Chrome/Android), inače lokalna biblioteka jsQR (js/vendor)
//   • rezerva: link iz QR koda (npr. skeniran drugim uređajem) može da se nalepi u polje
// Ne zavisi od Firebase-a. onUrl(url) se poziva sa proverenim linkom suf.purs.gov.rs.
// ============================================================================
import { t } from "./i18n.js";
import { extractReceiptUrl } from "./fiscal-logic.js";

let jsqrPromise = null;
function loadJsQR() {
  if (globalThis.jsQR) return Promise.resolve(globalThis.jsQR);
  if (!jsqrPromise) {
    jsqrPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = new URL("./vendor/jsQR.js", import.meta.url).href;
      s.onload = () => resolve(globalThis.jsQR);
      s.onerror = () => reject(new Error("jsqr_load"));
      document.head.appendChild(s);
    });
  }
  return jsqrPromise;
}

export function openQrScanner({ onUrl }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:520px;">
      <div class="modal-head"><h2>📷 ${t("scan_title")}</h2><button type="button" class="icon-btn" data-close>✕</button></div>
      <div id="qs-cam" style="background:#000;border-radius:10px;overflow:hidden;min-height:160px;display:flex;align-items:center;justify-content:center;">
        <video id="qs-video" playsinline muted style="width:100%;max-height:50vh;display:block;"></video>
      </div>
      <p id="qs-status" class="muted" style="font-size:13px;margin:8px 0;">${t("scan_hint")}</p>
      <div class="field"><label>${t("scan_paste_label")}</label>
        <div style="display:flex;gap:8px;"><input type="text" id="qs-link" placeholder="https://suf.purs.gov.rs/v/?vl=…" style="flex:1;" /><button type="button" class="btn btn-outline" id="qs-go">${t("scan_load_btn")}</button></div></div>
      <div id="qs-error" style="color:var(--color-danger,#c0392b);font-size:13px;min-height:18px;"></div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);
  let stream = null, stopped = false, timer = null;

  const stop = () => {
    stopped = true; clearTimeout(timer);
    stream?.getTracks().forEach((tr) => tr.stop());
    overlay.remove();
  };
  const accept = (text) => {
    const url = extractReceiptUrl(text);
    if (!url) { $("#qs-error").textContent = t("scan_not_receipt"); return false; }
    stop(); onUrl(url); return true;
  };
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", stop));
  $("#qs-go").addEventListener("click", () => accept($("#qs-link").value));
  $("#qs-link").addEventListener("keydown", (e) => { if (e.key === "Enter") accept($("#qs-link").value); });

  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) { $("#qs-status").textContent = t("scan_no_camera"); $("#qs-cam").style.display = "none"; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch { $("#qs-status").textContent = t("scan_camera_denied"); $("#qs-cam").style.display = "none"; return; }
    if (stopped) { stream.getTracks().forEach((tr) => tr.stop()); return; }
    const video = $("#qs-video");
    video.srcObject = stream; await video.play().catch(() => {});

    let detect;
    try {
      if ("BarcodeDetector" in globalThis) {
        const bd = new globalThis.BarcodeDetector({ formats: ["qr_code"] });
        detect = async () => (await bd.detect(video))[0]?.rawValue || "";
      }
    } catch { detect = null; }
    if (!detect) {
      try {
        const jsQR = await loadJsQR();
        const canvas = document.createElement("canvas"), ctx2 = canvas.getContext("2d", { willReadFrequently: true });
        detect = async () => {
          const w = video.videoWidth, h = video.videoHeight; if (!w || !h) return "";
          const k = Math.min(1, 720 / Math.max(w, h)); canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
          ctx2.drawImage(video, 0, 0, canvas.width, canvas.height);
          return jsQR(ctx2.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" })?.data || "";
        };
      } catch { $("#qs-status").textContent = t("scan_no_camera"); return; }
    }
    const tick = async () => {
      if (stopped) return;
      try { const v = await detect(); if (v && accept(v)) return; } catch { /* sledeći pokušaj */ }
      timer = setTimeout(tick, 300);
    };
    tick();
  })();
  return { close: stop };
}
