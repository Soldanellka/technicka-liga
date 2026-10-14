/* ============================================================
   FIREBASE IMPORTY
============================================================ */
import {
  ref,
  push,
  set,
  get,
  update,
  remove,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { econAward, econEnergy, econCanPlay, ECONOMY_CONFIG } from './economy.js';
import { showRewardToast } from '../ui.js';
import { escapeHtml } from '../core.js';
import { awardFacultyPoints } from './faculties.js';
import { getOkruhDoneKeys } from './dashboardStats.js';
import { fetchPercentMapSafe, bucketizeKeysByPercent } from './okruhSelector.js';
import { recordOkruhResult, PROGRESS_ACTIVITIES } from './progressTracking.js';

/* Bezpečný prístup k db */
function getDb() {
  const db = window.db;
  if (!db) {
    console.error("❌ Firebase DB (window.db) nie je inicializovaná.");
  }
  return db;
}

/* ============================================================
   VÝBER OTÁZOK PODĽA TVOJHO MODELU
============================================================ */
/* Shuffluje odpovede otázky a správne aktualizuje index správnej odpovede */
function shuffleQuestionOptions(q) {
  q = JSON.parse(JSON.stringify(q)); // deep copy
  if (!Array.isArray(q.options) || q.options.length === 0) return q;

  const correctText = (typeof q.correct === 'number')
    ? q.options[q.correct]
    : null;

  // Fisher-Yates shuffle
  for (let i = q.options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
  }

  // Aktualizuj index správnej odpovede
  if (correctText !== null) {
    const newIndex = q.options.findIndex(o => o === correctText);
    q.correct = newIndex >= 0 ? newIndex : 0;
  }

  return q;
}

/* ============================================================
   KOĽKO OTÁZOK MÁ JEDEN SÚBOJ

   Demo hrá PÄŤ otázok – na stretnutí s neziskovkami musí byť súboj
   dohraný rýchlo, aby sa stihli vystriedať. Pôvodne desať.

   ⚠️ Číslo sa nikde inde nepíše natvrdo. Odvodzujú sa z neho aj
   kombinované oblasti (polovica z každého bazéna) aj hlásenie
   výsledku zápasu tried v scripts/senaty.js. Návrat na desať =
   zmena tohto jedného čísla.
============================================================ */
export const DUEL_QUESTION_COUNT = 5;

/* Kombinované oblasti (trestné/občianske právo) berú polovicu z každého
   bazéna. Pri nepárnom počte dostane prvý bazén o jednu viac. */
const HALF_A = Math.ceil(DUEL_QUESTION_COUNT / 2);
const HALF_B = Math.floor(DUEL_QUESTION_COUNT / 2);

/* Zoskup otázky podľa zdrojového súboru/okruhu (napr. "A1", "A23") */
function groupBySource(list) {
  const groups = {};
  (list || []).forEach(q => {
    const id = q.source;
    if (!id) return;
    if (!groups[id]) groups[id] = [];
    groups[id].push(q);
  });
  return groups;
}

/* Zoraď kľúče okruhov numericky (A1, A2, A3... A10, A11...) */
function sortedOkruhKeys(groups) {
  return Object.keys(groups).filter(k => /^A\d+$/.test(k)).sort(
    (a, b) => Number(a.replace("A", "")) - Number(b.replace("A", ""))
  );
}

/* Vytvor páry po dvoch (A1+A2, A3+A4...); nepárny posledný kľúč sa vynechá */
function buildConsecutivePairs(keys) {
  const pairs = [];
  for (let i = 0; i < keys.length - 1; i += 2) {
    pairs.push([keys[i], keys[i + 1]]);
  }
  return pairs;
}

function pickOneRandomOkruh(areaQuestions, maxPerOkruh) {
  const groups = groupBySource(areaQuestions);
  const keys = sortedOkruhKeys(groups);
  if (keys.length === 0) return { key: null, questions: [] };
  const key = keys[Math.floor(Math.random() * keys.length)];
  const qs = groups[key] || [];
  return { key, questions: maxPerOkruh ? qs.slice(0, maxPerOkruh) : qs };
}

/* Popisuje, ako sa pre danú oblasť skladá "dvojica okruhov" na jednu study session. */
function getPairStructure(areaName) {
  // 🔥 PÁROVÉ OBLASTI – páry A1+A2, A3+A4, … (rovnaký mechanizmus pre
  // Pracovné právo aj Európske právo, žiadna EÚ-špecifická vetva).
  if (areaName === "Pracovné právo" || areaName === "Európske právo") {
    return { type: "pair", pool: areaName };
  }
  if (areaName === "Trestné právo" || areaName === "Trestné právo hmotné" || areaName === "Trestné právo procesné") {
    return { type: "dual", poolA: "Trestné právo hmotné", poolB: "Trestné právo procesné" };
  }
  if (areaName === "Občianske právo" || areaName === "Občianske právo hmotné" || areaName === "Občianske právo procesné") {
    return { type: "dual", poolA: "Občianske právo hmotné", poolB: "Občianske právo procesné" };
  }
  return { type: "flat", pool: areaName };
}

export function pickQuestions(areaName) {
  const structure = getPairStructure(areaName);
  let questions = [];

  if (structure.type === "pair") {
    const all = window.areas[structure.pool] || [];
    const groups = groupBySource(all);
    const keys = sortedOkruhKeys(groups);
    const pairs = buildConsecutivePairs(keys);

    if (pairs.length === 0) {
      // Fallback: vyber náhodné otázky z celej oblasti
      questions = all.slice().sort(() => Math.random() - 0.5).slice(0, DUEL_QUESTION_COUNT);
    } else {
      const [k1, k2] = pairs[Math.floor(Math.random() * pairs.length)];
      questions = [...(groups[k1] || []), ...(groups[k2] || [])];
    }
  }

  else if (structure.type === "dual") {
    // 1 náhodný okruh z poolu A + 1 z poolu B, polovica otázok z každého
    const poolA = window.areas[structure.poolA] || [];
    const poolB = window.areas[structure.poolB] || [];

    const fromA = pickOneRandomOkruh(poolA, HALF_A);
    const fromB = pickOneRandomOkruh(poolB, HALF_B);

    console.log(`🔥 ${areaName}: ${structure.poolA} okruh ${fromA.key}, ${structure.poolB} okruh ${fromB.key}`);
    questions = [...fromA.questions, ...fromB.questions];
  }

  // 🔥 Ostatné oblasti – fallback
  else {
    const all = window.areas[areaName] || [];
    questions = all.slice().sort(()=>Math.random()-0.5).slice(0, DUEL_QUESTION_COUNT);
  }

  // 🔥 Shuffluj odpovede každej otázky
  return questions.map(q => shuffleQuestionOptions(q));
}

/* ============================================================
   VÝBER DVOJICE OKRUHOV PRE CELÚ STUDY SESSION
   (pojednávanie + kartičky + prípady čerpajú z tej istej dvojice)
============================================================ */
async function filterKeysByMode(keys, mode, nick, poolAreaName) {
  if (mode === "random") return keys;

  if (mode === "studied") {
    // Bez nicku niet čo čítať z Firebase – prázdna množina (rovnaké ako
    // čerstvo prihlásený študent bez histórie) spustí usedFallback nižšie.
    if (!nick) return [];
    const doneKeys = await getOkruhDoneKeys(nick, poolAreaName, keys, 60, 'POJEDNÁVANIA');
    return keys.filter(k => doneKeys.has(k));
  }

  // mode === "unstudied" – percentMap ide cez fetchPercentMapSafe (nie
  // priamo getOkruhPercentMap), aby zlyhanie Firebase spôsobilo tichý
  // fallback (usedFallback), nie nezachytenú výnimku. Bez nicku sa
  // percentMap necháva prázdny objekt – classifyOkruhPercent vtedy
  // zaradí všetko do "nedotknuté", čiže vráti celé `keys` nezmenené
  // (rovnaký efekt ako pôvodné "pct=0 < 30 pre všetko").
  const percentMap = nick ? await fetchPercentMapSafe(nick, poolAreaName, keys, 'POJEDNÁVANIA') : {};
  if (!percentMap) return []; // skutočné zlyhanie Firebase (nick bol, fetch zlyhal)
  const buckets = bucketizeKeysByPercent(percentMap, keys);
  if (buckets.slabe.length) return buckets.slabe;
  if (buckets.nedotknute.length) return buckets.nedotknute;
  return buckets.silne;
}

/*
  mode: 'random' (🎲, default) | 'studied' (📗 zelená fajka študijného
  modulu, quiz.best ≥ 60 %) | 'unstudied' (📕 na precvičenie – relatívne
  najslabšie, fallback poradie slabé → nedotknuté → silné, rovnaká
  konvencia ako štátnica – žiadny pevný prah)
  Vráti { keys, questions, usedFallback, empty }.
  Ak filtrovaná množina pre zvolený režim vyjde prázdna, potichu spadne
  na náhodný výber z celej množiny (usedFallback = true) – volajúci si
  môže zobraziť hlásku a použiť vrátenú dvojicu ako náhradu za "🎲".
  empty = true len ak dvojicu nejde zostaviť vôbec (napr. oblasť bez dát).
*/
export async function pickOkruhPair(areaName, mode = "random", nick = null) {
  const structure = getPairStructure(areaName);

  if (structure.type === "pair") {
    const groups = groupBySource(window.areas[structure.pool] || []);
    const allKeys = sortedOkruhKeys(groups);
    let pairs = buildConsecutivePairs(allKeys);
    let usedFallback = false;

    if (mode !== "random" && pairs.length) {
      const okKeys = new Set(await filterKeysByMode(allKeys, mode, nick, structure.pool));
      const filteredPairs = pairs.filter(([k1, k2]) => okKeys.has(k1) && okKeys.has(k2));
      if (filteredPairs.length) pairs = filteredPairs;
      else usedFallback = true;
    }

    if (!pairs.length) return { keys: [], sources: [], questions: [], usedFallback: true, empty: true };

    const [k1, k2] = pairs[Math.floor(Math.random() * pairs.length)];
    const questions = [...(groups[k1] || []), ...(groups[k2] || [])].map(shuffleQuestionOptions);
    return {
      keys: [k1, k2],
      // { area, key } páry – rovnaká oblasť pre oba, source kľúče sú tu unikátne.
      sources: [{ area: structure.pool, key: k1 }, { area: structure.pool, key: k2 }],
      questions,
      usedFallback,
      empty: false
    };
  }

  if (structure.type === "dual") {
    const groupsA = groupBySource(window.areas[structure.poolA] || []);
    const groupsB = groupBySource(window.areas[structure.poolB] || []);
    let keysA = sortedOkruhKeys(groupsA);
    let keysB = sortedOkruhKeys(groupsB);
    let usedFallback = false;

    if (mode !== "random" && keysA.length && keysB.length) {
      const filteredA = await filterKeysByMode(keysA, mode, nick, structure.poolA);
      const filteredB = await filterKeysByMode(keysB, mode, nick, structure.poolB);
      if (filteredA.length && filteredB.length) {
        keysA = filteredA;
        keysB = filteredB;
      } else {
        usedFallback = true;
      }
    }

    if (!keysA.length || !keysB.length) return { keys: [], sources: [], questions: [], usedFallback: true, empty: true };

    const kA = keysA[Math.floor(Math.random() * keysA.length)];
    const kB = keysB[Math.floor(Math.random() * keysB.length)];
    const questions = [...(groupsA[kA] || []).slice(0, HALF_A), ...(groupsB[kB] || []).slice(0, HALF_B)].map(shuffleQuestionOptions);
    return {
      keys: [kA, kB],
      // 🔥 DÔLEŽITÉ: hmotné aj procesné majú vlastné A1..A30/A40/A45 súbory
      // s ROVNAKÝMI source kľúčmi (napr. "A15" existuje v oboch) – filtrovanie
      // kartičiek/prípadov MUSÍ vedieť, z ktorého konkrétneho poolu kľúč je,
      // inak by zlúčenie zobralo obsah oboch okruhov naraz (krížová kontaminácia).
      sources: [{ area: structure.poolA, key: kA }, { area: structure.poolB, key: kB }],
      questions,
      usedFallback,
      empty: false
    };
  }

  // flat fallback (neznáme/iné oblasti) – bez párovania, náhodný výber
  const all = window.areas[structure.pool] || [];
  const questions = all.slice().sort(() => Math.random() - 0.5).slice(0, DUEL_QUESTION_COUNT).map(shuffleQuestionOptions);
  const uniqKeys = [...new Set(questions.map(q => q.source).filter(Boolean))];
  return {
    keys: uniqKeys,
    sources: uniqKeys.map(key => ({ area: structure.pool, key })),
    questions,
    usedFallback: false,
    empty: questions.length === 0
  };
}

/* ============================================================
   HLAVNÁ FUNKCIA – SPUSTENIE DUELOVÉHO KVÍZU (TVORBA VÝZVY)
============================================================ */
/* ============================================================
   ČAKANIE NA NAČÍTANIE OTÁZOK (asynchrónne z data.js)
============================================================ */
export function waitForQuestions(areaName) {
  return new Promise((resolve) => {
    const areasToCheck = areaName === "Trestné právo"
      ? ["Trestné právo hmotné", "Trestné právo procesné"]
      : areaName === "Občianske právo"
        ? ["Občianske právo hmotné", "Občianske právo procesné"]
        : [areaName];

    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const ready = areasToCheck.every(a =>
        window.areasLoaded && window.areasLoaded[a]
      );
      if (ready) {
        clearInterval(timer);
        resolve();
      }
      if (attempts > 100) { // 10 sekúnd max
        clearInterval(timer);
        console.warn("⚠️ Otázky sa nenačítali včas pre:", areaName);
        resolve();
      }
    }, 100);
  });
}

/*
  precomputedPair: voliteľná dvojica okruhov, ktorú si už vybral výber
  oblasti (mode picker 🎲/📗/📕) pre celú study session – ak je k dispozícii,
  znovu sa NEROLUJE náhodne (pojednávanie musí čerpať z tej istej dvojice
  ako kartičky/prípady). Bez nej sa správa presne ako predtým.
*/
export async function startDuel(areaName, precomputedPair = null) {
  console.log("🔥 startDuel() – štartujem duel pre oblasť:", areaName);

  const canPlay = await econCanPlay('duel');
  if (!canPlay) return;

  // 🔥 Počkaj kým sú otázky načítané (TPH a TPP prídu asynchrónne)
  await waitForQuestions(areaName);

  if (!areaName) {
    console.warn("⚠️ Oblasť neexistuje.");
    return;
  }

  const selected = (precomputedPair && Array.isArray(precomputedPair.questions) && precomputedPair.questions.length)
    ? precomputedPair.questions
    : pickQuestions(areaName);

  console.log("🔥 Vybrané otázky:", selected);

  if (!selected.length) {
    console.warn(`⚠️ Oblasť "${areaName}" zatiaľ nemá dostatok otázok.`);
    showRewardToast('📚 Táto oblasť zatiaľ nemá dostatok otázok. Skús inú oblasť alebo to skús neskôr.');
    return;
  }

  /* ⚠️ Nikdy „Unknown" ako identita (viď quiz.js finishQuiz). Tu duel
     ešte nemá id ani sa nikam nezapisuje – prázdny nick je v poriadku,
     o uložení výzvy rozhoduje až koniec kvízu. */
  const nick = localStorage.getItem("playerNick") || null;

  // 🔥 OPRAVA: uložíme duel aj pre prvého hráča
  window.currentDuel = {
    id: null,
    from: nick,
    areaTitle: areaName,
    questions: selected
  };

  window.currentDuelMeta = window.currentDuel;
  window.duelQuestions = selected;
  window.currentOpponent = null;

  if (typeof window.startDuelQuiz === "function") {
    window.startDuelQuiz(selected);
  } else {
    console.error("❌ startDuelQuiz() neexistuje!");
  }
}

/* ============================================================
   ZDIEĽANIE VÝZVY (?duel=ID)

   Vytiahnuté z tlačidla 📤 v registri pojednávaní, aby ten istý kód
   používal aj automatický share krok po „⚔️ Vyzvi spolužiaka“ (init.js).
   Register a auto-share sa tak nemôžu rozísť v znení správy ani v tom,
   či sa link dostane do schránky.

   Poradie krokov je zámerné: NAJPRV schránka, až potom navigator.share.
   Schránka je istota (funguje aj keď hráč share dialóg zavrie), share je
   bonus na mobile. `duel` stačí v tvare { id, from, areaTitle }.
============================================================ */
export async function shareDuelInvite(duel) {
  if (!duel || !duel.id) {
    showRewardToast('⚠️ Výzvu sa nepodarilo pripraviť – skús ju poslať z registra súbojov.');
    return;
  }
  const link = `${location.origin}/?duel=${duel.id}`;
  const message = `⚔️ ${duel.from} ťa vyzýva na súboj z oblasti ${duel.areaTitle} vo Finančnej lige! Prijmi výzvu: ${link}`;
  try {
    await navigator.clipboard.writeText(message);
    showRewardToast('Výzva skopírovaná – stačí vložiť ✅');
  } catch (e) {
    window.prompt('Skopíruj správu manuálne:', message);
  }
  if (navigator.share) {
    navigator.share({
      title: 'Výzva na súboj – Finančná liga',
      text: message,
      url: link
    }).catch(() => {});
  }
}

/* ============================================================
   ULOŽENIE VÝZVY DO FIREBASE (PRVÝ HRÁČ)
============================================================ */
export function saveDuel(from, areaTitle, questions) {
  const db = getDb();
  if (!db) return;

  const duelRef = push(ref(db, "duels"));
  const duelId = duelRef.key;

  const duelData = {
    id: duelId,
    from,
    areaTitle,
    questions,
    created: Date.now(),
    expiresIn: 86400,
    status: "pending",
    result: null
  };

  set(duelRef, duelData);
  update(ref(db, `users/${from}/duels/${duelId}`), duelData);

  // 🔥 OPRAVA: uložíme meta aj lokálne
  window.currentDuel.id = duelId;
  window.currentDuelMeta = window.currentDuel;

  console.log("🔥 Duel uložený do Firebase:", duelId);
}

/* ============================================================
   SKÓRE, PARAGRAFY, REBRÍČEK
============================================================ */
function computeScoreFromQuestions(questions = []) {
  return questions.reduce((sum, q) => {
    if (typeof q.correct === "number" &&
        typeof q.selectedIndex === "number" &&
        q.selectedIndex === q.correct) {
      return sum + 1;
    }
    return sum;
  }, 0);
}

/* ============================================================
   ATRIBÚCIA OTÁZKA → OKRUH (Fáza 2, bod 0)
   Zoskupí zodpovedané otázky podľa (_area, source) a pre KAŽDÝ okruh
   zapíše najlepší % kvízu/duelu. _area (napr. "Trestné právo procesné")
   je nutná – hmotné aj procesné majú vlastné A1..A30/A40/A45 súbory
   s ROVNAKÝMI source kľúčmi, takže bez nej by sa dva rôzne okruhy
   omylom zliali do jedného.
============================================================ */
function tallyOkruhScores(questions) {
  const buckets = {};
  (questions || []).forEach(q => {
    const area = q._area || null;
    const source = q.source || null;
    if (!area || !source) return;
    const key = area + '::' + source;
    if (!buckets[key]) buckets[key] = { area, source, correct: 0, total: 0 };
    buckets[key].total++;
    if (typeof q.correct === 'number' && typeof q.selectedIndex === 'number' && q.selectedIndex === q.correct) {
      buckets[key].correct++;
    }
  });
  return Object.values(buckets);
}

/* export: volá sa aj z quiz.js pri PRVOM hráčovi. finalizeDuel() nižšie
   zapisuje progres oboch hráčov, ale beží až keď duel dohrá druhý –
   tvorca výzvy by inak za svoj odohraný kvíz nedostal do Môjho progresu
   nič. Dvojitý zápis nehrozí: quiz.js volá túto funkciu výhradne vo
   vetve bez duel.id, teda presne tam, kam finalizeDuel nedosiahne. */
export function recordDuelOkruhProgress(nick, questions) {
  if (!nick) return;
  tallyOkruhScores(questions).forEach(({ area, source, correct, total }) => {
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    recordOkruhResult(nick, area, source, PROGRESS_ACTIVITIES.QUIZ, pct);
  });
}

function updateLeaderboardWithResult(nick, score, isWin) {
  const db = getDb();
  if (!db || !nick) return;

  const playerRef = ref(db, `leaderboard/${nick}`);

  onValue(playerRef, (snap) => {
    const data = snap.val();

    if (!data) {
      set(playerRef, {
        nick,
        duels: 1,
        wins: isWin ? 1 : 0,
        points: score,
        lastUpdate: Date.now()
      });
    } else {
      update(playerRef, {
        duels: (data.duels || 0) + 1,
        wins: isWin ? (data.wins || 0) + 1 : (data.wins || 0),
        points: (data.points || 0) + score,
        lastUpdate: Date.now()
      });
    }
  }, { onlyOnce: true });
}

/* ============================================================
   VÝSLEDKOVÁ OBRAZOVKA DUELU

   duels/{id}.result sa zapisoval už predtým, ale žiadne UI ho nečítalo –
   hráč sa víťaza nedozvedel inak než z rebríčka. Modal používa VÝHRADNE
   existujúce triedy duelového modalu (.duel-challenge-modal-overlay /
   .duel-challenge-modal / .duel-challenge-title / .btn / .btn-primary,
   styles.css:2768+), takže nepribúda žiadny nový vzhľad.

   Zobrazuje sa hráčovi, ktorý duel práve dohral (prijímateľ výzvy – ten
   sedí za týmto zariadením a finalizeDuel beží u neho). Tvorca výzvy
   dohral skôr, ako výzvu niekto prijal, takže sa výsledok dozvie až pri
   ďalšej návšteve – to je samostatná úloha, viď protokol.
============================================================ */
function showDuelResultModal(result, myNick, onClose) {
  if (!result) return;

  const old = document.getElementById('duelResultModal');
  if (old) old.remove();

  const { firstPlayer, secondPlayer, winner, areaTitle } = result;
  const me = firstPlayer.nick === myNick ? firstPlayer : secondPlayer;
  const opponent = firstPlayer.nick === myNick ? secondPlayer : firstPlayer;

  let title;
  if (winner === 'draw') title = '🤝 Remíza!';
  else if (winner === myNick) title = '🏆 Vyhral/a si!';
  else title = '📚 Tentoraz to nevyšlo';

  const modal = document.createElement('div');
  modal.id = 'duelResultModal';
  modal.className = 'duel-challenge-modal-overlay';
  modal.innerHTML = `
    <div class="duel-challenge-modal">
      <div class="duel-challenge-title">${title}</div>
      <p class="small" style="margin:12px 0 4px">Súboj – ${escapeHtml(areaTitle || '')}</p>
      <div class="list" style="margin:10px 0">
        <div style="display:flex;justify-content:space-between;padding:6px 0">
          <span><strong>${escapeHtml(me.nick)}</strong> (ty)</span>
          <strong>${me.score}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0">
          <span>${escapeHtml(opponent.nick)}</span>
          <strong>${opponent.score}</strong>
        </div>
      </div>
      <button class="btn btn-primary" id="closeDuelResultModal" style="width:100%">Zavrieť</button>
    </div>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.remove();
    if (typeof onClose === 'function') onClose();
  };
  modal.querySelector('#closeDuelResultModal').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
}

/* ============================================================
   VÝSLEDKY VLASTNÝCH ODOSLANÝCH VÝZIEV (pre TVORCU)

   Tvorca výzvy dohrá skôr, než ju niekto prijme – finalizeDuel beží až u
   prijímateľa, takže tvorca sa výsledok inak nikdy nedozvie. Pri návšteve
   appky mu preto ukážeme výsledky jeho dokončených výziev.

   "Videné" sa značí do duels/{id}/resultSeen/{nick} – rovnaký vzor ako už
   existujúce duels/{id}/challengeClaimed/{nick} nižšie (nie localStorage,
   nech to sedí aj po prihlásení z iného zariadenia). Značí sa hneď pri
   zobrazení, aby reload uprostred modalu výsledok nezopakoval.

   Viac výsledkov sa ukáže postupne (od najstaršieho), vždy až po zavretí
   predchádzajúceho – nič sa nestratí a modaly sa neprekrývajú.

   ⚠️ DVE POISTKY PROTI ZAVALENIU: v databáze sú aj historické duely spred
   zavedenia tejto funkcie (pri písaní 111 dokončených, jeden tvorca ich mal
   36) a žiadny z nich nemá resultSeen – bez poistiek by hráč pri najbližšom
   otvorení appky dostal desiatky modalov za sebou.
   1. Časové okno: staré výsledky sú aj tak nezaujímavé, ohlasujú sa len
      duely dohrané za posledných MAX_AGE dní (staršie sa NIKDY neukážu a
      nič sa im nezapisuje – žiadna vlna zápisov do DB).
   2. Strop na návštevu: naraz najviac MAX_PER_VISIT modalov, zvyšok príde
      pri ďalšej návšteve (nič sa nestráca).
============================================================ */
const RESULT_ANNOUNCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dní
const RESULT_ANNOUNCE_MAX_PER_VISIT = 3;

export async function announceOwnDuelResults() {
  const db = getDb();
  const nick = localStorage.getItem('playerNick');
  if (!db || !nick) return;

  try {
    const snap = await get(ref(db, 'duels'));
    const data = snap.val() || {};

    const now = Date.now();
    const unseen = Object.entries(data)
      .filter(([, d]) =>
        d && d.status === 'finished' && d.result &&
        d.from === nick &&
        !(d.resultSeen && d.resultSeen[nick]) &&
        (now - (d.finishedAt || 0)) < RESULT_ANNOUNCE_MAX_AGE_MS
      )
      .sort((a, b) => (a[1].finishedAt || 0) - (b[1].finishedAt || 0))
      .slice(0, RESULT_ANNOUNCE_MAX_PER_VISIT);

    if (!unseen.length) return;

    const showNext = (i) => {
      if (i >= unseen.length) return;
      const [id, duel] = unseen[i];
      update(ref(db, `duels/${id}/resultSeen`), { [nick]: true });
      showDuelResultModal(duel.result, nick, () => showNext(i + 1));
    };
    showNext(0);
  } catch (e) {
    console.warn('⚠️ duels: výsledky vlastných výziev sa nepodarilo načítať', e);
  }
}

/* ============================================================
   FINÁLNE VYHODNOTENIE DUELU
============================================================ */
function finalizeDuel(duel, opponentNick, opponentQuestions) {
  const db = getDb();
  if (!db || !duel || !opponentNick || !Array.isArray(opponentQuestions)) return;

  const firstNick = duel.from;
  const areaTitle = duel.areaTitle || "Neznáma oblasť";

  const scoreA = computeScoreFromQuestions(duel.questions || []);
  const scoreB = computeScoreFromQuestions(opponentQuestions || []);

  let winner = null;
  if (scoreA > scoreB) winner = firstNick;
  else if (scoreB > scoreA) winner = opponentNick;
  else winner = "draw";

  // 🔥 § EKONOMIKA – jediná brána: economy.js
  if (winner === 'draw') {
    econAward(firstNick, ECONOMY_CONFIG.REWARDS.DUEL_DRAW, 'remíza v dueli');
    econAward(opponentNick, ECONOMY_CONFIG.REWARDS.DUEL_DRAW, 'remíza v dueli');
  } else {
    const loserNick = winner === firstNick ? opponentNick : firstNick;
    econAward(winner, ECONOMY_CONFIG.REWARDS.DUEL_WIN, 'výhra v dueli');
    econAward(loserNick, ECONOMY_CONFIG.REWARDS.DUEL_LOSS, 'prehra v dueli');
  }
  // Energia avatara za odohraný duel – len prijímateľ (tento hráč sedí za týmto
  // zariadením); tvorcovi sa energia odpočíta pri jeho vlastnom odohraní v quiz.js.
  econEnergy(opponentNick, ECONOMY_CONFIG.ENERGY.DUEL, 'odohraný duel');

  // 🔥 Rebríček
  updateLeaderboardWithResult(firstNick, scoreA, winner === firstNick);
  updateLeaderboardWithResult(opponentNick, scoreB, winner === opponentNick);

  // 🏛️ Fakulty – každé odohrané pojednávanie pripíše body fakulte hráča
  awardFacultyPoints(firstNick, scoreA);
  awardFacultyPoints(opponentNick, scoreB);

  // 📊 Osobný prehľad progresu – najlepší % kvízu per okruh (Fáza 2)
  recordDuelOkruhProgress(firstNick, duel.questions);
  recordDuelOkruhProgress(opponentNick, opponentQuestions);

  // 🔥 Uloženie výsledku
  const duelRef = ref(db, `duels/${duel.id}`);

  const resultPayload = {
    status: "finished",
    result: {
      areaTitle,
      firstPlayer: {
        nick: firstNick,
        score: scoreA
      },
      secondPlayer: {
        nick: opponentNick,
        score: scoreB
      },
      winner
    },
    finishedAt: Date.now()
  };

  update(duelRef, resultPayload);

  console.log("🔥 Duel vyhodnotený:", duel.id, resultPayload);

  // Ukáž výsledok hráčovi, ktorý duel práve dohral (viď komentár pri
  // showDuelResultModal vyššie). Nesmie zhodiť vyhodnotenie, ktoré je už
  // zapísané – preto vo vlastnom try/catch.
  try {
    showDuelResultModal(resultPayload.result, opponentNick);
  } catch (e) {
    console.warn('⚠️ duels: výsledkovú obrazovku sa nepodarilo zobraziť', e);
  }
}

/* ============================================================
   BANKA DUELOV
============================================================ */
/* ============================================================
   SKRYTÉ (ODMIETNUTÉ) CUDZIE VÝZVY – len lokálne, per zariadenie.

   Pôvodne "Odmietnuť" volalo remove() na duels/{id} pre AKÚKOĽVEK výzvu,
   teda ktokoľvek vedel natrvalo zmazať cudziu výzvu z databázy všetkým
   ostatným hráčom. Odmietnutie je pritom rozhodnutie JEDNÉHO hráča – nemá
   žiadny dôvod siahať na cudzí záznam. Vlastnú výzvu naďalej maže z DB
   (to je legitímne zrušenie vlastného pojednávania), cudziu len schová
   tomuto hráčovi. Zoznam sa priebežne čistí od ID, ktoré už aj tak nie sú
   platné (expirované/prijaté/zmazané autorom), aby nerástol donekonečna.
============================================================ */
const DISMISSED_DUELS_KEY = 'lex_dismissed_duels';

function getDismissedDuels() {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_DUELS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function dismissDuelLocally(duelId) {
  const list = getDismissedDuels();
  if (!list.includes(duelId)) list.push(duelId);
  try {
    localStorage.setItem(DISMISSED_DUELS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('⚠️ duels: odmietnutú výzvu sa nepodarilo uložiť lokálne', e);
  }
}

function loadDuelBank(callback) {
  const db = getDb();
  if (!db) return;

  const duelsRef = ref(db, "duels");

  onValue(duelsRef, (snapshot) => {
    const data = snapshot.val() || {};
    const list = Object.values(data);
    const now = Date.now();

    const valid = list.filter(d =>
      (now - d.created) / 1000 < d.expiresIn &&
      d.status === "pending"
    );

    // Prune: nechaj v zozname len ID, ktoré sú ešte reálne v ponuke.
    const dismissed = getDismissedDuels();
    if (dismissed.length) {
      const validIds = new Set(valid.map(d => d.id));
      const pruned = dismissed.filter(id => validIds.has(id));
      if (pruned.length !== dismissed.length) {
        try { localStorage.setItem(DISMISSED_DUELS_KEY, JSON.stringify(pruned)); } catch (e) {}
      }
    }

    const dismissedSet = new Set(getDismissedDuels());
    callback(valid.filter(d => !dismissedSet.has(d.id)));
  });
}

export function renderDuelBank() {
  const box = document.getElementById("duelBank");
  if (!box) return;

  box.innerHTML = "<p class='small muted'>Načítavam…</p>";

  /* ⚠️ Prázdny nick, nie „Unknown": inak by anonymný návštevník videl
     cudzie poškodené výzvy (from: "Unknown") ako svoje vlastné, aj
     s tlačidlom 📤 Poslať. */
  const currentUser = localStorage.getItem('playerNick') || null;

  loadDuelBank((stored) => {
    box.innerHTML = "";

    if (!stored.length) {
      box.innerHTML = "<p class='small muted'>Žiadne uložené súboja.</p>";
      return;
    }

    const now = Date.now();

    stored.forEach((duel) => {
      const div = document.createElement("div");
      div.className = "duel-item";
      const isOwn = duel.from === currentUser;

      div.innerHTML = `
        <div class="duel-banner">
          ⚔️ <strong>${duel.from}</strong> vyzýva na súboj<br>
          <span class="duel-topic">téma: <em>${duel.areaTitle}</em></span>
        </div>

        <div class="duel-header">
          <div class="duel-title">
            Výzva od: <strong>${duel.from}</strong>
          </div>
          <div class="duel-expire small muted">
            Expiruje o ${Math.ceil((duel.expiresIn - (now - duel.created) / 1000) / 60)} min
          </div>
        </div>

        <div class="duel-actions">
          ${isOwn
            ? `<button class="duel-accept duel-send">📤 Poslať</button>`
            : `<button class="duel-accept">Prijať</button>`}
          <button class="duel-reject">Odmietnuť</button>
        </div>
      `;

      const sendBtn = div.querySelector(".duel-send");
      if (sendBtn) {
        sendBtn.onclick = () => shareDuelInvite(duel);
      }

      const acceptBtn = div.querySelector(".duel-accept:not(.duel-send)");
      if (acceptBtn) {
        acceptBtn.onclick = async () => {
          /* Nick sa pýta PRED hrou, nie po nej – výsledok sa zapisuje
             pod menom a bez neho by sa duel nedal vyhodnotiť. Rovnaké
             poradie ako pri prijatí výzvy cez odkaz (acceptDuelChallenge
             v init.js si nick vypýta hneď v modáli). */
          if (!currentUser) {
            showRewardToast('Výsledok súboja sa zapisuje pod tvojím menom — zadaj si nick (stačí prezývka, žiadna registrácia) a výzvu prijmi znova.');
            return;
          }
          const canPlay = await econCanPlay('duel');
          if (!canPlay) return;

          // 🔥 OPRAVA: správny nick hráča
          window.currentUser = currentUser;

          window.currentDuelId = duel.id;
          window.currentDuelMeta = duel;
          window.currentDuel = duel;
          window.duelQuestions = duel.questions;
          window.currentOpponent = duel.from;

          if (typeof window.startDuelQuiz === "function") {
            window.startDuelQuiz(duel.questions);
          } else {
            console.error("❌ startDuelQuiz() neexistuje!");
          }

          // 🔥 § za prijatie výzvy (energia sa odpočíta až po odohraní duelu)
          econAward(currentUser, ECONOMY_CONFIG.REWARDS.CHALLENGE_EXISTING, 'za prijatie výzvy');

          const db = getDb();
          if (db) {
            update(ref(db, `duels/${duel.id}`), { status: "accepted", acceptedBy: currentUser });
          }
        };
      }

      div.querySelector(".duel-reject").onclick = () => {
        if (isOwn) {
          // Vlastná výzva – legitímne zrušenie, zmaž ju z databázy.
          const db = getDb();
          if (!db) return;
          remove(ref(db, `duels/${duel.id}`));
        } else {
          // Cudzia výzva – NIKDY nesiahaj na cudzí záznam, len ju schovaj
          // tomuto hráčovi (viď komentár pri DISMISSED_DUELS_KEY vyššie).
          dismissDuelLocally(duel.id);
        }
        renderDuelBank();
      };

      box.appendChild(div);
    });
  });
}

/* ============================================================
   🔴 PULZUJÚCI ODZNAK NA TLAČIDLE "Uložené výzvy"
   Sleduje počet duelov so statusom "pending" (a ešte
   nevypršaných) a podľa toho pridá/odoberie pulzovanie +
   číslo na tlačidlo, aby si návštevník hneď všimol, že
   čakajú nejaké výzvy.
============================================================ */
export function watchDuelBankBadge() {
  const db = getDb();
  if (!db) return;

  const btn = document.getElementById('toggleDuelBankBtn');
  if (!btn) {
    console.warn('⚠️ toggleDuelBankBtn sa nenašiel – pulzujúci odznak sa nedá pripojiť.');
    return;
  }

  if (getComputedStyle(btn).position === 'static') {
    btn.style.position = 'relative';
  }

  let badge = btn.querySelector('.duel-bank-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'duel-bank-badge';
    btn.appendChild(badge);
  }

  const duelsRef = ref(db, 'duels');
  onValue(duelsRef, (snapshot) => {
    const data = snapshot.val() || {};
    const now = Date.now();

    const pendingCount = Object.values(data).filter(d =>
      d && d.status === 'pending' &&
      d.created && d.expiresIn &&
      (now - d.created) / 1000 < d.expiresIn
    ).length;

    if (pendingCount > 0) {
      badge.textContent = pendingCount > 9 ? '9+' : String(pendingCount);
      badge.style.display = 'flex';
      btn.classList.add('has-pending-duels');
    } else {
      badge.style.display = 'none';
      btn.classList.remove('has-pending-duels');
    }
  });
}

/* ============================================================
   COMPLETE DUEL
============================================================ */
window.completeDuel = function(opponentQuestions){
  const duel = window.currentDuelMeta || window.currentDuel || null;

  /* ⚠️ Po bráne pri prijatí výzvy sem bez nicku nemožno doraziť –
     poistka proti zápisu „Unknown" do výsledku duelu. */
  const opponentNick = localStorage.getItem('playerNick') || null;
  if (!opponentNick) {
    console.error('❌ completeDuel() – hráč nemá nick, výsledok sa nezapisuje.');
    showRewardToast('Výsledok sa nedal zapísať — chýba nick.');
    return;
  }
  window.currentUser = opponentNick;

  if (!duel || !Array.isArray(opponentQuestions)) {
    console.error("❌ completeDuel() – chýba duel alebo otázky sú neplatné.");
    return;
  }

  finalizeDuel(duel, opponentNick, opponentQuestions);

  // 🔥 Odmena za prijatie výzvy cez zdieľateľný link (?duel=ID)
  const pending = window.__pendingChallengeReward;
  if (pending && pending.nick === opponentNick) {
    awardChallengeLinkReward(pending);
    window.__pendingChallengeReward = null;
  }
};

/* ============================================================
   ODMENA ZA PRIJATIE VÝZVY CEZ LINK
   +7§ nový hráč (nick ešte neexistoval v users/) / +1§ existujúci hráč.
   Ochrana proti opakovanému čerpaniu: duels/{id}/challengeClaimed/{nick}.
============================================================ */
async function awardChallengeLinkReward({ duelId, nick, isNewPlayer }) {
  const db = getDb();
  if (!db || !duelId || !nick) return;

  const claimedRef = ref(db, `duels/${duelId}/challengeClaimed/${nick}`);
  const already = await get(claimedRef);
  if (already.exists()) return;

  await set(claimedRef, true);
  const amount = isNewPlayer ? ECONOMY_CONFIG.REWARDS.CHALLENGE_NEW : ECONOMY_CONFIG.REWARDS.CHALLENGE_EXISTING;
  await econAward(nick, amount, isNewPlayer ? 'za prvý duel z výzvy 🎉' : 'za prijatie výzvy cez link');
}

/* ============================================================
   EXPORTY
============================================================ */
window.saveDuel = saveDuel;
window.shareDuelInvite = shareDuelInvite;
window.renderDuelBank = renderDuelBank;
window.startDuel = startDuel;
window.watchDuelBankBadge = watchDuelBankBadge;
