'use strict';

/* ============================================================
   memoryDefinitions.js
   Zdroj dát pre Bifľovačku (Memory Trainer).

   Jediný zoznam oblastí (MEMORY_AREAS) + generátor balíčkov
   z existujúcich JSON súborov externých appiek. Každá otázka
   z quiz[] poľa sa stáva jedným bifľovacím balíčkom.
============================================================ */

import { normalizeOkruh } from './scripts/contentNormalize.js';

export const MEMORY_AREAS = [
  {
    name: "Osobné financie",
    slug: "osobne",
    path: "data/",
    count: 2
  },
  {
    name: "Investovanie",
    slug: "invest",
    path: "data/invest/",
    count: 2
  },
  {
    name: "Makroekonómia",
    slug: "makro",
    path: "data/makro/",
    count: 2
  }
];

export function getAreaBySlug(slug) {
  return MEMORY_AREAS.find(a => a.slug === slug) || null;
}

/* ============================================================
   Cache – aby sa pri opakovanej návšteve balíčky nefetchovali znova
============================================================ */
const packageCache = new Map();

/* ============================================================
   Priradenie definície k správnej odpovedi
   Otázky majú v `options[]` často len krátky pojem (napr.
   "Odborová organizácia"), nie celú definíciu. Skutočnú definíciu
   nájdeme v `tiles[]` daného súboru (term ↔ definition).
============================================================ */
function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?()"'🪙]/g, '')
    .replace(/\s+/g, ' ');
}

function findMatchingTile(tiles, correctAnswer, question) {
  if (!Array.isArray(tiles) || !tiles.length) return null;
  const normAnswer = normalizeForMatch(correctAnswer);

  // 1. presná zhoda term ↔ correctAnswer
  let match = tiles.find(t => normalizeForMatch(t.term) === normAnswer);
  if (match) return match;

  // 2. term je súčasťou odpovede alebo naopak (len pri dostatočne dlhých pojmoch)
  match = tiles.find(t => {
    const normTerm = normalizeForMatch(t.term);
    if (normTerm.length < 4) return false;
    return normAnswer.includes(normTerm) || normTerm.includes(normAnswer);
  });
  if (match) return match;

  // 3. term sa nachádza priamo v znení otázky
  const normQuestion = normalizeForMatch(question);
  match = tiles.find(t => {
    const normTerm = normalizeForMatch(t.term);
    return normTerm.length >= 4 && normQuestion.includes(normTerm);
  });
  return match || null;
}

/* ============================================================
   Ručné balíčky – biflovacka/{slug}.json
   Ak pre danú oblasť existuje ručne pripravený súbor s definíciami
   (schéma: { area, slug, schemaVersion, okruhy: [{ id, title,
   definitions: [{ question, answer }] }] }), použije sa prednostne
   namiesto automatického generovania z kvízov.
============================================================ */
function packagesFromManualFile(slug, manual) {
  const packages = [];
  (manual.okruhy || []).forEach(okruh => {
    (okruh.definitions || []).forEach((def, idx) => {
      if (!def || !def.answer) return;
      packages.push({
        id: `${slug}_${okruh.id}_${idx + 1}`,
        defKey: `${okruh.id}_${idx + 1}`,
        okruhId: okruh.id,
        area: slug,
        source: okruh.title || '',
        zdroj: def.zdroj || null,
        question: def.question || '',
        correctAnswer: def.answer,
        definition: def.answer,
        summary: okruh.title || '',
        legalSentence: def.answer
      });
    });
  });
  return packages;
}

/* ============================================================
   GARANT/ADMIN OPRAVY – biflovackaOverrides/{slug}/{defKey}
   Statické JSON súbory sa z klienta prepísať nedajú, preto opravy
   žijú vo Firebase a prekryjú zodpovedajúcu definíciu pri každom
   načítaní balíčkov (jedno čítanie na oblasť). Balíček s opravou
   dostane pkg.seal = 'garant' + pkg.sealedBy, nech ho hráči vidia
   ako overený.
============================================================ */
async function loadOverrides(slug) {
  try {
    const db = window.db;
    if (!db) return {};
    const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const snap = await get(ref(db, `biflovackaOverrides/${slug}`));
    return snap.exists() ? snap.val() : {};
  } catch (e) {
    console.warn(`⚠️ Bifľovačka: chyba pri načítaní opráv pre ${slug}`, e);
    return {};
  }
}

function applyOverrides(packages, overrides) {
  if (!overrides || !Object.keys(overrides).length) return packages;
  return packages.map(pkg => {
    const override = pkg.defKey ? overrides[pkg.defKey] : null;
    if (!override) return pkg;
    return {
      ...pkg,
      question: override.question || pkg.question,
      correctAnswer: override.answer || pkg.correctAnswer,
      definition: override.answer || pkg.definition,
      legalSentence: override.answer || pkg.legalSentence,
      zdroj: override.zdroj || pkg.zdroj || null,
      seal: 'garant',
      sealedBy: override.editedBy || ''
    };
  });
}

/* ============================================================
   generateMemoryPackages(slug)
   Ak existuje biflovacka/{slug}.json, balíčky sa postavia z neho
   (ručné definície). Inak sa načíta A1..A{count}.json danej oblasti
   a z ich `quiz` poľa sa vytvoria bifľovacie balíčky:
   { id, area, source, question, correctAnswer,
     definition, summary, legalSentence }

   Zobrazovacia priorita (v memoryTrainer.js / memory-trainer.html)
   je definition || summary || legalSentence – nikdy title.
   Balíčky zámerne neobsahujú `explanation` (text spätnej väzby
   z kvízu, napr. "Správne. ..."), aby sa v Bifľovačke nezobrazoval.
============================================================ */
export async function generateMemoryPackages(slug) {
  if (packageCache.has(slug)) {
    return packageCache.get(slug);
  }

  const area = getAreaBySlug(slug);
  if (!area) return [];

  try {
    const manualRes = await fetch(`biflovacka/${slug}.json`);
    if (manualRes.ok) {
      const manual = await manualRes.json();
      let manualPackages = packagesFromManualFile(slug, manual);
      if (manualPackages.length) {
        const overrides = await loadOverrides(slug);
        manualPackages = applyOverrides(manualPackages, overrides);
        packageCache.set(slug, manualPackages);
        return manualPackages;
      }
    }
  } catch (e) {
    console.warn(`⚠️ Bifľovačka: chyba pri načítaní ručných definícií pre ${slug}`, e);
  }

  const packages = [];
  let n = 0;

  for (let i = 1; i <= area.count; i++) {
    const file = `A${i}.json`;
    try {
      const res = await fetch(area.path + file);
      if (!res.ok) continue;
      const raw = await res.json();
      /* Normalizácia na jeden vnútorný tvar (summary/theory, question/q,
         zdroj) – nech bifľovačka funguje aj pre oblasti, ktoré doteraz
         nemali `summary` (napr. Trestné právo hmotné má len `theory`). */
      const data = normalizeOkruh(raw);
      const summary = data.summary || '';

      (data.quiz || []).forEach(q => {
        if (!Array.isArray(q.options) || typeof q.correct !== 'number') return;
        const correctAnswer = q.options[q.correct];
        if (!correctAnswer) return;

        const matchedTile = findMatchingTile(data.tiles, correctAnswer, q.question);

        n++;
        packages.push({
          id: `${slug}_${String(n).padStart(3, '0')}`,
          area: slug,
          source: `A${i}`,
          zdroj: q.zdroj || null,
          question: q.question || '',
          correctAnswer,
          definition: matchedTile ? matchedTile.definition : '',
          summary,
          legalSentence: correctAnswer
        });
      });
    } catch (e) {
      console.warn(`⚠️ Bifľovačka: chyba pri načítaní ${area.path}${file}`, e);
    }
  }

  packageCache.set(slug, packages);
  return packages;
}
