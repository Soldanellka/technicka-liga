'use strict';

/* ============================================================
   scripts/spiderGames.js — HRY V STROME OKRUHU (edukačné, nehodnotené)
   Samostatný modul, nezávislý od spider.js aj spiderMap.js
   (spider.js SA NEDOTÝKA). Volá sa výhradne lazy importom zo
   spiderMap.js (openOkruhTree, keepUnderneath blok) – rovnaký
   containment vzor ako spiderRelated.js.

   Verejné exporty:
     - mountLauncher(panel, areaTitle, okruhCislo) – vykreslí sekciu
       .spiderGameSec s tlačidlami hier; JEDINÝ vstup zo spiderMap.js.
       Pribúdanie hier už spiderMap.js patch nemení – len tento modul.
     - startCuckoo(areaTitle, okruhCislo, panel) – ostáva exportovaná
       (spätná kompatibilita), funkčne identická s v1, len čerpá zo
       zdieľaných helperov.

   Hry:
     🐦 Kukučka     – v jednej vetve okruhu je premiešaných niekoľko jej
                      listov + 1 cudzí list (z iného okruhu klastra);
                      hráč hľadá cudzí. Skóre = trafenia na prvý pokus.
     🧩 Rozpárovanie – listy z DVOCH vetiev toho istého okruhu sú
                      zmiešané; hráč každý list priradí do správnej
                      vetvy (klik-list → klik-vetva). Skóre = kolá bez
                      chyby.

   AREA_PATHS je DUPLIKOVANÉ (rovnaký vzor ako spider.js/spiderMap.js/
   spiderRelated.js – menší blast radius než zdieľanie cez import;
   existujúce fetch funkcie tam nie sú exportované). Fetch cesta aj tvar
   dát (_map.json {clusters[]}, A{n}.json {spider.branches[].leaves[]})
   sú prevzaté 1:1 z týchto modulov, nič sa nehádalo.

   Žiadny Firebase, žiadny localStorage, žiadny server, žiadny progres –
   rovnako ako spider.js/spiderMap.js ide o nehodnotenú pomôcku. Stav
   sedenia je výlučne v lokálnych premenných closure jednotlivých hier;
   jediný pretrvávajúci stav je okruhCache (memoizácia fetchu okruhov).

   Farby/štýly: vlastný injektovaný <style> (ensureGameCss), rovnaký
   prístup ako ensureRelatedCss v spiderRelated.js (CSS premenné +
   dark-theme override), nezávislý od spider-map palety.
============================================================ */

/* ZÁMERNE relatívna cesta – demo nesmie ťahať obsah z produkčnej domény. */
const LIVE = '';
const AREA_PATHS = {
  'Osobné financie': LIVE + 'data/',
  'Investovanie': LIVE + 'data/invest/',
  'Makroekonómia': LIVE + 'data/makro/',
  // ⏳ dočasná téma, viď README-DEMO.md
  'Číselné sústavy': LIVE + 'data/ciselne/',
  'Logické funkcie': LIVE + 'data/logika/',
  'Počítačové siete': LIVE + 'data/siete/',
  'Elektrotechnika': LIVE + 'data/elektro/',
  'Fyzika': LIVE + 'data/fyzika/'
};

const ROUNDS = 5;

/* ---- zdieľané dátové utility (module-scope) --------------------------- */

/* Fetch A{n}.json / _map.json – identický vzor ako spider.js
   fetchTopicJson / spiderMap.js fetchMapJson (basePath + key + '.json').
   Vracia parsovaný JSON alebo null (fail-soft, len console.warn). */
async function fetchJson(areaKey, key) {
  const basePath = AREA_PATHS[areaKey];
  if (!basePath) {
    console.warn(`[HRY] Neznáma areaTitle "${areaKey}", basePath sa nedá určiť.`);
    return null;
  }
  try {
    const res = await fetch(`${basePath}${key}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[HRY] fetch zlyhal:', key, e);
    return null;
  }
}

/* Vetvy okruhu v tvare [{ label, leaves: string[] }] – rovnaká
   normalizácia ako buildBranches v spider.js (filtrovanie prázdnych),
   ale BEZ tiles fallbacku: hry potrebujú reálne listy vo vetvách,
   hviezdica z tiles (leaves=[]) je nepoužiteľná. */
function branchesOf(json) {
  if (json && json.spider && Array.isArray(json.spider.branches)) {
    return json.spider.branches
      .filter(b => b && b.label)
      .map(b => ({ label: b.label, leaves: Array.isArray(b.leaves) ? b.leaves.filter(Boolean) : [] }));
  }
  return [];
}

/* Krátky názov okruhu pre hlášku "patrí do okruhu: ..." (Kukučka) –
   rovnaké poradie preferencií ako fetchOkruhTitle v spiderMap.js. */
function okruhTitleOf(json, n) {
  return (json && (json.title || json.spider?.center)) || `A${n}`;
}

function randOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* Fisher–Yates (nemutuje vstup). */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* Memoizácia okruhov naprieč hrami aj okruhmi (prežije medzi sedeniami
   v tej istej relácii). Kľúč `${areaTitle}:${n}` – rôzne oblasti majú
   vlastné A{n}.json. */
const okruhCache = new Map(); // `${areaTitle}:${n}` -> { branches, title }

/* Zneplatní memoizovaný okruh – volá spiderEditor po uložení admin override,
   inak by hry ostali na starých dátach do reloadu (strom nové, hry staré).
   Exportované aj na window (editor ho volá bez importu, len ak je modul
   načítaný). */
export function invalidateOkruhCache(areaTitle, n) {
  okruhCache.delete(`${areaTitle}:${n}`);
}
if (typeof window !== 'undefined') window.invalidateOkruhCache = invalidateOkruhCache;

async function getOkruh(areaTitle, n) {
  const cacheKey = `${areaTitle}:${n}`;
  if (okruhCache.has(cacheKey)) return okruhCache.get(cacheKey);
  let json = await fetchJson(areaTitle, `A${n}`);
  // Admin spider override (Etapa 2) – navrství sa PRED cache entry, fail-soft.
  try {
    const { applySpiderOverride } = await import('./spiderOverrides.js');
    json = await applySpiderOverride(json, areaTitle, n);
  } catch (e) { console.warn('[HRY] spider override zlyhal – originál', e); }
  const title = okruhTitleOf(json, n);
  // seal = stopa poslednej admin úpravy pavúka (Krok 3); null ak nebol override.
  const entry = { branches: branchesOf(json), title, center: (json && json.spider?.center) || title, seal: (json && json.spider?._seal) || null };
  okruhCache.set(cacheKey, entry);
  return entry;
}

/* ---- zdieľaný UI skelet (module-scope) ------------------------------- */

/* #spiderTreeHost / #spiderDetailHost patria spider.js Z3 modalu. Počas
   hry sa skryjú, po návrate obnovia. Obnova nastavuje display='' (default
   viditeľný) namiesto pamätania predošlej hodnoty – tieto hosty sú mimo
   hry vždy viditeľné a inline display na nich spider.js nenastavuje,
   takže '' je korektné a odolné voči opakovaným mountom (žiadne riziko
   "zapamätania" hodnoty 'none' z prebiehajúcej hry). */
function hideTree() {
  const t = document.getElementById('spiderTreeHost');
  const d = document.getElementById('spiderDetailHost');
  if (t) t.style.display = 'none';
  if (d) d.style.display = 'none';
}
function restoreTree() {
  const t = document.getElementById('spiderTreeHost');
  const d = document.getElementById('spiderDetailHost');
  if (t) t.style.display = '';
  if (d) d.style.display = '';
}

/* Idempotentné rozlíšenie sekcie hry v paneli. */
function resolveSec(panel) {
  let sec = panel.querySelector('.spiderGameSec');
  if (!sec) {
    sec = document.createElement('div');
    sec.className = 'spiderGameSec';
    panel.appendChild(sec);
  }
  return sec;
}

/* Chybová obrazovka – obnoví strom a ponúkne návrat cez onBack
   (spravidla mountLauncher). */
function showError(sec, msg, onBack) {
  restoreTree();
  sec.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'spider-game-error';
  box.textContent = msg;
  const back = document.createElement('button');
  back.className = 'btn';
  back.style.width = '100%';
  back.style.marginTop = '10px';
  back.textContent = '← Späť na strom';
  back.onclick = onBack;
  sec.append(box, back);
}

/* Spoločný koniec sedenia – text výsledku aj oba callbacky sú
   parametrizované, takže ho zdieľajú obe hry. */
function renderSessionEnd(sec, { title, scoreText, onAgain, onBack, backText = '← Späť na strom' }) {
  hideTree();
  sec.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'spider-game-header';
  header.textContent = title;
  const score = document.createElement('div');
  score.className = 'spider-game-score';
  score.textContent = scoreText;

  const again = document.createElement('button');
  again.className = 'btn';
  again.style.width = '100%';
  again.textContent = '↻ Hrať znova';
  again.onclick = onAgain;

  const back = document.createElement('button');
  back.className = 'btn';
  back.style.width = '100%';
  back.style.marginTop = '8px';
  back.textContent = backText;
  back.onclick = onBack;

  sec.append(header, score, again, back);
}

/* ============================================================
   ENERGETICKÝ GATE – jednotné pravidlo „avatar spí = nič interaktívne".
   Rovnaký pre všetkých 5 hier (aj pre Recall/Blesk, ktoré energiu nemíňajú
   ani nedávajú § – gate je ich jediná ekonomická väzba).

   Vracia true = hrať sa smie. Pri spiacom avatarovi (energia ≤ 0) vráti
   false a hlášku „😴 Avatar spí! Nakŕm ho za 12§…" zobrazí canPlayDuel()
   SÁM – tu sa preto nič nedopĺňa (žiadny druhý toast).

   FAIL-SOFT: ak import alebo volanie ekonomiky zlyhá, hru PUSTÍME –
   výpadok ekonomiky nesmie zablokovať učenie.
============================================================ */
async function canPlaySpiderGame() {
  try {
    const econ = await import('./economy.js');
    return await econ.econCanPlay('spider');
  } catch (e) {
    console.warn('[HRY] energetický gate zlyhal – hra pokračuje', e);
    return true;
  }
}

/* ============================================================
   EKONOMIKA PAVÚKOVÝCH HIER (Etapa 2) – lazy import, FAIL-SOFT.
   Volá sa z KONCOVEJ obrazovky Kukučky/Rozpárovania/Kde som? (dosiahnutie
   renderSessionEnd = dokončené sedenie). Energia −2 aj pri 0 skóre; § len za
   výsledok cez econSpiderGameReward. Pád / nedostupnosť ekonomiky NIKDY nezhodí
   hru – § sa len nepripíšu a poznámka sa nezobrazí. Presnú sumu (+X§) toastuje
   econAward sám; sem pridáme len krátku poznámku do už vykreslenej obrazovky.
   Recall a Blesk túto funkciu NEVOLAJÚ (bez § a energie – vylúčené rozhodnutím).
============================================================ */
function spiderResultNote(outcome) {
  switch (outcome) {
    case 'full':
    case 'near':         return '💰 Odmena za sedenie pripísaná.';
    case 'okruh_played': return 'Tento okruh dnes už bol odmenený – 🪙 sa nepripísali.';
    case 'daily_max':    return 'Dnešný limit odmenených hier je vyčerpaný – 🪙 sa nepripísali.';
    case 'zero_score':   return 'Bez odmeny – nabudúce skús vyššie skóre.';
    default:             return '';   // 'no_user' / neznáme / pád → nič nezobrazíme
  }
}

function runSpiderEconomy(sec, gameId, score, okruhKey) {
  // Fire-and-forget: nemeníme signatúru ani logiku herných funkcií. Po dokončení
  // sedenia doplníme ekonomiku a poznámku do už vykreslenej koncovej obrazovky.
  (async () => {
    try {
      const nick = localStorage.getItem('playerNick');
      const econ = await import('./economy.js');
      // Energia −2 pri KAŽDOM dokončenom sedení (spresnenie 5), aj pri 0 skóre.
      // Berie sa aj anonymovi (A1) – econEnergy rieši null nick sama.
      econ.econEnergy(nick, econ.ECONOMY_CONFIG.ENERGY.SPIDER_GAME, `pavúková hra – ${gameId}`);
      if (!nick) return;   // § za sedenie sú za nickom (econSpiderGameReward)
      const outcome = await econ.econSpiderGameReward(gameId, score, okruhKey);
      const note = spiderResultNote(outcome);
      if (note && sec && sec.isConnected) {
        const el = document.createElement('div');
        el.style.cssText = 'margin:2px 0 12px;font-size:14px;font-weight:600;color:var(--muted,#667);';
        el.textContent = note;
        const scoreEl = sec.querySelector('.spider-game-score');
        if (scoreEl && scoreEl.parentNode === sec) scoreEl.after(el);
        else sec.append(el);
      }
    } catch (e) {
      console.warn('[SPIDER] ekonomika zlyhala (hra pokračuje bez 🪙):', e);
    }
  })();
}

function ensureGameCss() {
  if (document.getElementById('spider-games-css')) return;
  const style = document.createElement('style');
  style.id = 'spider-games-css';
  style.textContent = `
    .spiderGameSec { margin-top: 12px; }
    .spider-game-header { font-size: 14px; font-weight: 700; color: var(--text, #14262c); margin-bottom: 4px; }
    .spider-game-hint { font-size: 12px; color: var(--muted, #6b7280); margin-bottom: 10px; }
    .spider-game-cards { display: flex; flex-direction: column; gap: 8px; }
    .spider-game-card {
      display: block; width: 100%; text-align: left; box-sizing: border-box;
      background: var(--surface, #fff); border: 1px solid var(--card-border, rgba(0,0,0,0.12));
      border-radius: 10px; padding: 10px 12px; font: inherit; font-size: 12px; line-height: 1.35;
      color: var(--text, #14262c); cursor: pointer; min-height: 44px; max-height: 7em; overflow: auto;
    }
    .spider-game-card:hover:not(:disabled) { border-color: var(--accent-3, #0f6ea8); }
    .spider-game-card:disabled { cursor: default; }
    .spider-game-card-correct { background: #d7f4dd; border-color: #38a169; }
    .spider-game-card-cuckoo { background: #d7f4dd; border-color: #38a169; box-shadow: 0 0 0 2px rgba(56,161,105,0.4); }
    .spider-game-card-wrong { background: #fbdce0; border-color: #e15563; }
    .spider-game-card-locked { opacity: 0.55; }
    .spider-game-feedback { font-size: 12px; margin-top: 10px; min-height: 1.2em; }
    .spider-game-feedback-ok { color: #2f855a; font-weight: 600; }
    .spider-game-feedback-bad { color: #c53030; font-weight: 600; }
    .spider-game-nextwrap { margin-top: 10px; }
    .spider-game-endbtn { margin-top: 8px; }
    .spider-game-score { font-size: 22px; font-weight: 800; color: var(--accent-3, #0f6ea8); margin: 6px 0 12px; }
    .spider-game-loading { font-size: 12px; color: var(--muted, #6b7280); padding: 10px 0; }
    .spider-game-error { font-size: 12px; color: #c53030; padding: 8px 0; }
    /* --- Rozpárovanie --- */
    .spider-game-bins { display: flex; gap: 10px; margin-bottom: 12px; }
    .spider-game-bin { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .spider-game-col {
      width: 100%; box-sizing: border-box; text-align: center; font: inherit; font-size: 12px; font-weight: 700;
      padding: 8px 10px; border-radius: 10px; cursor: pointer; overflow-wrap: break-word;
      background: var(--surface, #fff); border: 1px solid var(--card-border, rgba(0,0,0,0.12)); color: var(--text, #14262c);
    }
    .spider-game-col:hover { border-color: var(--accent-3, #0f6ea8); }
    .spider-game-slot {
      display: flex; flex-direction: column; gap: 6px; min-height: 44px; padding: 6px;
      border: 1px dashed var(--card-border, rgba(0,0,0,0.18)); border-radius: 10px;
    }
    .spider-game-card-selected { border-color: var(--accent-3, #0f6ea8); box-shadow: 0 0 0 2px rgba(15,110,168,0.45); }
    .spider-game-card-assigned {
      background: #d7f4dd; border-color: #38a169; font-size: 11px; padding: 6px 8px;
      min-height: 0; max-height: none; opacity: 1; cursor: default;
    }
    .spider-game-card-wrong-blink { background: #fbdce0; border-color: #e15563; }
    :root[data-theme="dark"] .spider-game-header { color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-game-card { background: var(--surface, #1c2430); border-color: rgba(255,255,255,0.12); color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-game-card-correct { background: #1f4a38; border-color: #38a169; }
    :root[data-theme="dark"] .spider-game-card-cuckoo { background: #1f4a38; border-color: #38a169; }
    :root[data-theme="dark"] .spider-game-card-wrong { background: #5a2c3a; border-color: #e15563; }
    :root[data-theme="dark"] .spider-game-col { background: var(--surface, #1c2430); border-color: rgba(255,255,255,0.12); color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-game-slot { border-color: rgba(255,255,255,0.18); }
    :root[data-theme="dark"] .spider-game-card-assigned { background: #1f4a38; border-color: #38a169; }
    :root[data-theme="dark"] .spider-game-card-wrong-blink { background: #5a2c3a; border-color: #e15563; }
    /* --- Kde som? --- */
    .spider-game-subhead { font-size: 13px; font-weight: 700; color: var(--text, #14262c); margin: 4px 0 8px; }
    .spider-game-card-static {
      display: block; width: 100%; box-sizing: border-box; text-align: left;
      background: var(--surface, #fff); border: 1px solid var(--card-border, rgba(0,0,0,0.12));
      border-radius: 10px; padding: 8px 10px; font-size: 12px; line-height: 1.35;
      color: var(--text, #14262c); max-height: 7em; overflow: auto; cursor: default;
    }
    .spider-game-cluster-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .spider-game-col-correct { background: #d7f4dd; border-color: #38a169; }
    .spider-game-col-wrong { background: #fbdce0; border-color: #e15563; opacity: 0.7; }
    :root[data-theme="dark"] .spider-game-subhead { color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-game-card-static { background: var(--surface, #1c2430); border-color: rgba(255,255,255,0.12); color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-game-col-correct { background: #1f4a38; border-color: #38a169; }
    :root[data-theme="dark"] .spider-game-col-wrong { background: #5a2c3a; border-color: #e15563; }
    /* --- Recall --- */
    .spider-game-card-hidden {
      display: flex; align-items: center; justify-content: center; width: 100%; box-sizing: border-box;
      background: var(--bg, #f5faf9); border: 1px dashed var(--card-border, rgba(0,0,0,0.18));
      border-radius: 10px; padding: 12px; min-height: 44px; font-size: 16px; font-weight: 700;
      color: var(--muted, #6b7280);
    }
    .spider-game-selfcheck { display: flex; gap: 8px; margin-top: 8px; }
    .spider-game-selfcheck .btn { flex: 1 1 0; }
    .spider-game-revealed { margin-top: 8px; }
    .spider-game-revealed-label { font-size: 13px; font-weight: 700; color: var(--text, #14262c); margin-bottom: 6px; }
    .spider-game-linkbtn {
      background: none; border: none; padding: 4px 0; font: inherit; font-size: 12px;
      color: var(--accent-3, #0f6ea8); cursor: pointer; text-align: left;
    }
    .spider-game-leaf-static {
      display: block; width: 100%; box-sizing: border-box; text-align: left; margin-top: 6px;
      background: var(--surface, #fff); border: 1px solid var(--card-border, rgba(0,0,0,0.12));
      border-radius: 8px; padding: 6px 8px; font-size: 11px; line-height: 1.35; color: var(--text, #14262c);
    }
    .spider-game-missed { margin: 8px 0 12px; }
    .spider-game-missed-head { font-size: 12px; font-weight: 700; color: var(--muted, #6b7280); margin-bottom: 4px; }
    .spider-game-missed-item { font-size: 12px; color: var(--muted, #6b7280); padding: 2px 0; }
    :root[data-theme="dark"] .spider-game-card-hidden { background: var(--bg, #141b24); border-color: rgba(255,255,255,0.18); color: var(--muted, #9aa7b4); }
    :root[data-theme="dark"] .spider-game-revealed-label { color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-game-leaf-static { background: var(--surface, #1c2430); border-color: rgba(255,255,255,0.12); color: var(--text, #e6eef6); }
    /* --- Blesk --- */
    .spider-game-countdown { font-size: 28px; font-weight: 800; text-align: center; color: var(--accent-3, #0f6ea8); margin: 8px 0 12px; }
    .spider-game-studyitem {
      display: block; width: 100%; box-sizing: border-box; text-align: left;
      background: var(--surface, #fff); border: 1px solid var(--card-border, rgba(0,0,0,0.12));
      border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; line-height: 1.35;
      color: var(--text, #14262c);
    }
    :root[data-theme="dark"] .spider-game-countdown { color: var(--accent-3, #ff9db5); }
    :root[data-theme="dark"] .spider-game-studyitem { background: var(--surface, #1c2430); border-color: rgba(255,255,255,0.12); color: var(--text, #e6eef6); }
    /* --- Hlasový Recall --- */
    .spider-game-mic { margin-top: 10px; }
    .spider-game-mic-on { outline: 2px solid var(--accent-3, #0f6ea8); }
    .spider-game-card-hidden-voice { justify-content: space-between; gap: 8px; }
    .spider-game-saidbtn {
      flex-shrink: 0; background: none; border: 1px solid var(--card-border, rgba(0,0,0,0.18));
      border-radius: 8px; padding: 4px 8px; font: inherit; font-size: 11px;
      color: var(--muted, #6b7280); cursor: pointer;
    }
    .spider-game-saidbtn:hover { border-color: #38a169; color: #2f855a; }
    .spider-game-card-hint { display: block; text-align: left; }
    .spider-game-hintline { font-size: 12px; font-style: italic; color: var(--text, #14262c); overflow-wrap: break-word; }
    .spider-game-hinttoggle { display: flex; gap: 6px; margin: 0 0 8px; }
    .spider-game-hinttoggle button {
      flex: 1 1 0; font: inherit; font-size: 11px; padding: 4px 8px;
      background: var(--surface, #fff); border: 1px solid var(--card-border, rgba(0,0,0,0.12));
      border-radius: 8px; color: var(--muted, #6b7280); cursor: pointer;
    }
    .spider-game-hinttoggle .spider-game-hinttoggle-active { border-color: var(--accent-3, #0f6ea8); color: var(--text, #14262c); font-weight: 700; }
    :root[data-theme="dark"] .spider-game-saidbtn { border-color: rgba(255,255,255,0.18); color: var(--muted, #9aa7b4); }
    :root[data-theme="dark"] .spider-game-hintline { color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-game-hinttoggle button { background: var(--surface, #1c2430); border-color: rgba(255,255,255,0.12); color: var(--muted, #9aa7b4); }
    :root[data-theme="dark"] .spider-game-hinttoggle .spider-game-hinttoggle-active { border-color: var(--accent-3, #ff9db5); color: var(--text, #e6eef6); }
  `;
  document.head.appendChild(style);
}

/* ---- launcher (jediný vstup zo spiderMap.js) ------------------------- */

/* Idempotentne (starú .spiderGameSec zmaže) vykreslí sekciu hier s
   tlačidlami. Všetky návraty z hier volajú túto funkciu späť. */
export function mountLauncher(panel, areaTitle, okruhCislo, onSpiderSaved) {
  if (!panel) return;
  ensureGameCss();
  const existing = panel.querySelector('.spiderGameSec');
  if (existing) existing.remove();
  const sec = document.createElement('div');
  sec.className = 'spiderGameSec';
  panel.appendChild(sec);
  restoreTree();

  const cuckooBtn = document.createElement('button');
  cuckooBtn.className = 'btn';
  cuckooBtn.style.width = '100%';
  cuckooBtn.style.marginTop = '10px';
  cuckooBtn.textContent = '🐦 Kukučka';
  cuckooBtn.onclick = () => startCuckoo(areaTitle, okruhCislo, panel);

  const rozBtn = document.createElement('button');
  rozBtn.className = 'btn';
  rozBtn.style.width = '100%';
  rozBtn.style.marginTop = '8px';
  rozBtn.textContent = '🧩 Rozpárovanie';
  rozBtn.onclick = () => startRozparovanie(areaTitle, okruhCislo, panel);

  const recallBtn = document.createElement('button');
  recallBtn.className = 'btn';
  recallBtn.style.width = '100%';
  recallBtn.style.marginTop = '8px';
  recallBtn.textContent = '🧠 Recall';
  recallBtn.onclick = () => startRecall(areaTitle, okruhCislo, panel);

  const bleskBtn = document.createElement('button');
  bleskBtn.className = 'btn';
  bleskBtn.style.width = '100%';
  bleskBtn.style.marginTop = '8px';
  bleskBtn.textContent = '⚡ Blesk';
  bleskBtn.onclick = () => startBlesk(areaTitle, okruhCislo, panel);

  sec.append(cuckooBtn, rozBtn, recallBtn, bleskBtn);

  // ✏️ Admin/garant: editor pavúka (Etapa 2). Fire-and-forget; tlačidlo pribudne
  // až po overení skutočnej Firebase roly (getRole), ostatní ho neuvidia.
  mountSpiderEditButton(sec, areaTitle, okruhCislo, onSpiderSaved);

  // Stopa poslednej úpravy pavúka (Krok 3) – pre VŠETKÝCH, nielen adminov.
  // Býva v .spiderGameSec, ktorú mountLauncher stavia nanovo → idempotentné,
  // a spider.js sa nedotýka (jeho render ostáva nezmenený).
  mountSpiderStamp(sec, areaTitle, okruhCislo);
}

/* Decentný riadok „✏️ Upravené … – autor" pod hrami v Z3 strome. Fail-soft:
   pri chybe sa proste nezobrazí nič. */
async function mountSpiderStamp(sec, areaTitle, okruhCislo) {
  try {
    const okr = await getOkruh(areaTitle, okruhCislo);
    if (!okr || !okr.seal || !sec.isConnected) return;
    const { formatEditStamp } = await import('./contentOverrides.js');
    const text = formatEditStamp(okr.seal);
    if (!text) return;
    const el = document.createElement('div');
    el.className = 'small muted';
    el.style.cssText = 'margin-top:10px;font-size:11px';
    el.textContent = text;
    sec.appendChild(el);
  } catch (e) { console.warn('[HRY] stopa úpravy pavúka sa nezobrazila', e); }
}

/* Rola-gated tlačidlo „Upraviť pavúka" – zdieľané mount pre launcher.
   Prefill editora = efektívny (override-aware) getOkruh. */
async function mountSpiderEditButton(sec, areaTitle, okruhCislo, onSpiderSaved) {
  try {
    const nick = localStorage.getItem('playerNick');
    if (!nick) return;
    const { getRole } = await import('./economyConfig.js');   // rovnaký zdroj roly ako summary gate
    const rola = await getRole(nick);
    if (rola !== 'admin' && rola !== 'garant') return;

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.style.width = '100%';
    editBtn.style.marginTop = '12px';
    editBtn.textContent = '✏️ Upraviť pavúka';
    editBtn.onclick = async () => {
      try {
        const okr = await getOkruh(areaTitle, okruhCislo);   // override-aware efektívny stav
        const { openSpiderEditor } = await import('./spiderEditor.js');
        openSpiderEditor({
          areaTitle, okruhCislo,
          spider: { center: okr.center, branches: okr.branches, _seal: okr.seal },
          autor: nick, rola,
          onSaved: () => { if (typeof onSpiderSaved === 'function') onSpiderSaved(); }
        });
      } catch (e) { console.warn('[HRY] otvorenie editora pavúka zlyhalo', e); }
    };
    if (sec.isConnected) sec.appendChild(editBtn);
  } catch (e) { console.warn('[HRY] spider edit gate zlyhal', e); }
}

/* ---- Hra 1: Kukučka -------------------------------------------------- */

/* Ostáva exportovaná (spätná kompatibilita) a funkčne identická s v1 –
   len čerpá zo zdieľaných helperov a návraty smerujú na mountLauncher. */
export async function startCuckoo(areaTitle, okruhCislo, panel) {
  if (!panel) return;
  if (!(await canPlaySpiderGame())) return;   // avatar spí – launcher ostáva zobrazený
  ensureGameCss();
  const sec = resolveSec(panel);
  const backToLauncher = () => mountLauncher(panel, areaTitle, okruhCislo);

  let candidates = [];      // čísla iných okruhov v klastri
  let currentBranches = []; // vetvy aktuálneho okruhu
  let session = null;

  /* Zostaví jedno kolo: cieľová vetva (>=3 listy, fallback >=2) + kukučka
     z iného okruhu klastra. Dedup: text kukučky sa nesmie presne zhodovať
     so žiadnym listom cieľovej vetvy (do 10 pokusov na okruh, potom iný
     zdrojový okruh; každý kandidát sa skúsi najviac raz). */
  async function buildRound() {
    const branch = randOf(session.pool);
    const tried = new Set();
    let guard = 0;
    const maxOkruhTries = candidates.length + 2;

    while (guard < maxOkruhTries) {
      guard++;
      const remaining = candidates.filter(c => !tried.has(c));
      if (!remaining.length) break;
      const srcN = randOf(remaining);
      tried.add(srcN);

      const src = await getOkruh(areaTitle, srcN);
      const srcPool = src.branches.filter(b => b.leaves.length > 0);
      if (!srcPool.length) continue;

      for (let t = 0; t < 10; t++) {
        const srcBranch = randOf(srcPool);
        const cuckoo = randOf(srcBranch.leaves);
        if (!branch.leaves.includes(cuckoo)) {
          return {
            branchLabel: branch.label,
            cuckooText: cuckoo,
            cuckooOkruhTitle: src.title,
            cards: shuffle(branch.leaves.concat([cuckoo]))
          };
        }
      }
    }
    return null;
  }

  function renderRound(round) {
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = `Kolo ${session.round}/${ROUNDS} · ${round.branchLabel}`;

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Ktorý list do tejto vetvy NEPATRÍ? (kukučka z iného okruhu)';

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'spider-game-cards';

    const feedback = document.createElement('div');
    feedback.className = 'spider-game-feedback';

    const nextWrap = document.createElement('div');
    nextWrap.className = 'spider-game-nextwrap';

    let roundDone = false;
    let wrongCount = 0;

    function finishRound(firstTry) {
      roundDone = true;
      if (firstTry) session.correctFirstTry++;
      cardsWrap.querySelectorAll('.spider-game-card').forEach(c => {
        c.disabled = true;
        if (c.getAttribute('data-cuckoo') !== '1') c.classList.add('spider-game-card-locked');
      });
      const cuckooCard = cardsWrap.querySelector('[data-cuckoo="1"]');
      if (cuckooCard) cuckooCard.classList.add('spider-game-card-cuckoo');
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn';
      nextBtn.style.width = '100%';
      nextBtn.textContent = session.round >= ROUNDS ? 'Zobraziť výsledok →' : 'Ďalšie kolo →';
      nextBtn.onclick = () => nextRound();
      nextWrap.appendChild(nextBtn);
    }

    round.cards.forEach(text => {
      const isCuckoo = text === round.cuckooText;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'spider-game-card';
      if (isCuckoo) card.setAttribute('data-cuckoo', '1');
      card.textContent = text;
      card.onclick = () => {
        if (roundDone) return;
        if (isCuckoo) {
          card.classList.add('spider-game-card-correct');
          feedback.className = 'spider-game-feedback spider-game-feedback-ok';
          feedback.textContent = wrongCount === 0
            ? '✓ Správne! Kukučka odhalená na prvý pokus.'
            : '✓ Správne, to je kukučka.';
          finishRound(wrongCount === 0);
        } else {
          wrongCount++;
          card.classList.add('spider-game-card-wrong');
          card.disabled = true;
          if (wrongCount >= 2) {
            feedback.className = 'spider-game-feedback spider-game-feedback-bad';
            feedback.textContent = `✗ Tento list patrí do okruhu: ${round.cuckooOkruhTitle}`;
            finishRound(false);
          } else {
            feedback.className = 'spider-game-feedback spider-game-feedback-bad';
            feedback.textContent = '✗ Tento list do vetvy patrí. Skús ešte raz (ostáva 1 pokus).';
          }
        }
      };
      cardsWrap.appendChild(card);
    });

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';
    endBtn.onclick = backToLauncher;

    sec.append(header, hint, cardsWrap, feedback, nextWrap, endBtn);
  }

  async function nextRound() {
    session.round++;
    if (session.round > ROUNDS) {
      renderSessionEnd(sec, {
        title: 'Koniec hry 🐦',
        scoreText: `${session.correctFirstTry}/${ROUNDS} na prvý pokus`,
        onAgain: () => startSession(),
        onBack: backToLauncher
      });
      runSpiderEconomy(sec, 'kukucka', session.correctFirstTry, `${areaTitle}::A${okruhCislo}`);
      return;
    }
    hideTree();
    sec.innerHTML = '<div class="spider-game-loading">Pripravujem kolo…</div>';
    const round = await buildRound();
    if (!round) { showError(sec, 'Nepodarilo sa pripraviť kolo (nedostatok dát v klastri).', backToLauncher); return; }
    renderRound(round);
  }

  async function startSession() {
    hideTree();
    sec.innerHTML = '<div class="spider-game-loading">Načítavam hru…</div>';

    if (!candidates.length || !currentBranches.length) {
      const map = await fetchJson(areaTitle, '_map');
      if (!map || !Array.isArray(map.clusters)) {
        showError(sec, 'Nepodarilo sa načítať mapu okruhov (_map.json).', backToLauncher);
        return;
      }
      const cluster = map.clusters.find(cl =>
        Array.isArray(cl.okruhy) && cl.okruhy.map(Number).includes(Number(okruhCislo)));
      if (!cluster) {
        showError(sec, 'Tento okruh nie je v žiadnom klastri – hra nie je dostupná.', backToLauncher);
        return;
      }
      candidates = cluster.okruhy.map(Number).filter(x => x !== Number(okruhCislo));
      if (!candidates.length) {
        showError(sec, 'Klaster nemá iný okruh, z ktorého by sa dala vylosovať kukučka.', backToLauncher);
        return;
      }
      const cur = await getOkruh(areaTitle, Number(okruhCislo));
      currentBranches = cur.branches;
      if (!currentBranches.length) {
        showError(sec, 'Tento okruh nemá dáta stromu pre hru.', backToLauncher);
        return;
      }
    }

    let pool = currentBranches.filter(b => b.leaves.length >= 3);
    if (!pool.length) pool = currentBranches.filter(b => b.leaves.length >= 2);
    if (!pool.length) {
      showError(sec, 'Tento okruh nemá vetvu s dostatkom listov pre hru.', backToLauncher);
      return;
    }

    session = { round: 0, correctFirstTry: 0, pool };
    await nextRound();
  }

  await startSession();
}

/* ---- Hra 2: Rozpárovanie -------------------------------------------- */

/* Interná (volaná z mountLauncher). Priradenie listov dvoch zmiešaných
   vetiev toho istého okruhu do správnych košov (klik-list → klik-vetva).
   Skóre = kolá bez chyby. */
/* async kvôli energetickému gate nižšie – volajúci (mountLauncher onclick)
   návratovú hodnotu nepoužíva, takže zmena signatúry nikoho neovplyvní. */
async function startRozparovanie(areaTitle, okruhCislo, panel) {
  if (!panel) return;
  if (!(await canPlaySpiderGame())) return;   // avatar spí – launcher ostáva zobrazený
  ensureGameCss();
  const sec = resolveSec(panel);
  const backToLauncher = () => mountLauncher(panel, areaTitle, okruhCislo);

  const MAX_PER_BRANCH = 4;
  let eligible = [];   // [{ b, i }] vetvy s >=2 listami
  let session = null;

  const pairKey = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const pickLeaves = branch => shuffle(branch.leaves).slice(0, Math.min(MAX_PER_BRANCH, branch.leaves.length));

  /* Vyberie 2 rôzne vetvy (preferuje nepoužitú dvojicu v rámci sedenia)
     a z každej max. MAX_PER_BRANCH náhodných listov. Dedup: žiadny
     vybraný text sa nesmie vyskytovať v oboch výberoch (do 10 pokusov na
     dvojicu). Vráti null, ak sa nepodarí (fail-soft → showError). */
  function buildRound() {
    if (eligible.length < 2) return null;

    const pairs = [];
    for (let a = 0; a < eligible.length; a++) {
      for (let b = a + 1; b < eligible.length; b++) {
        pairs.push([eligible[a], eligible[b]]);
      }
    }

    /* Kandidáti zoradení do úrovní; losuje sa z najvyššej NEPRÁZDNEJ.
       úr.1: dvojice s aspoň jednou vetvou, pri ktorej padla chyba
             (opakovaný nácvik problémových vetiev) – len ak už chyby sú,
       úr.2: OBE vetvy ešte nepoužité v sedení (max. variabilita),
       úr.3: práve jedna vetva použitá,
       úr.4: hocijaká dvojica (fallback pri malých okruhoch).
       Prvé kolo: errorBranches aj usedBranches sú prázdne → padne to na
       úr.2 = všetky dvojice, čo je pôvodné správanie. */
    const inErr = p => session.errorBranches.has(p[0].i) || session.errorBranches.has(p[1].i);
    const usedCount = p => (session.usedBranches.has(p[0].i) ? 1 : 0) + (session.usedBranches.has(p[1].i) ? 1 : 0);
    const levels = [];
    if (session.errorBranches.size) levels.push(pairs.filter(inErr));
    levels.push(pairs.filter(p => usedCount(p) === 0));
    levels.push(pairs.filter(p => usedCount(p) === 1));
    levels.push(pairs);

    let pool = [];
    for (const lv of levels) { if (lv.length) { pool = lv; break; } }

    // v rámci úrovne naďalej preferovať ešte nepoužité dvojice
    const unused = pool.filter(p => !session.usedPairs.has(pairKey(p[0].i, p[1].i)));
    const order = shuffle(unused.length ? unused : pool);

    for (const [x, y] of order) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const la = pickLeaves(x.b);
        const lb = pickLeaves(y.b);
        const setB = new Set(lb);
        const overlap = la.some(txt => setB.has(txt));
        if (!overlap) {
          const key = pairKey(x.i, y.i);
          session.usedPairs.add(key);
          const cards = shuffle(
            la.map(text => ({ text, bin: 0 })).concat(lb.map(text => ({ text, bin: 1 })))
          );
          // branchIdx: bin 0/1 -> skutočný index vetvy v okruhu (pre
          // zápis do errorBranches/usedBranches)
          return { labels: [x.b.label, y.b.label], branchIdx: [x.i, y.i], cards, pairKey: key };
        }
      }
    }
    return null;
  }

  function renderRound(round) {
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = `Kolo ${session.round}/${ROUNDS}`;

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Klikni na list, potom na vetvu, kam patrí.';

    const feedback = document.createElement('div');
    feedback.className = 'spider-game-feedback';

    const nextWrap = document.createElement('div');
    nextWrap.className = 'spider-game-nextwrap';

    let selectedCard = null;
    let remaining = round.cards.length;
    let chyba = false;
    let roundDone = false;

    function clearSelection() {
      if (selectedCard) selectedCard.classList.remove('spider-game-card-selected');
      selectedCard = null;
    }

    function selectCard(card) {
      if (roundDone || card.disabled) return;
      if (selectedCard === card) { clearSelection(); return; }
      clearSelection();
      selectedCard = card;
      card.classList.add('spider-game-card-selected');
    }

    /* Koše (2) + ich sloty. */
    const binsWrap = document.createElement('div');
    binsWrap.className = 'spider-game-bins';
    const slots = [];
    round.labels.forEach((label, binIdx) => {
      const bin = document.createElement('div');
      bin.className = 'spider-game-bin';
      const col = document.createElement('button');
      col.type = 'button';
      col.className = 'spider-game-col';
      col.textContent = label;
      col.onclick = () => assign(binIdx);
      const slot = document.createElement('div');
      slot.className = 'spider-game-slot';
      slots[binIdx] = slot;
      bin.append(col, slot);
      binsWrap.appendChild(bin);
    });

    /* Balík nepriradených kariet. */
    const deck = document.createElement('div');
    deck.className = 'spider-game-cards';
    round.cards.forEach(c => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'spider-game-card';
      card.dataset.bin = String(c.bin);
      card.textContent = c.text;
      card.onclick = () => selectCard(card);
      deck.appendChild(card);
    });

    function finishRound() {
      roundDone = true;
      session.usedBranches.add(round.branchIdx[0]);
      session.usedBranches.add(round.branchIdx[1]);
      if (!chyba) session.cleanRounds++;
      feedback.className = 'spider-game-feedback ' + (chyba ? 'spider-game-feedback-bad' : 'spider-game-feedback-ok');
      feedback.textContent = chyba ? '✗ Dokončené s chybami' : '✓ Bez jedinej chyby';
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn';
      nextBtn.style.width = '100%';
      nextBtn.textContent = session.round >= ROUNDS ? 'Zobraziť výsledok →' : 'Ďalšie kolo →';
      nextBtn.onclick = () => nextRound();
      nextWrap.appendChild(nextBtn);
    }

    function assign(binIdx) {
      if (roundDone || !selectedCard) return; // klik na kôš bez výberu = no-op
      const card = selectedCard;
      const cardBin = Number(card.dataset.bin);
      if (cardBin === binIdx) {
        clearSelection();
        card.disabled = true;
        card.classList.remove('spider-game-card-selected');
        card.classList.add('spider-game-card-assigned');
        slots[binIdx].appendChild(card);
        remaining--;
        if (remaining === 0) finishRound();
      } else {
        // karta správne patrí do vetvy round.branchIdx[cardBin] – zapíš ju
        // ako "chybovú" pre prioritný nácvik v ďalších kolách
        session.errorBranches.add(round.branchIdx[cardBin]);
        card.classList.add('spider-game-card-wrong-blink');
        setTimeout(() => card.classList.remove('spider-game-card-wrong-blink'), 500);
        chyba = true;
        clearSelection();
      }
    }

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';
    endBtn.onclick = backToLauncher;

    sec.append(header, hint, binsWrap, deck, feedback, nextWrap, endBtn);
  }

  function nextRound() {
    session.round++;
    if (session.round > ROUNDS) {
      renderSessionEnd(sec, {
        title: 'Koniec hry 🧩',
        scoreText: `${session.cleanRounds}/${ROUNDS} bez chyby`,
        onAgain: () => startSession(),
        onBack: backToLauncher
      });
      runSpiderEconomy(sec, 'rozparovanie', session.cleanRounds, `${areaTitle}::A${okruhCislo}`);
      return;
    }
    const round = buildRound();
    if (!round) { showError(sec, 'Nepodarilo sa pripraviť kolo (nedostatok vhodných vetiev).', backToLauncher); return; }
    renderRound(round);
  }

  async function startSession() {
    hideTree();
    sec.innerHTML = '<div class="spider-game-loading">Načítavam hru…</div>';

    if (!eligible.length) {
      const cur = await getOkruh(areaTitle, Number(okruhCislo));
      eligible = cur.branches
        .map((b, i) => ({ b, i }))
        .filter(x => x.b.leaves.length >= 2);
    }
    if (eligible.length < 2) {
      showError(sec, 'Tento okruh nemá aspoň 2 vetvy s dostatkom listov pre Rozpárovanie.', backToLauncher);
      return;
    }

    session = {
      round: 0, cleanRounds: 0,
      usedPairs: new Set(),      // dvojice vetiev už odohrané (kľúč i-j)
      usedBranches: new Set(),   // indexy vetiev z odohraných kôl
      errorBranches: new Set()   // indexy vetiev, pri ktorých padla chyba
    };
    nextRound();
  }

  startSession();
}

/* ---- Hra 3: Kde som? ------------------------------------------------- */

/* Vstup je NOVÝ – tlačidlo na úrovni Z1 (nie Z3 launcher). spiderMap.js
   odovzdá celý #spiderMapModal (modal), aktívnu oblasť, už načítané
   mapData (_map.json – žiadny extra fetch klastrov) a onExit callback
   (návrat na čerstvý Z1 render). Hra preberie modal.innerHTML vlastným
   panelom; #spiderTreeHost/#spiderDetailHost v tomto modale NEEXISTUJÚ,
   takže hideTree/restoreTree (volané zvnútra showError/renderSessionEnd)
   sú no-op – ticho prejdú (getElementById vráti null, guard `if (t)`).

   Kolo: náhodná vetva náhodného okruhu oblasti (len na čítanie) → hráč
   dvojkrokovo háda klaster (krok A) a potom okruh v klastri (krok B).
   Skóre = 0–10 (2 body/kolo za trafenie na prvý pokus). 5 kôl. */
/* async kvôli energetickému gate nižšie – volajúci (spiderMap Z1 tlačidlo)
   návratovú hodnotu nepoužíva, takže zmena signatúry nikoho neovplyvní. */
export async function startKdeSom(modal, areaTitle, mapData, onExit) {
  const exit = () => { if (typeof onExit === 'function') onExit(); };
  if (!modal || !mapData || !Array.isArray(mapData.clusters) || !mapData.clusters.length) {
    if (typeof onExit === 'function') onExit();
    else console.error('[KDE SOM] chýbajú dáta (modal/mapData) – hra sa nespustí.');
    return;
  }
  /* Avatar spí. Na rozdiel od ostatných hier tu volajúci pred spustením robí
     cleanupLevel(), takže samotný return by nechal prázdnu obrazovku –
     preto sa cez exit() vrátime na Z1 mapu. */
  if (!(await canPlaySpiderGame())) { exit(); return; }
  ensureGameCss();

  // Únia okruhov naprieč klastrami (unikátne čísla).
  const allOkruhy = [...new Set(mapData.clusters.flatMap(cl => (cl.okruhy || []).map(Number)))];

  // Vlastný panel; sec = kontajner hry (dostáva ho showError/renderSessionEnd).
  modal.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'avatar-panel spider-panel';
  const h3 = document.createElement('h3');
  h3.style.margin = '0 0 10px 0';
  h3.textContent = `🧭 Kde som? · ${areaTitle}`;
  const sec = document.createElement('div');
  sec.className = 'spiderGameSec';
  panel.append(h3, sec);
  modal.appendChild(panel);

  let session = null;

  /* Zostaví kolo: náhodný nepoužitý okruh s vetvou (>=2 listy). Guard 10
     pokusov cez rôzne okruhy, potom null → showError. Po vyčerpaní
     všetkých okruhov sa usedOkruhy vyčistí (recyklácia v dlhom sedení). */
  async function buildRound() {
    let avail = allOkruhy.filter(n => !session.usedOkruhy.has(n));
    if (!avail.length) { session.usedOkruhy.clear(); avail = allOkruhy.slice(); }
    const tried = new Set();
    for (let guard = 0; guard < 10; guard++) {
      const pool = avail.filter(n => !tried.has(n));
      if (!pool.length) break;
      const n = randOf(pool);
      tried.add(n);
      const okr = await getOkruh(areaTitle, n);
      const eligible = okr.branches.filter(b => b.leaves.length >= 2);
      if (!eligible.length) continue;
      session.usedOkruhy.add(n);
      const branch = randOf(eligible);
      const leaves = shuffle(branch.leaves).slice(0, Math.min(4, branch.leaves.length));
      const clusterIdx = mapData.clusters.findIndex(cl => (cl.okruhy || []).map(Number).includes(n));
      return { okruh: n, okruhTitle: okr.title, branchLabel: branch.label, leaves, clusterIdx };
    }
    return null;
  }

  function renderRound(round) {
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = `Kolo ${session.round}/${ROUNDS}`;

    const subhead = document.createElement('div');
    subhead.className = 'spider-game-subhead';
    subhead.textContent = round.branchLabel;

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'spider-game-cards';
    round.leaves.forEach(text => {
      const card = document.createElement('div');
      card.className = 'spider-game-card-static';
      card.textContent = text;
      cardsWrap.appendChild(card);
    });

    const question = document.createElement('div');
    question.className = 'spider-game-hint';

    const choices = document.createElement('div');

    const feedback = document.createElement('div');
    feedback.className = 'spider-game-feedback';

    const nextWrap = document.createElement('div');
    nextWrap.className = 'spider-game-nextwrap';

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';
    endBtn.onclick = exit;

    sec.append(header, subhead, cardsWrap, question, choices, feedback, nextWrap, endBtn);

    function finishRound() {
      feedback.className = 'spider-game-feedback spider-game-feedback-ok';
      feedback.textContent = `Bola to vetva okruhu: ${round.okruhTitle}`;
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn';
      nextBtn.style.width = '100%';
      nextBtn.textContent = session.round >= ROUNDS ? 'Zobraziť výsledok →' : 'Ďalšie kolo →';
      nextBtn.onclick = () => nextRound();
      nextWrap.innerHTML = '';
      nextWrap.appendChild(nextBtn);
    }

    /* Generický dvojkrokový výber: options = [{ label, correct }], po
       vyriešení (trafené / 2 chyby) zavolá done(firstTry). */
    function renderChoice(promptText, options, done) {
      if (!sec.isConnected) return; // hráč medzitým ukončil (modal prepísaný)
      question.textContent = promptText;
      choices.className = 'spider-game-cluster-grid';
      choices.innerHTML = '';
      feedback.textContent = '';
      feedback.className = 'spider-game-feedback';
      let resolved = false;
      let wrong = 0;
      const btns = options.map(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spider-game-col';
        btn.textContent = opt.label;
        btn.onclick = () => {
          if (resolved) return;
          if (opt.correct) {
            btn.classList.add('spider-game-col-correct');
            resolved = true;
            done(wrong === 0);
          } else {
            wrong++;
            btn.classList.add('spider-game-col-wrong');
            btn.disabled = true;
            if (wrong >= 2) {
              resolved = true;
              const correctBtn = btns.find(b => b._correct);
              if (correctBtn) correctBtn.classList.add('spider-game-col-correct');
              done(false);
            }
          }
        };
        btn._correct = !!opt.correct;
        choices.appendChild(btn);
        return btn;
      });
    }

    // Krok A – klaster
    renderChoice(
      'Do ktorého klastra patrí?',
      mapData.clusters.map((cl, i) => ({ label: cl.label, correct: i === round.clusterIdx })),
      firstTryA => {
        if (firstTryA) session.score++;
        // Krok B – okruh v (správnom) klastri
        const cluster = mapData.clusters[round.clusterIdx];
        const titles = window.areaOkruhTitles?.[areaTitle] || {};
        const okruhy = (cluster.okruhy || []).map(Number);
        setTimeout(() => {
          renderChoice(
            'Z ktorého okruhu je to vetva?',
            okruhy.map(n => ({ label: titles['A' + n] || ('A' + n), correct: n === round.okruh })),
            firstTryB => {
              if (firstTryB) session.score++;
              finishRound();
            }
          );
        }, 550);
      }
    );
  }

  async function nextRound() {
    session.round++;
    if (session.round > ROUNDS) {
      renderSessionEnd(sec, {
        title: 'Koniec hry 🧭',
        scoreText: `${session.score}/10`,
        onAgain: () => startSession(),
        onBack: exit,
        backText: '← Späť na mapu'
      });
      runSpiderEconomy(sec, 'kdesom', session.score, areaTitle);
      return;
    }
    sec.innerHTML = '<div class="spider-game-loading">Pripravujem kolo…</div>';
    const round = await buildRound();
    if (!round) { showError(sec, 'Nepodarilo sa pripraviť kolo (nedostatok dát v oblasti).', exit); return; }
    renderRound(round);
  }

  async function startSession() {
    sec.innerHTML = '<div class="spider-game-loading">Načítavam hru…</div>';
    session = { round: 0, score: 0, usedOkruhy: new Set() };
    await nextRound();
  }

  startSession();
}

/* ---- Hlasové helpery (hlasový Recall) -------------------------------- */

/* Duplikát VZORU normalizácie z memoryTrainer.js (normalizeText tam nie je
   exportovaný a memoryTrainer.js sa podľa zadania NEMENÍ; STT funkcie sa
   naopak importujú – tie exportované sú). Malé písmená, bez diakritiky,
   len alfanumerické tokeny. */
const VOICE_DIACRITICS = {
  'á': 'a', 'ä': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'í': 'i', 'ĺ': 'l', 'ľ': 'l',
  'ň': 'n', 'ó': 'o', 'ô': 'o', 'ŕ': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ý': 'y', 'ž': 'z'
};
function normalizeVoiceText(s) {
  let out = '';
  for (const ch of String(s || '').toLowerCase()) out += VOICE_DIACRITICS[ch] || ch;
  return out.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Významové tokeny labelu vetvy (matching proti transcriptu): >3 znaky,
   mimo krátkeho stopword zoznamu; ak by nič neostalo, všetky tokeny. */
const VOICE_STOPWORDS = new Set(['alebo', 'ktory', 'ktora', 'ktore', 'jeho', 'tejto', 'podla', 'medzi', 'pred', 'proti']);
function labelTokens(label) {
  const all = normalizeVoiceText(label).split(' ').filter(Boolean);
  const main = all.filter(t => t.length > 3 && !VOICE_STOPWORDS.has(t));
  return main.length ? main : all;
}

/* Nápoveda „iniciály": „Funkcie pracovného práva" → „F. p. p." */
function buildInitialsHint(label) {
  return String(label || '').split(/\s+/).filter(Boolean).map(w => w[0] + '.').join(' ');
}

/* Nápoveda „skeleton" (vzor buildSkeleton z memoryTrainer.js): každé 3.
   slovo viditeľné, tokeny s číslicou/§ vždy viditeľné, ostatné ___. */
function buildSkeletonHint(label) {
  return String(label || '').split(/\s+/).filter(Boolean).map((tok, i) => {
    if (/[\d🪙]/.test(tok)) return tok;
    if (i % 3 === 0) return tok;
    const core = tok.replace(/[.,;:()"„“–-]/g, '');
    return tok.replace(core, '_'.repeat(Math.min(core.length, 12)));
  }).join(' ');
}

/* ---- Hra 4: Recall (self-check) ------------------------------------- */

/* Vetvy okruhu sú zakryté; hráč si ich má vybaviť z pamäti a postupne
   odkrývať s binárnym sebahodnotením (✓ vybavil / ✗ nevybavil). Center
   okruhu je viditeľný ako pomôcka. Nehodnotené (žiadny zápis), skóre je
   len sebareflexia v rámci sedenia. Vetvy v AUTORSKOM poradí (bez shuffle
   – recall má rešpektovať štruktúru okruhu). renderSessionEnd sa tu
   NEPOUŽÍVA (koniec má vlastný layout s "Na zopakovanie"). */
export async function startRecall(areaTitle, okruhCislo, panel) {
  if (!panel) return;
  if (!(await canPlaySpiderGame())) return;   // avatar spí – launcher ostáva zobrazený
  ensureGameCss();
  const sec = resolveSec(panel);
  const backToLauncher = () => mountLauncher(panel, areaTitle, okruhCislo);

  hideTree();
  sec.innerHTML = '<div class="spider-game-loading">Načítavam hru…</div>';

  const okr = await getOkruh(areaTitle, Number(okruhCislo));
  const branches = okr.branches; // autorské poradie, žiadny shuffle
  if (!branches.length) {
    showError(sec, 'Tento okruh nemá vetvy pre Recall.', backToLauncher);
    return;
  }

  /* Voľba režimu (klikací / hlasový). Hlasový sa ponúkne len ak sa podarí
     lazy import memoryTrainer.js A SpeechRecognition je podporované –
     inak sa BEZ voľby ide rovno do klikacieho flow (nulová bariéra,
     presne doterajšie správanie). memoryTrainer.js sa NEMENÍ – importujú
     sa len jeho exportované funkcie (rovnaký vzor ako statnice.js;
     top-level side-effecty overené: len window.renderMemoryTiles). */
  async function renderModeChoice() {
    hideTree();
    sec.innerHTML = '<div class="spider-game-loading">Načítavam hru…</div>';
    let mt = null;
    try {
      const mod = await import('../memoryTrainer.js');
      if (mod.isSpeechRecognitionSupported()) mt = mod;
    } catch (e) {
      console.warn('[RECALL] memoryTrainer.js sa nepodarilo načítať – klikací režim', e);
    }
    if (!mt) { render(); return; }

    sec.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = '🧠 Recall';

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Vyber si režim odkrývania vetiev.';

    const clickBtn = document.createElement('button');
    clickBtn.className = 'btn';
    clickBtn.style.width = '100%';
    clickBtn.textContent = 'Klikací režim';
    clickBtn.onclick = () => render();

    const voiceBtn = document.createElement('button');
    voiceBtn.className = 'btn';
    voiceBtn.style.width = '100%';
    voiceBtn.style.marginTop = '8px';
    voiceBtn.textContent = '🎤 Hlasový režim';
    voiceBtn.onclick = () => renderVoice(mt);

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';
    endBtn.onclick = backToLauncher;

    sec.append(header, hint, clickBtn, voiceBtn, endBtn);
  }

  /* Hlasový režim – hráč hovorí vetvy nahlas, rozpoznané sa odkryjú so ✓.
     STT prichádza z memoryTrainer.js (mt = importovaný modul), matching
     je lokálny (normalizeVoiceText/labelTokens). Po „Hotovo" dostanú
     nepovedané karty nápovedu – typ nápovedy je GLOBÁLNY prepínač nad
     kartami (zvolené namiesto per-karta: jeden stav + jeden riadok UI,
     menej DOM logiky; per-karta by pridala prepínač do každej karty bez
     reálneho prínosu). Mikrofón sa dá spustiť aj znova (druhé kolo).
     Cleanup rozpoznávača: stop pri „Ukončiť"/„Hotovo"/konci hry +
     !sec.isConnected guard v onResult (vzor časovača z Blesku) – žiadny
     visiaci mikrofón. */
  function renderVoice(mt) {
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = '🧠 Recall – hlasový';

    const centerCard = document.createElement('div');
    centerCard.className = 'spider-game-card-static';
    centerCard.textContent = okr.center;

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Hovor vetvy nahlas – rozpoznané sa odkryjú. Každú môžeš odškrtnúť aj ručne.';

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'spider-game-cards';

    const feedback = document.createElement('div');
    feedback.className = 'spider-game-feedback';

    const micBtn = document.createElement('button');
    micBtn.className = 'btn spider-game-mic';
    micBtn.style.width = '100%';
    micBtn.textContent = '🎤 Nahrať';

    const doneBtn = document.createElement('button');
    doneBtn.className = 'btn';
    doneBtn.style.width = '100%';
    doneBtn.style.marginTop = '8px';
    doneBtn.textContent = 'Hotovo';

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';

    let okCount = 0;
    const missedLabels = [];
    let resolvedCount = 0;
    let fullTranscript = ''; // kumulované za sedenie – neskorší výrok dopĺňa skoršie
    let recognizer = null;
    let recognizing = false;
    let hintMode = 'initials'; // 'initials' | 'skeleton' (globálny prepínač)
    const states = branches.map(() => 'hidden'); // 'hidden' | 'done'
    const hintLines = []; // { line, i } – na prepnutie typu nápovedy

    const stopRecognizer = () => { try { if (recognizer) recognizer.stop(); } catch (e) {} };
    const hintTextOf = label => (hintMode === 'initials' ? buildInitialsHint(label) : buildSkeletonHint(label));

    // Zakryté karty: „?" + ručná poistka „✓ povedala som"
    const cardEls = branches.map((branch, i) => {
      const card = document.createElement('div');
      card.className = 'spider-game-card-hidden spider-game-card-hidden-voice';
      const q = document.createElement('span');
      q.textContent = '?';
      const saidBtn = document.createElement('button');
      saidBtn.type = 'button';
      saidBtn.className = 'spider-game-saidbtn';
      saidBtn.textContent = '✓ povedala som';
      saidBtn.onclick = () => resolveCard(i, true);
      card.append(q, saidBtn);
      cardsWrap.appendChild(card);
      return card;
    });

    function resolveCard(i, isOk) {
      if (states[i] !== 'hidden') return;
      states[i] = 'done';
      resolvedCount++;
      const card = cardEls[i];
      card.className = 'spider-game-card-static ' + (isOk ? 'spider-game-col-correct' : 'spider-game-col-wrong');
      card.textContent = branches[i].label;
      if (isOk) okCount++; else missedLabels.push(branches[i].label);
      if (resolvedCount >= branches.length) {
        stopRecognizer();
        // posledná vetva: koniec sa NEukáže hneď – karty ostávajú viditeľné,
        // hráč prejde na výsledok sám
        micBtn.style.display = 'none';
        doneBtn.style.display = 'none';
        const resultBtn = document.createElement('button');
        resultBtn.className = 'btn';
        resultBtn.style.width = '100%';
        resultBtn.style.marginTop = '10px';
        resultBtn.textContent = 'Zobraziť výsledok →';
        resultBtn.onclick = () => renderEnd(okCount, branches.length, missedLabels);
        endBtn.insertAdjacentElement('beforebegin', resultBtn);
      }
    }

    /* Vetva je „povedaná", ak kumulovaný transcript obsahuje >=50 % jej
       tokenov (substring zhoda tokenov; pri 1–2 tokenoch všetky). */
    function applyTranscript() {
      const norm = normalizeVoiceText(fullTranscript);
      if (!norm) return;
      branches.forEach((branch, i) => {
        if (states[i] !== 'hidden') return;
        const tokens = labelTokens(branch.label);
        if (!tokens.length) return;
        const matched = tokens.filter(t => norm.includes(t)).length;
        const said = tokens.length <= 2 ? matched === tokens.length : matched / tokens.length >= 0.5;
        if (said) resolveCard(i, true);
      });
    }

    micBtn.onclick = () => {
      if (recognizing) { stopRecognizer(); return; }
      recognizer = mt.createSpeechRecognizer({
        onStart: () => { recognizing = true; micBtn.textContent = '⏹️ Stop'; micBtn.classList.add('spider-game-mic-on'); },
        onEnd: () => { recognizing = false; micBtn.textContent = '🎤 Nahrať'; micBtn.classList.remove('spider-game-mic-on'); },
        onError: (e) => {
          recognizing = false;
          micBtn.textContent = '🎤 Nahrať';
          micBtn.classList.remove('spider-game-mic-on');
          feedback.className = 'spider-game-feedback spider-game-feedback-bad';
          feedback.textContent = 'Mikrofón sa nepodarilo spustiť – skús znova alebo odkrývaj ručne.';
          console.warn('[RECALL] rozpoznávanie zlyhalo', e);
        },
        onResult: (transcript) => {
          if (!sec.isConnected) { stopRecognizer(); return; } // hráč medzitým odišiel z hry
          fullTranscript += ' ' + transcript;
          feedback.className = 'spider-game-feedback';
          feedback.textContent = `Počula som: „${transcript}“`;
          applyTranscript();
        }
      }, { continuous: mt.isLikelyDesktop() });
      if (!recognizer) {
        feedback.className = 'spider-game-feedback spider-game-feedback-bad';
        feedback.textContent = 'Rozpoznávanie hlasu nie je dostupné – odkrývaj ručne.';
        return;
      }
      // .start() PRIAMO v click handleri (user gesture – nutné na mobile)
      try { recognizer.start(); } catch (e) { console.warn('[RECALL] recognizer.start zlyhal', e); }
    };

    // Globálny prepínač typu nápovedy (zobrazí sa až po „Hotovo")
    const toggleRow = document.createElement('div');
    toggleRow.className = 'spider-game-hinttoggle';
    const initialsBtn = document.createElement('button');
    initialsBtn.type = 'button';
    initialsBtn.textContent = 'Iniciály';
    const skeletonBtn = document.createElement('button');
    skeletonBtn.type = 'button';
    skeletonBtn.textContent = 'Skeleton';
    toggleRow.append(initialsBtn, skeletonBtn);

    function refreshHintUi() {
      initialsBtn.classList.toggle('spider-game-hinttoggle-active', hintMode === 'initials');
      skeletonBtn.classList.toggle('spider-game-hinttoggle-active', hintMode === 'skeleton');
      hintLines.forEach(h => { if (states[h.i] === 'hidden') h.line.textContent = hintTextOf(branches[h.i].label); });
    }
    initialsBtn.onclick = () => { hintMode = 'initials'; refreshHintUi(); };
    skeletonBtn.onclick = () => { hintMode = 'skeleton'; refreshHintUi(); };

    // „Hotovo": nepovedané karty prejdú do nápovedného stavu (✓ Viem / ✗ Odkry)
    doneBtn.onclick = () => {
      stopRecognizer();
      doneBtn.style.display = 'none'; // úlohu splnilo; mikrofón ostáva (druhé kolo)
      sec.insertBefore(toggleRow, cardsWrap);
      branches.forEach((branch, i) => {
        if (states[i] !== 'hidden') return;
        const card = cardEls[i];
        card.classList.add('spider-game-card-hint');
        card.textContent = '';
        const line = document.createElement('div');
        line.className = 'spider-game-hintline';
        line.textContent = hintTextOf(branch.label);
        hintLines.push({ line, i });
        const chk = document.createElement('div');
        chk.className = 'spider-game-selfcheck';
        const knowBtn = document.createElement('button');
        knowBtn.className = 'btn';
        knowBtn.textContent = '✓ Viem';
        knowBtn.onclick = () => resolveCard(i, true);
        const openBtn = document.createElement('button');
        openBtn.className = 'btn';
        openBtn.textContent = '✗ Odkry';
        openBtn.onclick = () => resolveCard(i, false);
        chk.append(knowBtn, openBtn);
        card.append(line, chk);
      });
      refreshHintUi();
    };

    endBtn.onclick = () => { stopRecognizer(); backToLauncher(); };

    sec.append(header, centerCard, hint, cardsWrap, feedback, micBtn, doneBtn, endBtn);
  }

  function render() {
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = '🧠 Recall';

    const centerCard = document.createElement('div');
    centerCard.className = 'spider-game-card-static';
    centerCard.textContent = okr.center;

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Vybav si z pamäti vetvy tohto okruhu, potom ich postupne odkrývaj.';

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'spider-game-cards';

    const revealBtn = document.createElement('button');
    revealBtn.className = 'btn';
    revealBtn.style.width = '100%';
    revealBtn.style.marginTop = '10px';
    revealBtn.textContent = 'Odkry ďalšiu vetvu';

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';
    endBtn.onclick = backToLauncher;

    let idx = 0;              // index ďalšej zakrytej vetvy
    let okCount = 0;
    const missedLabels = [];

    // zakryté karty vopred (obsah "?"), odkrývajú sa v poradí
    const cardEls = branches.map(() => {
      const card = document.createElement('div');
      card.className = 'spider-game-card-hidden';
      card.textContent = '?';
      cardsWrap.appendChild(card);
      return card;
    });

    function finish() {
      renderEnd(okCount, branches.length, missedLabels);
    }

    revealBtn.onclick = () => {
      if (idx >= branches.length) return;
      const branch = branches[idx];
      const card = cardEls[idx];
      idx++;
      revealBtn.disabled = true; // kým hráč neoznačí ✓/✗

      // premeň zakrytú kartu na odkrytú: label + selfcheck + "Ukáž listy"
      card.className = 'spider-game-card-static';
      card.textContent = '';
      const label = document.createElement('div');
      label.className = 'spider-game-revealed-label';
      label.textContent = branch.label;

      const selfcheck = document.createElement('div');
      selfcheck.className = 'spider-game-selfcheck';
      const okBtn = document.createElement('button');
      okBtn.className = 'btn';
      okBtn.textContent = '✓ Vybavila som si';
      const noBtn = document.createElement('button');
      noBtn.className = 'btn';
      noBtn.textContent = '✗ Nevybavila';

      const showLeavesBtn = document.createElement('button');
      showLeavesBtn.className = 'spider-game-linkbtn';
      showLeavesBtn.textContent = 'Ukáž listy';
      showLeavesBtn.onclick = () => {
        const box = document.createElement('div');
        box.className = 'spider-game-revealed';
        branch.leaves.forEach(text => {
          const leaf = document.createElement('div');
          leaf.className = 'spider-game-leaf-static';
          leaf.textContent = text;
          box.appendChild(leaf);
        });
        card.appendChild(box);
        showLeavesBtn.remove(); // raz rozbalené ostáva
      };

      function mark(isOk) {
        if (isOk) { okCount++; card.classList.add('spider-game-col-correct'); }
        else { missedLabels.push(branch.label); card.classList.add('spider-game-col-wrong'); }
        selfcheck.remove();
        if (idx >= branches.length) {
          // posledná vetva: koniec sa NEukáže hneď – karty ostávajú viditeľné,
          // hráč prejde na výsledok sám
          revealBtn.style.display = 'none';
          const resultBtn = document.createElement('button');
          resultBtn.className = 'btn';
          resultBtn.style.width = '100%';
          resultBtn.style.marginTop = '10px';
          resultBtn.textContent = 'Zobraziť výsledok →';
          resultBtn.onclick = () => finish();
          revealBtn.insertAdjacentElement('afterend', resultBtn);
        }
        else revealBtn.disabled = false;
      }
      okBtn.onclick = () => mark(true);
      noBtn.onclick = () => mark(false);

      selfcheck.append(okBtn, noBtn);
      card.append(label, selfcheck, showLeavesBtn);
    };

    sec.append(header, centerCard, hint, cardsWrap, revealBtn, endBtn);
  }

  /* Vlastná koncová obrazovka (renderSessionEnd sa nepoužíva) – navyše
     blok "Na zopakovanie". Štýl tlačidiel zhodný s renderSessionEnd. */
  function renderEnd(okCount, total, missedLabels) {
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = 'Koniec – Recall 🧠';

    const score = document.createElement('div');
    score.className = 'spider-game-score';
    score.textContent = `${okCount}/${total} vetiev`;

    sec.append(header, score);

    if (missedLabels.length) {
      const missed = document.createElement('div');
      missed.className = 'spider-game-missed';
      const head = document.createElement('div');
      head.className = 'spider-game-missed-head';
      head.textContent = 'Na zopakovanie:';
      missed.appendChild(head);
      missedLabels.forEach(lbl => {
        const item = document.createElement('div');
        item.className = 'spider-game-missed-item';
        item.textContent = `• ${lbl}`;
        missed.appendChild(item);
      });
      sec.appendChild(missed);
    }

    const again = document.createElement('button');
    again.className = 'btn';
    again.style.width = '100%';
    again.textContent = '↻ Ešte raz';
    again.onclick = () => renderModeChoice(); // Ešte raz → voľba režimu (jediná zmena renderEnd)

    const back = document.createElement('button');
    back.className = 'btn';
    back.style.width = '100%';
    back.style.marginTop = '8px';
    back.textContent = '← Späť na strom';
    back.onclick = backToLauncher;

    sec.append(again, back);
  }

  renderModeChoice();
}

/* ---- Hra 5: Blesk (časovaný Recall) --------------------------------- */

/* Časovaná variácia Recallu: najprv fáza ŠTÚDIA (center + zoznam labelov
   vetiev bez listov + odpočítavadlo max(15, ceil(N*2.5)) s), potom fáza
   VYBAVOVANIA identická s Recallom (zakryté karty, odkrývanie po jednej,
   ✓/✗ self-check) a rovnaká koncová obrazovka. Fáza vybavovania + koniec
   sú ZÁMERNE duplikované z startRecall (nie zdieľané) – nasadený Recall
   ostáva bitovo nezmenený, malá duplicita je prijatá cena za nulové
   riziko. Nehodnotené, žiadny zápis, stav v closure. */
export async function startBlesk(areaTitle, okruhCislo, panel) {
  if (!panel) return;
  if (!(await canPlaySpiderGame())) return;   // avatar spí – launcher ostáva zobrazený
  ensureGameCss();
  const sec = resolveSec(panel);
  const backToLauncher = () => mountLauncher(panel, areaTitle, okruhCislo);

  hideTree();
  sec.innerHTML = '<div class="spider-game-loading">Načítavam hru…</div>';

  const okr = await getOkruh(areaTitle, Number(okruhCislo));
  const branches = okr.branches; // autorské poradie, žiadny shuffle
  if (!branches.length) {
    showError(sec, 'Tento okruh nemá vetvy pre Blesk.', backToLauncher);
    return;
  }

  const N = branches.length;
  const studySeconds = Math.max(15, Math.ceil(N * 2.5));
  let timerId = null;
  const clearTimer = () => { if (timerId) { clearInterval(timerId); timerId = null; } };

  /* Fáza ŠTÚDIA – center + labely vetiev + odpočítavadlo. */
  function renderStudy() {
    clearTimer(); // obrana pri "Ešte raz" (nový beh)
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = '⚡ Blesk';

    const centerCard = document.createElement('div');
    centerCard.className = 'spider-game-card-static';
    centerCard.textContent = okr.center;

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Zapamätaj si vetvy — o chvíľu zmiznú.';

    const countdown = document.createElement('div');
    countdown.className = 'spider-game-countdown';

    const listWrap = document.createElement('div');
    listWrap.className = 'spider-game-cards';
    branches.forEach(branch => {
      const item = document.createElement('div');
      item.className = 'spider-game-studyitem';
      item.textContent = branch.label; // len label, bez listov
      listWrap.appendChild(item);
    });

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn';
    skipBtn.style.width = '100%';
    skipBtn.style.marginTop = '10px';
    skipBtn.textContent = 'Hotovo, skry skôr';
    skipBtn.onclick = () => { clearTimer(); renderModeChoiceBlesk(); };

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';
    endBtn.onclick = () => { clearTimer(); backToLauncher(); };

    sec.append(header, centerCard, hint, countdown, listWrap, skipBtn, endBtn);

    let remaining = studySeconds;
    countdown.textContent = `${remaining} s`;
    timerId = setInterval(() => {
      // guard: hráč medzitým odišiel z hry (Zavrieť/Späť na Z3, iný render) –
      // sec je odpojený → zruš visiaci interval a skonči
      if (!sec.isConnected) { clearTimer(); return; }
      remaining--;
      if (remaining <= 0) { clearTimer(); renderModeChoiceBlesk(); }
      else countdown.textContent = `${remaining} s`;
    }, 1000);
  }

  /* Voľba režimu vybavovania – PO fáze štúdia (labely už nie sú viditeľné,
     obrazovka voľby prepíše celý sec). Vzor renderModeChoice z Recallu:
     lazy import memoryTrainer.js AŽ TU (zvolené namiesto prefetchu na
     pozadí pri štarte štúdia – jednoduchšie: jedna kódová cesta bez
     stavu navyše; po prvom použití Recallu/Blesku je modul aj tak v
     cache prehliadača, takže prefetch by nič nezrýchlil). Pri
     nepodporovanom STT alebo zlyhaní importu ROVNO renderRecallPhase()
     bez voľby (nulová bariéra). memoryTrainer.js sa NEMENÍ. */
  async function renderModeChoiceBlesk() {
    hideTree();
    sec.innerHTML = '<div class="spider-game-loading">Načítavam…</div>';
    let mt = null;
    try {
      const mod = await import('../memoryTrainer.js');
      if (mod.isSpeechRecognitionSupported()) mt = mod;
    } catch (e) {
      console.warn('[BLESK] memoryTrainer.js sa nepodarilo načítať – klikací režim', e);
    }
    if (!mt) { renderRecallPhase(); return; }

    sec.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = '⚡ Blesk';

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Vyber si režim vybavovania vetiev.';

    const clickBtn = document.createElement('button');
    clickBtn.className = 'btn';
    clickBtn.style.width = '100%';
    clickBtn.textContent = 'Klikací režim';
    clickBtn.onclick = () => renderRecallPhase();

    const voiceBtn = document.createElement('button');
    voiceBtn.className = 'btn';
    voiceBtn.style.width = '100%';
    voiceBtn.style.marginTop = '8px';
    voiceBtn.textContent = '🎤 Hlasový režim';
    voiceBtn.onclick = () => renderVoiceBlesk(mt);

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';
    endBtn.onclick = backToLauncher;

    sec.append(header, hint, clickBtn, voiceBtn, endBtn);
  }

  /* Hlasová vybavovacia fáza – duplikát renderVoice z Recallu (konzistentne
     s duplicitnou stratégiou Recall/Blesk dvojčiat; Recall sa NEMENÍ).
     Dva rozdiely: header „⚡ Blesk – hlasový" a koniec ide do Bleskovho
     renderEnd („Koniec – Blesk ⚡") s pauzou „Zobraziť výsledok →".
     Všetko ostatné 1:1: kumulovaný transcript, matching >=50 % tokenov,
     ručné „✓ povedala som", nápovedy iniciály/skeleton s globálnym
     prepínačom, druhé kolo nahrávania, cleanup mikrofónu (Ukončiť/
     Hotovo/koniec/!sec.isConnected). */
  function renderVoiceBlesk(mt) {
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = '⚡ Blesk – hlasový';

    const centerCard = document.createElement('div');
    centerCard.className = 'spider-game-card-static';
    centerCard.textContent = okr.center;

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Hovor vetvy nahlas – rozpoznané sa odkryjú. Každú môžeš odškrtnúť aj ručne.';

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'spider-game-cards';

    const feedback = document.createElement('div');
    feedback.className = 'spider-game-feedback';

    const micBtn = document.createElement('button');
    micBtn.className = 'btn spider-game-mic';
    micBtn.style.width = '100%';
    micBtn.textContent = '🎤 Nahrať';

    const doneBtn = document.createElement('button');
    doneBtn.className = 'btn';
    doneBtn.style.width = '100%';
    doneBtn.style.marginTop = '8px';
    doneBtn.textContent = 'Hotovo';

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';

    let okCount = 0;
    const missedLabels = [];
    let resolvedCount = 0;
    let fullTranscript = ''; // kumulované za sedenie – neskorší výrok dopĺňa skoršie
    let recognizer = null;
    let recognizing = false;
    let hintMode = 'initials'; // 'initials' | 'skeleton' (globálny prepínač)
    const states = branches.map(() => 'hidden'); // 'hidden' | 'done'
    const hintLines = []; // { line, i } – na prepnutie typu nápovedy

    const stopRecognizer = () => { try { if (recognizer) recognizer.stop(); } catch (e) {} };
    const hintTextOf = label => (hintMode === 'initials' ? buildInitialsHint(label) : buildSkeletonHint(label));

    // Zakryté karty: „?" + ručná poistka „✓ povedala som"
    const cardEls = branches.map((branch, i) => {
      const card = document.createElement('div');
      card.className = 'spider-game-card-hidden spider-game-card-hidden-voice';
      const q = document.createElement('span');
      q.textContent = '?';
      const saidBtn = document.createElement('button');
      saidBtn.type = 'button';
      saidBtn.className = 'spider-game-saidbtn';
      saidBtn.textContent = '✓ povedala som';
      saidBtn.onclick = () => resolveCard(i, true);
      card.append(q, saidBtn);
      cardsWrap.appendChild(card);
      return card;
    });

    function resolveCard(i, isOk) {
      if (states[i] !== 'hidden') return;
      states[i] = 'done';
      resolvedCount++;
      const card = cardEls[i];
      card.className = 'spider-game-card-static ' + (isOk ? 'spider-game-col-correct' : 'spider-game-col-wrong');
      card.textContent = branches[i].label;
      if (isOk) okCount++; else missedLabels.push(branches[i].label);
      if (resolvedCount >= branches.length) {
        stopRecognizer();
        // posledná vetva: koniec sa NEukáže hneď – karty ostávajú viditeľné,
        // hráč prejde na výsledok sám
        micBtn.style.display = 'none';
        doneBtn.style.display = 'none';
        const resultBtn = document.createElement('button');
        resultBtn.className = 'btn';
        resultBtn.style.width = '100%';
        resultBtn.style.marginTop = '10px';
        resultBtn.textContent = 'Zobraziť výsledok →';
        resultBtn.onclick = () => renderEnd(okCount, branches.length, missedLabels);
        endBtn.insertAdjacentElement('beforebegin', resultBtn);
      }
    }

    /* Vetva je „povedaná", ak kumulovaný transcript obsahuje >=50 % jej
       tokenov (substring zhoda tokenov; pri 1–2 tokenoch všetky). */
    function applyTranscript() {
      const norm = normalizeVoiceText(fullTranscript);
      if (!norm) return;
      branches.forEach((branch, i) => {
        if (states[i] !== 'hidden') return;
        const tokens = labelTokens(branch.label);
        if (!tokens.length) return;
        const matched = tokens.filter(t => norm.includes(t)).length;
        const said = tokens.length <= 2 ? matched === tokens.length : matched / tokens.length >= 0.5;
        if (said) resolveCard(i, true);
      });
    }

    micBtn.onclick = () => {
      if (recognizing) { stopRecognizer(); return; }
      recognizer = mt.createSpeechRecognizer({
        onStart: () => { recognizing = true; micBtn.textContent = '⏹️ Stop'; micBtn.classList.add('spider-game-mic-on'); },
        onEnd: () => { recognizing = false; micBtn.textContent = '🎤 Nahrať'; micBtn.classList.remove('spider-game-mic-on'); },
        onError: (e) => {
          recognizing = false;
          micBtn.textContent = '🎤 Nahrať';
          micBtn.classList.remove('spider-game-mic-on');
          feedback.className = 'spider-game-feedback spider-game-feedback-bad';
          feedback.textContent = 'Mikrofón sa nepodarilo spustiť – skús znova alebo odkrývaj ručne.';
          console.warn('[BLESK] rozpoznávanie zlyhalo', e);
        },
        onResult: (transcript) => {
          if (!sec.isConnected) { stopRecognizer(); return; } // hráč medzitým odišiel z hry
          fullTranscript += ' ' + transcript;
          feedback.className = 'spider-game-feedback';
          feedback.textContent = `Počula som: „${transcript}“`;
          applyTranscript();
        }
      }, { continuous: mt.isLikelyDesktop() });
      if (!recognizer) {
        feedback.className = 'spider-game-feedback spider-game-feedback-bad';
        feedback.textContent = 'Rozpoznávanie hlasu nie je dostupné – odkrývaj ručne.';
        return;
      }
      // .start() PRIAMO v click handleri (user gesture – nutné na mobile)
      try { recognizer.start(); } catch (e) { console.warn('[BLESK] recognizer.start zlyhal', e); }
    };

    // Globálny prepínač typu nápovedy (zobrazí sa až po „Hotovo")
    const toggleRow = document.createElement('div');
    toggleRow.className = 'spider-game-hinttoggle';
    const initialsBtn = document.createElement('button');
    initialsBtn.type = 'button';
    initialsBtn.textContent = 'Iniciály';
    const skeletonBtn = document.createElement('button');
    skeletonBtn.type = 'button';
    skeletonBtn.textContent = 'Skeleton';
    toggleRow.append(initialsBtn, skeletonBtn);

    function refreshHintUi() {
      initialsBtn.classList.toggle('spider-game-hinttoggle-active', hintMode === 'initials');
      skeletonBtn.classList.toggle('spider-game-hinttoggle-active', hintMode === 'skeleton');
      hintLines.forEach(h => { if (states[h.i] === 'hidden') h.line.textContent = hintTextOf(branches[h.i].label); });
    }
    initialsBtn.onclick = () => { hintMode = 'initials'; refreshHintUi(); };
    skeletonBtn.onclick = () => { hintMode = 'skeleton'; refreshHintUi(); };

    // „Hotovo": nepovedané karty prejdú do nápovedného stavu (✓ Viem / ✗ Odkry)
    doneBtn.onclick = () => {
      stopRecognizer();
      doneBtn.style.display = 'none'; // úlohu splnilo; mikrofón ostáva (druhé kolo)
      sec.insertBefore(toggleRow, cardsWrap);
      branches.forEach((branch, i) => {
        if (states[i] !== 'hidden') return;
        const card = cardEls[i];
        card.classList.add('spider-game-card-hint');
        card.textContent = '';
        const line = document.createElement('div');
        line.className = 'spider-game-hintline';
        line.textContent = hintTextOf(branch.label);
        hintLines.push({ line, i });
        const chk = document.createElement('div');
        chk.className = 'spider-game-selfcheck';
        const knowBtn = document.createElement('button');
        knowBtn.className = 'btn';
        knowBtn.textContent = '✓ Viem';
        knowBtn.onclick = () => resolveCard(i, true);
        const openBtn = document.createElement('button');
        openBtn.className = 'btn';
        openBtn.textContent = '✗ Odkry';
        openBtn.onclick = () => resolveCard(i, false);
        chk.append(knowBtn, openBtn);
        card.append(line, chk);
      });
      refreshHintUi();
    };

    endBtn.onclick = () => { stopRecognizer(); backToLauncher(); };

    sec.append(header, centerCard, hint, cardsWrap, feedback, micBtn, doneBtn, endBtn);
  }

  /* Fáza VYBAVOVANIA – duplikát Recall reveal fázy. */
  function renderRecallPhase() {
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = '⚡ Blesk – vybav si';

    const centerCard = document.createElement('div');
    centerCard.className = 'spider-game-card-static';
    centerCard.textContent = okr.center;

    const hint = document.createElement('div');
    hint.className = 'spider-game-hint';
    hint.textContent = 'Odkrývaj vetvy po jednej a ohodnoť, či si si ich vybavila.';

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'spider-game-cards';

    const revealBtn = document.createElement('button');
    revealBtn.className = 'btn';
    revealBtn.style.width = '100%';
    revealBtn.style.marginTop = '10px';
    revealBtn.textContent = 'Odkry ďalšiu vetvu';

    const endBtn = document.createElement('button');
    endBtn.className = 'btn spider-game-endbtn';
    endBtn.style.width = '100%';
    endBtn.textContent = 'Ukončiť hru';
    endBtn.onclick = () => { clearTimer(); backToLauncher(); }; // clearTimer defenzívne (časovač už nebeží)

    let idx = 0;
    let okCount = 0;
    const missedLabels = [];

    const cardEls = branches.map(() => {
      const card = document.createElement('div');
      card.className = 'spider-game-card-hidden';
      card.textContent = '?';
      cardsWrap.appendChild(card);
      return card;
    });

    function finish() {
      renderEnd(okCount, branches.length, missedLabels);
    }

    revealBtn.onclick = () => {
      if (idx >= branches.length) return;
      const branch = branches[idx];
      const card = cardEls[idx];
      idx++;
      revealBtn.disabled = true; // kým hráč neoznačí ✓/✗

      card.className = 'spider-game-card-static';
      card.textContent = '';
      const label = document.createElement('div');
      label.className = 'spider-game-revealed-label';
      label.textContent = branch.label;

      const selfcheck = document.createElement('div');
      selfcheck.className = 'spider-game-selfcheck';
      const okBtn = document.createElement('button');
      okBtn.className = 'btn';
      okBtn.textContent = '✓ Vybavila som si';
      const noBtn = document.createElement('button');
      noBtn.className = 'btn';
      noBtn.textContent = '✗ Nevybavila';

      const showLeavesBtn = document.createElement('button');
      showLeavesBtn.className = 'spider-game-linkbtn';
      showLeavesBtn.textContent = 'Ukáž listy';
      showLeavesBtn.onclick = () => {
        const box = document.createElement('div');
        box.className = 'spider-game-revealed';
        branch.leaves.forEach(text => {
          const leaf = document.createElement('div');
          leaf.className = 'spider-game-leaf-static';
          leaf.textContent = text;
          box.appendChild(leaf);
        });
        card.appendChild(box);
        showLeavesBtn.remove();
      };

      function mark(isOk) {
        if (isOk) { okCount++; card.classList.add('spider-game-col-correct'); }
        else { missedLabels.push(branch.label); card.classList.add('spider-game-col-wrong'); }
        selfcheck.remove();
        if (idx >= branches.length) {
          // posledná vetva: koniec sa NEukáže hneď – karty ostávajú viditeľné,
          // hráč prejde na výsledok sám
          revealBtn.style.display = 'none';
          const resultBtn = document.createElement('button');
          resultBtn.className = 'btn';
          resultBtn.style.width = '100%';
          resultBtn.style.marginTop = '10px';
          resultBtn.textContent = 'Zobraziť výsledok →';
          resultBtn.onclick = () => finish();
          revealBtn.insertAdjacentElement('afterend', resultBtn);
        }
        else revealBtn.disabled = false;
      }
      okBtn.onclick = () => mark(true);
      noBtn.onclick = () => mark(false);

      selfcheck.append(okBtn, noBtn);
      card.append(label, selfcheck, showLeavesBtn);
    };

    sec.append(header, centerCard, hint, cardsWrap, revealBtn, endBtn);
  }

  /* Koniec – duplikát Recall koncovej obrazovky (header "Blesk ⚡"). */
  function renderEnd(okCount, total, missedLabels) {
    hideTree();
    sec.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'spider-game-header';
    header.textContent = 'Koniec – Blesk ⚡';

    const score = document.createElement('div');
    score.className = 'spider-game-score';
    score.textContent = `${okCount}/${total} vetiev`;

    sec.append(header, score);

    if (missedLabels.length) {
      const missed = document.createElement('div');
      missed.className = 'spider-game-missed';
      const head = document.createElement('div');
      head.className = 'spider-game-missed-head';
      head.textContent = 'Na zopakovanie:';
      missed.appendChild(head);
      missedLabels.forEach(lbl => {
        const item = document.createElement('div');
        item.className = 'spider-game-missed-item';
        item.textContent = `• ${lbl}`;
        missed.appendChild(item);
      });
      sec.appendChild(missed);
    }

    const again = document.createElement('button');
    again.className = 'btn';
    again.style.width = '100%';
    again.textContent = '↻ Ešte raz';
    again.onclick = () => renderStudy(); // nový beh vrátane fázy štúdia + časovača

    const back = document.createElement('button');
    back.className = 'btn';
    back.style.width = '100%';
    back.style.marginTop = '8px';
    back.textContent = '← Späť na strom';
    back.onclick = backToLauncher;

    sec.append(again, back);
  }

  renderStudy();
}
