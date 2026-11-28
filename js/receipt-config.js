// ============================================================================
// Adresa Cloudflare Worker-a koji preuzima fiskalne račune sa suf.purs.gov.rs (cloudflare/worker.js).
// Isti Worker može da služi za više aplikacija (FleetManager, OrderAndSupply, ...): vidi docs/WORKER.md.
// Upiši adresu svog Worker-a, npr. "https://receipt-reader.tvoje-ime.workers.dev".
// Dok je prazno, dugme "Skeniraj QR" javlja da skeniranje nije podešeno.
// ============================================================================
export const RECEIPT_WORKER_URL = "https://fleet-receipt.ilija-djinovic.workers.dev";
