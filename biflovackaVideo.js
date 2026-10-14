'use strict';

/* ============================================================
   biflovackaVideo.js (v3)
   In-app "video režim" pre Bifľovačku – definícia sa premieta cez
   celoobrazovkový prehrávač: avatar-moderátor (celá postava, náhodne
   vybraný z talárových avatarov pri každom spustení) stojí NA OKRAJI
   (strieda strany podľa párnosti defIndex), text je na druhej strane.
   Text sa odkrýva po písmenkách (alebo po vetách) synchronizovane
   s TTS hlasom prispôsobeným pohlaviu moderátora.

   Dve prehratia na definíciu (videoPlays 1/2, spravuje volajúci
   v memory-trainer.html – zdieľané so žolíkom "Video znova"):
   1. zadarmo/full, 2. za energiu (canReplay/onRequestReplay)/tired, ku
   koncu (posledná ~1/4 textu) sa moderátor prepne na sleep a hlas
   stíchne. Po 2. prehratí je "Znova" natrvalo zamknuté.
============================================================ */

import { speakText } from './memoryTrainer.js';
import { getAvatarCatalog, getRandomTalarAvatar, avatarStateSrc, getAvatarGender } from './scripts/avatarCatalog.js';
import { ECONOMY_CONFIG } from './scripts/economy.js';
import { renderSource } from './scripts/sourceUtil.js';

const SLEEPY_OUTRO = true;
const TEXT_MODE_KEY = 'bfVideoTextMode';       // 'letters' | 'sentences'
const VOICE_OVERRIDE_KEY = 'bfVideoVoiceOverride'; // 'f' | 'm' | null (auto)

let overlayEl = null;
let ttsController = null;
let muted = false;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function getTextMode() {
  if (prefersReducedMotion()) return 'sentences';
  const stored = localStorage.getItem(TEXT_MODE_KEY);
  return stored === 'sentences' ? 'sentences' : 'letters';
}

function setTextMode(mode) {
  localStorage.setItem(TEXT_MODE_KEY, mode);
}

/* Rozdelenie na vety podľa '. ' – posledný fragment ostáva ako je
   (zvyčajne už má vlastnú koncovú interpunkciu). */
function splitSentences(text) {
  return String(text || '')
    .split(/\.\s+/)
    .map((s, i, arr) => (i < arr.length - 1 ? `${s}.` : s))
    .map(s => s.trim())
    .filter(Boolean);
}

function estimateMs(sentence) {
  const words = sentence.trim().split(/\s+/).filter(Boolean).length || 1;
  return Math.max(600, words * 380);
}

function preloadModerator(mod) {
  if (!mod) return;
  ['full', 'tired', 'sleep'].forEach(state => {
    new Image().src = avatarStateSrc(mod, state);
  });
}

/* ============================================================
   HLAS podľa pohlavia moderátora. sk → cs (blízky fallback) →
   predvolený. Bez rodovo rozlíšiteľného hlasu sa rozdiel naznačí
   výškou hlasu (pitch): žena +0.2, muž −0.2 oproti základu 1.
============================================================ */
let voicesReadyPromise = null;
export function ensureVoicesLoaded() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  if (voicesReadyPromise) return voicesReadyPromise;

  voicesReadyPromise = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) { resolve(existing); return; }
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    // Poistka – niektoré prehliadače voiceschanged nevystavia vôbec.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 500);
  });
  return voicesReadyPromise;
}

/* Zdieľané rozpoznávanie pohlavia hlasu podľa mena – JEDINÉ miesto s týmito
   vzormi, nech pickVoice() (video – akceptuje substitút) a
   getAvailableSkGenders() (skúška – prísnejšia politika, viď statnice.js)
   nikdy nemôžu tvrdiť dve rôzne veci o tom istom hlase. */
const FEMALE_VOICE_HINT = /female|žen|zuzana|katarína|iveta|google.*žensk/i;
const MALE_VOICE_HINT = /male|muž|filip|tomáš|google.*mužsk/i;

export function pickVoice(gender) {
  const voices = window.speechSynthesis.getVoices();
  const sk = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('sk'));
  const cs = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('cs'));
  const pool = sk.length ? sk : (cs.length ? cs : voices);

  const hint = gender === 'f' ? FEMALE_VOICE_HINT : MALE_VOICE_HINT;

  const match = pool.find(v => hint.test(v.name));
  return { voice: match || pool[0] || null, pitch: match ? 1 : (gender === 'f' ? 1.2 : 0.8) };
}

/* Reálne rozlíšiteľné pohlasie MEDZI SK hlasmi tohto zariadenia (podľa mena) –
   na rozdiel od pickVoice() TU sa nič nesimuluje pitch-shiftom. Použi na
   rozhodnutie, či má zmysel ponúknuť voľbu "Mužský/Ženský", alebo len jeden
   neutrálny "Hlas" (viď scripts/statnice.js buildPersonaOverlay). */
export function getAvailableSkGenders() {
  const voices = window.speechSynthesis.getVoices();
  const sk = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('sk'));
  return {
    hasMale: sk.some(v => MALE_VOICE_HINT.test(v.name)),
    hasFemale: sk.some(v => FEMALE_VOICE_HINT.test(v.name))
  };
}

function effectiveGender(baseGender) {
  const override = localStorage.getItem(VOICE_OVERRIDE_KEY);
  return (override === 'f' || override === 'm') ? override : baseGender;
}

async function resolveVoice(baseGender) {
  if (!('speechSynthesis' in window)) return { voice: null, pitch: 1 };
  await ensureVoicesLoaded();
  return pickVoice(effectiveGender(baseGender));
}

/* ============================================================
   TYPEWRITER – odkryv po písmenkách, tempovaný na estimateMs vety.
   'sleepy' (3. prehratie) spomalí druhú polovicu × 1.5.
   onBoundary(charIndex) – ak TTS vystaví 'boundary' event, dobehne
   typewriter na dané miesto, nech sa text a hlas nerozídu.
============================================================ */
function createTypewriter(el, text, { sleepy = false } = {}) {
  const total = text.length;
  el.textContent = '';
  if (!total) return { destroy(){}, onBoundary(){}, finishNow(){} };

  const estMs = estimateMs(text);
  const baseInterval = Math.min(60, Math.max(18, estMs / total));
  let revealed = 0;
  let handle = null;
  let destroyed = false;
  let pausedRemaining = null;

  function intervalAt(pos) {
    return (sleepy && pos > total / 2) ? baseInterval * 1.5 : baseInterval;
  }

  function tick() {
    if (destroyed || revealed >= total) return;
    revealed++;
    el.textContent = text.slice(0, revealed);
    if (revealed < total) handle = setTimeout(tick, intervalAt(revealed));
  }
  handle = setTimeout(tick, intervalAt(0));

  return {
    destroy() { destroyed = true; if (handle) clearTimeout(handle); },
    onBoundary(charIndex) {
      // Ignoruj neskoro doručené 'boundary' eventy počas pauzy (audio
      // API sa niekedy zastaví až o zlomok sekundy neskôr).
      if (destroyed || pausedRemaining !== null || charIndex <= revealed) return;
      revealed = Math.min(total, charIndex);
      el.textContent = text.slice(0, revealed);
    },
    finishNow() {
      if (destroyed) return;
      revealed = total;
      el.textContent = text;
      if (handle) clearTimeout(handle);
    },
    pause() {
      if (destroyed || pausedRemaining !== null) return;
      pausedRemaining = true;
      if (handle) { clearTimeout(handle); handle = null; }
    },
    resume() {
      if (destroyed || pausedRemaining === null) return;
      pausedRemaining = null;
      if (revealed < total) handle = setTimeout(tick, intervalAt(revealed));
    }
  };
}

/* Prehrá vety postupne – reťazenie cez onEnd (spoľahlivejšie ako
   samotný 'boundary' event pri sk-SK hlasoch na riadenie POSTUPU,
   boundary sa použije len na dolaďovanie typewriteru v rámci vety).
   sleepyVolume(idx) – na 3. prehratí hlas postupne stíška. */
function playSentences(sentences, { voice, pitch, sleepy, onSentenceStart, onBoundary, onDone }) {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();

  let idx = 0;
  let cancelled = false;
  let fallbackHandle = null;

  function volumeFor(i) {
    if (muted) return 0;
    if (!sleepy) return 1;
    const progress = i / Math.max(1, sentences.length - 1);
    if (progress < 0.75) return 1;
    const t = (progress - 0.75) / 0.25;
    return Math.max(0.15, 1 - 0.85 * t);
  }

  function next() {
    if (cancelled) return;
    if (idx >= sentences.length) { onDone(); return; }

    const sentence = sentences[idx];
    onSentenceStart(idx, sentence);

    const spoke = speakText(sentence, {
      cancelPrevious: false,
      volume: volumeFor(idx),
      voice, pitch,
      onBoundary: (e) => onBoundary && onBoundary(e && typeof e.charIndex === 'number' ? e.charIndex : 0),
      onEnd: () => { idx++; next(); }
    });

    if (!spoke) {
      fallbackHandle = setTimeout(() => { idx++; next(); }, estimateMs(sentence));
    }
  }

  next();

  return {
    cancel() {
      cancelled = true;
      if (fallbackHandle) clearTimeout(fallbackHandle);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }
  };
}

function buildOverlay(side) {
  const el = document.createElement('div');
  el.className = 'bf-video-overlay';
  el.innerHTML = `
    <div class="bf-video-bg"></div>
    <div class="bf-video-main ${side === 'right' ? 'side-right' : ''}">
      <div class="bf-video-moderator" id="bfVideoModWrap"><img id="bfVideoModImg" alt="Moderátor" /></div>
      <div class="bf-video-content">
        <div class="bf-video-question" id="bfVideoQuestion"></div>
        <div class="bf-video-answer" id="bfVideoAnswer"></div>
        <div class="bf-video-source" id="bfVideoSource"></div>
      </div>
    </div>
    <div class="bf-video-dim" id="bfVideoDim"></div>
    <div class="bf-video-bottom">
      <div class="bf-video-progress"><div class="bf-video-progress-fill" id="bfVideoProgressFill"></div></div>
      <div class="bf-video-controls">
        <button class="btn" id="bfVideoPauseBtn" type="button">⏸️ Pauza</button>
        <button class="btn" id="bfVideoMuteBtn" type="button">🔊</button>
        <button class="btn" id="bfVideoVoiceBtn" type="button" title="Prepnúť hlas, ak automatika zlyhala">🔊 Hlas</button>
        <button class="btn" id="bfVideoTextModeBtn" type="button" title="Štýl odkrývania textu">Aa</button>
        <button class="btn" id="bfVideoCloseBtn" type="button">✕ Zavrieť</button>
      </div>
    </div>
    <div class="bf-video-end" id="bfVideoEnd" style="display:none">
      <div class="bf-video-end-msg" id="bfVideoEndMsg" style="display:none"></div>
      <button class="btn" id="bfVideoReplayBtn" type="button">🔁 Pozrieť znova</button>
      <button class="btn btn-primary" id="bfVideoEndCloseBtn" type="button">✕ Zavrieť</button>
    </div>
  `;
  document.body.appendChild(el);

  // ⚠️ Poistka (2026-07-19): ak PNG moderátora chýba (404 – napr. nekonzistentné
  // premenovanie avatarov v avatars/), NIKDY nenechaj prehliadačovú "rozbitú"
  // ikonku – nahraď dekoratívnym emoji, rovnaký vzor ako fallback komisie
  // v scripts/statnice.js renderCommission.
  const modImg = el.querySelector('#bfVideoModImg');
  if (modImg) {
    modImg.onerror = () => {
      modImg.onerror = null;
      const wrap = document.getElementById('bfVideoModWrap');
      if (wrap) wrap.innerHTML = '<div class="bf-video-moderator-fallback">⚖️</div>';
    };
  }

  return el;
}

function setModeratorState(mod, state) {
  const img = document.getElementById('bfVideoModImg');
  if (img && mod) img.src = avatarStateSrc(mod, state);
}

/* Počiatočný stav moderátora pre dané prehratie – 1. je vždy full,
   2. začína tired a ku koncu (posledná ~1/4) prejde na sleep (viď
   highlightSentence). Max 2 prehratia na definíciu. */
function initialStateForPlay(n) {
  return n >= 2 ? 'tired' : 'full';
}

export async function openVideoPlayer({
  question, reference, zdroj = null, defIndex = 0, playNumber = 1,
  canReplay, onRequestReplay,
  onExit
} = {}) {
  closeVideoPlayer();

  const catalog = await getAvatarCatalog();
  const moderator = getRandomTalarAvatar(catalog);
  preloadModerator(moderator);
  const baseGender = getAvatarGender(moderator);
  let { voice, pitch } = await resolveVoice(baseGender);

  const sentences = splitSentences(reference);
  let paused = false;
  let curPlayNumber = playNumber;
  let sentenceTypewriter = null;
  let moderatorState = initialStateForPlay(curPlayNumber);

  const side = defIndex % 2 === 0 ? 'left' : 'right';
  overlayEl = buildOverlay(side);
  document.body.style.overflow = 'hidden';

  document.getElementById('bfVideoQuestion').textContent = question || '';
  const answerEl = document.getElementById('bfVideoAnswer');
  answerEl.innerHTML = sentences.map((s, i) =>
    `<span class="bf-sentence" data-idx="${i}"></span>`
  ).join(' ');
  document.getElementById('bfVideoSource').innerHTML = renderSource(zdroj);

  const progressFill = document.getElementById('bfVideoProgressFill');
  const endBox = document.getElementById('bfVideoEnd');
  const endMsg = document.getElementById('bfVideoEndMsg');
  const dimEl = document.getElementById('bfVideoDim');
  const pauseBtn = document.getElementById('bfVideoPauseBtn');
  const muteBtn = document.getElementById('bfVideoMuteBtn');
  const voiceBtn = document.getElementById('bfVideoVoiceBtn');
  const textModeBtn = document.getElementById('bfVideoTextModeBtn');
  const replayBtn = document.getElementById('bfVideoReplayBtn');
  const endCloseBtn = document.getElementById('bfVideoEndCloseBtn');
  muteBtn.textContent = muted ? '🔇' : '🔊';

  if (prefersReducedMotion()) {
    textModeBtn.disabled = true;
    textModeBtn.title = 'Vypnuté kvôli nastaveniu obmedzeného pohybu.';
  }
  textModeBtn.textContent = getTextMode() === 'letters' ? 'Aa' : '¶';

  function highlightSentence(idx, sentenceText) {
    if (sentenceTypewriter) sentenceTypewriter.destroy();
    answerEl.querySelectorAll('.bf-sentence').forEach(node => node.classList.remove('active'));

    for (let i = 0; i < idx; i++) {
      const node = answerEl.querySelector(`[data-idx="${i}"]`);
      if (node) { node.classList.add('done'); node.textContent = sentences[i]; }
    }

    const progress = idx / Math.max(1, sentences.length);
    const nearEnd = curPlayNumber === 2 && progress >= 0.75;
    if (nearEnd && moderatorState !== 'sleep') {
      moderatorState = 'sleep';
      setModeratorState(moderator, moderatorState);
    }

    const cur = answerEl.querySelector(`[data-idx="${idx}"]`);
    if (cur) {
      cur.classList.add('active');
      cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (getTextMode() === 'letters') {
        sentenceTypewriter = createTypewriter(cur, sentenceText, { sleepy: nearEnd && SLEEPY_OUTRO });
      } else {
        cur.textContent = sentenceText;
      }
    }
    progressFill.style.width = `${Math.round(progress * 100)}%`;
  }

  function finish() {
    if (sentenceTypewriter) { sentenceTypewriter.finishNow(); }
    progressFill.style.width = '100%';
    answerEl.querySelectorAll('.bf-sentence').forEach((node, i) => {
      node.classList.remove('active');
      node.classList.add('done');
      node.textContent = sentences[i];
    });
    if (curPlayNumber >= 2) moderatorState = 'sleep';
    setModeratorState(moderator, moderatorState);

    if (curPlayNumber >= 2 && SLEEPY_OUTRO) {
      dimEl.classList.add('active');
      endMsg.textContent = '😴 Definícia sa uložila do pamäte – pokračuj v odpovedacej fáze';
      endMsg.style.display = 'block';
    } else {
      dimEl.classList.remove('active');
      endMsg.style.display = 'none';
    }

    updateEndScreen();
    endBox.style.display = 'flex';
  }

  async function updateEndScreen() {
    if (curPlayNumber >= 2) {
      replayBtn.style.display = 'none';
      return;
    }
    replayBtn.style.display = 'inline-flex';
    replayBtn.disabled = true;
    /* E3: stojí energiu, nie 🪙 (predtým SINKS.BIFLOVACKA_VIDEO_REPLAY, 2 🪙). */
    replayBtn.textContent = `🔁 Pozrieť znova (⚡ ${Math.abs(ECONOMY_CONFIG.ENERGY.JOKER_VIDEO)})`;
    replayBtn.title = '';
    if (!canReplay) return;
    const check = await canReplay();
    if (check && check.allowed) {
      replayBtn.disabled = false;
    } else {
      replayBtn.disabled = true;
      replayBtn.title = (check && check.reason) || 'Nedostatok energie.';
    }
  }

  function start() {
    endBox.style.display = 'none';
    dimEl.classList.remove('active');
    paused = false;
    pauseBtn.textContent = '⏸️ Pauza';
    moderatorState = initialStateForPlay(curPlayNumber);
    setModeratorState(moderator, moderatorState);
    ttsController = playSentences(sentences, {
      voice, pitch, sleepy: curPlayNumber === 2 && SLEEPY_OUTRO,
      onSentenceStart: (idx, text) => highlightSentence(idx, text),
      onBoundary: (charIndex) => { if (sentenceTypewriter) sentenceTypewriter.onBoundary(charIndex); },
      onDone: finish
    });
  }

  start();

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    if (paused) {
      if ('speechSynthesis' in window) window.speechSynthesis.pause();
      if (sentenceTypewriter) sentenceTypewriter.pause();
      pauseBtn.textContent = '▶️ Pokračovať';
    } else {
      if ('speechSynthesis' in window) window.speechSynthesis.resume();
      if (sentenceTypewriter) sentenceTypewriter.resume();
      pauseBtn.textContent = '⏸️ Pauza';
    }
  });

  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  voiceBtn.addEventListener('click', async () => {
    const current = effectiveGender(baseGender);
    const next = current === 'f' ? 'm' : 'f';
    localStorage.setItem(VOICE_OVERRIDE_KEY, next);
    ({ voice, pitch } = await resolveVoice(baseGender));
    voiceBtn.textContent = next === 'f' ? '🔊 Ženský ✓' : '🔊 Mužský ✓';
    setTimeout(() => { voiceBtn.textContent = '🔊 Hlas'; }, 1400);
  });

  textModeBtn.addEventListener('click', () => {
    if (prefersReducedMotion()) return;
    const next = getTextMode() === 'letters' ? 'sentences' : 'letters';
    setTextMode(next);
    textModeBtn.textContent = next === 'letters' ? 'Aa' : '¶';
  });

  document.getElementById('bfVideoCloseBtn').addEventListener('click', () => {
    closeVideoPlayer();
    if (onExit) onExit();
  });

  replayBtn.addEventListener('click', async () => {
    if (replayBtn.disabled || !onRequestReplay) return;
    replayBtn.disabled = true;
    const result = await onRequestReplay();
    if (!result || !result.ok) { await updateEndScreen(); return; }
    curPlayNumber = result.playNumber;
    start();
  });

  endCloseBtn.addEventListener('click', () => {
    closeVideoPlayer();
    if (onExit) onExit();
  });
}

export function closeVideoPlayer() {
  if (ttsController) { ttsController.cancel(); ttsController = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  document.body.style.overflow = '';
}
