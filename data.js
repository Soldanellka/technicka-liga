'use strict';

import { normalizeOkruh } from './scripts/contentNormalize.js';
import { applyOverridesFromMap, loadContentOverridesForApp, AREA_SLUGS }
from './scripts/contentOverrides.js';

console.log("DATAJS NAČÍTANÝ");

/* =====================================================
   AUTO-DETEKCIA PROSTREDIA
===================================================== */

/* ZÁMERNE relatívna cesta – demo nesmie ťahať obsah z produkčnej domény. */
const LIVE = "";

/* =====================================================
   GLOBÁLNE OBJEKTY PRE DUELOVÝ ENGINE
===================================================== */

window.areas = {
  "Osobné financie": [],
  "Investovanie": [],
  "Makroekonómia": [],
  "Číselné sústavy": [],   // ⏳ dočasná téma, viď README-DEMO.md
  "Logické funkcie": [],
  "Počítačové siete": [],
  "Elektrotechnika": [],
  "Fyzika": [],
  "Bankovníctvo": [],
  "Práca a mzda": [],
  "Digitálne financie": [],
  "Spotrebiteľské právo": []
};

/* =====================================================
   ŠTUDIJNÉ MODULY – VRÁTENÉ VŠETKY
===================================================== */

/* Externé sub-appky demo nemá. Objekt musí existovať a musí na ňom byť
   openExternal – waitForAllData() v init.js čaká na oboje. Prázdny zoznam
   modulov je v poriadku, renderCatalog() v app.js openExternal odfiltruje. */
window.catalog = {
  "Peniaze a úver": {
    area: "Osobné financie",
    id: "osobne-peniaze-a-uver",
    openExternal: "moduly/osobne-peniaze-a-uver.html",
    desc: "Teória k okruhu A1 oblasti Osobné financie."
  },
  "Sporenie a investovanie": {
    area: "Osobné financie",
    id: "osobne-sporenie-a-investovanie",
    openExternal: "moduly/osobne-sporenie-a-investovanie.html",
    desc: "Teória k okruhu A2 oblasti Osobné financie."
  },
  /* ⏳ DOČASNÁ TÉMA – samostatný modul k číselným sústavám. Viď README-DEMO.md. */
  "Číselné sústavy": {
    area: "Číselné sústavy",
    id: "ciselne-sustavy",
    openExternal: "moduly/ciselne-sustavy.html",
    desc: "Výklad k dvojkovej, šestnástkovej a osmičkovej sústave."
  },
  /* ⏳ ŠKOLSKÁ OBLASŤ – univerzálny modul, viď README-DEMO.md. */
  "Logické funkcie": {
    area: "Logické funkcie",
    id: "skola-logika",
    openExternal: "moduly/skola.html?oblast=logika",
    desc: "Výklad a kvíz k okruhom oblasti Logické funkcie."
  },
  /* ⏳ ŠKOLSKÁ OBLASŤ – univerzálny modul, viď README-DEMO.md. */
  "Počítačové siete": {
    area: "Počítačové siete",
    id: "skola-siete",
    openExternal: "moduly/skola.html?oblast=siete",
    desc: "Výklad a kvíz k okruhom oblasti Počítačové siete."
  },
  /* ⏳ ŠKOLSKÁ OBLASŤ – univerzálny modul, viď README-DEMO.md. */
  "Elektrotechnika": {
    area: "Elektrotechnika",
    id: "skola-elektro",
    openExternal: "moduly/skola.html?oblast=elektro",
    desc: "Výklad a kvíz k okruhom oblasti Elektrotechnika."
  },
  /* ⏳ ŠKOLSKÁ OBLASŤ – univerzálny modul, viď README-DEMO.md. */
  "Fyzika": {
    area: "Fyzika",
    id: "skola-fyzika",
    openExternal: "moduly/skola.html?oblast=fyzika",
    desc: "Výklad a kvíz k okruhom oblasti Fyzika."
  }
};

/* =====================================================
   AUTO-LOADER JSON OTÁZOK

   🚀 DÁVKOVÉ NAČÍTANIE (2026-08). Pôvodná verzia bola striktne sériová:
   for (file of files) { await fetch(file); await <Firebase get pre okruh>; }
   – pri ~233 súboroch naprieč appkou to znamenalo ~233 HTTP round-tripov
   a ~233 Firebase čítaní za sebou. Na mobile to trvalo natoľko dlho, že
   chipy oblastí stihli zošednúť na „pripravuje sa“ a potom sa odblokovať
   (blikanie), a najväčšie oblasti (Pracovné 50 súborov, Občianske 40+45)
   dobiehali ako posledné.

   Po novom:
   ① overridy CELEJ oblasti jedným Firebase getom PRED cyklom
      (loadContentOverridesForApp) → 233 čítaní pre appku klesne na 6,
   ② súbory sa sťahujú po dávkach BATCH_SIZE paralelne (Promise.all),
      nie po jednom – dávka je zámerne malá, nech nezahltí mobilnú sieť.

   ⚠️ PORADIE SA NESMIE ZMENIŤ. Promise.all vracia výsledky v poradí
   vstupov a dávky idú za sebou, takže ploché polia questions/tiles/cases
   vzniknú presne v takom poradí ako doteraz (A1 → A2 → … → An, vnútri
   v poradí položiek). Kanonické indexy _ti/_ci/_quizIndex sú per-okruh,
   takže na ne dávkovanie nemá vplyv – ale poradie otázok v rámci okruhu
   číta groupBySource() v scripts/duels.js, preto sa drží aj to.

   ⚠️ FAIL-SOFT PER SÚBOR. Každá položka dávky má vlastný try/catch a pri
   chybe vracia null – jeden rozbitý/chýbajúci súbor nesmie zhodiť celú
   dávku ani oblasť. Rovnaké správanie ako pôvodný `continue` v cykle.
===================================================== */

/* Koľko súborov naraz. Pozor, NIE je to celkový počet súbežných requestov:
   šesť oblastí sa načítava paralelne (šesť volaní loadJsonQuestions bez
   awaitu nižšie), takže reálna súbežnosť je 6 × BATCH_SIZE. Pri 4 je to
   24 requestov naraz – výrazne rýchlejšie než sériovo, ale ešte šetrné
   k mobilnej sieti (pri 8 by ich bolo 48). */
const BATCH_SIZE = 4;

async function fetchOkruhJson(folderUrl, file, areaTitle, overridesByOkruh) {
  try {
    const res = await fetch(folderUrl + file);
    if (!res.ok) return null;                       // chýbajúci súbor – ticho preskočiť

    const raw = await res.json();
    /* Normalizácia na jeden vnútorný tvar (summary/theory, question/q,
       explanation v 3 tvaroch, zdroj/source) – nech engine prijme
       všetky existujúce tvary JSON bez prepisovania súborov. */
    const normalized = normalizeOkruh(raw);
    /* Firebase override (admin/garant oprava) navrství sa nad pôvodný
       JSON – chýbajúci override alebo nedostupná Firebase necháva
       pôvodný obsah bez zmeny. Zdroj je predčítaná mapa oblasti, takže
       tu už žiadne sieťové volanie nie je. */
    const json = applyOverridesFromMap(normalized, areaTitle, file.replace('.json', ''), overridesByOkruh);
    return { file, json };
  } catch (e) {
    console.warn("⚠️ Chyba pri načítaní:", file, e);
    return null;
  }
}

async function loadJsonQuestions(areaTitle, folderUrl, maxFiles) {
  console.log("📥 Načítavam JSON otázky pre:", areaTitle);

  const files = Array.from({ length: maxFiles }, (_, i) => `A${i + 1}.json`);
  const questions = [];
  const tiles = [];
  const cases = [];

  /* Jeden get na celú oblasť namiesto jedného na každý okruh. Fail-soft:
     pri nedostupnej Firebase vráti {} a obsah sa zobrazí bez úprav. */
  const overridesByOkruh = await loadContentOverridesForApp(AREA_SLUGS[areaTitle]);

  for (let start = 0; start < files.length; start += BATCH_SIZE) {
    const batch = files.slice(start, start + BATCH_SIZE);
    const loaded = await Promise.all(
      batch.map(file => fetchOkruhJson(folderUrl, file, areaTitle, overridesByOkruh))
    );

    /* Skladanie AŽ TU a v poradí dávky – pozri poznámku o poradí vyššie. */
    for (const item of loaded) {
      if (!item) continue;                          // preskočený/rozbitý súbor
      const { file, json } = item;

      /* 📛 Názov okruhu (title z A*.json) – doteraz sa načítal, ale nikde
         sa neukladal, takže dashboard/garant test builder mali k dispozícii
         len interný kľúč "A1". Uloženie tu (bez ďalšieho fetchu) rieši oba
         naraz – jeden zdroj pravdy pre názov okruhu naprieč appkou. */
      window.areaOkruhTitles = window.areaOkruhTitles || {};
      window.areaOkruhTitles[areaTitle] = window.areaOkruhTitles[areaTitle] || {};
      window.areaOkruhTitles[areaTitle][file.replace('.json', '')] = json.title || null;

      /* 🃏 Dlaždice pre memory (pojem ↔ definícia) */
      if (Array.isArray(json.tiles)) {
        /* _ti = kanonický index dlaždice v json.tiles jeho okruhu (rovnaký dôvod
           ako _ci pri prípadoch nižšie): zoznam je PLOCHÝ a cez-okruhový, takže
           pozícia v ňom nie je index, ktorý čaká applyContentOverrides
           (tile_${i}). Hlavná appka dnes dlaždice needituje, ale sploštenie tým
           prestáva informáciu strácať. */
        json.tiles.forEach((t, ti) => {
          if (t && t.term && t.definition) {
            tiles.push({ term: t.term, definition: t.definition, source: file.replace('.json',''), _area: areaTitle, zdroj: t.zdroj || null, _ti: ti });
          }
        });
      }

      /* 📋 Prípady z praxe (jeden prípad = viac krokov) */
      if (Array.isArray(json.cases)) {
        json.cases.forEach((c, ci) => {
          if (c && Array.isArray(c.steps)) {
            cases.push({
              title: c.title || 'Prípad',
              difficulty: c.difficulty || '',
              steps: c.steps, // už normalizované (question/explanation/zdroj na krok)
              source: file.replace('.json',''),
              /* Kanonický index prípadu v json.cases jeho okruhu. Zoznam nižšie
                 je PLOCHÝ a cez-okruhový (a v cases.js sa ešte filtruje na
                 vybranú dvojicu okruhov), takže pozícia v ňom NIE JE totožná
                 s indexom, ktorý čaká applyContentOverrides (contentOverrides.js
                 case_${ci}_step_${si}). Bez tohto poľa by sa admin úprava
                 uložila pod cudzí/neexistujúci index. */
              _ci: ci,
              /* Pôvodná (nezlúčená) oblasť tohto prípadu – niektoré výbery
                 v cases.js zlučujú viac oblastí do jedného poľa (napr.
                 "Trestné právo" = hmotné + procesné), takže areaTitle
                 parameter v renderJsonCase() by nebol spoľahlivý na
                 identifikáciu contentOverrides app slugu. */
              area: areaTitle,
              zdroj: c.zdroj || null
            });
          }
        });
      }

      if (json.quiz) {
        json.quiz.forEach((q, qi) => {
          questions.push({
            question: q.question, // už normalizované (question || q)
            options: q.options,
            correct: q.correct,
            explanation: q.explanation, // už normalizované na {correct,wrong} | null
            zdroj: q.zdroj || null,
            _seal: q._seal || null,
            /* Kanonický index v okruh.quiz[] (pred zamiešaním) + oblasť –
               potrebné pre admin/garant inline editáciu (contentOverrides
               cast kľúč quiz_{i}), keďže toto pole je zlúčené naprieč
               všetkými súbormi danej oblasti a stráca pôvodný index. */
            _quizIndex: qi,
            _area: areaTitle,
            /* =========================
               🔥 OPRAVA: source sa nastavuje podľa
               skutočného súboru (napr. "A23"), nie podľa
               interného json.id, ktoré môže byť v rôznych
               JSON súboroch zhodné/duplicitné a spôsobovať
               nesprávne zoskupovanie otázok do párov
               (duel potom ťahal iný počet otázok, než mal).
               ========================= */
            source: file.replace('.json', '')
          });
        });
      }
    }
  }

  window.areas[areaTitle] = questions;
  window.areaTiles = window.areaTiles || {};
  window.areaCases = window.areaCases || {};
  window.areaTiles[areaTitle] = tiles;
  window.areaCases[areaTitle] = cases;

  /* 🏁 Príznak "načítanie dokončené" – nezávisí od počtu otázok,
     aby waitForQuestions() vedel odlíšiť "ešte sa načítava" od
     "načítané, ale zatiaľ prázdne" (napr. oblasť s čiastočne
     doplnenými JSON súbormi) a zbytočne nečakal celých 10 sekúnd. */
  window.areasLoaded = window.areasLoaded || {};
  window.areasLoaded[areaTitle] = true;

  console.log(`✅ ${areaTitle}: ${questions.length} otázok, ${tiles.length} dlaždíc, ${cases.length} prípadov`);
}

/* =====================================================
   NAČÍTANIE OBLASTÍ PRE DUEL
===================================================== */

/* ⚠️ Loader sa spúšťa LEN pre oblasti, ktoré už majú obsah. Oblasť bez
   volania nižšie ostane v zozname chipov, ale bez otázok – app.js ju
   po AREA_GIVE_UP_MS označí ako „pripravuje sa“. Pridanie oblasti =
   nový priečinok s A*.json + jedno volanie tu (viď README-DEMO.md). */

// Osobné financie → 2 JSON (A1-A2)
loadJsonQuestions(
  "Osobné financie",
  LIVE + "data/",
  2
);

// Investovanie → 2 JSON (A1-A2)
loadJsonQuestions(
  "Investovanie",
  LIVE + "data/invest/",
  2
);

// Makroekonómia → 2 JSON (A1-A2)
loadJsonQuestions(
  "Makroekonómia",
  LIVE + "data/makro/",
  2
);

/* ⏳ DOČASNÁ TÉMA – Číselné sústavy → 6 JSON (A1-A6), okruhy zodpovedajú
   kapitolám študijného modulu. Pomôcka pre jedného žiaka, nie obsah dema
   pre neziskovky. Oblasť má ZÁMERNE len kvíz a súboj: kartičky, prípady,
   bifľovačka ani AI skúška pre ňu obsah nemajú a UI pre ne ukáže svoj
   bežný prázdny stav. Odstránenie: viď README-DEMO.md. */
loadJsonQuestions(
  "Číselné sústavy",
  LIVE + "data/ciselne/",
  6
);

/* ⏳ ŠKOLSKÁ OBLASŤ – Logické funkcie → 3 JSON (A1-A3).
   Pomôcka pre jedného žiaka, nie obsah dema. Kartičky a prípady si engine
   dogeneruje z otázok; bifľovačka ani AI skúška obsah nemajú. Odstránenie:
   viď README-DEMO.md, sekcia Školské oblasti. */
loadJsonQuestions(
  "Logické funkcie",
  LIVE + "data/logika/",
  3
);

/* ⏳ ŠKOLSKÁ OBLASŤ – Počítačové siete → 3 JSON (A1-A3).
   Pomôcka pre jedného žiaka, nie obsah dema. Kartičky a prípady si engine
   dogeneruje z otázok; bifľovačka ani AI skúška obsah nemajú. Odstránenie:
   viď README-DEMO.md, sekcia Školské oblasti. */
loadJsonQuestions(
  "Počítačové siete",
  LIVE + "data/siete/",
  3
);

/* ⏳ ŠKOLSKÁ OBLASŤ – Elektrotechnika → 2 JSON (A1-A2).
   Pomôcka pre jedného žiaka, nie obsah dema. Kartičky a prípady si engine
   dogeneruje z otázok; bifľovačka ani AI skúška obsah nemajú. Odstránenie:
   viď README-DEMO.md, sekcia Školské oblasti. */
loadJsonQuestions(
  "Elektrotechnika",
  LIVE + "data/elektro/",
  2
);

/* ⏳ ŠKOLSKÁ OBLASŤ – Fyzika → 4 JSON (A1-A4).
   Pomôcka pre jedného žiaka, nie obsah dema. Kartičky a prípady si engine
   dogeneruje z otázok; bifľovačka ani AI skúška obsah nemajú. Odstránenie:
   viď README-DEMO.md, sekcia Školské oblasti. */
loadJsonQuestions(
  "Fyzika",
  LIVE + "data/fyzika/",
  4
);

/* =====================================================
   OTVORENIE EXTERNEJ APPKY
===================================================== */

window.catalog.openExternal = function (slug) {
  console.log("Otváram externú appku:", slug);

  const loader = document.createElement("div");
  loader.id = "globalLoader";
  loader.style = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    color: white;
    font-size: 22px;
    font-weight: 600;
  `;
  loader.textContent = "Načítavam externú aplikáciu…";
  document.body.appendChild(loader);

  setTimeout(() => {
    window.location.href = slug;
  }, 200);
};
