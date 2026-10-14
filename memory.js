'use strict';

import { $, qsa, shuffleArray } from './core.js';
import { showRewardToast } from './ui.js';
import { playSound } from './audio.js';
import { incrementGamesPlayed } from './avatars.js';
import { LS } from './core.js';
import { econEnergy, econAward, ECONOMY_CONFIG } from './scripts/economy.js';
import { recordOkruhResult, PROGRESS_ACTIVITIES } from './scripts/progressTracking.js';

/* ===============================
   Memory state
   =============================== */
let memoryState = {
  cards: [],
  first: null,
  second: null,
  lock: false,
  matches: 0,
  wrongs: 0,
  startTime: null,
  timer: null,
  elapsed: 0,
  perSource: {} // { [okruh source]: { matches, wrongs } } – per-karta atribúcia (Fáza 2 dodatok)
};

let memoryFocusedIndex = 0;

/* Zložený kľúč (_area::source), NIE holý source – hmotné aj procesné
   podoblasti majú vlastné A1..A30/A40/A45 súbory s ROVNAKÝMI source kľúčmi
   (napr. Občianske právo: hmotné A1-A40 × procesné A1-A45 → ~40 zhôd z 1800
   kombinácií, teda kolízia pri ~2 % hier, nie výnimka). Bez _area v kľúči by
   sa takéto dva odlišné okruhy omylom zliali do jedného zápisu, a keďže
   writeOkruhBest drží najlepší doteraz dosiahnutý výsledok TRVALO, zlúčenie
   by sa už nikdy neopravilo. */
function cardSourceKey(card) {
  if (!card || !card.source) return null;
  return card._area ? `${card._area}::${card.source}` : card.source;
}

/* Karty bez source (napr. legacy buildMemory(setKey) pevná sada) sa
   jednoducho ignorujú – cardSourceKey() im vráti null. */
function bumpPerSource(key, field) {
  if (!key) return;
  if (!memoryState.perSource[key]) memoryState.perSource[key] = { matches: 0, wrongs: 0 };
  memoryState.perSource[key][field]++;
}

/* ===============================
   Build memory board
   =============================== */
export function buildMemory(setKey = "TPH-A1"){
  const board = $('memoryBoard');
  if(!board) return;

  ensureMemoryControls();

  const pairs = (typeof memorySets !== 'undefined' && memorySets[setKey])
    ? memorySets[setKey]
    : [];

  const cards = [];
  pairs.forEach(p => {
    cards.push({ uid: p.id + "-L", pairId: p.id, text: p.left,  side: 'L', matched:false });
    cards.push({ uid: p.id + "-R", pairId: p.id, text: p.right, side: 'R', matched:false });
  });

  shuffleArray(cards);

  memoryState.cards = cards;
  memoryState.first = null;
  memoryState.second = null;
  memoryState.lock = false;
  memoryState.matches = 0;
  memoryState.wrongs = 0;
  memoryState.elapsed = 0;
  memoryState.startTime = Date.now();

  // start timer only if timer element exists (ensureMemoryControls created it)
  startTimer();

  renderMemoryBoard();
  updateMemoryCounter();
  updateStats();
  memoryFocusedIndex = 0;
}

/* ===============================
   Render board (all cards visible)
   =============================== */
export function renderMemoryBoard(){
  const board = $('memoryBoard');
  if(!board) return;

  board.innerHTML = '';

  memoryState.cards.forEach((card, idx) => {
    const el = document.createElement('div');
    el.className = 'memory-card' + (card.side === 'L' ? ' memory-card-q' : ' memory-card-a');
    el.dataset.uid = card.uid;
    el.dataset.index = String(idx);
    el.tabIndex = 0;

    // text directly on the card (no question mark)
    el.textContent = card.text;

    if(card.matched){
      el.classList.add('matched');
      el.style.pointerEvents = 'none';
      el.removeAttribute('tabindex');
    }

    el.addEventListener('click', () => onMemoryClick(card.uid, el));
    el.addEventListener('keydown', e => {
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        el.click();
      }
    });

    board.appendChild(el);
  });
}

/* ===============================
   Click logic (pairing)
   =============================== */
function onMemoryClick(uid, el){
  if(memoryState.lock) return;

  const card = memoryState.cards.find(c => c.uid === uid);
  if(!card || card.matched) return;

  if(!memoryState.first){
    memoryState.first = { card, el };
    el.classList.add('selected');
    updateMemoryCounter();
    return;
  }

  if(memoryState.first.card.uid === uid) return;

  memoryState.second = { card, el };
  memoryState.lock = true;

  const firstCard = memoryState.first.card;
  const secondCard = memoryState.second.card;

  const mode = $('memoryMode')?.value || 'training';

  if(firstCard.pairId === secondCard.pairId && firstCard.side !== secondCard.side){
    // MATCH
    firstCard.matched = true;
    secondCard.matched = true;
    memoryState.matches++;
    bumpPerSource(cardSourceKey(firstCard), 'matches'); // firstCard/secondCard majú rovnaký (_area,source) pri matchi

    try { playSound(window.soundMatch); } catch(e){}

    // draw connection line
    drawConnection(memoryState.first.el, memoryState.second.el);

    // visual feedback: matched + bounce
    memoryState.first.el.classList.add('matched','bounce');
    memoryState.second.el.classList.add('matched','bounce');

    // remove selected state from first
    memoryState.first.el.classList.remove('selected');

    // disable interactions
    memoryState.first.el.style.pointerEvents = 'none';
    memoryState.second.el.style.pointerEvents = 'none';

    memoryState.first.el.removeAttribute('tabindex');
    memoryState.second.el.removeAttribute('tabindex');

    // clear bounce after short animation
    setTimeout(() => {
      if(memoryState.first && memoryState.first.el) memoryState.first.el.classList.remove('bounce');
      if(memoryState.second && memoryState.second.el) memoryState.second.el.classList.remove('bounce');
    }, 420);

    memoryState.first = null;
    memoryState.second = null;
    memoryState.lock = false;

    updateMemoryCounter();
    updateStats();

    if(memoryState.matches === memoryState.cards.length / 2){
      finishMemoryGame();
    }

  } else {
    // WRONG
    try { playSound(window.soundNoMatch); } catch(e){}

    memoryState.wrongs++;
    // 1 wrong sa počíta KAŽDÉMU dotknutému okruhu (dedup – ak sú obe karty
    // z toho istého (_area,source), počíta sa mu len raz, nie dvakrát).
    [...new Set([cardSourceKey(firstCard), cardSourceKey(secondCard)])].forEach(k => bumpPerSource(k, 'wrongs'));

    // visual feedback: wrong + shake
    memoryState.first.el.classList.add('wrong','shake');
    memoryState.second.el.classList.add('wrong','shake');

    // § trest za nesprávnu dvojicu zrušený – odmeny/postih za pexeso rieši
    // výhradne Firebase (MEMORY_PERFECT za bezchybnú sadu). Exam režim ostáva hrateľný.

    // remove wrong/selected after short animation
    setTimeout(() => {
      if(memoryState.first && memoryState.first.el) memoryState.first.el.classList.remove('selected','wrong','shake');
      if(memoryState.second && memoryState.second.el) memoryState.second.el.classList.remove('wrong','shake');

      memoryState.first = null;
      memoryState.second = null;
      memoryState.lock = false;

      updateMemoryCounter();
      updateStats();
    }, 700);
  }
}

/* ===============================
   Connection animation
   =============================== */
function drawConnection(el1, el2){
  if(!el1 || !el2) return;

  const rect1 = el1.getBoundingClientRect();
  const rect2 = el2.getBoundingClientRect();

  const line = document.createElement('div');
  line.className = 'memory-line';

  const x1 = rect1.left + rect1.width / 2;
  const y1 = rect1.top + rect1.height / 2;
  const x2 = rect2.left + rect2.width / 2;
  const y2 = rect2.top + rect2.height / 2;

  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;

  line.style.position = 'fixed';
  line.style.left = `${x1}px`;
  line.style.top = `${y1}px`;
  line.style.width = `${length}px`;
  line.style.height = '3px';
  line.style.transform = `rotate(${angle}deg)`;
  line.style.transformOrigin = '0 50%';
  line.style.zIndex = 9999;

  document.body.appendChild(line);

  // fade in then remove
  requestAnimationFrame(() => line.classList.add('fade'));
  setTimeout(() => {
    if(line && line.parentNode) line.remove();
  }, 600);
}

/* ===============================
   Timer
   =============================== */
function startTimer(){
  stopTimer();
  memoryState.elapsed = 0;
  const tEl = $('memoryTimer');
  if(tEl) tEl.textContent = 'Čas: 0 s';

  // only start if timer element exists
  if(!tEl) return;

  memoryState.timer = setInterval(() => {
    memoryState.elapsed++;
    const te = $('memoryTimer');
    if(te) te.textContent = `Čas: ${memoryState.elapsed} s`;
  }, 1000);
}

function stopTimer(){
  if(memoryState.timer) {
    clearInterval(memoryState.timer);
    memoryState.timer = null;
  }
}

/* ===============================
   Finish game
   =============================== */
function finishMemoryGame(){
  stopTimer();

  const mode = $('memoryMode')?.value || 'training';

  const nick = localStorage.getItem('playerNick');
  /* Energia aj anonymovi (A1) – econEnergy rieši null nick sama. */
  econEnergy(nick, ECONOMY_CONFIG.ENERGY.MEMORY_SET, 'dohraná sada pexesa');
  if (nick) {
    if (memoryState.wrongs === 0) {
      econAward(nick, ECONOMY_CONFIG.REWARDS.MEMORY_PERFECT, 'pexeso bez chyby');
    }
  }

  /* 📊 Osobný prehľad progresu (Fáza 2) – presná per-karta atribúcia podľa
     ZLOŽENÉHO kľúča (_area::source), NIE holého source: hmotné aj procesné
     podoblasti majú vlastné A1..A30/A40/A45 súbory s ROVNAKÝMI source kľúčmi
     (napr. Občianske právo hmotné A1-A40 × procesné A1-A45 → kolízia pri
     ~2 % náhodných párov), takže bez _area v kľúči by sa dva rôzne okruhy
     omylom zlúčili do jedného zápisu – a keďže writeOkruhBest drží najlepší
     výsledok TRVALO, takéto zlúčenie by sa už nikdy neopravilo. Ak sa do
     8-karticového výberu tejto session nedostala žiadna dlaždica z
     niektorého okruhu, pre ten sa nezapisuje nič (radšej žiadny zápis ako
     vymyslené číslo). */
  const pair = window.__selectedOkruhPair;
  if (nick && pair && Array.isArray(pair.sources) && pair.sources.length) {
    pair.sources.forEach(({ area, key }) => {
      const tally = memoryState.perSource[`${area}::${key}`];
      if (!tally) return; // žiadna karta z tohto okruhu sa v tejto session neobjavila
      const attempts = tally.matches + tally.wrongs;
      const pct = attempts > 0 ? Math.round((tally.matches / attempts) * 100) : 100;
      recordOkruhResult(nick, area, key, PROGRESS_ACTIVITIES.FLASHCARDS, pct);
    });
  }

  if(mode === 'exam'){
    // § odmena za exam pexeso zrušená z localStorage – § rieši výhradne Firebase
    // (MEMORY_PERFECT vyššie za bezchybnú sadu). Ostáva zvuk, toast bez §, rebríček.
    try { playSound(window.soundWin); } catch(e){}

    showRewardToast(`Všetky páry spojené • ${memoryState.matches} párov`);

    saveLeaderboardEntry({
      time: memoryState.elapsed,
      pairs: memoryState.matches,
      date: new Date().toISOString()
    });

    renderLeaderboard();
  } else {
    try { playSound(window.soundWin); } catch(e){}
    showRewardToast(`Tréning dokončený • ${memoryState.matches} párov`);
  }

  incrementGamesPlayed();
}

/* ===============================
   Memory UI controls
   =============================== */
function ensureMemoryControls(){
  const modal = $('memoryModal');
  if(!modal) return;

  const panel = modal.querySelector('.avatar-panel');
  if(!panel) return;

  if(panel.querySelector('.memory-controls')) return;

  const controls = document.createElement('div');
  controls.className = 'memory-controls';
  controls.style.display = 'flex';
  controls.style.flexDirection = 'column';
  controls.style.gap = '8px';
  controls.style.marginTop = '12px';

  /* Mode selector */
  const modeSel = document.createElement('select');
  modeSel.id = 'memoryMode';
  modeSel.className = 'btn';
  modeSel.innerHTML = `
    <option value="training">Tréning</option>
    <option value="exam">Skúška</option>
  `;

  /* Timer */
  const timer = document.createElement('div');
  timer.id = 'memoryTimer';
  timer.className = 'small';
  timer.textContent = 'Čas: 0 s';

  /* Counter */
  const counter = document.createElement('div');
  counter.className = 'small';
  counter.id = 'memoryCounter';
  counter.textContent = 'Páry: 0';

  /* Stats */
  const stats = document.createElement('div');
  stats.id = 'memoryStats';
  stats.className = 'small';
  stats.textContent = 'Úspešnosť: 0 % (0/0)';

  controls.appendChild(modeSel);
  controls.appendChild(timer);
  controls.appendChild(counter);
  controls.appendChild(stats);

  panel.appendChild(controls);

  /* Leaderboard */
  const lb = document.createElement('div');
  lb.id = 'memoryLeaderboard';
  lb.style.marginTop = '12px';
  lb.style.display = 'none';
  panel.appendChild(lb);

  renderLeaderboard();
}

/* ===============================
   Counter
   =============================== */
function updateMemoryCounter(){
  const el = $('memoryCounter');
  if(!el) return;

  const totalPairs = memoryState.cards.length / 2;
  const found = memoryState.matches;

  el.textContent = `Páry: ${found} / ${totalPairs}`;
}

/* ===============================
   Stats
   =============================== */
function updateStats(){
  const el = $('memoryStats');
  if(!el) return;

  const attempts = memoryState.matches + memoryState.wrongs;
  const success = attempts > 0 ? Math.round((memoryState.matches / attempts) * 100) : 0;

  el.textContent = `Úspešnosť: ${success} % (${memoryState.matches}/${attempts})`;
}

/* ===============================
   Leaderboard
   =============================== */
function saveLeaderboardEntry(entry){
  const raw = localStorage.getItem(LS.LEADERBOARD);
  const arr = raw ? JSON.parse(raw) : [];

  arr.push(entry);
  arr.sort((a,b) => a.time - b.time);

  const top = arr.slice(0, 10);

  try {
    localStorage.setItem(LS.LEADERBOARD, JSON.stringify(top));
  } catch(e){}
}

export function renderLeaderboard(){
  const lb = $('memoryLeaderboard');
  if(!lb) return;

  const raw = localStorage.getItem(LS.LEADERBOARD);
  const arr = raw ? JSON.parse(raw) : [];

  if(arr.length === 0){
    lb.innerHTML = '<div class="small">Žiadne záznamy.</div>';
    return;
  }

  let html = '<div style="font-weight:700;margin-bottom:8px">Leaderboard (skúška)</div>';
  html += '<ol style="padding-left:18px;margin:0">';

  arr.forEach(r => {
    const d = new Date(r.date);
    html += `<li style="margin-bottom:6px"><strong>${r.time}s</strong> • ${r.pairs} párov • <span class="small">${d.toLocaleString()}</span></li>`;
  });

  html += '</ol>';
  lb.innerHTML = html;
}

/* ===============================
   Keyboard navigation
   =============================== */
export function attachMemoryKeyboard(){
  memoryFocusedIndex = 0;
  document.addEventListener('keydown', memoryKeyboardHandler);
}

export function detachMemoryKeyboard(){
  document.removeEventListener('keydown', memoryKeyboardHandler);
}

function memoryKeyboardHandler(e){
  const modal = $('memoryModal');
  if(!modal || !modal.classList.contains('open')) return;

  const cards = qsa('#memoryBoard .memory-card');
  if(!cards.length) return;

  if(e.key === 'ArrowRight'){
    memoryFocusedIndex = (memoryFocusedIndex + 1) % cards.length;
    cards[memoryFocusedIndex].focus();
  }

  if(e.key === 'ArrowLeft'){
    memoryFocusedIndex = (memoryFocusedIndex - 1 + cards.length) % cards.length;
    cards[memoryFocusedIndex].focus();
  }

  if(e.key === 'ArrowDown'){
    memoryFocusedIndex = (memoryFocusedIndex + 4) % cards.length;
    cards[memoryFocusedIndex].focus();
  }

  if(e.key === 'ArrowUp'){
    memoryFocusedIndex = (memoryFocusedIndex - 4 + cards.length) % cards.length;
    cards[memoryFocusedIndex].focus();
  }

  if(e.key === 'Enter'){
    cards[memoryFocusedIndex].click();
  }
}

/* ===============================
   BUILD MEMORY FROM DUEL QUESTIONS
   Načíta páry z JSON otázok (question ↔ správna odpoveď)
   =============================== */
export function buildMemoryFromQuestions(questions) {
  const board = $('memoryBoard');
  if (!board) return;

  if (!questions || !questions.length) {
    board.innerHTML = '<div class="small muted">Žiadne otázky pre túto oblasť.</div>';
    return;
  }

  ensureMemoryControls();

  // Vytvor páry: otázka ↔ správna odpoveď (max 8 párov pre prehľadnosť)
  const pairs = questions.slice(0, 8).map((q, i) => {
    const correctAnswer = Array.isArray(q.options) && typeof q.correct === 'number'
      ? q.options[q.correct]
      : '';
    // Skráť otázku ak je príliš dlhá
    const shortQ = q.question && q.question.length > 80
      ? q.question.substring(0, 78) + '…'
      : (q.question || '?');
    return {
      id: `q${i}`,
      left: shortQ,
      right: correctAnswer,
      source: q.source || null,
      _area: q._area || null
    };
  }).filter(p => p.right); // len páry so správnou odpoveďou

  if (!pairs.length) {
    board.innerHTML = '<div class="small muted">Otázky nemajú správne odpovede.</div>';
    return;
  }

  const cards = [];
  pairs.forEach(p => {
    cards.push({ uid: p.id + "-L", pairId: p.id, text: p.left,  side: 'L', matched: false, source: p.source, _area: p._area });
    cards.push({ uid: p.id + "-R", pairId: p.id, text: p.right, side: 'R', matched: false, source: p.source, _area: p._area });
  });

  shuffleArray(cards);

  memoryState.cards = cards;
  memoryState.first = null;
  memoryState.second = null;
  memoryState.lock = false;
  memoryState.matches = 0;
  memoryState.wrongs = 0;
  memoryState.perSource = {};
  memoryState.elapsed = 0;
  memoryState.startTime = Date.now();

  startTimer();
  renderMemoryBoard();
  updateMemoryCounter();
  updateStats();
  memoryFocusedIndex = 0;
}

// Globálny export pre volanie z init.js
window.buildMemoryFromQuestions = buildMemoryFromQuestions;

/* ===============================
   BUILD MEMORY FROM TILES
   Páruje pojem ↔ definícia z JSON "tiles"
   =============================== */
export function buildMemoryFromTiles(tiles) {
  const board = $('memoryBoard');
  if (!board) return;

  if (!tiles || !tiles.length) {
    board.innerHTML = '<div class="small muted">Žiadne dlaždice pre túto oblasť.</div>';
    return;
  }

  ensureMemoryControls();

  // Zamiešaj a vyber max 8 párov
  const pool = [...tiles];
  shuffleArray(pool);
  const pairs = pool.slice(0, 8).map((t, i) => ({
    id: `t${i}`,
    left: t.term,
    right: t.definition,
    source: t.source || null,
    _area: t._area || null
  }));

  const cards = [];
  pairs.forEach(p => {
    cards.push({ uid: p.id + "-L", pairId: p.id, text: p.left,  side: 'L', matched: false, source: p.source, _area: p._area });
    cards.push({ uid: p.id + "-R", pairId: p.id, text: p.right, side: 'R', matched: false, source: p.source, _area: p._area });
  });

  shuffleArray(cards);

  memoryState.cards = cards;
  memoryState.first = null;
  memoryState.second = null;
  memoryState.lock = false;
  memoryState.matches = 0;
  memoryState.wrongs = 0;
  memoryState.perSource = {};
  memoryState.elapsed = 0;
  memoryState.startTime = Date.now();

  startTimer();
  renderMemoryBoard();
  updateMemoryCounter();
  updateStats();
  memoryFocusedIndex = 0;
}

window.buildMemoryFromTiles = buildMemoryFromTiles;
