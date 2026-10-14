# Finančná liga — demo

Nasadené na **https://financna-liga.sk** (Vercel, automatický deploy z vetvy `main`). Napojené sú aj `https://www.financna-liga.sk` a pôvodná `https://financna-liga.vercel.app` — všetky tri vedú na tú istú appku.

Finančná liga je určená pre **stredné školy**. Pre základné školy vznikne samostatná inštancia.

Appka je statická — žiadny build krok, žiadny `npm install`, žiadne externé CDN ani písma. Vercel servuje súbory tak, ako sú v repe, a priečinok `api/` spúšťa ako serverless funkcie.

---

## Obsah

| Kapitola | Pre koho |
|---|---|
| [Nasadenie od nuly](#nasadenie-od-nuly) | keď treba postaviť druhú inštanciu |
| [Prevádzka dema](#prevádzka-dema) | bežné používanie, stropy, čo keď niečo nefunguje |
| [Deň stretnutia — checklist](#deň-stretnutia--checklist) | pred prezentáciou |
| [Testovací protokol dvoch telefónov](#testovací-protokol-dvoch-telefónov) | overenie na mobilných dátach |
| [Oblasti](#oblasti) a [Ako pridať oblasť](#ako-pridať-oblasť) | pridávanie obsahu bez programovania |
| [Obsah na odbornú kontrolu](#obsah-na-odbornú-kontrolu) | pre Júliu |
| [Zapekanie úprav do GitHubu](#zapekanie-úprav-do-githubu) | keď treba opravy obsahu dostať do repa |
| [Vlastná doména](#vlastná-doména) | ako je doména napojená a čo na nej závisí |
| [Školské oblasti](#školské-oblasti) | ⏳ pomôcky pre jedného žiaka a ako ich odstrániť |
| [Dočasná téma Číselné sústavy](#dočasná-téma-číselné-sústavy) | ⏳ ako ju odstrániť, keď doslúži |
| [Roadmapa](#roadmapa) | čo príde ďalej |

---

## Nasadenie od nuly

Postup na postavenie novej inštancie (napr. verzie pre ZŠ). Trvá ~30 minút.

### 1. GitHub

Nový repozitár a nahratie obsahu tohto:

```bash
git clone https://github.com/Soldanellka/financna-liga.git nova-instancia
```

```bash
cd nova-instancia && git remote set-url origin https://github.com/POUZIVATEL/NOVY-REPO.git && git push -u origin main
```

### 2. Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. **Realtime Database** → Create → lokalita **europe-west1** → režim **locked**.
3. Pravidlá: skopíruj obsah [database.rules.json](database.rules.json) do záložky **Rules** a publikuj. Zámerne nepovoľujú zápis na koreň ani na vrchol vetvy (anti-wipe) — preto reset beží cez server.
4. **Project settings → General → Your apps → Web app** → skopíruj `firebaseConfig` a vlož ho do [firebase.js](firebase.js). Nie je to tajomstvo, patrí do klientskeho kódu.
5. **Project settings → Service accounts → Generate new private key**. Zo stiahnutého JSON budeš potrebovať `client_email` a `private_key` — **nikam ich necommituj**, idú výhradne do Vercel env.

### 3. Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → naimportuj repozitár.
2. Framework preset **Other**, root `/`, build command **prázdny**.
3. Nastav env premenné (tabuľka nižšie) pre **Production aj Preview**.
4. **Deploy.**

### 4. Env premenné

| Názov | Povinná? | Bez nej |
|---|---|---|
| `ANTHROPIC_API_KEY` | pre AI funkcie | „Vysvetli mi to" aj AI skúška spadnú na statický fallback |
| `DEMO_RESET_SECRET` | pre reset | `/api/demo-reset` vráti 500 a nič nespraví |
| `FIREBASE_DB_URL` | pre reset a denný strop | reset nefunguje, denný strop sa preskočí |
| `FIREBASE_CLIENT_EMAIL` | pre reset a denný strop | to isté |
| `FIREBASE_PRIVATE_KEY` | pre reset a denný strop | to isté; vlož celý kľúč aj so znakmi `\n` |

### 5. Po nasadení

1. Uprav `ALLOWED_ORIGINS` v [api/grade-answer.js](api/grade-answer.js) a [api/quiz-feedback.js](api/quiz-feedback.js) na novú doménu, inak AI funkcie ticho spadnú na fallback.
2. Spusti reset (nižšie) — naplní demo ukážkovými dátami.
3. Otvor `/qr/` a skontroluj, že sa QR vykreslil.

---

## Prevádzka dema

**URL:** https://financna-liga.sk · **QR na premietnutie:** https://financna-liga.sk/qr/

### Reset

Zmaže herné vetvy a nahrá ukážkové dáta. Podrobnosti v sekcii [Reset dema](#reset-dema).

```bash
curl -X POST "https://financna-liga.sk/api/demo-reset" -H "x-demo-reset-secret: TVOJE_TAJOMSTVO"
```

Alebo v prehliadači na mobile: `https://financna-liga.sk/api/demo-reset?secret=TVOJE_TAJOMSTVO`

### Stropy AI

| Funkcia | Klient | Server | Po prekročení |
|---|---|---|---|
| „Vysvetli mi to" v kvíze | 20 / deň / zariadenie | **200 / deň** | tlačidlo sa nezobrazí, ostane statické vysvetlenie |
| „Vysvetli mi to" v téme ⏳ Číselné sústavy | 20 / deň / zariadenie | **20 / deň** | to isté |
| AI skúška | — | **50 / deň** | lokálny grader `evaluateCoverage()` |

Okrem toho platí **rate limit 10 požiadaviek za minútu na IP** na oboch endpointoch a origin check — požiadavka z inej domény sa zamietne.

Deň sa láme podľa **UTC dátumu**. Serverový počítač je vo Firebase v `demoLimits/{dátum}/{funkcia}` — tam sa dá aj pozrieť, koľko sa dnes minulo.

### Keď „Vysvetli mi to" vráti statický text

Je to **navrhnuté správanie**, nie chyba: AI je nadstavba, statické vysvetlenie z datasetu je základ. Tlačidlo sa nezobrazí alebo po kliknutí ticho zmizne. Postup od najčastejšej príčiny:

| # | Príčina | Ako overiť | Riešenie |
|---|---|---|---|
| 1 | Vyčerpaný klientský strop 20/deň | v konzole prehliadača `localStorage.fl_ai_feedback_count` (v téme Číselné sústavy `…_ciselne`) | iné zariadenie, alebo počkať do ďalšieho UTC dňa |
| 2 | Vyčerpaný serverový strop 200/deň | vo Firebase `demoLimits/{dnešný dátum}/quizFeedback` (v téme Číselné sústavy `…/ciselneSustavy`, strop 20) | počkať do ďalšieho dňa |
| 3 | Chýba `ANTHROPIC_API_KEY` | endpoint vráti 500 | doplniť vo Vercel env a znova nasadiť |
| 4 | Zlá doména v `ALLOWED_ORIGINS` | endpoint vráti 403 | pridať aktuálnu doménu do oboch endpointov |
| 5 | Offline alebo timeout | záložka Network v konzole | nič — fallback je správne správanie |

Vynulovanie klientského stropu na demo zariadení: `localStorage.removeItem("fl_ai_feedback_count")`. Dočasná téma má vlastný kľúč `fl_ai_feedback_count_ciselne`, takže si tieto dva stropy navzájom nesiahajú — viď [Dočasná téma Číselné sústavy](#dočasná-téma-číselné-sústavy).

---

## Deň stretnutia — checklist

- [ ] **Spustiť reset** (curl alebo prehliadač). Bez neho ostanú v rebríčkoch výsledky z minula a **QR výzva od Lektora nebude fungovať**.
- [ ] **Vytlačiť `/qr/`** — Ctrl/Cmd + P, A4 na výšku. Prípadne pripraviť na premietnutie v druhej záložke.
- [ ] **Overiť `lektor-demo-01`**: otvoriť `https://financna-liga.sk/?duel=lektor-demo-01` a skontrolovať, že sa zobrazí modál výzvy. **Potom zavrieť bez prijatia** — prijatie ju spotrebuje a musela by si resetovať znova.
- [ ] **Nabité telefóny** — obe zariadenia na súboj, ideálne nad 50 %.
- [ ] **Mobilné dáta zapnuté** na oboch telefónoch. Wi-Fi na mieste býva preplnená; LTE je spoľahlivejšie.
- [ ] Otvoriť appku raz na každom telefóne vopred — prehliadač si nakešuje statické súbory a prvé načítanie pred publikom bude okamžité.

---

## Testovací protokol dvoch telefónov

Vykonať **na mobilných dátach, nie na Wi-Fi** — to je situácia, ktorá nastane na mieste. Telefóny označené **A** a **B**.

### T1 — Od skenu po prvú otázku pod 15 s

1. Na telefóne A vypnúť Wi-Fi, zapnúť LTE, zavrieť všetky záložky prehliadača.
2. Naskenovať QR z `/qr/` fotoaparátom.
3. **Stopovať od klepnutia na notifikáciu skenu po zobrazenie prvej otázky kvízu.**
4. Cesta: úvodná stránka → chip oblasti → dlaždica **Súboj** → prvá otázka.

**Očakávanie:** pod 15 s. Namerané lokálne: 55 požiadaviek, ~853 kB nekomprimovane (na Verceli s brotli ~200–250 kB), DOMContentLoaded 316 ms.

**Ak to trvá dlhšie:** poznač si, či sa čaká na načítanie stránky, alebo na chipy oblastí. Prvé je sieť, druhé sú dátové súbory — návrhy na zrýchlenie sú v sekcii [Rýchlosť prvého načítania](#rýchlosť-prvého-načítania).

### T2 — Súboj cez odkaz

1. **Telefón A:** zadať nick → vybrať oblasť → **Súboj** → odohrať 10 otázok.
2. Po dohraní klepnúť na zdieľanie výzvy — odkaz sa skopíruje do schránky.
3. **Skontrolovať, že odkaz začína doménou, na ktorej práve si** — teda `https://financna-liga.sk/?duel=`, prípadne `https://financna-liga.vercel.app/?duel=`, ak testuješ cez pôvodnú adresu. Ak ukazuje na inú doménu, je to chyba — nahlás ju.
4. Poslať odkaz na telefón B (SMS, Signal, čokoľvek).
5. **Telefón B — dôležité:** otvoriť odkaz **v Chrome alebo Safari**, nie v zabudovanom prehliadači Messengera či Instagramu. Tie majú vlastné úložisko a obmedzenia, ktoré vedia rozbiť uloženie nicku.
   - Na Androide: podržať odkaz → *Otvoriť v prehliadači*.
   - Na iPhone: klepnúť na ikonu *…* → *Otvoriť v Safari*.
6. **Telefón B:** zobrazí sa modál „X ťa vyzýva na súboj" → zadať nick → **Prijať výzvu** → odohrať tie isté otázky.

**Očakávanie:** po dohraní vidia obaja výsledok a obaja sa objavia v rebríčku jednotlivcov.

⚠️ **Výzva je jednorazová.** Prvý, kto ju prijme, prepne jej stav a ďalšiemu sa zobrazí „Táto výzva už nie je aktívna". Pri opakovaní testu treba vygenerovať novú alebo spustiť reset.

### T3 — Zamknutie displeja uprostred kvízu

1. Na telefóne A začať súboj a odpovedať na 3 otázky.
2. Zamknúť displej, počkať **30 sekúnd**, odomknúť.

**Očakávanie:** kvíz pokračuje na tej istej otázke, odpovede sa nestratili.

**Ak sa stránka načíta odznova:** prehliadač uvoľnil záložku z pamäte (bežné pri nízkej pamäti). Poznač si model telefónu — priebeh kvízu sa nikam neukladá, takže by sa začínalo odznova. Pre prezentáciu to znamená nezamykať telefón uprostred hry.

### T4 — Prepnutie Wi-Fi → LTE uprostred

1. Na telefóne A začať súboj na Wi-Fi, odpovedať na 3 otázky.
2. Vypnúť Wi-Fi (prejde na LTE), dohrať kvíz.

**Očakávanie:** kvíz beží ďalej — otázky sú už načítané v pamäti. Uloženie výsledku do Firebase po zmene siete môže trvať pár sekúnd.

**Ak sa výsledok neuloží:** skontroluj, či sa hráč objavil v rebríčku. Firebase sa po zmene siete pripája znova; pri strate spojenia sa zápis nemusí podariť.

### Záznam z testovania

| Test | Telefón A | Telefón B | Výsledok | Poznámka |
|---|---|---|---|---|
| T1 sken → prvá otázka | | — | ... s | |
| T2 súboj cez odkaz | | | ✅ / ❌ | |
| T3 zamknutie displeja | | — | ✅ / ❌ | |
| T4 Wi-Fi → LTE | | — | ✅ / ❌ | |

---

## Oblasti

Obsah je rozdelený na oblasti, ktoré sa v appke zobrazujú ako chipy v dlaždici **Hraj**, v tomto poradí:

| # | Oblasť | Stav | Obsah |
|---|---|---|---|
| 1 | Osobné financie | **aktívna** | `data/A1.json`, `data/A2.json` |
| 2 | Investovanie | **aktívna** | `data/invest/A1.json`, `data/invest/A2.json` |
| 3 | Makroekonómia | **aktívna** | `data/makro/A1.json`, `data/makro/A2.json` |
| 4 | Číselné sústavy | **aktívna, ⏳ dočasná** | `data/ciselne/A1.json`, `data/ciselne/A2.json` |
| 5 | Bankovníctvo | pripravuje sa | zatiaľ žiadny |
| 6 | Práca a mzda | pripravuje sa | zatiaľ žiadny |
| 7 | Digitálne financie | pripravuje sa | zatiaľ žiadny |
| 8 | Spotrebiteľské právo | pripravuje sa | zatiaľ žiadny |

> ⏳ **Číselné sústavy nie je obsah dema pre neziskovky.** Je to dočasná pomôcka
> pre jedného žiaka a má sa odstrániť, keď doslúži — celý postup je v kapitole
> [Dočasná téma Číselné sústavy](#dočasná-téma-číselné-sústavy).

Pripravovaná oblasť je v zozname chipov, ale nedá sa vybrať — appka ju sama označí „pripravuje sa" a klik zablokuje. Nie je to zvláštna vetva kódu: je to ten istý mechanizmus, aký v pôvodnej appke označoval oblasti bez obsahu ([app.js](app.js) → `markUnavailableAreaChips`).

Ďalšie oblasti z plánu (Podnikanie, Riziko a poistenie, Finančné rozhodovanie) v chipoch zámerne nie sú — viď [Roadmapa](#roadmapa).

> ⏱️ **Časovanie.** Chip sa označí ako „pripravuje sa" po `AREA_GIVE_UP_MS` v [app.js](app.js) — nastavené na **3 s**, aby pripravované oblasti nevyzerali dlho klikateľné.

---

## Ako pridať oblasť

Toto je celý postup na nasadenie nového obsahu **bez programovania**. Treba vedieť upraviť textový súbor a spraviť commit.

### Koľko obsahu oblasť potrebuje

Toto je najdôležitejšia podmienka — bez nej sa hra buď nespustí, alebo bude ochudobnená:

| Požiadavka | Prečo |
|---|---|
| **aspoň 2 okruhy** (`A1.json`, `A2.json`) | AI skúška ťahá **dvojicu** okruhov (`A1`+`A2`, `A3`+`A4`, …); s jediným okruhom sa dvojica nedá zostaviť. Kartičky aj prípady sa filtrujú podľa tej istej dvojice. |
| **spolu aspoň 12–16 otázok** | Súboj ťahá **10 otázok** náhodne z celej oblasti. Pri menšom počte hra dobehne, len bude kratšia (ukazovateľ zobrazí napr. „1 / 8"). Pri 12–16 otázkach je z čoho vyberať a dve hry za sebou nevyjdú rovnako. |
| `summary` v každom okruhu | podmienka pre AI skúšku — viď krok 8 nižšie |

Rozumné minimum je teda **2 okruhy po 6–8 otázkach**. Presne tak je postavená oblasť Osobné financie (2 × 8 = 16 otázok).

### 1. Priprav JSON súbory okruhov

Jeden súbor = jeden okruh. Súbory sa volajú `A1.json`, `A2.json`, `A3.json`, … a musia byť očíslované **súvisle od 1**.

Odporúčaný priečinok pre novú oblasť: `data/<slug>/`, napríklad `data/invest/`.
*(Aktívna oblasť Osobné financie historicky sedí priamo v `data/` — nová oblasť nech má vlastný podpriečinok.)*

Štruktúra súboru — vzor nájdeš v [data/A1.json](data/A1.json):

```json
{
  "id": "1. A",
  "title": "Názov okruhu",
  "schemaVersion": "1.1",
  "tags": ["kluc", "slova"],
  "summary": "Súvislý text okruhu. Z neho čerpá AI skúška.",
  "quiz": [
    {
      "question": "Znenie otázky?",
      "options": ["možnosť A", "možnosť B", "možnosť C", "možnosť D"],
      "correct": 1,
      "explanation": {
        "correct": "Text po správnej odpovedi.",
        "wrong": "Text po nesprávnej odpovedi."
      }
    }
  ],
  "tiles": [
    { "term": "Pojem", "definition": "Definícia pojmu." }
  ],
  "cases": [
    {
      "title": "Prípad 1 – názov",
      "difficulty": "ľahká",
      "steps": [
        { "question": "Úvodná situácia (bez možností).", "options": [], "correct": 0 },
        {
          "question": "Otázka kroku?",
          "options": ["správna", "nesprávna", "nesprávna"],
          "correct": 0,
          "explanation": { "correct": "Vysvetlenie.", "wrong": "Vysvetlenie." }
        }
      ]
    }
  ],
  "zdroj": { "type": "ucebnica", "citation": "Odkiaľ obsah pochádza" },
  "spider": {
    "center": "Názov okruhu",
    "branches": [
      { "label": "Vetva", "leaves": ["Tvrdenie 1.", "Tvrdenie 2."] }
    ]
  }
}
```

Čo je povinné a čo nie:

| Pole | Povinné? | Čo bez neho nefunguje |
|---|---|---|
| `title` | áno | názov okruhu v progrese a v AI skúške |
| `quiz` | áno | súboj aj výzvy — **bez otázok je oblasť prázdna** |
| `summary` | pre AI skúšku | okruh sa v AI skúške nepoužije |
| `tiles` | nie | kartičky |
| `cases` | nie | prípady z praxe |
| `spider` | nie | Štruktúra otázok a pavúkové hry |
| `zdroj` | nie | zobrazí sa „Zdroj: doplní sa" |

`correct` je **index** správnej možnosti, počíta sa od nuly (`0` = prvá možnosť). Appka možnosti pri hraní zamieša, takže nevadí, ak sú správne odpovede v súbore stále na rovnakej pozícii.

Po napísaní si súbor over — musí to byť platný JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('data/invest/A1.json','utf8')); console.log('OK')"
```

### 2. Zapíš oblasť do registrov

Pre oblasť `Investovanie` so slugom `invest`, priečinkom `data/invest/` a 6 okruhmi:

| # | Súbor | Čo pridať |
|---|---|---|
| 1 | [areas.js](areas.js) → `duelAreas` | názov oblasti — **už tam je**, pripravované oblasti sú uvedené od začiatku |
| 2 | [data.js](data.js) → `window.areas` | `"Investovanie": [],` — **už tam je** |
| 3 | [data.js](data.js), dolu | nové volanie `loadJsonQuestions("Investovanie", LIVE + "data/invest/", 6);` |
| 4 | [scripts/contentOverrides.js](scripts/contentOverrides.js) → `AREA_SLUGS` | `'Investovanie': 'invest'` |
| 5 | [scripts/dashboardStats.js](scripts/dashboardStats.js) → `DASHBOARD_AREAS` | nový blok s `areaTitle` a `maxOkruh: 6` |
| 6 | [memoryDefinitions.js](memoryDefinitions.js) → `MEMORY_AREAS` | `{ name: "…", slug: "invest", path: "data/invest/", count: 6 }` |
| 7 | `scripts/spider.js`, `spiderGames.js`, `spiderMap.js`, `spiderRelated.js` → `AREA_PATHS` | `'Investovanie': LIVE + 'data/invest/'` (rovnaký riadok do všetkých štyroch) |
| 8 | [scripts/statnice.js](scripts/statnice.js) → `AREA_CONFIG` | len ak majú okruhy `summary` — viď nižšie |
| 9 | [index.html](index.html) → `LEX_QUESTION_RANGES` | `"Investovanie": { start: 1, end: 6 }` |
| 10 | [index.html](index.html) → `<select id="rArea">` | `<option>Investovanie</option>` |
| 11 | [api/sync-content.js](api/sync-content.js) → `AREA_PATHS` | `invest: 'data/invest/'` |

Kroky 1 a 2 sú už hotové pre všetky pripravované oblasti — pri ich zapínaní stačí kroky 3–11.

**Krok 8 — AI skúška.** Pridaj oblasť do `AREA_CONFIG` len vtedy, ak má **aspoň 2 okruhy so `summary`**, inak komisia nemá z čoho skúšať:

```js
const AREA_CONFIG = {
  [OSOBNE_AREA_NAME]: { … },
  'Investovanie': {
    mode: 'pair',
    pool: { path: LIVE + 'data/invest/', count: 6 },
    progressAreaTitle: 'Investovanie'
  }
};
```

`count` znamená **koľko okruhov má skúškový obsah**, nie koľko je súborov.

Ak oblasť v `AREA_CONFIG` nie je, AI skúška ju jednoducho neponúkne — nič sa nerozbije.

### 3. Nasaď

```bash
git add data/invest areas.js data.js index.html memoryDefinitions.js scripts api
```

```bash
git commit -m "Nová oblasť: Investovanie" && git push
```

Vercel nasadí sám. Po nasadení skontroluj:

- chip oblasti už nehlási „pripravuje sa" a dá sa naň kliknúť,
- súboj sa spustí a ide 10 otázok (nie menej — ak áno, oblasť má málo otázok),
- kartičky a prípady majú obsah,
- konzola prehliadača nehlási 404 na `data/invest/A*.json`.

### Odstránenie oblasti

Vymaž riadok `loadJsonQuestions(...)` z [data.js](data.js) (krok 3). Oblasť ostane v zozname ako „pripravuje sa". Ostatné registre môžu ostať — bez loadera sa nepoužijú.

---

## AI funkcie a stropy

Appka má dve AI funkcie. Obe sú **nadstavba** – keď zlyhajú alebo sa vyčerpá strop, hráč dostane pôvodné statické správanie a žiadnu chybovú hlášku.

| Funkcia | Endpoint | Strop na deň | Fallback |
|---|---|---|---|
| Vysvetlenie chyby v kvíze (tlačidlo „Vysvetli mi to") | `/api/quiz-feedback` | 20 na zariadenie + **200 na server** | statické vysvetlenie z datasetu |
| To isté v dočasnej téme ⏳ Číselné sústavy | `/api/quiz-feedback` | 20 na zariadenie + **20 na server**, oddelené počítadlá | statické vysvetlenie z datasetu |
| Hodnotenie odpovede v AI skúške | `/api/grade-answer` | **50 na server** | lokálny grader `evaluateCoverage()` |

Ochrana ide v štyroch vrstvách, najlacnejšia prvá: rate limit per IP (10/min) → origin check → limity dĺžky vstupu → tvrdý denný strop.

Prvé tri vrstvy sú best-effort – rate limit žije v pamäti jednej inštancie. **Skutočný strop nákladov je až ten denný**: počítadlo vo Firebase (`demoLimits/{UTC-dátum}/{funkcia}`), inkrementované atomicky cez ETag compare-and-swap, spoločné pre všetky inštancie aj regióny. Zapisuje sa doň výhradne číslo – žiadny nick, IP ani obsah otázky.

Deň sa láme podľa **UTC dátumu**, rovnako ako energia a denný strop mincí.

### Env premenné

| Názov | Povinná? | Načo |
|---|---|---|
| `ANTHROPIC_API_KEY` | áno pre AI | bez nej obe AI funkcie vrátia 500 a klient spadne na fallback |
| `FIREBASE_DB_URL` | pre denný strop | kam sa píše počítadlo |
| `FIREBASE_CLIENT_EMAIL` | pre denný strop | service account |
| `FIREBASE_PRIVATE_KEY` | pre denný strop | service account (celý kľúč aj so znakmi `\n`) |

**Keď premenné `FIREBASE_*` nie sú nastavené, denný strop sa preskočí** a AI beží len s rate limitom per IP. Je to vedomé rozhodnutie: chýbajúca konfigurácia nie je zlyhanie a nemá zhodiť funkciu, ktorá inak beží. Keď však premenné nastavené sú a Firebase zlyhá, volanie sa **zamietne** – strop chráni peniaze, takže pri neistote radšej AI nezavoláme.

---
## Reset dema

> ⚠️ **Spusti reset pred každým stretnutím.** Nie je to odporúčanie — bez neho ostanú v rebríčkoch výsledky z predchádzajúcej ukážky a **QR výzva od Lektora nebude fungovať** (viď nižšie).

Reset zmaže herné vetvy a nahrá ukážkové dáta:

```bash
curl -X POST "https://financna-liga.sk/api/demo-reset" -H "x-demo-reset-secret: TVOJE_TAJOMSTVO"
```

Alebo priamo v prehliadači (pohodlnejšie na mobile pred stretnutím):

```bash
https://financna-liga.sk/api/demo-reset?secret=TVOJE_TAJOMSTVO
```

Odpoveď je JSON s počtami nahratých záznamov. Trvá pár sekúnd.

### Čo reset spraví

| Zmaže | Nahrá |
|---|---|
| `users/`, `duels/`, `senaty/`, `senatSpory/`, `senatInvites/`, `faculties/`, `reports/` | 15 hráčov (vrátane admina), 20 odohraných súbojov, 1 pending výzvu, 3 triedy, 1 zápas tried, 4 školy |

- **`users/Babu` s `role: admin`** — admin prežije každý reset.
- **14 fiktívnych hráčov** s mincami, avatarmi a školou.
- **20 odohraných súbojov** naprieč všetkými tromi aktívnymi oblasťami. `finishedAt` je relatívny k času resetu (dnes − 1 až 6 dní), takže výsledky sú vždy v týždennom rebríčku bez ohľadu na to, kedy si reset spustila.
- **3 triedy** po 4 členoch + 1 odohraný zápas tried v konečnom stave.
- **4 školy** s bodmi a počtom aktívnych hráčov.

Rebríčky jednotlivcov, tried aj škôl majú nad sebou štítok **„📊 ukážkové dáta"**.

### QR výzva je jednorazová

Seed vytvára pending výzvu s pevným ID **`duels/lektor-demo-01`** od hráča „Lektor" v oblasti Osobné financie. Odkaz je teda stabilný a dá sa vytlačiť ako QR:

```bash
https://financna-liga.sk/?duel=lektor-demo-01
```

**Prijme ju len prvý, kto na ňu klikne.** Engine pri prijatí prepne stav `pending → accepted` a ďalšiemu ukáže „Táto výzva už nie je aktívna". Reset ju vráti do `pending`. Na súboj dvoch telefónov pred publikom je preto spoľahlivejšie vygenerovať výzvu naživo priamo v appke — táto je záloha.

### Prečo seed predznačuje vyhodnotenia období

Appka pri načítaní lenivo dopočítava uzavreté obdobia rebríčkov. Dve z nich by fiktívnym hráčom vyplácali mince, a **tretie je deštruktívne**: `settleFacultyMonth()` pri prvom načítaní v novom mesiaci archivuje školy a vynuluje im body, počet hráčov aj zoznam členov. Demo cez zlom mesiaca prejde, takže bez zásahu by sa rebríček škôl sám vyprázdnil.

Seed preto vopred zapisuje `evaluated: true` do `rewards/`, `senatRewards/` a `facultyRewards/` — pre predchádzajúce, aktuálne aj niekoľko budúcich období. Transakcia v tých funkciách potom abortne a vyhodnotenie sa preskočí. **Žiadna zmena hernej logiky, len dáta.**

### Env premenné resetu

| Názov | Načo |
|---|---|
| `DEMO_RESET_SECRET` | autorizácia endpointu — bez nej vráti 500 a nič nespraví |
| `FIREBASE_DB_URL`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | service account; pravidlá v `database.rules.json` zámerne nepovoľujú mazanie vetiev z klienta (anti-wipe), preto reset ide cez server |

---
## QR stránka `/qr`

Stránka na premietnutie alebo vytlačenie — veľký QR, nadpis a jedna veta.

| Adresa | Kam QR vedie |
|---|---|
| `https://financna-liga.sk/qr/` | úvodná stránka appky |
| `https://financna-liga.sk/qr/?duel=lektor-demo-01` | priamo na výzvu od Lektora |

Cieľ sa skladá z `location.origin`, takže po prechode na vlastnú doménu netreba na tejto stránke meniť nič.

**Tlač:** Ctrl/Cmd + P. Print CSS nastavuje A4 na výšku, QR má pevných 120 mm a poznámka pod adresou sa netlačí.

**Offline:** QR generuje vendorovaný enkodér [assets/qrcode.min.js](assets/qrcode.min.js) (qrcode-generator 2.0.4, MIT, Kazuhiko Arase) — **žiadne CDN**, stránka funguje aj bez internetu. Keby sa enkodér nenačítal, stránka namiesto QR ukáže adresu na ručné prepísanie.

---

## Rýchlosť prvého načítania

Merané lokálne (bez kompresie), prvé načítanie `/` s prázdnou cache:

| Metrika | Hodnota |
|---|---|
| Požiadaviek | 55 |
| Prenesené (nekomprimované) | ~853 kB |
| Z toho JS | ~682 kB · CSS ~96 kB · dáta oblastí ~69 kB |
| DOMContentLoaded | 316 ms |

Na Verceli ide text cez brotli, takže reálny prenos je približne štvrtina — rádovo **200–250 kB**. Najväčšie moduly (`statnice.js` 97 kB, `spiderGames.js` 94 kB) sa načítavajú **až pri otvorení svojej hry**, nie hneď. Cieľ „od skenu po prvú otázku pod 15 s" je s veľkou rezervou splniteľný aj na mobilných dátach.

**Externé závislosti: žiadne.** Písmo z Google Fonts bolo odstránené a nahradené systémovým stackom — appka si už neťahá nič z cudzieho servera okrem Firebase SDK. Na zlej Wi-Fi to bola jediná vec, ktorá blokovala prvé vykreslenie textu.

### Ak by to na mieste bolo aj tak pomalé

Dvaja zostávajúci kandidáti — **ani jeden nie je urobený**:

| # | Zásah | Prínos | Riziko |
|---|---|---|---|
| 1 | Načítať dáta len pre zvolenú oblasť (dnes sa ťahá všetkých 6 JSON naraz) | −4 požiadavky, −45 kB | chip inej oblasti by musel dáta doťahovať na klik |
| 2 | Zlúčiť malé moduly `scripts/*.js` do jedného súboru | −20 až −30 požiadaviek | vyžaduje build krok, ktorý projekt zámerne nemá |

Oba menia architektúru kvôli problému, ktorý zatiaľ nenastal — siahnuť po nich až keď meranie na mieste ukáže, že treba.

---
## Zapekanie úprav do GitHubu

Garant aj admin môžu opravovať obsah priamo v appke (tlačidlo ✏️ pri otázke, kartičke alebo kroku prípadu). Úprava sa uloží do Firebase pod `contentOverrides/` a **navrství sa nad pôvodný JSON pri každom načítaní** — v appke je viditeľná okamžite, ale súbor v repe ostáva nezmenený.

**Reset dema tieto úpravy nemaže.** `contentOverrides/` nie je medzi mazanými vetvami, takže opravy od Júlie prežijú aj reset pred stretnutím.

Kým sa úprava nezapečie do repa, žije len vo Firebase. Zapečenie je manuálny krok: prepíše `data/**/A*.json` v repe a commitne cez GitHub API.

### Karta je v deme skrytá

Karta „🔄 Synchronizácia obsahu do GitHubu" v admin paneli má `display:none` a `data-demo-hidden` — projekt nemá nastavené potrebné env premenné a pre demo nie je potrebná.

### Ako ju odkryť

1. Nastav vo Vercel env premenné:

| Názov | Čo to je |
|---|---|
| `ADMIN_SYNC_SECRET` | heslo, ktoré sa zadáva v karte; bez neho endpoint odmietne požiadavku |
| `GITHUB_REPO_OWNER` | vlastník repozitára, napr. `Soldanellka` |
| `GITHUB_REPO_NAME` | názov repozitára, napr. `financna-liga` |
| `GITHUB_BRANCH` | vetva, do ktorej sa commituje, napr. `main` |
| `GITHUB_TOKEN` | Personal Access Token s právom **`contents: write`** na ten repozitár |

Bez `FIREBASE_DB_URL`, `FIREBASE_CLIENT_EMAIL` a `FIREBASE_PRIVATE_KEY` to nepobeží ani tak — endpoint číta overridy cez service account.

2. V [init.js](init.js) nájdi blok s `data-demo-hidden="synchronizácia do GitHubu…"` a odstráň z jeho `style` časť `;display:none`.

3. Nasaď a otvor admin panel. Karta ponúka **najprv náhľad** (👁️ Zobraziť náhľad) a až potom potvrdenie — nikdy necommituje automaticky.

> ⚠️ `GITHUB_TOKEN` s právom zápisu do repa je najcitlivejšia premenná v projekte. Daj mu prístup len k tomuto jednému repozitáru (fine-grained token) a nikdy ho nedávaj do kódu — patrí výhradne do Vercel env.

---
## Vlastná doména

Doména **financna-liga.sk** je kúpená a napojená. Appka je dostupná na troch adresách, všetky vedú na to isté nasadenie:

| Adresa | Načo |
|---|---|
| `https://financna-liga.sk` | **hlavná** — túto dávaj na letáky, do QR aj neziskovkám |
| `https://www.financna-liga.sk` | www variant, napojený kvôli ľuďom, ktorí ho napíšu zo zvyku |
| `https://financna-liga.vercel.app` | pôvodná Vercel adresa, ponechaná kvôli starším zdieľaným výzvam a QR |

### Prečo sa pri zmene domény nemuselo nič prepisovať

Odkazy v JS sa skladajú z `location.origin`, takže **vždy ukazujú na doménu, na ktorej hráč práve je**. Kto hrá na `financna-liga.sk`, pošle súperovi odkaz na `financna-liga.sk`; kto otvorí starú vercel.app adresu, pošle odkaz na ňu.

| Súbor | Čo generuje |
|---|---|
| [scripts/duels.js](scripts/duels.js) | odkaz na výzvu — `${location.origin}/?duel=…` |
| [scripts/senaty.js](scripts/senaty.js) | pozvánka do triedy — `${location.origin}/?senat=…` |
| [qr/index.html](qr/index.html) | cieľ QR kódu — `location.origin + ...` |

### Jediné miesto, kde doména zapísaná JE

`ALLOWED_ORIGINS` v [api/quiz-feedback.js](api/quiz-feedback.js) a
[api/grade-answer.js](api/grade-answer.js) — zoznam všetkých troch adries.
Je to bezpečnostná poistka (origin check), nedá sa odvodiť za behu.

⚠️ **Keby v budúcnosti pribudla ďalšia adresa, musí sa doplniť do oboch súborov.**
Origin check zamietne požiadavku z neznámej domény a AI vysvetlenie v kvíze aj
AI skúška na nej **ticho spadnú na statický fallback** — bez chybovej hlášky,
takže sa to ľahko prehliadne. Rýchly test: na novej adrese odpovedz v kvíze
nesprávne a klikni „Vysvetli mi to". Keď príde text, origin je v poriadku;
keď tlačidlo ticho zmizne, pozri v konzole, či endpoint nevrátil 403.

---

## Čo appka ukladá do zariadenia

Appka **neukladá do zariadenia žiadny identifikátor návštevníka** — žiadnu cookie, žiadny odtlačok prehliadača, žiadny kľúč relácie. Nerozlišuje nového a vracajúceho sa návštevníka. Ukladanie do zariadenia, ktoré nie je nevyhnutné pre fungovanie služby, totiž vyžaduje súhlas, a tomu sa appka vyhýba.

Návštevy sa **počítajú agregovane**: pri každom otvorení sa transakciou zvýši jedno číslo na serveri (`analyticsDaily/{dátum}/visits`). Appka si pritom do zariadenia neuloží nič, takže súhlas nepotrebuje — viď nižšie.

V `localStorage` žije len to, bez čoho by appka nefungovala alebo by otravovala pri každom načítaní:

| Kľúč | Načo |
|---|---|
| `playerNick` | prezývka = identita hráča (appka nemá prihlasovanie) |
| `lex_anon_id` | anonymná herná identita pre hráča bez prezývky |
| `lex_anon_energy`, `lex_anon_energy_day` | denná energia anonymného hráča |
| `lex_theme` | svetlá/tmavá téma |
| `lex_avatar`, `lex_pin`, `lex_paragrafy`, `playerRole` | zrkadlo herného stavu, aby sa UI nemuselo čakať na Firebase |
| `lastDuelPackage`, `mColl:*`, `cs-modul-v1`, `fin-a1-modul-v1`, `fin-a2-modul-v1` | rozohraný súboj, zbalené sekcie, postup v študijných moduloch |
| `lex_games_played` | počet odohraných hier (avatar a odmeny) |
| `lexWelcomeSeen`, `lexGuideSeen` | hráč už videl úvodné okno / návod |
| `firebase:host:…` | interný kľúč Firebase SDK (na ktorý server sa pripojiť) |

`sessionStorage` drží jedinú vec: cache titulkov okruhov pre Nočný výcuc (`scripts/nightRecap.js`) — obsah, nie identifikátor.

### Počítanie návštev (obnovené 2026-10-12, bez identifikátora)

`scripts/visits.js` pri každom otvorení appky zvýši `analyticsDaily/{YYYY-MM-DD}/visits` o jedna. Transakciou, nie prostým zápisom — stránku otvára viac ľudí naraz. Volá sa pri štarte a **zámerne nie je pod `if (initNick)`**: počíta sa otvorenie, nie hráč, takže beží aj pre anonyma.

Do zariadenia sa pritom neuloží **nič**. Číslo sa nespája s prezývkou ani s IP.

⚠️ `analyticsDaily` **nie je a nesmie byť** vo `WIPE_BRANCHES` (`api/_seedDemo.js`) — denné počty musia prežiť reset pred stretnutiami. Nie sú to údaje hráčov, je to jedno číslo na deň.

Prehľad je v admin paneli pod **📊 Otvorenia aplikácie** (dnes / 7 dní / 30 dní, stĺpcový graf a tabuľka dní).

#### Prečo nie „nový vs. vracajúci sa“

Nie je problém ten údaj, ale to, čo sa preň musí spraviť. Počet otvorení nepotrebuje v zariadení žiadnu pamäť — appka len zvýši číslo na serveri. Otázku „je tento návštevník nový?“ ale nejde zodpovedať inak, než že si appka prehliadač **označí** a pri ďalšej návšteve tú značku **prečíta**. Práve uloženie a spätné čítanie údaja v zariadení vyžaduje súhlas (ePrivacy, u nás § 109 ods. 8 zákona o elektronických komunikáciách), ak nie je nevyhnutné pre službu — a štatistika nevyhnutná nie je. Nepomôže, že značka je náhodná ani že sa neukladá IP: rozhoduje samotný zápis do zariadenia.

#### Návrh pre prípad, že advokát rozlíšenie povolí

`scripts/visits.js` má konštantu `REZIM_S_IDENTIFIKATOROM` (teraz `false`). Zapnúť ju smie len rozhodnutie advokáta **spolu so súhlasovou lištou**; bez nej by bol režim protiprávny a Zásady by prestali sedieť. Lišta by vyzerala takto:

| | |
|---|---|
| Kedy | pri prvej návšteve, dole, neprekrýva obsah |
| Text | čo sa počíta, že to je značka v zariadení, odkaz na Zásady |
| Tlačidlá | **Súhlasím** / **Nesúhlasím** — rovnocenné, žiadne predvolené |
| Kým sa neklikne | beží režim bez identifikátora (počíta sa len otvorenie) |
| Súhlasím | vznikne náhodné `lex_visit_id`, zapisuje sa `analytics/{visitId}` s prvou a poslednou návštevou |
| Nesúhlasím | ostáva režim bez identifikátora, lišta sa už neukáže |
| Odvolanie | prepínač v Mojom účte, po odvolaní sa `lex_visit_id` aj `analytics/{visitId}` zmažú |

Lišta pre súhlas je **niečo iné** než nenápadná lišta „Používaním súhlasíš s Podmienkami“ z bodu 3 zadania — tá nič neukladá a nič si nepýta.

### Zrušená vetva `analytics/` (2026-10-05)

Merala návštevy a na rozlíšenie „nový vs. vracajúci sa“ potrebovala kľúč relácie v `sessionStorage`. Zapisovala `analytics/{nick}` (`firstSeen`, `lastSeen`, `visitCount`, `days:{}`) a denné súhrny `analyticsDaily/{dátum}` (`visits`, `newUsers`, `returningUsers`).

Zanikla celá — modul `scripts/analytics.js`, obe volania, sekcia „📊 Návštevnosť“ v admin paneli aj obe vetvy v databáze. Zachovali sa **len dve časové pečiatky**, ktoré prešli do `users/{nick}`:

| Predtým | Teraz | Načo |
|---|---|---|
| `analytics/{nick}/firstSeen` | `users/{nick}/createdAt` | dátum vzniku prezývky |
| `analytics/{nick}/lastSeen` | `users/{nick}/lastActiveAt` | dátum poslednej aktivity |

`visitCount` ani `days:{}` sa nemigrovali. Píše ich `scripts/playerDates.js`, migráciu zaznamenáva `tools/migrate-analytics.js`.

Bez kľúča relácie sa `lastActiveAt` zapíše pri každom načítaní stránky, nie raz za 30 minút — jeden malý zápis navyše za to, že v zariadení nič neostáva. To isté platí pre počítadlo otvorení vyššie.

---

## Kde všade žije prezývka (podklad pre „Zmazať moju prezývku a postup“)

Zoznam vznikol rekurzívnym prehľadaním 21 vetiev databázy pri odstraňovaní uzla `Unknown` (2026-10-11) — nie z pamäti, ale z toho, čo sa naozaj našlo. Náhradné meno drží `scripts/deletedPlayer.js` (`DELETED_PLAYER`), aby sa text v databáze a v Zásadách nemohol rozísť.

### Maže sa (kľúčované prezývkou)

| Cesta | Poznámka |
|---|---|
| `users/{nick}` | celý podstrom vrátane `users/{nick}/duels/{id}` — vlastná kópia súbojov hráča |
| `leaderboard/{nick}` | zápis v rebríčku |
| `faculties/{id}/players/{nick}` | členstvo v škole (cestu dá `users/{nick}/faculty`) |
| `senaty/{id}/members/{nick}`, `recruitClaimed/{nick}` | členstvo v triede (cestu dá `users/{nick}/senaty`) |
| `groups/{id}/members/{nick}` | skupina vyučujúceho |
| `feedback/{id}` | súkromné správy prevádzkovateľke — mažú sa celé |

### Prepisuje sa na náhradné meno

| Cesta | Poznámka |
|---|---|
| `duels/{id}/from` | kto súboj vytvoril |
| `duels/{id}/acceptedBy` | kto výzvu prijal |
| `duels/{id}/result/firstPlayer/nick`, `secondPlayer/nick`, `winner` | výsledok |
| `reports/{id}/nick` | nahlásenie chyby — záznam ostáva, má hlasy a verdikt |
| `courtroom/{id}/comments/{id}/nick` | komentár v nástenke |

⚠️ **Rebríček sa počíta zo `duels/`, nie z vetvy `leaderboard/`.** Bez filtra by sa zmazaný hráč do rebríčka vrátil pod náhradným menom, hoci Zásady (bod 8) sľubujú, že výmaz odstráni zápis v rebríčkoch. Filter preto sedí v agregácii — `scripts/leaderboard.js` aj `scripts/economy.js` (vyhodnotenie odmien za obdobie) volajú `jePreskocitelnaPrezyvka()`.

`isValidNick()` náhradné meno odmieta, nech sa zaň nikto nevydáva — rovnaký vzor ako vyhradený prefix `anon_`.

### Zostáva nedotknuté

`assignments/{id}/results/{nick}` (výsledok zadaného testu patrí aj vyučujúcemu), `senatSpory/{id}/scores/{nick}`, `duels/{id}/challengeClaimed/{nick}` a archívy výhier (`rewards`, `senatRewards`, `facultyRewards`). Zásady to v bode 8 priznávajú.

---
## Miestne spustenie

Stačí hocijaký statický server nad koreňom repa. Serverless funkcie z `api/` lokálne nebežia — AI hodnotenie v AI skúške spadne na lokálny záložný grader, čo je správne správanie.

---

## Obsah na odbornú kontrolu

**Otázky, možnosti a ich vysvetlenia sú prevzaté doslovne z podkladov a nemenili sa.** Všetko ostatné je z nich odvodené — a práve to čaká na odbornú kontrolu.

Pravidlo, ktoré platilo pri celej tvorbe: **žiadny odvodený text neobsahuje finančnú radu, odporúčanie ani informáciu nad rámec vysvetlení z datasetu.** To isté vynucuje aj systémový prompt AI vysvetlenia v [api/quiz-feedback.js](api/quiz-feedback.js).

### Osobné financie

| Čo | Kde | Rozsah | Odvodené z |
|---|---|---|---|
| `summary` | `data/A1.json`, `A2.json` | 2 zhrnutia | vysvetlení otázok okruhu |
| `tiles` (kartičky) | to isté | 16 pojmov | vysvetlení otázok |
| `cases` (prípady) | to isté | 4 scenáre | vysvetlení otázok |
| `spider` (štruktúra) | to isté | 8 vetiev | tvrdení z vysvetlení |
| bifľovačka | `biflovacka/osobne.json` | 16 pojmov | `tiles` |
| **teória** | `moduly/osobne-peniaze-a-uver.html` | 442 slov v 4 kapitolách | doslovne zo `summary` a `tiles` |
| **teória** | `moduly/osobne-sporenie-a-investovanie.html` | 452 slov v 4 kapitolách | to isté |

### Investovanie

| Čo | Kde | Rozsah | Odvodené z |
|---|---|---|---|
| `summary` | `data/invest/A1.json`, `A2.json` | 2 zhrnutia | dodané spolu s otázkami |
| `tiles` | to isté | 16 pojmov | dodané spolu s otázkami |
| `cases` | to isté | 4 scenáre | dodané spolu s otázkami |
| `spider` | to isté | 6 vetiev | dodané spolu s otázkami |
| bifľovačka | `biflovacka/invest.json` | 16 pojmov | `tiles` |

### Makroekonómia

| Čo | Kde | Rozsah | Odvodené z |
|---|---|---|---|
| `summary` | `data/makro/A1.json`, `A2.json` | 2 zhrnutia | dodané spolu s otázkami |
| `tiles` | to isté | 16 pojmov | dodané spolu s otázkami |
| `cases` | to isté | 4 scenáre | dodané spolu s otázkami |
| `spider` | to isté | 6 vetiev | dodané spolu s otázkami |
| bifľovačka | `biflovacka/makro.json` | 16 pojmov | `tiles` |

#### Teória vo financiách sa už nepíše, generuje sa

Obe stránky vznikajú skriptom z `data/A1.json` a `data/A2.json`: výklad je **doslovný text zo `summary`**, pojmy sú **doslovné `tiles`**, riešený prípad je `cases` a kvíz je `quiz` aj s vysvetleniami. Skript každú vetu pred zápisom overí proti zdroju, takže do stránky sa nedá dostať veta, ktorá v datasete nie je. Prakticky to znamená, že kontrolou `summary` a `tiles` je skontrolovaná aj teória.

**Dve kapitoly sú tenké a zámerne sa nedopĺňali:**

| Kapitola | Čo v nej je | Čo chýba |
|---|---|---|
| Peniaze a úver → *3. Ručenie za cudzí úver* | jedna veta zo `summary`, jeden pojem, jedna otázka | v datasete nie je k ručeniu nič viac — ani prípad |
| Sporenie a investovanie → *4. Poistenie a spoluúčasť* | jedna veta, jeden pojem, jedna otázka | celé poistenie stojí na jednej vete o spoluúčasti |

Ostatné kapitoly majú 2–3 otázky a tri zo štyroch kapitol v module *Peniaze a úver* majú aj riešený prípad. Ak sa podklad k ručeniu alebo poisteniu doplní do `data/A1.json`/`A2.json`, stránky stačí pregenerovať:

```
node tools/build-fin-modul.js
```

Skript berie rozloženie (hlavičku, CSS aj motor) z `moduly/ciselne-sustavy.html`, takže sa obe stránky s ním nemôžu rozísť. Rozdelenie na kapitoly je v poli `SPEC` priamo v skripte.

### Čo skontrolovať prednostne

1. **`summary` Osobných financií** — teória v `moduly/` je jeho doslovný prepis a zároveň je podkladom pre hodnotenie v AI skúške, takže nepresnosť sa prenesie na obe miesta aj do známky.
2. **`tiles` Osobných financií** — pojmy v module, kartičky aj bifľovačka sú ten istý text.
3. **`cases` Osobných financií** — 4 scenáre poskladané z vysvetlení viacerých otázok naraz.

Kartičky, bifľovačka a spider sú mechanické preusporiadanie `tiles`, takže stačí skontrolovať `tiles` raz.

---

## Školské oblasti

Okrem finančných oblastí beží v appke skupina **školských oblastí** — pomôcok
pre jedného žiaka, poskladaných z jeho poznámok zo školy. **Nie sú obsahom dema
pre neziskovky** a majú sa dať odstrániť po jednej.

| Oblasť | Slug | Okruhy | Otázok |
|---|---|---|---|
| Číselné sústavy | `ciselne` | A1–A6 | 34 |
| Logické funkcie | `logika` | A1–A3 | 15 |
| Počítačové siete | `siete` | A1–A3 | 15 |
| Elektrotechnika | `elektro` | A1–A2 | 12 |
| Fyzika | `fyzika` | A1–A4 | 20 |

Fyzika píše **vektory bez šípky** (`b = 4·a`, veľkosť `|a|`, slovo „vektor" tam,
kde by inak nebolo jasné, či ide o vektor alebo číslo). Kombinačná šípka U+20D7
sa v písme appky nekombinuje – pridáva šírku a vykreslí sa ako samostatný znak
vedľa písmena, takže by namiesto vektora ukázala „a→". Indexy a mocniny
(F₁, x²) sa vykresľujú správne a ostávajú.

### Čo majú spoločné

**Zoznam oblastí** je na dvoch miestach a musí sedieť na oboch:
[areas.js](areas.js) → `SCHOOL_AREAS` (prehliadač) a
[api/quiz-feedback.js](api/quiz-feedback.js) → `SCHOOL_AREAS` (server). Appka nemá
build krok — ES modul a CommonJS funkcia sa navzájom importovať nedajú, preto
kópia. Obe miesta sú označené značkou `ŠKOLSKÉ OBLASTI`.

**AI spätná väzba** má pre všetky školské oblasti jeden spoločný prompt
(`SCHOOL_SYSTEM_PROMPT`, prísnejší než finančný — zakazuje počítať aj dopĺňať
fakty) a **jednu spoločnú dennú kvótu `skola`, 30 volaní**. Nie je to kvóta na
oblasť: 30 je strop pre učenie jedného človeka za deň. Klientské počítadlo má
príponu `_skola`. Finančná vetva vrátane stropu 200/deň je nedotknutá.

**Študijný modul** je jeden pre všetky oblasti:
[moduly/skola.html](moduly/skola.html)`?oblast=<slug>`. Obsah nečíta z vlastnej
kópie, ale z tých istých `data/<slug>/A{n}.json`, z ktorých ťahá otázky aj hra —
výklad je `summary` (zalomenia sa zobrazia ako odseky), kvíz sú otázky okruhu
s jedným pokusom. Pokrok drží `localStorage` pod `skola-modul-<slug>`.

> ⚠️ **Modul závisí od `data/<slug>/_map.json`.** Berie z neho názov oblasti aj
> čísla okruhov, takže netreba druhý register — ale bez tohto súboru oblasť
> nevykreslí a ukáže hlášku „Obsah oblasti sa nepodarilo načítať" s odkazom späť.
> `_map.json` teda neslúži len pavúkovi; keď ho odstrániš, prestane fungovať aj
> študijný modul.

Modul **Číselné sústavy** má vlastnú stránku
([moduly/ciselne-sustavy.html](moduly/ciselne-sustavy.html)) s riešenými prípadmi
a interaktívnymi prepínačmi bitov — univerzálny modul ich nemá a tá stránka
ostáva ako je.

### Odstránenie jednej oblasti

Pre každú oblasť treba zmazať alebo upraviť:

| Kde | Čo |
|---|---|
| `data/<slug>/` | celý priečinok vrátane `_map.json` |
| [areas.js](areas.js) | riadok v `duelAreas` **a** v `SCHOOL_AREAS` |
| [api/quiz-feedback.js](api/quiz-feedback.js) | riadok v `SCHOOL_AREAS` |
| [data.js](data.js) | kľúč vo `window.areas`, volanie `loadJsonQuestions`, dlaždica vo `window.catalog` |
| [scripts/contentOverrides.js](scripts/contentOverrides.js) | riadok v `AREA_SLUGS` |
| [scripts/dashboardStats.js](scripts/dashboardStats.js) | záznam v `DASHBOARD_AREAS` |
| spider súbory | riadok v `AREA_PATHS` v [spider.js](scripts/spider.js), [spiderGames.js](scripts/spiderGames.js), [spiderMap.js](scripts/spiderMap.js), [spiderRelated.js](scripts/spiderRelated.js) |

Keď odíde **posledná** školská oblasť, dajú sa zmazať aj spoločné časti:
`SCHOOL_AREAS` na oboch miestach, `SCHOOL_PROFILE` a `SCHOOL_SYSTEM_PROMPT`
v endpointe, prípona `_skola` v [quiz.js](quiz.js) a `moduly/skola.html`.

**Zvyšky v databáze** sú rovnaké ako pri Číselných sústavách (viď nižšie):
záznamy v `duels/`, body v rebríčku, denné počítadlá `demoLimits/{dátum}/skola`
a `users/*/spiderGame*`. Nič z toho sa nemusí čistiť.

---

## Dočasná téma Číselné sústavy

Oblasť **Číselné sústavy** (dvojková, šestnástková a osmičková sústava) je
pomôcka pre jedného žiaka na predmet číselná technika, nie obsah Finančnej ligy.
Pridaná 1. 10. 2026. Má sa odstrániť, keď doslúži.

Je to zámerne **bežná oblasť**, nie skrytá stránka: beží cez ten istý register,
ten istý kvíz, ten istý súboj a ten istý rebríček ako finančné oblasti. Preto
nepribudol žiadny `vercel.json`, žiadna nová route, žiadna env premenná ani
zmena pravidiel databázy.

### Súbory, ktoré k nej patria

| Súbor | Čo je v ňom |
|---|---|
| `data/ciselne/_map.json` | klastre a väzby pre mapu pavúka — bez neho sa nezobrazí mapa ani hry |
| `data/ciselne/A1.json` … `A6.json` | šesť okruhov, názvami zhodných s kapitolami modulu: Pozičná váha, Dvojková → desiatková, Desiatková → dvojková, Sčítanie, Šestnástková a iné, Skupiny bitov. Spolu 34 otázok (cs01–cs34). |
| `moduly/ciselne-sustavy.html` | samostatný študijný modul: 6 kapitol s výkladom, riešeným prípadom a kvízom, plus časté chyby a cvičenia. Vlastné CSS aj JS, bez závislostí na appke; tému berie z `localStorage.lex_theme` ako zvyšok appky. `noindex, nofollow` |

A päť miest v existujúcich súboroch, všetky označené komentárom `⏳ DOČASNÁ TÉMA`:

| Súbor | Čo tam pribudlo |
|---|---|
| [areas.js](areas.js) | jeden riadok v `duelAreas` (chip oblasti) |
| [data.js](data.js) | kľúč vo `window.areas`, volanie `loadJsonQuestions`, záznam vo `window.catalog` |
| [scripts/contentOverrides.js](scripts/contentOverrides.js) | jeden riadok v `AREA_SLUGS` (`ciselne`) |
| [quiz.js](quiz.js) | `AI_FEEDBACK_KEY_SUFFIX` + posielanie `area` endpointu |
| [api/quiz-feedback.js](api/quiz-feedback.js) | `MATH_SYSTEM_PROMPT` a `AREA_PROFILES` |
| [scripts/dashboardStats.js](scripts/dashboardStats.js) | záznam v `DASHBOARD_AREAS` (kvôli pavúkovi) |
| [scripts/spider.js](scripts/spider.js), [spiderGames.js](scripts/spiderGames.js), [spiderMap.js](scripts/spiderMap.js), [spiderRelated.js](scripts/spiderRelated.js) | po jednom riadku v `AREA_PATHS` |

### Otázky sú na dvoch miestach

Osemnásť otázok (cs17–cs34) existuje **dvakrát**: v poli `CH[n].quiz` v
[moduly/ciselne-sustavy.html](moduly/ciselne-sustavy.html) a v `data/ciselne/A*.json`.
Modul si obsah nesie sám (je bez závislostí) a engine kvízu číta JSON-y, takže
spoločný zdroj by znamenal prepojiť ich — väčší zásah, než téma zaslúži.
**Oprava jednej otázky sa teda musí spraviť na oboch miestach.** Vedomé
rozhodnutie, nie prehliadnutie.

### Čo oblasť zámerne NEMÁ

Súbory `data/ciselne/A*.json` nemajú `tiles` ani `cases` a oblasť nie je
v `MEMORY_AREAS` ([memoryDefinitions.js](memoryDefinitions.js)) ani v `AREA_CONFIG`
([scripts/statnice.js](scripts/statnice.js)). Dôsledky:

- **Bifľovačka** a **nočný výcuc** ju neponúkajú vôbec.
- **AI skúška** ju odmietne hláškou „AI skúška je zatiaľ dostupná len pre: …".
- **Môj progres** ju zobrazí, ale **so samými nulami** — oblasť je
  v `DASHBOARD_AREAS` len kvôli pavúkovi (viď nižšie) a `recordOkruhResult()`
  do nej nič nezapíše, rovnako ako pri finančných oblastiach.
- **Kartičky** a **prípady** sa napriek tomu otvoria — engine si ich pre každú
  oblasť bez `tiles`/`cases` dogeneruje z otázok (`buildMemoryFromQuestions`,
  `loadCasesFromQuestions`). Kartičky párujú otázku so správnou odpoveďou,
  prípady ukážu otázky po jednej. Je to pôvodné správanie enginu pre všetky
  oblasti, nie zvláštna vetva — a pre túto tému dáva zmysel, takže sa nechalo tak.

### Pavúk (štruktúra otázok)

Každý z okruhov `A1`–`A6` má v JSON-e pole `spider` so **4 vetvami po 3 listoch**,
takže v dlaždici **🕸️ Štruktúra otázok** sa oblasť ponúkne a strom sa vykreslí.
Klik na list ukáže len jeho text — definícia sa ťahá z `tiles`, ktoré oblasť
zámerne nemá, a `findDefinition()` vtedy vráti `null` a riadok sa nevykreslí
(overené, nič nespadne).

Zapojenie stálo tri veci: pole `spider` v šiestich JSON-och, riadok v `AREA_PATHS`
v **štyroch** súboroch ([scripts/spider.js](scripts/spider.js),
[spiderGames.js](scripts/spiderGames.js), [spiderMap.js](scripts/spiderMap.js),
[spiderRelated.js](scripts/spiderRelated.js) — tabuľka je tam zámerne duplikovaná)
a záznam v `DASHBOARD_AREAS`, odkiaľ si pavúk berie počty okruhov.

#### Mapa a hry

Launcher Kukučky, Rozpárovania, Recallu a Blesku sa pripája **len pri vstupe do
stromu z mapy** ([spiderMap.js](scripts/spiderMap.js): „pri vstupe z plochého
zoznamu hry nie sú"), a mapa potrebuje `_map.json` s klastrami. Hra „Kde som?"
je na mape závislá rovnako.

Táto téma preto `data/ciselne/_map.json` **má** — dva klastre a jednu väzbu:

| klaster | okruhy |
|---|---|
| Základy a dvojková sústava | A1–A4 |
| Iné sústavy | A5–A6 |

Väzba `2 ↔ 6` (bity → skupiny bitov) sa v Z2 prejaví odznakom ⇄1 a v strome
sekciou „Súvisí s". Dva klastre sú lepšie než jeden: „Kde som?" má potom
z čoho vyberať, a Kukučke stačí, že aj menší klaster má dva okruhy, takže si
cudzí list má odkiaľ požičať (overené na A5 aj A6).

> ⚠️ **Finančné oblasti `_map.json` nemajú a nedostali ho.** Ich pavúk ostáva
> ako doteraz: plochý zoznam → strom, bez mapy, bez „Kde som?" a bez launchera
> hier. Zapnúť hry aj tam je samostatné rozhodnutie — stačil by im rovnaký
> súbor, žiadny kód.

### AI spätná väzba má vlastné stropy

Tlačidlo „Vysvetli mi to" používa pre túto oblasť **iný systémový prompt**
(zakazuje počítať čokoľvek nanovo — modely sa pri prevodoch medzi sústavami
mýlia) a **vlastné denné počítadlá**, takže žiak nemôže vyčerpať limit dema:

| | Finančné oblasti | Číselné sústavy |
|---|---|---|
| serverový strop | `quizFeedback`, 200/deň | `ciselneSustavy`, 20/deň |
| klientský strop | `fl_ai_feedback_count` | `fl_ai_feedback_count_ciselne` |

Po vyčerpaní sa tlačidlo nezobrazí a ostane statické vysvetlenie z datasetu —
rovnako ako pri chybe API. Finančná vetva endpointu je nedotknutá.

### Odstránenie

1. Zmaž priečinok `data/ciselne/` (A1–A6 **aj `_map.json`**) a súbor `moduly/ciselne-sustavy.html`.
2. V [areas.js](areas.js) zmaž riadok `"Číselné sústavy"` aj s komentárom nad ním.
3. V [data.js](data.js) zmaž tri miesta: kľúč vo `window.areas`, záznam
   `"Číselné sústavy"` vo `window.catalog` a volanie `loadJsonQuestions`
   pre `data/ciselne/`.
4. V [scripts/contentOverrides.js](scripts/contentOverrides.js) zmaž riadok
   `'Číselné sústavy': 'ciselne'` z `AREA_SLUGS`.
5. V [quiz.js](quiz.js) zmaž `AI_FEEDBACK_KEY_SUFFIX` a `aiFeedbackKeys()`;
   vráť `aiFeedbackUsedToday()`/`bumpAiFeedbackCount()` na pôvodné kľúče.
   Pole `area` v tele požiadavky môže zostať — endpoint ho ignoruje.
6. V [api/quiz-feedback.js](api/quiz-feedback.js) zmaž `MATH_SYSTEM_PROMPT`,
   `buildMathUserMessage()` a `AREA_PROFILES`. `FINANCE_PROFILE` a
   `profileForArea()` môžu zostať — bez `AREA_PROFILES` vracajú vždy finančný
   profil, teda pôvodné správanie.
7. V [scripts/dashboardStats.js](scripts/dashboardStats.js) zmaž záznam
   `'Číselné sústavy'` z `DASHBOARD_AREAS` aj s komentárom nad ním.
8. Zmaž riadok `'Číselné sústavy': LIVE + 'data/ciselne/'` z `AREA_PATHS`
   v **štyroch** súboroch: [spider.js](scripts/spider.js),
   [spiderGames.js](scripts/spiderGames.js), [spiderMap.js](scripts/spiderMap.js),
   [spiderRelated.js](scripts/spiderRelated.js).
9. Commit a push. Vercel nasadí sám.

> ⚠️ **Nestačí zmazať len riadok v `areas.js`.** Chip síce zmizne, ale
> `loadJsonQuestions` v `data.js` beží ďalej, kľúč sa do `window.areas` vráti
> po načítaní a dlaždica ťaháka ostane v Študijných moduloch. Overené.

### Čo po odstránení ostane v databáze (a prečo to nevadí)

Nič z toho sa nemusí čistiť — appka to znesie, overené v kóde:

- **Záznamy súbojov** v `duels/` a `users/{nick}/duels/` s `areaTitle:
  "Číselné sústavy"`. `saveDuel()` ukladá celé pole otázok dovnútra záznamu a
  prijatie výzvy hrá z `duel.questions`, nie z `window.areas` — stará výzva
  ostane hrateľná. Názov oblasti je len text.
- **Body v rebríčku.** [scripts/leaderboard.js](scripts/leaderboard.js) o
  oblastiach vôbec nevie (`updateLeaderboardWithResult` berie len nick, skóre a
  výhru), takže body z tejto témy sú bežné body a nič sa nerozbije.
- **Zadané testy** s touto oblasťou. `createAssignment()` si otázky odfotí do
  záznamu testu, takže už zadaný test funguje ďalej; z ponuky oblastí zmizne.
- **`contentOverrides/ciselne`**, ak by garant niektorú otázku upravil. Po
  odstránení ich nič nečíta. Reset dema `contentOverrides` zámerne nemaže
  (viď [Reset dema](#reset-dema)), takže ak ich chceš preč, zmaž vetvu ručne
  vo Firebase konzole.
- **`users/*/spiderGamePlays`** a **`spiderGameOkruhy`** — denné počítadlá hier
  pavúka, kľúče obsahujú názov oblasti. Sú to len čísla, nič sa z nich nečíta
  spätne; už pripísané 🪙 ostávajú, sú zarobené a rebríček ich nerozlišuje.
- **`demoLimits/{dátum}/ciselneSustavy`** — denné počítadlo AI. Vetva
  `demoLimits` sa prirodzene prestane dopĺňať.

### Po odstránení over

Hlavnú stránku, `/qr/`, finančný súboj a [reset dema](#reset-dema) — teda to
isté, čo sa overovalo pri jej pridaní.

---

## Roadmapa

### Pripravované oblasti

Sú v zozname chipov, ale zamknuté. Zapnú sa doplnením obsahu podľa [Ako pridať oblasť](#ako-pridať-oblasť) — kroky 3–11, prvé dva sú už hotové.

| Oblasť | Chýba |
|---|---|
| Bankovníctvo | `data/<slug>/A1.json`, `A2.json` |
| Práca a mzda | to isté |
| Digitálne financie | to isté |
| Spotrebiteľské právo | to isté |

### Ďalej v pláne

Zámerne **nie sú** v chipoch, aby zoznam neobsahoval položky, ktoré nikam nevedú:

- Podnikanie
- Riziko a poistenie
- Finančné rozhodovanie

### Samostatná verzia pre ZŠ

Táto inštancia je **pre stredné školy** — obsah aj tón textov tomu zodpovedajú. Pre základné školy vznikne **samostatná inštancia**, nie ďalšie oblasti v tejto:

- vlastný repozitár, vlastný Vercel projekt a **vlastná Firebase databáza** (rebríčky ZŠ a SŠ sa nemajú miešať),
- postup je v [Nasadenie od nuly](#nasadenie-od-nuly),
- obsah sa pripraví zvlášť; štruktúra JSON aj registre ostávajú rovnaké.
