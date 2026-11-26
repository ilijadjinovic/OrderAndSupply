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

## Sledeće faze
2. Stavke računa (cena, rabat, iznos) + usaglašavanje sa stavkama narudžbine („nema svog para“, višak, manjak;
   naručene količine se ne menjaju).
3. Skeniranje QR fiskalnog računa (poseban Cloudflare Worker za ovu app).
4. Izveštaji po računima.
