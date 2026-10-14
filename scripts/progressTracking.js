'use strict';

/* ============================================================
   PER-OKRUH TRACKING – Fáza 2 osobného prehľadu progresu
   ============================================================
   Ukladá NAJLEPŠÍ (nie posledný) výsledok študenta per okruh pre
   kvíz/duel, kartičky a prípady. Bifľovačka má vlastný, už existujúci
   store (users/{nick}/memoryProgress/...) – tu sa nedupluje, Fáza 3
   ho pri počítaní % témy len prečíta.

   Schéma (nová vetva, nedotýka sa duels/, leaderboard/, groups/,
   assignments/, contentOverrides):
     users/{nick}/progress/{appId}/{subArea}/{okruhKey}/{activity}
       = { best: 0-100, ts }

   appId:   'pracovne' | 'trestne' | 'obcianske' | 'eu'  (rovnaké id ako
            v data.js window.catalog[...].id)
   subArea: 'main' (Pracovné právo, Európske právo – jeden pool)
            'hmotne' | 'procesne' (Trestné/Občianske právo – MUSÍ byť
            oddelené, lebo hmotné aj procesné majú vlastné A1..A30/A40/A45
            súbory s rovnakými source kľúčmi – bez rozlíšenia by sa
            progres dvoch rôznych okruhov omylom zlial do jedného).
   activity: 'quiz' | 'flashcards' | 'cases' | 'statnica'
============================================================ */
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export const PROGRESS_ACTIVITIES = { QUIZ: 'quiz', FLASHCARDS: 'flashcards', CASES: 'cases', STATNICA: 'statnica' };

function getDb() {
  const db = window.db;
  if (!db) {
    console.error("❌ Firebase DB (window.db) nie je inicializovaná.");
  }
  return db;
}

/* Firebase kľúč nesmie obsahovať . # $ / [ ] */
function sanitizeKey(s) {
  return String(s).replace(/[.#$/\[\]]/g, '_');
}

/* Mapuje presný názov (pod)oblasti (napr. "Trestné právo procesné") na
   appId + subArea. Vracia { appId: null } pre neznáme/nepodporované oblasti
   (napr. legacy moduly) – volajúci to má ignorovať. */
export function resolveProgressLocation(areaTitle) {
  switch (areaTitle) {
    /* ⚠️ OPRAVA (2026-10): finančné oblasti tu CHÝBALI, hoci dashboard
       ich celý čas čítal. resolveProgressLocation() vracala { appId: null },
       recordOkruhResult() sa hneď vrátila a do users/{nick}/progress/
       {osobne|invest|makro} nikdy nič nezapísalo – Môj progres preto
       ukazoval samé nuly bez ohľadu na to, koľko toho hráč odohral.
       appId musí sedieť s DASHBOARD_AREAS v scripts/dashboardStats.js,
       inak dashboard číta inú vetvu, než do ktorej sa zapisuje. */
    case 'Osobné financie': return { appId: 'osobne', subArea: 'main' };
    case 'Investovanie': return { appId: 'invest', subArea: 'main' };
    case 'Makroekonómia': return { appId: 'makro', subArea: 'main' };

    /* Zdedené právnické oblasti LexAreny – v deme sa nepoužívajú. */
    case 'Pracovné právo': return { appId: 'pracovne', subArea: 'main' };
    case 'Európske právo': return { appId: 'eu', subArea: 'main' };
    case 'Trestné právo hmotné': return { appId: 'trestne', subArea: 'hmotne' };
    case 'Trestné právo procesné': return { appId: 'trestne', subArea: 'procesne' };
    case 'Občianske právo hmotné': return { appId: 'obcianske', subArea: 'hmotne' };
    case 'Občianske právo procesné': return { appId: 'obcianske', subArea: 'procesne' };
    default: return { appId: null, subArea: null };
  }
}

/*
  Nízkoúrovňový zápis – appId/subArea sú už známe (samostatné appky
  pracovne-pravo-app/eu-pravo-app/trestne-pravo-app/ob-pravo-app poznajú
  window.PRAVO_APP_ID a state.area priamo, netreba ich odvodzovať z
  názvu oblasti). Zapíše len ak je výsledok LEPŠÍ ako doteraz uložený
  najlepší (zlepšenie sa počíta, zhoršenie nie).
*/
export async function writeOkruhBest(nick, appId, subArea, okruhKey, activity, percent) {
  const db = getDb();
  if (!db || !nick || !appId || !subArea || !okruhKey || !activity) return;
  if (typeof percent !== 'number' || Number.isNaN(percent)) return;

  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const path = `users/${sanitizeKey(nick)}/progress/${appId}/${subArea}/${sanitizeKey(okruhKey)}/${activity}`;
  const node = ref(db, path);

  try {
    const snap = await get(node);
    const prev = snap.exists() ? snap.val() : null;
    const prevBest = prev && typeof prev.best === 'number' ? prev.best : -1;

    if (pct > prevBest) {
      await update(node, { best: pct, ts: Date.now() });
    }
  } catch (e) {
    console.warn('⚠️ writeOkruhBest zlyhalo:', path, e);
  }
}

/*
  Vrstva nad writeOkruhBest pre volajúcich, ktorí poznajú len presný názov
  (pod)oblasti (napr. root scripts/duels.js, memory.js, cases.js – tie
  pracujú s window.areas["Trestné právo procesné"] a pod., nie s appId).
*/
export async function recordOkruhResult(nick, areaTitle, okruhKey, activity, percent) {
  const { appId, subArea } = resolveProgressLocation(areaTitle);
  if (!appId) return; // neznáma/nepodporovaná oblasť – nič neukladaj
  return writeOkruhBest(nick, appId, subArea, okruhKey, activity, percent);
}

/*
  Fáza 3 – cross-device "preštudované okruhy".
  Prečíta CELÚ vetvu users/{nick}/progress/{appId}/{subArea} jedným get()
  a vráti Set INDEXOV tých okruhov z poľa `okruhy`, ktoré študent aspoň raz
  zvládol na `threshold` % v KVÍZE. To presne zodpovedá pôvodnej lokálnej
  logike "done" (okruh sa označil za dokončený pri kvíze ≥ 60 %). Best % je
  monotónne (writeOkruhBest nikdy neznižuje), takže raz dokončené ostáva
  dokončené. Data už v Firebase SÚ (píše ich writeOkruhBest) – doteraz sa
  len čítalo z localStorage, preto sa progres neprenášal medzi zariadeniami.

  Sanitizácia kľúča ostáva v tomto module (rovnaká ako pri zápise), aby sa
  read/write nerozišli – volajúci posiela okruhy s ._file a dostane indexy.
*/
export async function readDoneOkruhIndices(nick, appId, subArea, okruhy, threshold = 60) {
  const done = new Set();
  const db = getDb();
  if (!db || !nick || !appId || !subArea || !Array.isArray(okruhy)) return done;

  const path = `users/${sanitizeKey(nick)}/progress/${appId}/${subArea}`;
  try {
    const snap = await get(ref(db, path));
    if (!snap.exists()) return done;
    const bySubArea = snap.val() || {};
    okruhy.forEach((o, i) => {
      if (!o || !o._file) return;
      const acts = bySubArea[sanitizeKey(o._file)];
      const q = acts && acts.quiz;
      if (q && typeof q.best === 'number' && q.best >= threshold) done.add(i);
    });
  } catch (e) {
    console.warn('⚠️ readDoneOkruhIndices zlyhalo:', path, e);
  }
  return done;
}
