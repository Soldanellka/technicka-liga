'use strict';

/* =====================================================
   DEFINÍCIA OBLASTÍ PRE DUEL (bez tréningového režimu)
   ===================================================== */

/*
  Toto sú oblasti, ktoré duelový engine používa.
  Presne tieto názvy sa zobrazujú v UI a používajú sa
  ako kľúče v window.areas aj v startDuel(name).
*/

export const duelAreas = [
  /* ⚠️ Tento zoznam je ZÁROVEŇ zoznamom chipov oblastí. areas.js beží AŽ PO
     data.js a prepisuje window.areas, takže oblasť, ktorá tu nie je, sa
     v UI vôbec nezobrazí. Pripravované oblasti preto MUSIA byť uvedené –
     data.js pre ne loader nespúšťa, a tak ich app.js po AREA_GIVE_UP_MS
     sám označí ako „pripravuje sa“ a klik zablokuje (rovnaký mechanizmus,
     aký mali kedysi Rímske právo a Dejiny práva).
     Ďalšie oblasti z roadmapy (Podnikanie, Riziko a poistenie,
     Makroekonómia, Finančné rozhodovanie) sem ZÁMERNE nepatria, kým
     nie sú na rade – viď README-DEMO.md. */
  "Osobné financie",        // aktívna – data/A1.json, data/A2.json
  "Investovanie",           // aktívna – data/invest/A1.json, A2.json
  "Makroekonómia",          // aktívna – data/makro/A1.json, A2.json
  /* ⏳ DOČASNÁ TÉMA (pomôcka pre jedného žiaka, nie obsah dema pre neziskovky).
     Odstránenie = tento riadok + tri miesta v data.js + jeden riadok v
     scripts/contentOverrides.js – celý postup je v README-DEMO.md. */
  "Číselné sústavy",        // dočasná – data/ciselne/A1.json, A2.json
  "Logické funkcie",         // školská oblasť – data/logika/
  "Počítačové siete",        // školská oblasť – data/siete/
  "Elektrotechnika",         // školská oblasť – data/elektro/
  "Fyzika",                  // školská oblasť – data/fyzika/
  "Bankovníctvo",           // pripravuje sa – bez obsahu
  "Práca a mzda",           // pripravuje sa – bez obsahu
  "Digitálne financie",     // pripravuje sa – bez obsahu
  "Spotrebiteľské právo"    // pripravuje sa – bez obsahu
];

/* =====================================================
   ŠKOLSKÉ OBLASTI
   =====================================================
   Oblasti, ktoré NIE SÚ obsahom dema pre neziskovky – sú to pomôcky
   pre jedného žiaka z jeho školských poznámok. Zoznam je jedno miesto
   pravdy pre všetko, čo sa ich týka spoločne:
     – AI spätná väzba (školský prompt + spoločná kvóta `skola`),
     – univerzálny študijný modul moduly/skola.html,
     – do budúcna sprístupnenie len vybranému hráčovi.

   ⚠️ api/quiz-feedback.js má VLASTNÚ kópiu tohto zoznamu. Appka je
   bez build kroku: areas.js je ES modul pre prehliadač, endpoint je
   CommonJS na Verceli – importovať sa navzájom nedajú. Keď sa zoznam
   mení, musí sa zmeniť na OBOCH miestach. Obe sú označené rovnakou
   značkou ŠKOLSKÉ OBLASTI, nech sa dajú nájsť naraz.
===================================================== */
export const SCHOOL_AREAS = [
  'Číselné sústavy',
  'Fyzika',
  'Elektrotechnika',
  'Počítačové siete',
  'Logické funkcie',
  'Logické funkcie',
  'Počítačové siete',
  'Elektrotechnika',
  'Fyzika'
];

/* =====================================================
   PRÍPRAVA GLOBÁLNEJ ŠTRUKTÚRY PRE DUELOVÉ OTÁZKY
   ===================================================== */

window.areas = {};

duelAreas.forEach(name => {
  // Každá oblasť má pole otázok, ktoré doplní data.js
  window.areas[name] = [];
});

console.log("AREAS INITIALIZED FOR DUELS:", Object.keys(window.areas));
