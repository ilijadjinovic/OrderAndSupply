# Master Admin i bezbednost (besplatan Firebase plan)

Sve ispod radi na **Spark (besplatnom) planu** — bez Cloud Functions, samo klijentski kod + `firestore.rules` + `storage.rules`.

## 1. Šta master admin sada vidi i može

**Stranica „Firme" (`master-admin.html`)**
- Kartice: firme (ukupno / aktivne / blokirane / obrisane), korisnici, narudžbine (ukupno i 30 dana), nove firme (30 dana).
- Tabela svih firmi: pretraga (naziv, PIB, email), filter po statusu, sortiranje; kolone broj korisnika, narudžbine, poslednja aktivnost.
- Akcije: **Detalji**, **Log**, **Blokiraj/Odblokiraj** (sa razlogom), **Obriši** (arhiviranje — firma se može vratiti), **Vrati**, **Trajno obriši** (samo za već obrisanu firmu; traži upis tačnog naziva).
- Ako se podaci ne učitaju, prikazuje se razlog (najčešće: pravila nisu objavljena) umesto praznog ekrana.
- „Dnevnik master admina": sve akcije na nivou platforme (nepromenljiv zapis).

**Stranica „Detalji firme" (`master-company.html?id=…`)**
- **Pregled:** podaci firme, podešavanja, ko je registrovao, status i razlog blokade.
- **Korisnici:** svi korisnici firme (uloga, status, poslednja aktivnost); aktiviraj/deaktiviraj nalog, pošalji link za reset lozinke.
- **Statistika:** narudžbine po statusu i po mesecima (poslednjih 6), broj dobavljača i lokacija, najaktivniji naručioci/isporučioci i prioriteti (iz poslednjih 200 narudžbina).
- **Dnevnik:** audit log firme (poslednjih 200) sa filterom.
- **Pretplata i beleška:** evidencija plana/važenja (informativna) i interna beleška.

Master admin **ne vidi** stavke narudžbina, cene/nabavke, poruke ni priloge. Svako otvaranje detalja firme upisuje se u dnevnik master admina.

## 2. Bezbednosne ispravke

| # | Problem | Ispravka |
|---|---|---|
| 1 | Svako ko napravi nalog mogao je sebi da upiše `role: master_admin` ili tuđu firmu | Samoregistracija je dozvoljena samo kao `admin` firme koja nastaje u istom batch-u i čiji je korisnik kreator (`createdByUid`); `master_admin` se nikad ne može dodeliti iz klijenta |
| 2 | Admin firme mogao je da menja `role`/`companyId` zaposlenih | Dozvoljene uloge su samo `admin/narucilac/isporucilac`; `companyId` i `uid` se ne menjaju |
| 3 | Admin firme mogao je sam da odblokira firmu ili menja pretplatu | Polja `status`, `subscription`, `blockReason`… menja samo master admin |
| 4 | Storage bez izolacije firmi | Pristup samo fajlovima sopstvene firme (provera preko Firestore profila); popravljeno i brisanje priloga |
| 5 | Blokada firme nije se primenjivala | Blokirana/obrisana firma gubi pristup u pravilima, a korisnik dobija poruku pri prijavi i odjavu na svakoj strani |
| 6 | Brisanje firme ostavljalo siročad podatke | Meko brisanje (arhiva) + trajno čišćenje svih podataka firme iz aplikacije |
| 7 | Audit log se mogao lažirati | `actorUid` je uvek uid prijavljenog korisnika, vreme je serversko; master akcije u nepromenljivom `platformAuditLogs` |
| 8 | Registracija nije bila atomska | Firma + korisnik + usersIndex u jednom batch-u; pri grešci se uklanja nastali Auth nalog |
| 9 | Nema App Check | Opciono uključivanje (vidi ispod) |

**Namerno nepromenjeno:** pisanje u stavke/nabavke/reklamacije narudžbine ostaje dozvoljeno svim ulogama firme, jer sve tri uloge legitimno upisuju u svoj deo toka. Sužavanje po vlasniku narudžbine zahtevalo bi dodatna `get()` čitanja po operaciji i moglo bi da pokvari tok bez testiranja na tvojim podacima.

## 3. Kako objaviti (redosledom)

1. **Kod i pravila objavi zajedno** (odmah jedno za drugim): postavi nove fajlove na GitHub Pages, pa objavi pravila. Stari kod ne radi sa novim pravilima samo na jednom mestu — registracija nove firme (nova verzija `auth.js` je atomska).
2. **Firestore → Rules** → nalepi `firestore.rules` → *Publish*.
3. **Storage → Rules** → nalepi `storage.rules` → *Publish*; ako Firebase traži, potvrdi **Grant access** (Storage čita Firestore za proveru firme).
4. U Firebase konzoli proveri da tvoj `users/{uid}` ima `role: "master_admin"` (već imaš) i prijavi se ponovo.
5. Otvori **Firme** i klikni **Osveži** — kartice treba da pokažu brojeve.

## 4. Lista za ručno testiranje (Rules Playground ili aplikacija)

- Nov nalog preko `register-company.html` → prolazi; firma i admin se pojave u listi korisnika firme.
- Iz konzole browsera pokušaj `setDoc(doc(db,"users",MOJ_UID),{role:"master_admin",…})` kao običan korisnik → **mora da padne** (permission-denied).
- Admin firme pokuša da promeni `role` zaposlenog u `master_admin` ili `status` firme → **mora da padne**.
- Blokiraj firmu → korisnici te firme pri sledećoj strani/prijavi dobijaju poruku i odjavu; **Odblokiraj** vraća pristup.
- Obriši (arhiviraj) → Vrati → ponovo obriši → **Trajno obriši** na test firmi; proveri da se lista korisnika ispisuje za ručno brisanje u Authentication.
- Otpremi sliku priloga kao član firme A, pa pokušaj čitanje kao član firme B → **mora da padne**.
- Obriši narudžbinu sa prilogom → fajl nestaje iz Storage-a.

## 5. Ograničenja besplatnog plana (važno)

- **Auth nalozi se ne mogu obrisati iz aplikacije.** Posle trajnog brisanja firme aplikacija prikaže emailove koje treba ručno ukloniti u *Authentication → Users*; dok se to ne uradi, email ostaje zauzet za novu registraciju.
- Dnevnik master admina beleži akcije urađene kroz aplikaciju; izmene direktno u konzoli se ne beleže.
- Pretplata je samo evidencija — ne blokira automatski. Za prekid pristupa koristi **Blokiraj**.
- Statistika koristi `count()` upite (jeftino), ali po firmi ima ~20 upita pri otvaranju kartice „Statistika"; globalna tabela radi ~4 upita po firmi pri učitavanju (rezultat se kešira dok je stranica otvorena).
- Pravila nisu automatski testirana u Firebase emulatoru (nema pristupa mreži u okruženju gde su pisana) — obavezno prođi listu iz tačke 4.

## 6. App Check (opciono, besplatno)

1. Firebase konzola → *App Check* → registruj web aplikaciju sa **reCAPTCHA v3** (dodaj domen `ilijadjinovic.github.io`).
2. U `js/firebase-config.js` dodaj: `export const appCheckSiteKey = "TVOJ_SITE_KEY";`
3. Nekoliko dana ostavi u režimu **praćenja (monitor)**, pa tek onda uključi **Enforce** za Firestore i Storage.
4. Preporuka: ograniči i API ključ (Google Cloud → Credentials) na tvoje domene.
