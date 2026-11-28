# Računi (naknadni unos troška) — faza 1

## Problem
Isporučilac često dobije samo otpremnicu (stavke bez cena), a račun stiže kasnije — kad je narudžbina
već zatvorena. Zato se iznos može upisati i **posle zatvaranja**.

## Model
Podkolekcija `companies/{c}/orders/{o}/invoices` — jedan dokument = jedan račun jednog dobavljača.
Polja: `supplierId, supplierName, purchaseId, number, date, source, vatRate, netAmount, vatAmount,
grossAmount, currency, note, attachmentUrl, createdByUid/Name, createdAt`.
Rezervisano za fazu 2: `lines` (stavke sa jediničnom cenom, rabatom, iznosom) i `matchStatus` (usaglašavanje).

- `source`: `rucno_ukupno` (faza 1), `faktura` (faza 2, sa stavkama), `fiskalni_qr` (faza 3).
- Iznosi: **osnovica (bez PDV-a) + PDV = ukupno sa PDV-om**. Stope: 20%, 10%, 0% ili „Ručno“ (račun sa više stopa).
- Nabavka (`purchases`) i dalje ima `paidAmount` — sada je to **zbir ukupnih iznosa (sa PDV-om)** svih računa
  tog dobavljača; uz njega `netAmount, vatAmount, invoiceCount, receiptNumber, receiptDate`. Zato izveštaji i
  PDF-ovi rade bez izmene. Nabavka `noInvoice: true` = „za ovog dobavljača račun ne postoji“.
- Narudžbina ima `invoiceStatus`: `bez_racuna` / `delimicno` / `kompletno` / `nije_potreban` i `invoicedTotal`.
  „Čeka račun“ = zatvorena narudžbina sa `bez_racuna` ili `delimicno`.

## Ko sme
Admin firme; naručilac koji je napravio narudžbinu; isporučilac kome je dodeljena — u svim fazama posle
prihvatanja, i na zatvorenim narudžbinama. Brisanje: admin uvek, ostali samo račun koji su sami uneli.
Pravila: `firestore.rules` (`canManageInvoices`), UI: `invoice-logic.js → canManageInvoices`.
Svaka izmena ide u audit log (`invoice_added / invoice_updated / invoice_deleted / invoice_marked_none`).

## Ekrani
- Detalji narudžbine → za svakog dobavljača blok **Računi** (dodaj, izmeni, obriši, prilog, „račun ne postoji“).
- Finansijski pregled: osnovica, PDV i ukupno po dobavljaču + zbir.
- Kontrolne table (admin, naručilac, isporučilac): kartica i oznaka **Čeka račun**.

## Stare narudžbine
1. Objaviti `firestore.rules`.
2. Admin jednom pokrene **Dopuna starih narudžbina** (`backfill-orders.html`) — upisuje `invoiceStatus`.
3. Raniji ručni iznos (pre računa) se prikazuje kao „raniji unos“ i računa se kao da račun postoji; klikom na ✏
   (ili pri dodavanju novog računa) pretvara se u pravi račun, bez gubitka iznosa. PDV za njega nije poznat.

## Poznata ograničenja
- Pravila za `purchases` i `items` i dalje dozvoljavaju pisanje svakom članu firme (ograničenje po ulozi važi za račune).
- Lista „sve narudžbine“ sa starije, učitane strane ne osvežava oznaku uživo dok se strana ne učita ponovo.

## Faza 2 — račun sa stavkama i usaglašavanje
U bloku **Računi** uz „Dodaj račun“ (samo ukupan iznos) postoji **„Račun sa stavkama“**.

**Stavke računa** (`lines` u dokumentu računa): naziv, šifra, količina, jedinica, jedinična cena, rabat %, PDV %,
iznos bez PDV-a i sa PDV-om. Iznos stavke se računa iz količine, cene i rabata, a može i ručno da se upiše „kako piše
na računu“ (zbog zaokruživanja). Opcija „Cene na računu su sa PDV-om“ je za račune sa cenama sa PDV-om (fiskalni).
Zbir stavki (osnovica, PDV po stopama, ukupno) puni zaglavlje računa; polje „Ukupno sa fakture (kontrola)“ pokazuje
razliku ako se zbir ne slaže sa fakturom.

**Veza sa narudžbinom** (po stavci računa):
- upareno sa artiklom iz narudžbine (ručno, **„Automatski upari“** po šifri/nazivu, ili **„Popuni iz narudžbine“**)
- **„nema svog para“** → mora se rešiti: *dodatni trošak* (dostava, ambalaža…) ili *višak* (preuzeto, a nije naručeno)

**Usaglašavanje po artiklu**: naručeno · preuzeto · na računu, sa statusom: poklapa se / na računu manje / na računu
više / nema na računu.
- **Naručene količine se nikad ne menjaju.**
- **„Ispravi preuzeto → X“** je predlog: menja samo preuzetu količinu i status artikla (kupljeno / nije pronađeno), i to
  **tek kad se unos potvrdi**; svaka ispravka ide u audit log (`item_purchased_corrected`) i u račun (`corrections`).
- **Višak** (preuzeto preko naručenog i stavke „višak“): opcija **dodatne narudžbine** sa unapred popunjenim stavkama.
  Pošto narudžbine kreira samo naručilac (firestore.rules), opciju vidi uloga naručilac; ostali dobiju napomenu.
- **Nacrt**: račun može da se sačuva kao nacrt (ne ulazi u iznos nabavke ni u status „Čeka račun“) i da se kasnije
  potvrdi. **„Potvrdi unos“** traži da su sve stavke upareno ili rešene.
- `matchStatus`: `usaglaseno` / `usaglaseno_uz_razlike` / `nije_usaglaseno`.

Fajlovi: `invoice-lines.js`, `invoice-match.js` (čista logika), `invoice-lines-ui.js` (ekran), `invoices.js`
(`saveInvoiceWithLines`), testovi `tests/invoice-lines.test.mjs`.

## Faza 3 — fiskalni račun (QR)
U ekranu „Račun sa stavkama“ (i u bloku Računi) postoji **„📷 Skeniraj QR“**; dostupno je svakome ko sme da unosi račune
(isporučilac, naručilac, admin).

- **Kamera** (ugrađeni BarcodeDetector, a gde ga nema lokalna biblioteka `js/vendor/jsQR.js`, Apache-2.0) ili
  **nalepljen link** iz QR koda (npr. skeniran drugim uređajem i prekopiran).
- Račun se preuzima preko Cloudflare Worker-a (`docs/WORKER.md`). Popunjava se: broj računa (= PFR), datum, stavke
  (cene **sa PDV-om**, stopa po stavci), kontrolni zbir; `source: fiskalni_qr`, `fiscal` (PFR, prodavac, rekapitulacija).
- Dalje ide isti tok kao za fakturu: automatsko uparivanje, „nema svog para“, ispravka preuzetog, nacrt, potvrda.
- **PDV**: stopa dolazi iz poreske rekapitulacije računa (rezerva: Đ 20, E 10, G 0, A 0). Stavka sa nepoznatom stopom
  ima izbor „?“ i ne može da se potvrdi dok se stopa ne izabere. Ukupan porez sa računa se poredi sa PDV-om iz stavki.
- **Duplikati**: evidencija `companies/{c}/fiscalReceipts/{PFR}` (`uses[invoiceId]`). Pri ponovnom učitavanju istog računa
  korisnik dobija upozorenje sa spiskom gde je već unet i može da potvrdi (isti račun se deli između narudžbina; obrišite
  stavke koje se ne odnose na ovu narudžbinu). Tada se kontrolni zbir ne popunjava. Brisanje računa briše i evidenciju.
- Podešavanje: `js/receipt-config.js` (adresa Worker-a). Pravila: `fiscalReceipts` u `firestore.rules`.

Testovi: `tests/fiscal-logic.test.mjs`, `tests/worker.test.mjs`, `tests/ui-smoke.mjs` (potreban `npm i jsdom`).

## Sledeće faze
4. Izveštaji po računima (trošak po artiklu/dobavljaču, cena kroz vreme, razlike naručeno/fakturisano).
