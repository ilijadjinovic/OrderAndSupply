# Reklamacije — više artikala i potvrda naručioca

## Tok

1. **Otvaranje.** Naručilac (status narudžbine *Isporučena*) klikne *Otvori reklamaciju*. U prozoru je tabela svih artikala:
   kvačica, traženo, primljeno (unapred preuzeto iz panela za prijem), napomena po artiklu + zajednički opis problema.
   Artikli čija se primljena količina razlikuje od tražene su unapred štikliran. Za artikal sa količinom koja nije manja od
   tražene obavezno je upisati šta nije u redu (napomena po artiklu ili zajednički opis).
   Svaki štikliran artikal postaje **posebna reklamacija** (`orders/{id}/claims/{claimId}`, polje `itemId` + `itemName`).
   Narudžbina prelazi u status `reklamacija`, isporučilac dobija jednu notifikaciju.
2. **Rešavanje.** Isporučilac (ili admin) na svakoj reklamaciji klikne *Označi kao rešeno* i upiše rešenje (obavezno).
   Reklamacija dobija status `resena` (čeka potvrdu naručioca); naručilac dobija notifikaciju.
3. **Potvrda.** Naručilac na rešenoj reklamaciji bira:
   - *Potvrdi rešenje* → `zatvorena`; ili *Potvrdi sve rešene (n)* kad ih ima više;
   - *Vrati na obradu* (obavezna napomena) → ponovo `otvorena`, isporučilac dobija notifikaciju.
4. **Zatvaranje narudžbine.** Narudžbina ostaje u statusu `reklamacija` dok je bar jedna reklamacija nezatvorena.
   Kad se zatvori poslednja, narudžbina se zatvara **kao potvrda prijema** (`confirmReceiptFull`): upisuju se `confirmedAt`,
   `closedAt`, `processingMs`, potvrđuju se lokacije isporuke, šalje se notifikacija „Prijem potvrđen“.
5. **Izuzetak za admina.** Admin sme *Zatvori bez potvrde naručioca* (za otvorenu uz napomenu o rešenju, za rešenu uz potvrdu pitanja).
   Na kartici piše da je zatvoreno bez potvrde naručioca, a u reviziji je zapis `claim_closed`.

## Brojači na narudžbini

`claimsOpen` (čeka isporučioca) i `claimsPendingConfirm` (rešeno, čeka naručioca) upisuju se pri svakoj promeni (`claims.js`).
Stare narudžbine ih nemaju — tada se reklamacija smatra otvorenom (`hasOpenClaims`, `hasPendingClaims` u `dash-logic.js`).

## Kontrolne table

- **Naručilac:** kartica *Čeka moju potvrdu* obuhvata i narudžbine sa rešenim reklamacijama (u redu je dugme *Pregledaj reklamaciju*);
  kartica *Reklamacije* broji samo one koje još čekaju isporučioca. Rešene su na vrhu liste, uz isporučene.
- **Isporučilac:** kartica *Reklamacije* broji samo narudžbine sa otvorenim reklamacijama; rešene više nisu u bloku „Zahteva pažnju“.
- **Admin:** metrika uspešnosti i dalje broji narudžbine u statusu `reklamacija`.

## Fajlovi

`order-detail.html` (prozor), `js/page-order-detail.js` (forma, panel reklamacija), `js/claims.js` (tok), `js/dash-logic.js`,
`js/dash-common.js`, `js/page-dash-narucilac.js`, `js/page-dash-isporucilac.js`, `js/notifications.js`, `i18n/sr.json`, `i18n/en.json`,
`tests/dash-logic.test.mjs`. Pravila baze (`firestore.rules`) nisu menjana.

## Scenariji za testiranje

| # | Uloga | Radnja | Očekivano |
|---|-------|--------|-----------|
| 1 | Naručilac | Narudžbina *Isporučena* → *Otvori reklamaciju*. | Tabela svih artikala; oni sa drugačijom primljenom količinom su štiklirani. |
| 2 | Naručilac | Pošalji bez štiklirane stavke. | Greška „Štikliraj bar jedan artikal“. |
| 3 | Naručilac | Štikliraj 3 artikla, pošalji. | 3 reklamacije u panelu, narudžbina u statusu *Reklamacija*, isporučilac dobija jednu notifikaciju („… +2“). |
| 4 | Isporučilac | *Označi kao rešeno* bez teksta. | „Napomena je obavezna“. |
| 5 | Isporučilac | Reši sve tri. | Status svake „Rešeno — čeka potvrdu“; narudžbina je i dalje *Reklamacija*; kod isporučioca kartica *Reklamacije* = 0. |
| 6 | Naručilac | Kartica *Čeka moju potvrdu* = 1; otvori narudžbinu. | Dugmad *Potvrdi rešenje* / *Vrati na obradu* na svakoj, *Potvrdi sve rešene (3)* u zaglavlju. |
| 7 | Naručilac | *Vrati na obradu* jednu (uz napomenu). | Ta reklamacija je opet *Otvorena* sa napomenom „Naručilac vratio na obradu“; isporučilac dobija notifikaciju. |
| 8 | Naručilac | *Potvrdi sve rešene*. | Dve zatvorene, treća ostaje otvorena, narudžbina i dalje *Reklamacija*. |
| 9 | Isporučilac + naručilac | Reši i potvrdi poslednju. | Narudžbina *Zatvorena*, lokacije isporuke potvrđene, `processingMs` upisan, kartica *Danas završeno* +1. |
| 10 | Admin | Otvorena reklamacija → *Zatvori bez potvrde naručioca* (uz napomenu). | Zatvorena sa oznakom „bez potvrde naručioca“; ako je poslednja, zatvara se i narudžbina. |
| 11 | Naručilac | Stara narudžbina koja je ranije imala otvorenu reklamaciju. | I dalje se računa kao otvorena; isporučilac je rešava istim tokom. |
| 12 | Jezik | Prebaci na engleski. | Svi novi natpisi i poruke su na engleskom. |

## Namerno nije urađeno

- Prenos nedostajuće robe u novu narudžbinu pri potvrdi rešenja (dijalog iz *Potvrdi prijem*) — reklamacija i prenos manjka su i dalje dva odvojena toka.
