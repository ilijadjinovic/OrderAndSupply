# Cloudflare Worker za fiskalne račune (QR)

Fajl: `cloudflare/worker.js`. Isti Worker služi za **više aplikacija** (FleetManager, OrderAndSupply, nova aplikacija
za čitanje računa...). Prima link iz QR koda (`https://suf.purs.gov.rs/v/?vl=...`), preuzima račun sa
`suf.purs.gov.rs` i vraća ga kao JSON (prodavac, PFR broj, vreme, ukupno, stavke, PDV).

## Podešavanje u Cloudflare-u (Workers & Pages → tvoj Worker → Settings → Variables and Secrets)
| Promenljiva | Vrednost |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase projekti svih aplikacija, odvojeni zarezom: `fleet-manager-cfd6c,orderandsupply` |
| `ALLOWED_ORIGINS` | Adrese aplikacija, odvojene zarezom, npr. `https://tvoje-ime.github.io` (bez kose crte i bez naziva repozitorijuma). Na GitHub Pages sve aplikacije sa istog naloga dele istu adresu. Ako aplikacija radi i u APK-u, dodati i `https://localhost`. |

Zatim zameni kod Worker-a sadržajem `cloudflare/worker.js` (Edit code → nalepi → Deploy).
Nova aplikacija se dodaje samo dopisivanjem njenog `projectId` (i adrese, ako je drugačija) — kod se ne menja.

## Podešavanje u aplikaciji
`js/receipt-config.js` → `RECEIPT_WORKER_URL = "https://<ime-workera>.<nalog>.workers.dev"`.
Dok je prazno, dugme „Skeniraj QR“ javlja da skeniranje nije podešeno.

## Šta Worker proverava
- adresa aplikacije mora biti na spisku `ALLOWED_ORIGINS`;
- mora postojati važeći Firebase ID token (potpis, istek, izdavalac) iz jednog od projekata sa spiska;
- link mora biti `https://suf.purs.gov.rs/v/?vl=...` (ne može da se koristi kao otvoren proksi).

## Odgovor (dopune za PDV; stara polja ostaju ista, pa FleetManager radi kao ranije)
- `items[].taxLabel` — oznaka poreske stope sa stavke (latinicom: `Đ`, `E`, `G`, `A`);
- `items[].vatRate` / `vatSource` — stopa PDV-a (%) i izvor: `recap` (iz poreske rekapitulacije samog računa) ili
  `table` (rezervna tabela: Đ = 20, E = 10, G = 0, A = 0); `null` ako se ne zna;
- `taxes[]` — poreska rekapitulacija sa računa (`label`, `name`, `rate`, `tax`); `totalTax` — ukupan porez;
- `diag` — `taxRecapRows` (koliko redova rekapitulacije je pročitano) i `itemsWithoutVat`.

## Ako PDV nije pročitan na pravom računu
Stavke se i dalje učitavaju; stavke bez stope se u aplikaciji označe (izbor „?“) i moraju se ručno izabrati pre
potvrde. Ako se to dešava često, pošalji `diag` i žurnal tog računa — parser rekapitulacije (`parseTaxRecap`)
je pisan po opisu formata i probavan na izmišljenom žurnalu (`tests/worker.test.mjs`), ne na pravom računu.

## Testovi
`node tests/worker.test.mjs` — parsiranje žurnala, PDV, provera tokena iz više projekata.
