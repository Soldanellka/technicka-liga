'use strict';

/* ============================================================
   memoryTrainer.js
   Logika Bifľovačky (Memory Trainer).

   POZOR: tento súbor je zámerne pomenovaný inak ako memory.js
   (ten už existuje a implementuje nesúvisiacu hru "Kartičky" –
   párovanie pojem/definícia). Bifľovačka je samostatný modul.
============================================================ */

import { MEMORY_AREAS, getAreaBySlug, generateMemoryPackages } from './memoryDefinitions.js';
import { incrementGamesPlayed } from './avatars.js';
import { econEnergy, econAward, econCanPlay, ECONOMY_CONFIG } from './scripts/economy.js';
import { getRole } from './scripts/economyConfig.js';

/* ============================================================
   Slovenské stopslová + detekcia právnych pojmov
============================================================ */
const STOPWORDS = new Set([
  'a','alebo','ale','je','sa','na','v','vo','do','z','zo','za','pre','ako','pri','po','od',
  'ku','k','s','so','ktory','ktora','ktore','ktori','tento','tato','toto','tieto','nie','ano',
  'aj','uz','len','iba','teda','preto','ak','ci','no','tak','byt','bol','bola','boli','ma',
  'maju','mat','su','bude','budu','ich','jej','jeho','im','mu','ju','ho','ten','ta','to','ti','tie',
  'alebo','pokial','kym','ktorym','ktorej','ktorych','tym','tejto','tychto','vsak','teda','preto'
]);

/* ============================================================
   Normalizácia a tokenizácia textu
============================================================ */
const DIACRITIC_MAP = {
  'á': 'a', 'ä': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'í': 'i', 'ĺ': 'l', 'ľ': 'l',
  'ň': 'n', 'ó': 'o', 'ô': 'o', 'ŕ': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ý': 'y', 'ž': 'z'
};

function stripDiacritics(s) {
  let out = '';
  for (const ch of s) out += DIACRITIC_MAP[ch] || ch;
  return out;
}

function normalizeText(s) {
  return stripDiacritics(String(s || '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
}

function extractLegalTerms(rawText) {
  const terms = new Set();
  const sPattern = /🪙\s?\d+[a-z]?(?:\s?ods\.?\s?\d+)?/gi;
  (String(rawText || '').match(sPattern) || []).forEach(m => terms.add(m.replace(/\s+/g, ' ').trim().toLowerCase()));
  const abbrPattern = /\b[A-ZÁÄČĎÉÍĹĽŇÓŔŠŤÚÝŽ]{2,6}\b/g;
  (String(rawText || '').match(abbrPattern) || []).forEach(m => terms.add(m.toLowerCase()));
  return terms;
}

function extractKeywords(rawText) {
  const words = tokenize(rawText).filter(w => w.length > 3 && !STOPWORDS.has(w));
  const legal = extractLegalTerms(rawText);
  return new Set([...words, ...legal]);
}

/* ============================================================
   Levenshtein distance + podobnosť
============================================================ */
function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function levenshteinSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/* ============================================================
   Jaro-Winkler podobnosť
============================================================ */
function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions = transpositions / 2;

  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
}

function jaroWinkler(a, b) {
  const jaro = jaroSimilarity(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/* ============================================================
   Kontrola kľúčových slov a poradia viet
============================================================ */
function keywordCoverage(userText, referenceText) {
  const refKeywords = extractKeywords(referenceText);
  if (refKeywords.size === 0) return { ratio: 1, matched: 0, total: 0 };

  const userKeywords = extractKeywords(userText);
  let matched = 0;
  refKeywords.forEach(k => {
    if (userKeywords.has(k)) { matched++; return; }
    for (const uk of userKeywords) {
      if (uk.length > 3 && (uk.includes(k) || k.includes(uk))) { matched++; return; }
    }
  });
  return { ratio: matched / refKeywords.size, matched, total: refKeywords.size };
}

function lcsLength(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function sequenceOrderScore(userText, referenceText) {
  const refKeywords = extractKeywords(referenceText);
  if (refKeywords.size === 0) return 1;

  const refOrdered = tokenize(referenceText).filter(t => refKeywords.has(t));
  const userOrdered = tokenize(userText).filter(t => refKeywords.has(t));
  if (refOrdered.length === 0) return 1;

  return lcsLength(refOrdered, userOrdered) / refOrdered.length;
}

/* ============================================================
   calculateSimilarity / compareText
   Váhy: Levenshtein 35 % · Jaro-Winkler 25 % · kľúčové slová 30 % · poradie 10 %
============================================================ */
export function calculateSimilarity(userText, pkg) {
  const reference = pkg.definition || pkg.summary || pkg.legalSentence || pkg.correctAnswer || '';
  const refKeywordsCount = extractKeywords(reference).size;

  if (!userText || !userText.trim()) {
    return { score: 0, keywordsMatched: `0/${refKeywordsCount}`, notes: '❌ Neodpovedal/a si – skús to znova.' };
  }

  const userNorm = normalizeText(userText);
  const refNorm = normalizeText(reference);

  const levSim = levenshteinSimilarity(userNorm, refNorm);
  const jw = jaroWinkler(userNorm, refNorm);
  const kw = keywordCoverage(userText, reference);
  const order = sequenceOrderScore(userText, reference);

  const combined = levSim * 0.35 + jw * 0.25 + kw.ratio * 0.30 + order * 0.10;
  const score = Math.max(0, Math.min(100, Math.round(combined * 100)));

  let notes;
  if (score < 50) {
    notes = '❌ Chýbajú kľúčové pojmy alebo je formulácia nepresná – zopakuj balíček.';
  } else if (score < 80) {
    notes = '🟡 Dobrá formulácia, skús doplniť presnejšie odborné pojmy.';
  } else {
    notes = '✅ Výborná odborná formulácia!';
  }

  return { score, keywordsMatched: `${kw.matched}/${kw.total}`, notes };
}

export function compareText(userText, pkg) {
  return calculateSimilarity(userText, pkg);
}

/* ============================================================
   ŽOLÍKY – textové pomôcky pre fázu odpovede
   Čísla/§/paragrafy sa nikdy neskrývajú (bez nich sa nedá doplniť).
============================================================ */
export function buildSkeleton(text) {
  return String(text || '').split(/(\s+)/).map((tok, i, arr) => {
    if (/^\s+$/.test(tok)) return tok;
    const wordIdx = arr.slice(0, i).filter(t => !/^\s+$/.test(t)).length;
    if (/\d/.test(tok)) return tok;
    if (wordIdx % 3 === 0) return tok; // každé 3. slovo viditeľné
    const core = tok.replace(/[.,;:()"]/g, '');
    return tok.replace(core, '_'.repeat(Math.min(core.length, 12)));
  }).join('');
}

export function buildInitials(text) {
  return String(text || '').split(/(\s+)/).map(tok => {
    if (/^\s+$/.test(tok) || /\d/.test(tok)) return tok;
    const m = tok.match(/^\W*(\p{L})/u);
    if (!m) return tok;
    return tok.replace(/\p{L}[\p{L}''-]*/u, w => w[0] + '_'.repeat(Math.min(w.length - 1, 10)));
  }).join('');
}

/* ============================================================
   Firebase / localStorage perzistencia progresu
============================================================ */
const LS_PROGRESS_PREFIX = 'lex_memory_progress_';
const LS_META_PREFIX = 'lex_memory_meta_';

function getNick() {
  return localStorage.getItem('playerNick') || null;
}

function getDb() {
  return window.db || null;
}

async function waitForDb(maxMs = 2000) {
  const start = Date.now();
  while (!window.db && Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 100));
  }
  return window.db || null;
}

async function fbImport() {
  return await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
}

function loadLocalJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function saveLocalJson(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
}

async function loadProgress(slug) {
  const nick = getNick();
  const db = nick ? await waitForDb() : null;
  if (nick && db) {
    try {
      const { ref, get } = await fbImport();
      const snap = await get(ref(db, `users/${nick}/memoryProgress/${slug}`));
      if (snap.exists()) return snap.val();
    } catch (e) {
      console.warn('Bifľovačka: čítanie progresu z Firebase zlyhalo, používam localStorage', e);
    }
  }
  return loadLocalJson(LS_PROGRESS_PREFIX + slug);
}

async function persistProgress(slug, progress) {
  saveLocalJson(LS_PROGRESS_PREFIX + slug, progress);
  const nick = getNick();
  const db = getDb();
  if (nick && db) {
    try {
      const { ref, update } = await fbImport();
      await update(ref(db, `users/${nick}/memoryProgress`), { [slug]: progress });
    } catch (e) {
      console.warn('Bifľovačka: zápis progresu do Firebase zlyhal, uložené len lokálne', e);
    }
  }
}

async function loadMeta(slug) {
  const nick = getNick();
  const db = nick ? await waitForDb(800) : null;
  if (nick && db) {
    try {
      const { ref, get } = await fbImport();
      const snap = await get(ref(db, `users/${nick}/memoryMeta/${slug}`));
      if (snap.exists()) return snap.val();
    } catch (e) {}
  }
  return loadLocalJson(LS_META_PREFIX + slug);
}

async function persistMeta(slug, meta) {
  saveLocalJson(LS_META_PREFIX + slug, meta);
  const nick = getNick();
  const db = getDb();
  if (nick && db) {
    try {
      const { ref, update } = await fbImport();
      await update(ref(db, `users/${nick}/memoryMeta`), { [slug]: meta });
    } catch (e) {}
  }
}

async function awardXp(amount) {
  const key = 'lex_memory_xp';
  const current = Number(localStorage.getItem(key) || 0);
  const next = current + amount;
  try { localStorage.setItem(key, String(next)); } catch (e) {}

  const nick = getNick();
  const db = getDb();
  if (nick && db) {
    try {
      const { ref, get, update } = await fbImport();
      const snap = await get(ref(db, `users/${nick}/memoryXp`));
      const fbCurrent = snap.exists() ? snap.val() : current;
      await update(ref(db, `users/${nick}`), { memoryXp: fbCurrent + amount });
    } catch (e) {}
  }
  return next;
}

/* ============================================================
   Stav oblastí načítaných v aktuálnej relácii (balíčky + progres)
============================================================ */
const areaState = new Map();

function computeStatsFromProgress(progress, total) {
  const entries = Object.values(progress || {});
  const completed = entries.filter(e => e && e.completed).length;
  const scored = entries.filter(e => e && typeof e.score === 'number');
  const avgAccuracy = scored.length ? Math.round(scored.reduce((s, e) => s + e.score, 0) / scored.length) : 0;
  const bestScore = scored.length ? Math.max(...scored.map(e => e.score)) : 0;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percent, avgAccuracy, bestScore };
}

/* ============================================================
   loadMemoryArea(slug) – načíta balíčky + progres pre oblasť
============================================================ */
export async function loadMemoryArea(slug) {
  const packages = await generateMemoryPackages(slug);
  const progress = await loadProgress(slug);
  areaState.set(slug, { packages, progress, rewarded: false });
  return { packages, progress };
}

/* ============================================================
   getNextMemoryItem(slug) – prvý nedokončený balíček alebo null
============================================================ */
export function getNextMemoryItem(slug) {
  const state = areaState.get(slug);
  if (!state) return null;
  return state.packages.find(p => !(state.progress[p.id] && state.progress[p.id].completed)) || null;
}

/* ============================================================
   calculateCompletion(slug) – presné štatistiky (vyžaduje loadMemoryArea)
============================================================ */
export function calculateCompletion(slug) {
  const state = areaState.get(slug);
  if (!state) return { completed: 0, total: 0, percent: 0, avgAccuracy: 0, bestScore: 0 };
  return computeStatsFromProgress(state.progress, state.packages.length);
}

/* ============================================================
   getAreaStats(slug) – lacný odhad pre dlaždicu (bez fetchu balíčkov)
   Ak je oblasť už načítaná v tejto relácii, použije presné dáta.
============================================================ */
export async function getAreaStats(slug) {
  const state = areaState.get(slug);
  if (state) return computeStatsFromProgress(state.progress, state.packages.length);

  const area = getAreaBySlug(slug);
  const progress = await loadProgress(slug);
  /* Odhad celkového počtu balíčkov pre dlaždicu: 3 definície na okruh.
     Pôvodne tu bolo 5 (konvencia počtu KVÍZOVÝCH otázok na súbor) – lenže
     bifľovačka čerpá z ručných biflovacka/{slug}.json, kde má KAŽDÝ okruh
     presne 3 definície (overené vo všetkých piatich súboroch: pracovne
     50/150, tph 30/90, tpp 30/90, ob_hmotne 40/120, ob_procesne 45/135 –
     min aj max 3). Menovateľ bol preto o tretinu nafúknutý a percentá aj
     odznak dokončenia na dlaždici systematicky podhodnotené.

     Ostáva to ODHAD len pre Európske právo, ktoré ručný súbor nemá a
     balíčky sa mu generujú z kvízov (≤5 na okruh, podľa toho, koľko
     otázok nájde zodpovedajúcu definíciu v tiles). Presné číslo sa
     aj tak doplní hneď, ako používateľ oblasť otvorí – vtedy sa použije
     vetva areaState vyššie. */
  const DEFINITIONS_PER_OKRUH = 3;
  const estimatedTotal = area ? area.count * DEFINITIONS_PER_OKRUH : 0;
  return computeStatsFromProgress(progress, estimatedTotal);
}

/* ============================================================
   GARANT/ADMIN – režim kontroly (prechádzanie bez učenia)
============================================================ */

/* Všetky balíčky oblasti bez ohľadu na progres (kontrola ide cez
   VŠETKY definície, nielen nedokončené). Vyžaduje loadMemoryArea. */
export function getAllMemoryItems(slug) {
  const state = areaState.get(slug);
  return state ? state.packages : [];
}

/* Uloží opravu definície do Firebase overrides. Rola sa overuje
   ČERSTVO tesne pred zápisom (nie z cache) – ochrana proti
   podvrhnutej localStorage. Zároveň aktualizuje balíček v pamäti
   pre túto reláciu, nech sa pečať zobrazí okamžite bez refreshu. */
export async function saveDefinitionOverride(slug, pkg, { question, answer, zdroj }) {
  const nick = getNick();
  const db = getDb();
  if (!nick || !db || !pkg || !pkg.defKey) {
    return { ok: false, message: 'Chýba prihlásenie alebo definícia.' };
  }
  if (!zdroj || !zdroj.citation) {

  }

  const role = await getRole(nick);
  if (role !== 'admin' && role !== 'garant') {
    return { ok: false, message: 'Len garant alebo admin môže opravovať definície.' };
  }

  const override = {
    question: question || '',
    answer: answer || '',
    zdroj,
    editedBy: nick,
    role,
    ts: Date.now(),
    seal: 'garant'
  };

  try {
    const { ref, set } = await fbImport();
    await set(ref(db, `biflovackaOverrides/${slug}/${pkg.defKey}`), override);
  } catch (e) {
    console.warn('Bifľovačka: zápis opravy zlyhal', e);
    return { ok: false, message: 'Zápis opravy zlyhal.' };
  }

  const state = areaState.get(slug);
  if (state) {
    const idx = state.packages.findIndex(p => p.defKey === pkg.defKey);
    if (idx !== -1) {
      state.packages[idx] = {
        ...state.packages[idx],
        question: override.question,
        correctAnswer: override.answer,
        definition: override.answer,
        legalSentence: override.answer,
        zdroj: override.zdroj,
        seal: 'garant',
        sealedBy: nick
      };
    }
  }

  return { ok: true, sealedBy: nick };
}

/* ============================================================
   saveMemoryScore(slug, id, score) – uloží výsledok balíčka,
   udelí odmeny a pri dokončení celej oblasti odomkne skúšobný režim
============================================================ */
export async function saveMemoryScore(slug, id, score) {
  const state = areaState.get(slug);
  if (!state) throw new Error('Oblasť nie je načítaná – zavolaj najprv loadMemoryArea(slug).');

  const prevEntry = state.progress[id];
  const prevCompleted = !!(prevEntry && prevEntry.completed);
  const attempts = (prevEntry && prevEntry.attempts || 0) + 1;
  const completed = score >= 50;

  state.progress[id] = { score, completed, attempts, updatedAt: Date.now() };
  await persistProgress(slug, state.progress);

  /* Energia sa berie VŽDY, aj anonymovi (A1) – econEnergy si null nick
     rieši sama (localStorage). 🪙 nižšie ostávajú za nickom. */
  const nick = getNick();
  econEnergy(nick, ECONOMY_CONFIG.ENERGY.BIFLOVACKA_CARD, 'kartička bifľovačky');

  const newlyCompleted = completed && !prevCompleted;
  if (newlyCompleted) {
    await awardXp(2);
    // 🪙 odmena za okruh len pri vyššej presnosti (priebežná motivácia, nie za každý pokus)
    if (nick && score >= 80) {
      await econAward(nick, ECONOMY_CONFIG.REWARDS.BIFLOVACKA_OKRUH, 'okruh bifľovačky ≥ 80 %');
    }
  }

  const stats = calculateCompletion(slug);

  let areaJustFinished = false;
  let sealTier = null;
  if (stats.total > 0 && stats.completed === stats.total && !state.rewarded) {
    state.rewarded = true;
    areaJustFinished = true;
    sealTier = stats.avgAccuracy >= 90 ? 'gold' : stats.avgAccuracy >= 75 ? 'silver' : 'bronze';
    await persistMeta(slug, { examUnlocked: true, sealTier, finishedAt: Date.now() });
    if (nick) await econAward(nick, ECONOMY_CONFIG.REWARDS.BIFLOVACKA_AREA, 'celá oblasť bifľovačky dokončená');
    await awardXp(20);
    try { incrementGamesPlayed(); } catch (e) {}
  }

  return { stats, newlyCompleted, areaJustFinished, sealTier };
}

/* Zavolaj pred vstupom do oblasti (startArea v memory-trainer.html) –
   ak avatar spí, zobrazí toast a vráti false. */
export async function canPlayBiflovacka() {
  return await econCanPlay('biflovacka');
}

/* ============================================================
   Dlaždice na dashboarde
============================================================ */
const SEAL_ICON = { bronze: '🥉', silver: '🥈', gold: '🥇' };

export async function updateTile(slug, containerEl) {
  const area = getAreaBySlug(slug);
  if (!area || !containerEl) return;

  const [stats, meta] = await Promise.all([getAreaStats(slug), loadMeta(slug)]);
  const sealIcon = meta && meta.examUnlocked ? (SEAL_ICON[meta.sealTier] || '🥉') : '';

  let tile = containerEl.querySelector(`[data-memory-slug="${slug}"]`);
  if (!tile) {
    tile = document.createElement('a');
    tile.className = 'memory-tile';
    tile.dataset.memorySlug = slug;
    tile.href = `memory-trainer.html?area=${slug}`;
    containerEl.appendChild(tile);
  }

  tile.innerHTML = `
    <div class="memory-tile-title">🧠 Bifľovačka – ${area.name} ${sealIcon}</div>
    <div class="memory-tile-stat">Dokončené: ${stats.completed}/${stats.total} (${stats.percent} %)</div>
    <div class="memory-tile-stat">Priemerná presnosť: ${stats.avgAccuracy} %</div>
    <div class="memory-tile-stat">Najlepší výsledok: ${stats.bestScore} %</div>
    ${meta && meta.examUnlocked ? '<div class="memory-tile-badge">🎓 Pripravený na skúšky</div>' : ''}
  `;
}

/* Koľko oblastí je vidieť hneď; zvyšok sa skrýva pod rozbaľovač.
   Šesť dlaždíc robilo z karty najvyšší prvok ľavého stĺpca (~720 px). */
const MEMORY_TILES_VISIBLE = 3;

export async function renderMemoryTiles(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  const makeTile = (area) => {
    const tile = document.createElement('a');
    tile.className = 'memory-tile';
    tile.dataset.memorySlug = area.slug;
    tile.href = `memory-trainer.html?area=${area.slug}`;
    tile.innerHTML = `
      <div class="memory-tile-title">🧠 Bifľovačka – ${area.name}</div>
      <div class="small muted">Načítavam…</div>
    `;
    return tile;
  };

  const visible = MEMORY_AREAS.slice(0, MEMORY_TILES_VISIBLE);
  const hidden = MEMORY_AREAS.slice(MEMORY_TILES_VISIBLE);

  visible.forEach(area => container.appendChild(makeTile(area)));

  /* Zvyšné oblasti pod jedným rozbaľovačom – rovnaký vzor ako „Ďalší obsah“
     v Študijných moduloch (chip + skrytý box), žiadny nový vizuálny jazyk.
     Dlaždice sa vytvárajú hneď, len sú skryté, takže updateTile() nižšie
     doplní progres do všetkých šiestich bez ohľadu na rozbalenie. */
  if (hidden.length) {
    const box = document.createElement('div');
    box.id = 'moreMemoryBox';
    box.style.display = 'none';
    hidden.forEach(area => box.appendChild(makeTile(area)));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'chip';
    toggle.id = 'moreMemoryBtn';
    toggle.setAttribute('aria-expanded', 'false');
    const label = (open) => `${open ? '▾' : '▸'} Ďalšie oblasti (${hidden.length})`;
    toggle.textContent = label(false);
    toggle.onclick = () => {
      const open = box.style.display === 'none';
      box.style.display = open ? 'block' : 'none';
      toggle.textContent = label(open);
      toggle.setAttribute('aria-expanded', String(open));
    };

    container.appendChild(toggle);
    container.appendChild(box);
  }

  MEMORY_AREAS.forEach(area => updateTile(area.slug, container));
}

window.renderMemoryTiles = renderMemoryTiles;

/* ============================================================
   Zvuková podpora – prehratie definície (SpeechSynthesis)
   a nahratie odpovede hlasom (SpeechRecognition).
============================================================ */
export function speakText(text, { onEnd, onBoundary, cancelPrevious = true, volume = 1, voice = null, pitch = 1 } = {}) {
  if (!text || !('speechSynthesis' in window)) return false;
  try {
    if (cancelPrevious) window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = voice ? voice.lang : 'sk-SK';
    utter.rate = 0.95;
    utter.pitch = pitch;
    utter.volume = volume;
    if (voice) utter.voice = voice;
    if (onEnd) utter.onend = onEnd;
    if (onBoundary) utter.onboundary = onBoundary;
    window.speechSynthesis.speak(utter);
    return true;
  } catch (e) {
    console.warn('Bifľovačka: prehratie hlasu zlyhalo', e);
    return false;
  }
}

export function isSpeechRecognitionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/* ============================================================
   isLikelyDesktop() – zdieľané medzi statnice.js (AI skúška) a
   memory-trainer.html (bifľovačka), presunuté sem 2026-07-19 (predtým
   duplicitne v statnice.js), nech obe miesta majú JEDEN zdroj pravdy.

   ⚠️ TOTO JE LEN SIGNÁL, ČI SKÚSIŤ auto-štart/continuous mikrofón – NIKDY
   bariéra. Tlačidlo mikrofónu ostáva VŽDY viditeľné a funkčné bez ohľadu na
   výsledok tejto detekcie:
   - detekcia sa pomýli → auto-štart/continuous sa nespustí → používateľ má
     stále tlačidlo (najhorší dôsledok: musí kliknúť, nikdy "nefunguje")
   - detekcia sa pomýli opačne (dotykový notebook vyhodnotený ako desktop,
     continuous/auto-štart je tam nespoľahlivý) → volajúci musí mať vlastnú
     záložku (napr. onError → výzva na manuálny klik, viď statnice.js
     startOrRestartRecording)

   navigator.maxTouchPoints ani User-Agent nie sú spoľahlivé (dotykové
   notebooky sú "touch", ale sú to PC) – pointer:fine + hover:hover (myš/
   trackpad vie hoverovať, prst na dotykovej ploche nie) je najlepší dostupný
   best-effort signál, nie istota. */
export function isLikelyDesktop() {
  return !!(window.matchMedia && window.matchMedia('(pointer: fine) and (hover: hover)').matches);
}

/**
 * Vytvorí rozpoznávač reči pre jednu nahrávku.
 * callbacks: { onStart, onResult(transcript), onEnd, onError }
 * options: { continuous } – voliteľné, default false (doterajšie správanie,
 *   nezmenené pre existujúcich volajúcich). JEDNO rozhranie pre prípadnú
 *   budúcu platform-špecifickú potrebu (napr. desktop), namiesto dvoch
 *   nezávislých implementácií, ktoré by sa časom rozišli.
 * Vráti inštanciu s .start()/.stop(), alebo null ak nie je podporované.
 */
export function createSpeechRecognizer(callbacks = {}, { continuous = false } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;

  const recognizer = new Ctor();
  recognizer.lang = 'sk-SK';
  recognizer.continuous = continuous;
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;

  recognizer.onstart = () => callbacks.onStart && callbacks.onStart();
  recognizer.onend = () => callbacks.onEnd && callbacks.onEnd();
  recognizer.onerror = (e) => callbacks.onError && callbacks.onError(e);
  /* ⚠️ Iteruje e.resultIndex..e.results.length, NIE natvrdo index 0
     (2026-07-19 – oprava pre continuous:true). Pri continuous:false (default,
     jediné doterajšie použitie) má každá udalosť VŽDY resultIndex===0 a
     results.length===1, takže táto iterácia prebehne presne raz a vráti
     to isté ako predtým – správanie existujúcich volajúcich (memory-trainer.html)
     sa nemení. Pri continuous:true (statnice.js, len na desktope) Chrome
     PRIDÁVA nové výsledky do results namiesto novej relácie – natvrdo index 0
     by po prvej vete navždy opakoval len ju a každú ďalšiu ticho ignoroval. */
  recognizer.onresult = (e) => {
    let combined = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) combined += (combined ? ' ' : '') + result[0].transcript;
    }
    if (combined) callbacks.onResult && callbacks.onResult(combined);
  };

  return recognizer;
}
