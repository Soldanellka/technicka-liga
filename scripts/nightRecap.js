'use strict';

/* ============================================================
   NOČNÝ VÝCUC – audio opakovanie oblasti pred spaním
   Karta #nightRecapCard (panel #setStudy).

   Princíp: jeden energetický náklad (ENERGY.NIGHT_RECAP) odomkne audio
   výcucy VŠETKÝCH okruhov ZVOLENEJ oblasti na 24 h — odomknutie,
   TTL aj výber okruhov sa kľúčujú slugom oblasti, oblasti sú na
   sebe nezávislé. Študent si hore prepne oblasť, zaškrtá okruhy
   a appka ich zreťazí do jedného plynulého prúdu: <audio> +
   Media Session, reťazenie cez 'ended' (overené na iOS aj pri
   zamknutej obrazovke – Fáza 0), časovač spánku cez deadline
   v 'timeupdate' (setTimeout v iOS pozadí nie je spoľahlivý),
   slučka.

   Fade-out: na iOS je audio.volume read-only, preto je fade
   zapečený priamo v MP3 (TTS pipeline); JS fade tu je len bonus
   pre Android/desktop. Web Audio API sa NEPOUŽÍVA – iOS ho pri
   zamknutí suspenduje a umlčal by celú feature.

   Vlastný výber okruhov – vedome NEsiaha na __selectedOkruhPair
   ani __area*ForGames (pojednávací výber je iný svet).
============================================================ */

import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { econEnergyLeft, econEnergyMissingMsg, econSpendEnergy, ECONOMY_CONFIG } from './economy.js';
import { escapeHtml } from '../core.js';
import { showRewardToast } from '../ui.js';

/* ---------- OBLASTI (jediné miesto pravdy) ----------
   Pridať oblasť = pridať položku sem, len čo má nahrávky
   v lexarena-audio pod {slug}/vecny/A{n}.mp3. Oblasti bez audia
   (európske, trestné) sa sem nepridávajú, kým audio nepribudne.
   dataPath: odkiaľ sa čítajú názvy okruhov (title v A{n}.json);
   relatívne cesty – tá istá statika servíruje appku aj dáta. */
const AREAS = [
  { slug: 'pracovne',           label: 'Pracovné',           count: 50, dataPath: 'LuluLaw duel Pracovné právo/data/' },
  { slug: 'obcianske-hmotne',   label: 'Občianske hmotné',   count: 40, dataPath: 'ob-pravo-app/data/hmotne/' },
  { slug: 'obcianske-procesne', label: 'Občianske procesné', count: 45, dataPath: 'ob-pravo-app/data/procesne/' }
];

const UNLOCK_TTL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_SECONDS = 30;       // bezplatná ukážka pred odomknutím
const FADE_MS = 15000;            // JS fade pred zastavením časovača (len kde volume funguje)

/* Audio žije mimo hlavného repa: repo lexarena-audio cez jsDelivr,
   verzia = git tag (@v1). Nová verzia nahrávok = nový tag = čistá cache.
   Pre lokálny test zvuku sa dá zdroj prepnúť bez zásahu do kódu
   (override nahrádza CELÚ cestu oblasti vrátane slugu):
     localStorage.nightRecapAudioBase = 'http://localhost:8123/night-test-audio/'
     localStorage.nightRecapAudioExt  = '.wav' */
const CDN_ROOT = 'https://cdn.jsdelivr.net/gh/Soldanellka/financna-liga-audio@v1/';
const audioBase = (slug) => localStorage.getItem('nightRecapAudioBase') || `${CDN_ROOT}${slug}/vecny/`;
const audioExt  = () => localStorage.getItem('nightRecapAudioExt') || '.mp3';

/* ---------- HELPERY ---------- */
const $id = (x) => document.getElementById(x);
const getDb = () => window.db || null;
const getNick = () => localStorage.getItem('playerNick') || null;
const AREA_PREF_KEY = 'nightRecapArea';
const cacheKey  = (slug) => `nightRecapUnlock:${slug}`;
const selKey    = (slug) => `nightRecapSel:${slug}`;
const titlesKey = (slug) => `nightRecapTitles:${slug}`;

function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------- STAV ---------- */
let area = AREAS.find((a) => a.slug === localStorage.getItem(AREA_PREF_KEY)) || AREAS[0];
let unlockTs = null;              // timestamp odomknutia AKTUÁLNEJ oblasti (null = zamknuté)
const titlesByArea = {};          // slug -> { 1: 'Pojem…', … } – lazy load
let selection = new Set();        // čísla vybraných okruhov aktuálnej oblasti
let playlist = [];                // aktuálny prúd (čísla okruhov)
let playSlug = null;              // slug oblasti bežiaceho prúdu (drží URL pri reťazení)
let trackIdx = 0;
let loop = false;
let sleepDeadline = null;         // Date.now() deadline, null = bez časovača
let sleepMinutes = 0;             // 0 = „celé“ (bez časovača)
let previewMode = false;          // hrá bezplatná ukážka (stop po PREVIEW_SECONDS)
let fadeWarned = false;           // iOS: volume je read-only – zaznamenaj len raz
let errorStreak = 0;              // po sebe idúce nenačítateľné stopy (poistka slučky chýb)

const isUnlocked = () => Boolean(unlockTs && Date.now() - unlockTs < UNLOCK_TTL_MS);
const trackUrl = (n) => `${audioBase(playSlug || area.slug)}A${n}${audioExt()}`;

/* ---------- ODOMKNUTIE (Firebase + localStorage cache, per oblasť) ----------
   Vzor videoRewards/dailyEarned: cache pre okamžitý render, DB je pravda.
   users/${nick}/nightRecap/${slug} = Date.now() – kľúčované slugom,
   odomknutie jednej oblasti sa druhej netýka. Bez zmeny DB pravidiel. */
async function loadUnlock() {
  const forSlug = area.slug;
  const cached = Number(localStorage.getItem(cacheKey(forSlug))) || null;
  unlockTs = cached;
  const db = getDb(), nick = getNick();
  if (!db || !nick) return;
  try {
    const snap = await get(ref(db, `users/${nick}/nightRecap/${forSlug}`));
    const dbTs = snap.exists() ? Number(snap.val()) : null;
    if (area.slug !== forSlug) return; // medzitým prepnutá oblasť – výsledok už neplatí
    if (dbTs !== cached) {
      unlockTs = dbTs;
      if (dbTs) localStorage.setItem(cacheKey(forSlug), String(dbTs));
      else localStorage.removeItem(cacheKey(forSlug));
      render();
    }
  } catch (e) {
    /* offline/na chvíľu bez DB – cache necháva kartu použiteľnú */
    console.warn('nightRecap: DB kontrola odomknutia zlyhala', e);
  }
}

async function unlock() {
  const nick = getNick();
  const msg = $id('nrMsg');
  if (!nick) { if (msg) msg.textContent = 'Najprv sa prihlás (nick), potom sa dá odomykať.'; return; }

  /* E2: výcuc sa už neplatí §, stojí energiu (ENERGY.NIGHT_RECAP).
     Jemná hláška namiesto tvrdého bloku – nočné opakovanie je návyk,
     nie trestná zóna. Tlačidlo ostáva aktívne, nič sa nezamyká. */
  const energyCost = ECONOMY_CONFIG.ENERGY.NIGHT_RECAP;
  const energyLeft = await econEnergyLeft();
  if (energyLeft < Math.abs(energyCost)) {
    if (msg) msg.textContent = econEnergyMissingMsg(energyCost, energyLeft) + ' Výcuc tu na teba počká. 🌙';
    return;
  }

  const ok = await econSpendEnergy(nick, energyCost, `Nočný výcuc – ${area.label} (24 h)`);
  if (!ok) { if (msg) msg.textContent = econEnergyMissingMsg(energyCost, await econEnergyLeft()); return; }

  const ts = Date.now();
  try {
    await set(ref(getDb(), `users/${nick}/nightRecap/${area.slug}`), ts);
  } catch (e) {
    console.warn('nightRecap: zápis odomknutia do DB zlyhal (cache platí)', e);
  }
  unlockTs = ts;
  localStorage.setItem(cacheKey(area.slug), String(ts));
  showRewardToast(`🌙 Nočný výcuc (${area.label}) odomknutý na 24 hodín`);
  render();
}

/* ---------- TITULKY OKRUHOV (lazy, sessionStorage cache, per oblasť) ---------- */
async function loadTitles() {
  const a = area;
  if (titlesByArea[a.slug]) return titlesByArea[a.slug];
  try {
    const cached = sessionStorage.getItem(titlesKey(a.slug));
    if (cached) { titlesByArea[a.slug] = JSON.parse(cached); return titlesByArea[a.slug]; }
  } catch (e) { /* pokazená cache – načítame nanovo */ }

  const out = {};
  await Promise.all(Array.from({ length: a.count }, (_, i) => i + 1).map(async (n) => {
    try {
      const r = await fetch(`${a.dataPath}A${n}.json`);
      const j = await r.json();
      out[n] = j.title || `Okruh ${n}`;
    } catch (e) {
      out[n] = `Okruh ${n}`;
    }
  }));
  titlesByArea[a.slug] = out;
  try { sessionStorage.setItem(titlesKey(a.slug), JSON.stringify(out)); } catch (e) { /* plné úložisko – nevadí */ }
  return out;
}

/* ---------- VÝBER OKRUHOV (per oblasť) ---------- */
function loadSelection() {
  try {
    const arr = JSON.parse(localStorage.getItem(selKey(area.slug)) || '[]');
    selection = new Set(arr.filter((n) => Number.isInteger(n) && n >= 1 && n <= area.count));
  } catch (e) { selection = new Set(); }
}
function saveSelection() {
  localStorage.setItem(selKey(area.slug), JSON.stringify([...selection].sort((a, b) => a - b)));
}

/* ---------- PREHRÁVAČ ---------- */
const player = () => $id('nightRecapPlayer');

function updateMediaSession(n) {
  if (!('mediaSession' in navigator)) return;
  try {
    const titles = titlesByArea[playSlug || area.slug] || {};
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titles[n] || `Okruh ${n}`,
      artist: 'Nočný výcuc – Finančná liga',
      album: (AREAS.find((a) => a.slug === (playSlug || area.slug)) || area).label
    });
    navigator.mediaSession.setActionHandler('play', () => { player()?.play().catch(() => {}); });
    navigator.mediaSession.setActionHandler('pause', () => { player()?.pause(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => stepTrack(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => stepTrack(-1));
  } catch (e) { /* stará WebView bez MediaMetadata – prehrávanie beží aj tak */ }
}

function playTrack(i) {
  const el = player();
  if (!el || !playlist.length) return;
  trackIdx = Math.min(Math.max(i, 0), playlist.length - 1);
  const n = playlist[trackIdx];
  el.src = trackUrl(n);
  try { el.volume = 1; } catch (e) { /* iOS – volume read-only */ }
  updateMediaSession(n);
  updateNowPlaying();
  el.play().catch((e) => {
    /* play() mimo gesta môže odmietnuť len pri prvom štarte – ten je vždy z kliku */
    console.warn('nightRecap: play() zlyhalo', e);
  });
}

function stepTrack(delta) {
  if (!playlist.length) return;
  playTrack((trackIdx + delta + playlist.length) % playlist.length);
}

function stopPlayback() {
  const el = player();
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  try { el.load(); } catch (e) { /* niektoré prehliadače load() bez src neznesú */ }
  playlist = [];
  playSlug = null;
  previewMode = false;
  sleepDeadline = null;
  updateNowPlaying();
}

function startStream() {
  if (!isUnlocked()) { render(); return; }
  const chosen = [...selection].sort((a, b) => a - b);
  const msg = $id('nrPlayMsg');
  if (!chosen.length) { if (msg) msg.textContent = 'Zaškrtni aspoň jeden okruh.'; return; }
  if (msg) msg.textContent = '';
  previewMode = false;
  errorStreak = 0;
  playSlug = area.slug;
  playlist = chosen;
  sleepDeadline = sleepMinutes ? Date.now() + sleepMinutes * 60000 : null;
  playTrack(0);
}

function startPreview() {
  /* Ukážka zdarma: prvých ~30 s okruhu 1 zvolenej oblasti – nech
     študent počuje, čo odomyká, a energiu neminie naslepo. */
  previewMode = true;
  errorStreak = 0;
  playSlug = area.slug;
  playlist = [1];
  sleepDeadline = null;
  playTrack(0);
  const msg = $id('nrMsg');
  if (msg) msg.textContent = `Hrá ukážka (${PREVIEW_SECONDS} s) – ${area.label}, okruh 1.`;
}

function updateNowPlaying() {
  const box = $id('nrNow');
  if (!box) return;
  const el = player();
  if (!el || !playlist.length || !el.src) { box.textContent = ''; return; }
  const n = playlist[trackIdx];
  const titles = titlesByArea[playSlug || area.slug] || {};
  const name = titles[n] || `Okruh ${n}`;
  let line = `▶ ${trackIdx + 1}/${playlist.length} · ${name} · ${fmtTime(el.currentTime)}/${fmtTime(el.duration)}`;
  if (sleepDeadline) line += ` · 💤 ${fmtTime((sleepDeadline - Date.now()) / 1000)}`;
  box.textContent = line;
}

function wirePlayer() {
  const el = player();
  if (!el) return;

  el.addEventListener('ended', () => {
    errorStreak = 0;
    if (previewMode) { stopPlayback(); return; }
    if (trackIdx < playlist.length - 1) playTrack(trackIdx + 1);
    else if (loop) playTrack(0);
    else stopPlayback();
  });

  el.addEventListener('error', () => {
    /* chýbajúca/nedostupná nahrávka: preskoč, ale max raz za stopu –
       keď zlyhá celý playlist, zastav (žiadna nekonečná slučka chýb) */
    errorStreak++;
    const n = playlist[trackIdx];
    console.warn(`nightRecap: nahrávka ${playSlug || area.slug}/A${n} sa nedá načítať`);
    if (previewMode || errorStreak >= playlist.length) {
      showRewardToast('Nahrávky sa nepodarilo načítať 😔');
      stopPlayback();
      return;
    }
    if (trackIdx < playlist.length - 1) playTrack(trackIdx + 1);
    else if (loop) playTrack(0);
    else stopPlayback();
  });

  el.addEventListener('timeupdate', () => {
    updateNowPlaying();

    /* ukážka: tvrdý strih po PREVIEW_SECONDS */
    if (previewMode && el.currentTime >= PREVIEW_SECONDS) {
      stopPlayback();
      const msg = $id('nrMsg');
      if (msg) msg.textContent = 'Koniec ukážky. Celé okruhy odomkneš tlačidlom vyššie. 🌙';
      return;
    }

    /* časovač spánku: deadline-check (nie setTimeout – iOS pozadie) */
    if (sleepDeadline && !el.paused) {
      const rem = sleepDeadline - Date.now();
      if (rem <= 0) {
        stopPlayback();
        return;
      }
      if (rem <= FADE_MS) {
        const target = Math.max(0.05, rem / FADE_MS);
        try {
          el.volume = target;
          if (!fadeWarned && Math.abs(el.volume - target) > 0.1) {
            fadeWarned = true; // iOS: volume read-only – fade je zapečený v MP3
          }
        } catch (e) { fadeWarned = true; }
      }
    }
  });

  el.addEventListener('play', updateNowPlaying);
  el.addEventListener('pause', updateNowPlaying);
}

/* ---------- PREPÍNAČ OBLASTI ---------- */
function switchArea(slug) {
  if (slug === area.slug) return;
  const next = AREAS.find((a) => a.slug === slug);
  if (!next) return;
  /* okruhy dvoch oblastí sa do jedného prúdu nemiešajú – prepnutie zastaví */
  stopPlayback();
  area = next;
  localStorage.setItem(AREA_PREF_KEY, area.slug);
  loadSelection();
  /* loadUnlock si synchrónne (pred prvým await) prepíše unlockTs z cache
     novej oblasti – až potom sa kreslí, inak by render ukázal stav
     predošlej oblasti; DB dorovnanie prekreslí, len ak sa líši */
  loadUnlock();
  render();
}

function areaSwitcherHtml() {
  return `<div class="nr-row" id="nrAreaRow">` + AREAS.map((a) =>
    `<button class="btn nr-chip${a.slug === area.slug ? ' active' : ''}" data-area="${a.slug}">${escapeHtml(a.label)}</button>`
  ).join('') + `</div>`;
}

function wireAreaSwitcher(body) {
  body.querySelectorAll('[data-area]').forEach((b) => {
    b.addEventListener('click', () => switchArea(b.dataset.area));
  });
}

/* ---------- RENDER ---------- */
function timeLeftLabel() {
  const ms = (unlockTs || 0) + UNLOCK_TTL_MS - Date.now();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function renderLocked(body) {
  const energyCost = Math.abs(ECONOMY_CONFIG.ENERGY.NIGHT_RECAP);
  body.innerHTML = `
    ${areaSwitcherHtml()}
    <div class="nr-row">
      <button class="btn" id="nrPreviewBtn">🎧 Ukážka zdarma (${PREVIEW_SECONDS} s)</button>
      <button class="btn btn-primary" id="nrUnlockBtn">🔓 Odomkni ${escapeHtml(area.label)} na 24 h za ⚡ ${energyCost}</button>
    </div>
    <div class="small" id="nrMsg" style="margin-top:8px"></div>
    <div class="small nr-now" id="nrNow" style="margin-top:4px"></div>`;
  wireAreaSwitcher(body);
  $id('nrUnlockBtn').addEventListener('click', unlock);
  $id('nrPreviewBtn').addEventListener('click', startPreview);
}

async function renderUnlocked(body) {
  const a = area;
  body.innerHTML = `
    ${areaSwitcherHtml()}
    <div class="small">${escapeHtml(a.label)} odomknuté ešte <b>${timeLeftLabel()}</b>. Vyber okruhy, ktoré si dnes prešiel – appka ich prehrá za sebou ako jeden prúd.</div>
    <div class="nr-row">
      <button class="btn" id="nrAllBtn">Vybrať všetkých ${a.count}</button>
      <button class="btn" id="nrNoneBtn">Vyčistiť</button>
    </div>
    <div class="nr-okruh-list" id="nrOkruhList"><div class="small">Načítavam okruhy…</div></div>
    <div class="nr-row">
      <button class="btn btn-primary" id="nrPlayBtn">▶︎ Spustiť</button>
      <button class="btn" id="nrPauseBtn">⏯</button>
      <button class="btn" id="nrPrevBtn">⏮</button>
      <button class="btn" id="nrNextBtn">⏭</button>
    </div>
    <div class="nr-row small">
      💤 Časovač:
      <button class="btn nr-chip" data-sleep="0">celé</button>
      <button class="btn nr-chip" data-sleep="15">15 min</button>
      <button class="btn nr-chip" data-sleep="30">30 min</button>
      <button class="btn nr-chip" data-sleep="60">60 min</button>
      <button class="btn nr-chip" id="nrLoopBtn">🔁 slučka</button>
    </div>
    <div class="small" id="nrPlayMsg"></div>
    <div class="small nr-now" id="nrNow" style="margin-top:4px"></div>`;

  wireAreaSwitcher(body);
  $id('nrPlayBtn').addEventListener('click', startStream);
  $id('nrPauseBtn').addEventListener('click', () => {
    const el = player();
    if (!el || !el.src) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  });
  $id('nrPrevBtn').addEventListener('click', () => stepTrack(-1));
  $id('nrNextBtn').addEventListener('click', () => stepTrack(1));
  $id('nrLoopBtn').addEventListener('click', (e) => {
    loop = !loop;
    e.currentTarget.classList.toggle('active', loop);
  });
  body.querySelectorAll('[data-sleep]').forEach((b) => {
    b.addEventListener('click', () => {
      sleepMinutes = Number(b.dataset.sleep) || 0;
      /* zmena časovača platí hneď aj pre bežiaci prúd */
      sleepDeadline = sleepMinutes ? Date.now() + sleepMinutes * 60000 : null;
      try { const el = player(); if (el) el.volume = 1; } catch (e2) { /* iOS */ }
      body.querySelectorAll('[data-sleep]').forEach((x) => x.classList.toggle('active', x === b));
      updateNowPlaying();
    });
  });
  body.querySelector('[data-sleep="0"]').classList.add('active');

  const titles = await loadTitles();
  const list = $id('nrOkruhList');
  if (!list || area.slug !== a.slug) return; // medzitým prekreslené/prepnutá oblasť
  list.innerHTML = Array.from({ length: a.count }, (_, i) => i + 1).map((n) => `
    <label class="nr-okruh">
      <input type="checkbox" data-n="${n}" ${selection.has(n) ? 'checked' : ''}>
      <span>${n}. ${escapeHtml(titles[n])}</span>
    </label>`).join('');

  list.querySelectorAll('input[data-n]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const n = Number(cb.dataset.n);
      if (cb.checked) selection.add(n); else selection.delete(n);
      saveSelection();
    });
  });
  $id('nrAllBtn').addEventListener('click', () => {
    for (let n = 1; n <= a.count; n++) selection.add(n);
    saveSelection();
    list.querySelectorAll('input[data-n]').forEach((cb) => { cb.checked = true; });
  });
  $id('nrNoneBtn').addEventListener('click', () => {
    selection.clear();
    saveSelection();
    list.querySelectorAll('input[data-n]').forEach((cb) => { cb.checked = false; });
  });
}

function render() {
  const body = $id('nightRecapBody');
  if (!body) return;
  /* Expirácia počas počúvania prúd NEZASTAVÍ (v noci by to bolo kruté) –
     kontroluje sa pri renderi a pri štarte prúdu. */
  if (isUnlocked()) renderUnlocked(body);
  else renderLocked(body);
}

/* ---------- INIT ---------- */
function init() {
  if (!$id('nightRecapCard')) return;
  loadSelection();
  wirePlayer();
  /* poradie je dôležité: loadUnlock synchrónne načíta cache odomknutia
     (až jeho DB časť je async), takže render už kreslí správny stav */
  loadUnlock();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
