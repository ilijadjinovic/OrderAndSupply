# Plutajući prikaz uz redove tabela + pretraga kataloga

## Plutajući prikaz (balon)
Hover mišem otvara balon sa osnovnim sadržajem reda; na telefonu/tabletu (bez hovera) otvara ga dodir na ikonicu **„i"** u ćeliji reda (običan dodir na red radi kao i ranije).

| Tabela | Gde se hoveruje | Sadržaj balona |
|---|---|---|
| Izveštaji → Po narudžbenicama | prva ćelija (broj) | broj + status, ko je tražio, dobavljači, artikli sa količinama (do 12), plaćeno po dobavljaču. Ne prikazuje se kad je štikliran „Detaljno" |
| Izveštaji → Po naručiocima | ceo red | broj narudžbina po statusu, ukupan iznos, poslednja narudžbina, 3 najčešća dobavljača |
| Izveštaji → Po isporučiocima | ceo red | isto + 3 najčešća naručioca |
| Izveštaji → Po dobavljačima | ceo red | ukupno plaćeno, broj narudžbina, kontakt, 5 najtraženijih artikala tog dobavljača |
| Izveštaji → Po artiklima | ceo red | šifra, ukupna količina, broj narudžbina, najčešći naručioci i dobavljači |
| Izveštaji → raširen red (sva 4 taba) | broj narudžbenice u listi | isti balon kao na tabu „Po narudžbenicama": status, ko je tražio, dobavljači, artikli, plaćeno po dobavljaču |
| Dobavljači | ceo red | PIB, MB, kontakt, email, adresa, radno vreme, napomena + lokacije preuzimanja (✅/⚠/❌) |
| Katalog | ceo red | naziv, šifra, barkod, kategorija, JM, PDV, min. količina, status |
| Lokacije za isporuku | ceo red | adresa, koordinate, tačnost, datum ažuriranja |
| Šabloni i liste | ceo red | sve stavke sa količinama, dani ponavljanja |
| Korisnici | ceo red | email, uloga, status, datum registracije (samo podaci iz liste) |
| Master admin → Firme / Dnevnik | ceo red | podaci firme / ceo zapis sa punim tekstom detalja |
| Detalj narudžbine → Stavke | ćelija sa nazivom | šifra, dobavljač, lokacije, traženo/kupljeno, status, zamena, napomena, račun |
| Kontrolne table | prva ćelija (broj) | kao do sada |

Red agregacije koji je već otvoren (klik u izveštajima) nema svoj balon, ali narudžbenice u njegovoj listi imaju; iznad dugmadi i polja u redu balon se ne prikazuje. Izveštaji i većina tabela ne prave nova čitanja; jedini izuzetak su lokacije dobavljača (jedno čitanje po dobavljaču, pamti se 20 s) i stavke narudžbine na kontrolnim tablama (kao i ranije).

Kod: `js/row-popover.js` (mehanika), `js/table-popovers.js` (sadržaj), `js/report-popovers.js`, `js/order-items-popover.js`. Nova tabela: `attachRowPopover(tbody, { hoverSelector, getContent })` + `itemsInfoBtnHtml()` u ćeliji za telefon.

## Pretraga kataloga
Iznad liste artikala dobavljača: polje za pretragu (naziv, šifra, barkod), filter kategorije, filter statusa i brojač „Prikazano X od Y".
- bez razlike veliko/malo slovo i kvačice (š→s, č/ć→c, ž→z, đ→dj, dž→dz); radi i ćirilica; kod više reči moraju sve
- „izaberi sve" i grupne akcije (izmena, pasivizacija, brisanje) važe samo za prikazane artikle
- promena pretrage/filtera poništava izbor sakrivenih artikala (uz obaveštenje)
- pretraga i filteri se brišu pri promeni dobavljača; Esc ili × briše pretragu

Kod: `js/catalog-search.js`; testovi: `node tests/catalog-search.test.mjs`.

## Pretraga na glavnoj tabli admina
Polje „Pretraga: broj, artikal, osoba, dobavljač, lokacija..." u zaglavlju panela „Narudžbine" (isto kao na tablama naručioca i isporučioca; koristi isto polje `searchText`, pa nalazi i lokacije isporuke).
- Istorija (do 5000 najnovijih narudžbina) se čita jednom i pamti 5 min; dalje kucanje ne pravi nova čitanja, a istovremena pretraga deli isto čitanje.
- Firma sa više od 5000 narudžbina: pretraga jedne reči se dopunjava pretragom po početku broja direktno u bazi, pa se starije narudžbine i dalje nalaze po broju (u brojaču piše da je pretraženo najnovijih 5000).
- Stare narudžbine bez polja `searchText` ne pojavljuju se u pretrazi po tekstu dok se ne pokrene `backfill-orders.html` (isto važi za ostale table).
- Kartica (Aktivne, Kasne...) i pretraga se i dalje međusobno isključuju.
- Placeholder na sve tri table sada pominje lokaciju (ključ `dash_search_placeholder`).

## Instalacija
Nema novih indeksa niti izmena pravila baze. Otpremi fajlove i osveži stranicu (Ctrl+F5). Novi i18n ključevi: 19 (sr + en).
