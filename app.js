'use strict';

import { $ } from './core.js';
import { renderAdminPanel } from './admin.js';
import { startDuel, pickOkruhPair } from './scripts/duels.js';
import { claimNick, isValidNick } from './scripts/pinAuth.js';
import { MEMORY_AREAS } from './memoryDefinitions.js';

/* =====================================================
   RENDER ŠTUDIJNÝCH MODULOV (externé appky z catalog)
   ===================================================== */
/* Jedna dlaždica katalógu. Vzhľad ostáva presne ako doteraz – .chip,
   rovnaké otváranie cez window.catalog.openExternal. */
function buildModuleChip(name, item) {
  const btn = document.createElement('button');
  btn.className = 'chip';
  btn.type = 'button';
  btn.textContent = name;

  btn.onclick = () => openModuleItem(item);

  return btn;
}

/* Otvorenie jedného modulu – jedno miesto pre dlaždicu v paneli aj pre
   priame otvorenie z Pokladne vedomostí, nech sa tie dve cesty nemôžu
   rozísť (loader, logovanie, fallback). */
export function openModuleItem(item) {
  if (!item || !item.openExternal) return;
  console.log("Otváram externú appku:", item.openExternal);

  if (typeof window.catalog.openExternal === 'function') {
    window.catalog.openExternal(item.openExternal);
  } else {
    // fallback – otvorenie URL
    window.location.href = item.openExternal;
  }
}

/* Moduly patriace oblasti. Vracia dvojice [názov, záznam] v poradí,
   v akom stoja v data.js. */
export function modulesForArea(areaName) {
  if (!areaName || typeof window.catalog === 'undefined') return [];
  return Object.keys(window.catalog)
    .map(name => [name, window.catalog[name]])
    .filter(([, item]) => item && item.openExternal && item.area === areaName);
}

/* Bifľovačka existuje len pre tri finančné oblasti (MEMORY_AREAS
   v memoryDefinitions.js). Pre ostatné vracia null a dlaždica sa
   vôbec nezobrazí – mŕtvy klik je horší než chýbajúca dlaždica. */
export function biflovackaSlugForArea(areaName) {
  const a = MEMORY_AREAS.find(x => x.name === areaName);
  return a ? a.slug : null;
}

/* Moduly sa po novom ukazujú pod dlaždicou 🏦 Pokladňa vedomostí, a to
   len pre PRÁVE VYBRANÚ oblasť – preto parameter. Bez oblasti vypíšeme
   vetu namiesto prázdneho zoznamu, aby hráč vedel, čo mu chýba. */
function renderModules(areaName) {
  const list = $('modulesList');
  if (!list || typeof window.catalog === 'undefined') return;

  list.innerHTML = '';

  if (!areaName) {
    const hint = document.createElement('div');
    hint.className = 'small';
    hint.textContent = 'Najprv si vyber oblasť vyššie – potom tu nájdeš jej výklad a teóriu.';
    list.appendChild(hint);
    return;
  }

  /* window.catalog nesie aj funkciu openExternal – tá nemá vlastnú
     .openExternal vlastnosť, takže sa filtrom nižšie prirodzene vynechá
     (rovnaká podmienka ako pôvodne). */
  const entries = modulesForArea(areaName);

  if (!entries.length) {
    const hint = document.createElement('div');
    hint.className = 'small';
    hint.textContent = 'Pre túto oblasť zatiaľ modul nie je. Otázky aj pavúk fungujú normálne.';
    list.appendChild(hint);
    return;
  }

  entries.filter(([, item]) => !item.legacy)
         .forEach(([name, item]) => list.appendChild(buildModuleChip(name, item)));

  /* Staršie samostatné appky (legacy: true v data.js) idú pod jednu
     zbaliteľnú dlaždicu, nech hlavný zoznam drží len plnohodnotné
     oblasti. Rozbaľovač je bežný .chip a rozbalený zoznam je .list –
     žiadny nový vizuálny jazyk. */
  const legacy = entries.filter(([, item]) => item.legacy);
  if (!legacy.length) return;

  const box = document.createElement('div');
  box.id = 'moreModulesBox';
  box.className = 'list';
  box.style.width = '100%';   // .list je flex-wrap → vlastný riadok
  box.style.display = 'none';
  legacy.forEach(([name, item]) => box.appendChild(buildModuleChip(name, item)));

  const toggle = document.createElement('button');
  toggle.className = 'chip';
  toggle.type = 'button';
  toggle.id = 'moreModulesBtn';
  toggle.setAttribute('aria-expanded', 'false');
  const label = (open) => `${open ? '▾' : '▸'} Ďalší obsah (${legacy.length})`;
  toggle.textContent = label(false);

  toggle.onclick = () => {
    const open = box.style.display === 'none';
    box.style.display = open ? 'flex' : 'none';
    toggle.textContent = label(open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  list.appendChild(toggle);
  list.appendChild(box);
}

/* =====================================================
   RENDER OBLASTÍ NA DUEL (interné balíky z areas)
   ===================================================== */

/* Posledný zvolený režim výberu dvojice okruhov – prežíva prepnutie
   oblasti (pohodlnejšie pre študenta), default je 🎲 náhodne. */
let currentOkruhMode = 'random';

const OKRUH_MODES = [
  { key: 'random', label: '🎲 Náhodne' },
  { key: 'studied', label: '📗 Preštudované' },
  { key: 'unstudied', label: '📕 Na precvičenie' }
];

/* Malé dlaždice závislé od oblasti. Volá sa po každom prepnutí oblasti:
   Bifľovačka sa skryje/odkryje a otvorený panel Pokladne sa prekreslí –
   inak by pod novým názvom oblasti visel starý modul. */
export function syncAreaTiles(areaName) {
  const bif = $('openBiflovackaBtn');
  if (bif) {
    const slug = biflovackaSlugForArea(areaName);
    bif.dataset.slug = slug || '';
    /* Skrývame len pri VYBRANEJ oblasti bez bifľovačky (školské oblasti).
       Bez vybranej oblasti dlaždica ostáva – inak by o bifľovačke hráč pri
       prvom príchode nevedel; klik ho vtedy pošle k výberu oblasti. */
    bif.style.display = (areaName && !slug) ? 'none' : '';
  }

  const panel = $('modulesPanel');
  if (panel && panel.style.display !== 'none') fillModulesPanel(areaName);
}

/* Obsah panela Pokladne. Jedno miesto pre obe cesty – otvorenie dlaždicou
   aj prepnutie oblasti pri otvorenom paneli – aby sa popisok nelíšil
   podľa toho, ktorou z nich hráč prišiel. Panel sa otvára len vtedy, keď
   je naozaj čo vyberať alebo čo povedať; jediný modul sa otvára priamo. */
export function fillModulesPanel(areaName) {
  const sub = $('modulesPanelSub');
  if (sub) {
    sub.textContent = modulesForArea(areaName).length
      ? 'Vyber si modul oblasti ' + areaName + '.'
      : 'Výklad a teória k vybranej oblasti.';
  }
  renderModules(areaName);
}

function renderAreas() {
  const list = $('areasList');
  if (!list || typeof window.areas === 'undefined') return;

  list.innerHTML = '';

  Object.keys(window.areas).forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'chip area-chip';
    btn.textContent = name;
    btn.dataset.area = name;

    btn.onclick = () => {
      // Zruš zvýraznenie všetkých
      list.querySelectorAll('.area-chip').forEach(b => {
        b.classList.remove('chip-active');
      });

      // Zvýrazni vybraný
      btn.classList.add('chip-active');

      const quizTitle = $('quizTitle');
      const areaTitle = $('areaTitle');

      if (quizTitle) quizTitle.textContent = 'Vyber si oblasť a hraj';
      if (areaTitle) areaTitle.textContent = name;

      window.__selectedAreaName = name;
      renderOkruhModePicker(name);
      applyOkruhPairSelection(name, currentOkruhMode);

      syncAreaTiles(name);
    };

    list.appendChild(btn);
  });

  markUnavailableAreaChips(list);
}

/* ============================================================
   CHIPY OBLASTÍ BEZ OBSAHU – "načítava sa…" → "pripravuje sa"

   Rímske právo a Dejiny práva sú v duelAreas (areas.js), ale data.js pre
   ne nenačítava žiadne otázky, takže viedli do slepej uličky: dali sa
   vybrať, pojednávanie sa nespustilo a hry ostali prázdne. Po dobehnutí
   načítavania sa preto chip označí a klik zablokuje.

   🔥 HOTFIX (2026-08): označenie sa PO NOVOM naozaj samo odstráni.
   Pôvodná verzia sa po 5 s (waitAreaLoaded) vzdala a chip nechala
   zamknutý NAVŽDY – markUnavailableAreaChips totiž beží presne raz
   (renderAreas má jediného volajúceho, init.js) a isAreaLoaded sa už
   nikdy nepýtala. Loader v data.js je pritom SÉRIOVÝ a na každý súbor
   robí fetch + čítanie contentOverrides, takže 5 s nestačí: Pracovné
   právo (50 súborov) a Občianske (hmotné 40 + procesné 45, potrebuje
   OBA flagy) hranicu na pomalšom pripojení prekročia a zošednú, hoci
   sa o pár sekúnd načítajú. Európske (38) a Trestné (30) prejdú –
   presne to bolo vidieť v produkcii.

   Preto sú stavy po novom dva:
     – "načítava sa…"  = zatiaľ nedorazilo, ale ešte to skúšame (poll),
     – "pripravuje sa" = po AREA_GIVE_UP_MS to nedorazilo (Rímske/Dejiny
                         sem spadnú vždy – data.js pre ne loader nemá).
   Len čo areasLoaded naskočí, chip sa odomkne a text sa vráti späť.

   Timeout vo waitAreaLoaded (5 s) sa ZÁMERNE nemení – rieši sa tu len
   to, že sa označenie neodstraňovalo. Zrýchlenie samotného loadera
   (dávkové načítanie + jedno čítanie contentOverrides na oblasť) je
   samostatná úloha.

   ⚠️ Čisto správanie + popis, ŽIADNA zmena vzhľadu: ani trieda .muted, ani
   atribút disabled nemajú v styles.css vlastné pravidlo (overené – chip
   s .muted aj s disabled je pixelovo identický s bežným chipom; appka
   nemá disabled štýl nikde, ani #startQuizBtn). Stav je preto čitateľný
   výhradne z textu. Vizuálne odlíšenie by si vyžiadalo NOVÉ CSS
   pravidlo = zmena dizajnu, ktorá čaká na odsúhlasenie.
============================================================ */

/* Ako často sa po prvom neúspechu ešte pýtame na areasLoaded. */
const AREA_SLOW_POLL_MS = 250;
/* Dokedy (od označenia) chip drží mierne "načítava sa…". Po uplynutí sa
   prehlási za "pripravuje sa" a poll sa zastaví. 30 s je s rezervou nad
   reálnym trvaním sériového loadera aj na pomalom mobile; Rímske a Dejiny
   sem doputujú vždy, lebo pre ne loader neexistuje. */
const AREA_GIVE_UP_MS = 3000;

function markChipPending(btn, name, label, title) {
  btn.disabled = true;
  btn.classList.add('muted');
  btn.title = title;
  btn.textContent = `${name} – ${label}`;
}

/* Vráti chip presne do stavu, v akom ho vytvorilo renderAreas() – vrátane
   odstránenia titulku (bežný chip žiadny nemá). Handler onclick sa nikdy
   neodpájal, takže stačí povoliť tlačidlo. */
function releaseChip(btn, name) {
  btn.disabled = false;
  btn.classList.remove('muted');
  btn.removeAttribute('title');
  btn.textContent = name;
}

function watchAreaChip(btn, name) {
  const deadline = Date.now() + AREA_GIVE_UP_MS;
  const timer = setInterval(() => {
    /* Chip zmizol z DOM (re-render zoznamu) – nemá zmysel ďalej pollovať
       ani písať do odpojeného uzla. */
    if (!btn.isConnected) { clearInterval(timer); return; }

    if (isAreaLoaded(name)) {
      clearInterval(timer);
      releaseChip(btn, name);
      return;
    }

    if (Date.now() >= deadline) {
      clearInterval(timer);
      markChipPending(btn, name, 'pripravuje sa', 'Obsah tejto oblasti sa pripravuje');
    }
  }, AREA_SLOW_POLL_MS);
}

async function markUnavailableAreaChips(list) {
  const chips = Array.from(list.querySelectorAll('.area-chip'));
  await Promise.all(chips.map(async (btn) => {
    const name = btn.dataset.area;
    await waitAreaLoaded(name);      // max 5 s, existujúca helper nižšie
    if (isAreaLoaded(name)) return;  // obsah dorazil – chip ostáva bežný

    /* Zatiaľ NEtvrdíme, že obsah neexistuje – po 5 s to ešte nevieme. */
    markChipPending(btn, name, 'načítava sa…', 'Obsah tejto oblasti sa ešte načítava');
    watchAreaChip(btn, name);
  }));
}

/* =====================================================
   VÝBER REŽIMU DVOJICE OKRUHOV (🎲/📗/📕)
   ===================================================== */
function renderOkruhModePicker(areaName) {
  let box = document.getElementById('okruhModePicker');
  if (!box) {
    box = document.createElement('div');
    box.id = 'okruhModePicker';
    box.style.cssText = 'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap';
    const areasInQuiz = document.getElementById('areasInQuiz');
    if (areasInQuiz) areasInQuiz.appendChild(box);
  }

  box.innerHTML = '';
  OKRUH_MODES.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip mode-chip' + (m.key === currentOkruhMode ? ' chip-active' : '');
    b.textContent = m.label;
    b.onclick = () => {
      currentOkruhMode = m.key;
      box.querySelectorAll('.mode-chip').forEach(x => x.classList.remove('chip-active'));
      b.classList.add('chip-active');
      applyOkruhPairSelection(areaName, currentOkruhMode);
    };
    box.appendChild(b);
  });
}

function modeEmptyMessage(mode) {
  if (mode === 'studied') {
    return 'Zatiaľ nemáš žiadnu tému preštudovanú v študijnom module – vyberáme náhodne.';
  }
  if (mode === 'unstudied') {
    return 'Nepodarilo sa vybrať témy podľa progresu – vyberáme náhodne.';
  }
  return '';
}

/* =====================================================
   EXPORTY
   ===================================================== */

/* ===============================
   PRELOAD MEMORY + CASES pre vybranú oblasť
   =============================== */
function isAreaLoaded(areaName) {
  if (areaName === 'Trestné právo') {
    return !!(window.areasLoaded?.['Trestné právo hmotné'] && window.areasLoaded?.['Trestné právo procesné']);
  }
  if (areaName === 'Občianske právo') {
    return !!(window.areasLoaded?.['Občianske právo hmotné'] && window.areasLoaded?.['Občianske právo procesné']);
  }
  return !!window.areasLoaded?.[areaName];
}

function waitAreaLoaded(areaName) {
  /* 🔥 OPRAVA: čaká na príznak "načítanie dokončené" (nie na dĺžku
     otázok) – oblasť s čiastočne/zatiaľ nenaplnenými dátami (napr.
     Európske právo pred doplnením obsahu) inak nikdy nesplní
     "length > 0" a __areaTilesForGames/__areaQuestionsForGames
     ostanú navždy zo STARŠEJ vybranej oblasti (zavádzajúce). */
  return new Promise(resolve => {
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (isAreaLoaded(areaName) || attempts > 50) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
}

/* Filtruje dlaždice/prípady presne podľa dvojice { area, key } – NIE podľa
   holého source kľúča naprieč zlúčenou oblasťou. Hmotné aj procesné podoblasti
   majú vlastné A1..A30/A40/A45 súbory s ROVNAKÝMI source kľúčmi (napr. "A15"
   existuje v oboch), takže filter len podľa kľúča by omylom zobral obsah
   z oboch okruhov naraz. */
function filterBySources(store, sources) {
  if (!Array.isArray(sources) || !sources.length) return [];
  const out = [];
  sources.forEach(({ area, key }) => {
    const list = store?.[area] || [];
    out.push(...list.filter(item => item.source === key));
  });
  return out;
}

/* Poradové číslo session-u – zabráni tomu, aby výsledok pomalšieho
   (starého) volania prepísal medzičasom vybranú novú oblasť/režim. */
let okruhSelectionToken = 0;

async function applyOkruhPairSelection(areaName, mode) {
  const token = ++okruhSelectionToken;

  const hint = document.getElementById('gamesAreaHint');
  if (hint) {
    hint.classList.remove('games-hint-ready');
    hint.innerHTML = `<span class="games-hint-dot"></span><strong>${areaName}</strong> – vyberám okruhy…`;
  }

  /* Kým sa nevyberie nová dvojica, nedovoľ spustiť pojednávanie so starou
     (z inej oblasti/režimu). Dlaždica Výzvy (#openDuelBankTile) sem nepatrí –
     register od výberu oblasti nezávisí a je aktívny vždy. */
  const startBtnEarly = $('startQuizBtn');
  if (startBtnEarly) { startBtnEarly.disabled = true; startBtnEarly.onclick = null; }

  await waitAreaLoaded(areaName);
  if (token !== okruhSelectionToken) return; // medzitým sa zvolila iná oblasť/režim

  const nick = localStorage.getItem('playerNick') || null;
  const result = await pickOkruhPair(areaName, mode, nick);
  if (token !== okruhSelectionToken) return;

  window.__selectedOkruhPair = { area: areaName, mode, ...result };
  window.__areaQuestionsForGames = result.questions;
  window.__areaTilesForGames = filterBySources(window.areaTiles, result.sources);
  window.__areaCasesForGames = filterBySources(window.areaCases, result.sources);

  const nTiles = window.__areaTilesForGames.length;
  const nCases = window.__areaCasesForGames.length;
  console.log(`🎮 ${areaName} [${mode}]: okruhy ${result.keys.join('+') || '—'}, ${result.questions.length} otázok, ${nTiles} dlaždíc, ${nCases} prípadov`);

  const startBtn = $('startQuizBtn');
  if (startBtn) {
    if (result.empty || !result.questions.length) {
      startBtn.disabled = true;
      startBtn.onclick = null;
    } else {
      startBtn.disabled = false;
      /* Text sa ZÁMERNE neprepisuje – #startQuizBtn je od prestavby na
         dlaždice HTML blok (ikona/názov/popis) a textContent by ho zmazal.
         Pôvodný zápis 'Spustiť pojednávanie' tu bol len preto, aby z popisku
         zmizlo emoji, ktoré už aj tak nie je súčasťou textu. */
      startBtn.onclick = () => {
        console.log('Spúšťam duel pre oblasť:', areaName, 'okruhy:', result.keys);
        startDuel(areaName, result);
      };
    }
  }

  if (hint) {
    if (result.empty) {
      hint.classList.remove('games-hint-ready');
      hint.innerHTML = `<span class="games-hint-dot"></span><strong>${areaName}</strong> – obsah sa ešte pripravuje`;
    } else {
      const okruhLabel = result.keys.join(' + ');
      const fallbackMsg = result.usedFallback ? ` ${modeEmptyMessage(mode)}` : '';
      if (nTiles || nCases || result.questions.length) {
        hint.classList.add('games-hint-ready');
        hint.innerHTML = `<span class="games-hint-dot ready"></span>
          <strong>${areaName}</strong> – okruhy ${okruhLabel}: pripravené ${nTiles} kartičiek, ${nCases} prípadov${fallbackMsg}`;
      } else {
        hint.classList.remove('games-hint-ready');
        hint.innerHTML = `<span class="games-hint-dot"></span>
          <strong>${areaName}</strong> – okruhy ${okruhLabel} zatiaľ nemajú obsah${fallbackMsg}`;
      }
    }
  }
}

export { renderAreas, renderModules, updateNickUI };

/* =====================================================
   NICK HRÁČA – uloženie a načítanie
   ===================================================== */

/* Jednotné miesto pre stav hlavičky podľa nicku – volá sa pri štarte appky,
   po úspešnom claimNick() (hlavné pole aj duel-link) a pri odhlásení.
   nick = meno hráča → schová .nick-box, ukáže meno v #playerNickDisplay.
   nick = null (odhlásenie) → opačne, nech má hráč kam zadať nový nick.
   Predtým toto (len schovanie boxu) robil paralelný lexarena_nick handler
   v ui.js, odstránený vo Fáze 4 Kroku 1 – táto funkcia nahrádza jeho
   jedinú živú funkciu na jednom mieste namiesto duplicity na 3 miestach. */
function updateNickUI(nick) {
  const nickBox = document.querySelector('.nick-box');
  const nickDisplay = $('playerNickDisplay');
  if (nickDisplay) nickDisplay.textContent = nick || '';
  if (nickBox) nickBox.style.display = nick ? 'none' : '';
}

const saveNickBtn = $('saveNick');
if (saveNickBtn) {
  saveNickBtn.addEventListener("click", async () => {
    const nick = $('nickname').value.trim();

    // ⚠️ Obyčajné znovu-uloženie toho istého nicku (napr. po reloade stránky
    // s už predvyplneným poľom) – NIKDY Firebase check, NIKDY PIN prompt.
    // Vracajúci sa hráč sa tu nesmie stretnúť so žiadnym novým trením
    // (Fáza 2, 2026-07-20, bod 2/4 zadania).
    //
    // ⚠️ MUSÍ ZOSTAŤ PRED VALIDÁCIOU TVARU (A2a). V databáze sú nicky
    // z čias, keď validácia neexistovala – dlhé, s bodkou, s lomkou.
    // Keby sa validovalo skôr, vracajúci sa hráč s takým nickom by po
    // kliku na „Uložiť" dostal chybovú hlášku o vlastnom, roky
    // používanom nicku. Tu sa jeho vetva končí ešte pred validáciou.
    if (nick === localStorage.getItem("playerNick")) return;

    /* Validácia tvaru (A2a) – až TU, teda výhradne pre nick, ktorý sa
       práve zakladá alebo mení. Uložený nick sa cez ňu nikdy nepúšťa
       (ani tu, ani na load ceste pri `savedNick` nižšie). */
    const shapeCheck = isValidNick(nick);
    if (!shapeCheck.ok) {
      alert(shapeCheck.reason);
      return;
    }

    const originalLabel = saveNickBtn.textContent;
    saveNickBtn.disabled = true;
    saveNickBtn.textContent = 'Overujem...';

    try {
      let result = await claimNick(nick, null);

      // Nick existuje a je chránený PIN-om – vyžiadaj ho a skús znova
      // s tým istým claimNick() (jedna zdieľaná logika, nie dve kópie).
      if (!result.ok && result.reason === 'pin-required') {
        const pinAttempt = prompt(`Nick „${nick}" existuje a je chránený PIN-om.\nZadaj PIN:`);
        if (!pinAttempt) return; // zrušené používateľom, nič sa nemení
        result = await claimNick(nick, pinAttempt);
      }

      if (!result.ok) {
        // ⚠️ Nesedí PIN – ODMIETNI, NIKDY nezaložiť nový prázdny účet
        // namiesto pôvodného (presne to pôvodne chýbalo).
        alert('Nesprávny PIN pre tento nick. Skús znova, alebo si over, či si nick nezadal preklepom.');
        return;
      }

      // VETVA A (nový nick) sa tu zámerne NEPOTVRDZUJE dodatočným dialógom –
      // pridalo by to trenie KAŽDÉMU novému hráčovi (drvivá väčšina "nových
      // nickov" sú skutočne noví hráči, nie preklepy), zatiaľ čo pôvodný bug
      // (tichá strata existujúceho účtu) rieši už samotné rozlíšenie
      // vetiev A/B/C vyššie – existujúci nick sa už nikdy nezamení za nový.
      /* A2a: bez reloadu. claimNickInline() (init.js) uloží nick a dobehne
         presne tie kroky, ktoré anon vetva vynechala – avatar, § panel,
         rola, senáty, fakulty, analytika. Reload bol jediné, čo to dovtedy
         zabezpečovalo, a pre progresívny nick (A4/A5) je neprijateľný:
         prompt uprostred hry by obnovil stránku a zahodil rozohranú
         aktivitu.

         Fallback na pôvodné správanie, keby sa init.js nenačítal – radšej
         reload než nick uložený bez nadviazaného stavu. */
      if (typeof window.claimNickInline === 'function') {
        await window.claimNickInline(nick);
      } else {
        console.warn('⚠️ claimNickInline nie je dostupná – padám späť na reload');
        localStorage.setItem("playerNick", nick);
        updateNickUI(nick);
        window.location.reload();
      }
    } finally {
      saveNickBtn.disabled = false;
      saveNickBtn.textContent = originalLabel;
    }
  });
}

const savedNick = localStorage.getItem("playerNick");
if (savedNick) {
  const nickInput = $('nickname');
  if (nickInput) nickInput.value = savedNick;
  updateNickUI(savedNick);
}

/* =====================================================
   ADMIN PANEL (prepínač rolí)
   ===================================================== */
const toggleRoleBtn = $('toggleRoleBtn');
if (toggleRoleBtn) {
  toggleRoleBtn.addEventListener('click', () => {
    const current = localStorage.getItem('userRole') || 'student';
    const next = current === 'student' ? 'garant' : 'student';
    localStorage.setItem('userRole', next);
    toggleRoleBtn.textContent = `Role: ${next}`;
    renderAdminPanel();
  });

  // inicializácia
  const role = localStorage.getItem('userRole') || 'student';
  toggleRoleBtn.textContent = `Role: ${role}`;
  renderAdminPanel();
}
