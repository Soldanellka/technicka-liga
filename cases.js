'use strict';

import { $, escapeHtml, LS, closeModal, shuffleOptions } from './core.js';
import {
  currentCaseSet,
  answeredCases,
  setAnsweredCases
} from './state.js';
import { showRewardToast } from './ui.js';
import { incrementGamesPlayed } from './avatars.js';
import { econEnergy, econAward, ECONOMY_CONFIG } from './scripts/economy.js';
import { recordOkruhResult, PROGRESS_ACTIVITIES } from './scripts/progressTracking.js';
import { renderSource } from './scripts/sourceUtil.js';
import { AREA_SLUGS, formatEditStamp, sealMeta } from './scripts/contentOverrides.js';
import { openContentEditModal } from './scripts/contentEditModal.js';
import { getRole } from './scripts/economyConfig.js';

/* Per-step zdroj: na rozdiel od case-level/okruh-level renderSource() (kde
   chýbajúci zdroj zámerne zobrazí "Zdroj: doplní sa"), tu sa má krok bez
   vlastného zdroja/source úplne vynechať – inak by pod každým jedným krokom
   viselo rovnaké "doplní sa", aj keď väčšina oblastí per-step zdroj vôbec
   nepoužíva. */
function renderStepSource(step) {
  return step && step.zdroj ? renderSource(step.zdroj) : '';
}

/* =========================
   Storage keys
   ========================= */
function answeredCasesStorageKey(setKey){
  return LS.ANSWERED_CASES_PREFIX + setKey;
}

/* =========================
   Load answered cases
   ========================= */
export function loadAnsweredCases(setKey){
  const raw = localStorage.getItem(answeredCasesStorageKey(setKey));
  if(raw){
    try {
      const arr = JSON.parse(raw);
      setAnsweredCases(new Set(arr));
    } catch(e){
      setAnsweredCases(new Set());
    }
  } else {
    setAnsweredCases(new Set());
  }
}

/* =========================
   Save answered cases
   ========================= */
export function saveAnsweredCases(setKey){
  try {
    localStorage.setItem(
      answeredCasesStorageKey(setKey),
      JSON.stringify(Array.from(answeredCases))
    );
  } catch(e){}
}

/* =========================
   Render case
   ========================= */
export function renderCase(){
  const container = $('caseContainer');
  if(!container) return;

  const set = window.cases?.[currentCaseSet] ?? [];

  if(set.length === 0){
    container.innerHTML = '<div class="small">Žiadne prípady v tejto oblasti.</div>';
    return;
  }

  const c = set[currentCaseIndex];
  const done = answeredCases.has(c.id);

  container.innerHTML = '';

  const titleWrap = document.createElement('div');
  titleWrap.style.fontWeight = '700';
  titleWrap.style.display = 'flex';
  titleWrap.style.alignItems = 'center';
  titleWrap.style.gap = '8px';
  titleWrap.textContent = c.title;

  if(done){
    const img = document.createElement('img');
    img.src = 'assets/icons/check.svg';
    img.alt = 'vyriešené';
    img.style.width = '18px';
    img.style.height = '18px';
    img.style.marginLeft = '8px';
    titleWrap.appendChild(img);
  }

  container.appendChild(titleWrap);

  const text = document.createElement('div');
  text.className = 'small';
  text.style.marginTop = '8px';
  text.textContent = c.text;
  container.appendChild(text);

  const optsWrap = document.createElement('div');
  optsWrap.style.marginTop = '12px';
  optsWrap.style.display = 'flex';
  optsWrap.style.flexDirection = 'column';
  optsWrap.style.gap = '8px';

  c.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'btn case-opt';
    btn.dataset.case = c.id;
    btn.dataset.opt = opt.id;
    btn.textContent = opt.text;

    if(done) btn.disabled = true;

    btn.addEventListener('click', () =>
      submitCase(btn.dataset.case, btn.dataset.opt)
    );

    optsWrap.appendChild(btn);
  });

  container.appendChild(optsWrap);

  const nav = document.createElement('div');
  nav.style.marginTop = '12px';
  nav.style.display = 'flex';
  nav.style.gap = '8px';

  const prev = document.createElement('button');
  prev.className = 'btn';
  prev.textContent = 'Predchádzajúci';
  prev.addEventListener('click', prevCase);

  const next = document.createElement('button');
  next.className = 'btn btn-primary';
  next.textContent = 'Ďalší';
  next.addEventListener('click', nextCase);

  nav.appendChild(prev);
  nav.appendChild(next);
  container.appendChild(nav);
}

/* =========================
   Submit case
   ========================= */
export function submitCase(caseId, optionId){
  const set = window.cases?.[currentCaseSet] ?? [];
  const c = set.find(x => x.id === caseId);
  if(!c) return;

  if(answeredCases.has(caseId)){
    showRewardToast('Tento prípad už je vyriešený.');
    return;
  }

  const opt = c.options.find(o => o.id === optionId);
  if(!opt) return;

  showRewardToast(opt.feedback || 'Spätná väzba');

  if(opt.correct){
    // § za správny prípad sa už nepripisuje priebežne z localStorage – odmena za
    // prípady ide výhradne cez Firebase pri dokončení celej sady (econAward nižšie).
    answeredCases.add(caseId);
    saveAnsweredCases(currentCaseSet);
  }

  renderCase();

  const total = set.length;
  const doneCount = Array.from(answeredCases)
    .filter(id => set.find(s => s.id === id))
    .length;

  if(doneCount >= total){
    const nick = localStorage.getItem('playerNick');
    /* Energia aj anonymovi (A1) – econEnergy rieši null nick sama.
       § nižšie ostávajú za nickom. */
    econEnergy(nick, ECONOMY_CONFIG.ENERGY.CASES_SET, 'dohraná sada prípadov');
    if (nick) {
      econAward(nick, ECONOMY_CONFIG.REWARDS.CASES_SET, 'dokončená sada prípadov');
      // Sadu možno dokončiť len samými správnymi odpoveďami (nesprávna voľba
      // prípad neoznačí za vyriešený), takže dokončenie = 100 %.
      econAward(nick, ECONOMY_CONFIG.REWARDS.CASES_PERFECT, 'sada prípadov na 100 %');
    }

    setTimeout(() => {
      showRewardToast(`Všetkých ${total} prípadov vyriešených!`);
      const casesModal = $('casesModal');
      if(casesModal) closeModal(casesModal);
      incrementGamesPlayed();
    }, 700);
  }
}

/* =========================
   Navigation
   ========================= */
export function nextCase(){
  const set = window.cases?.[currentCaseSet] ?? [];
  if(set.length === 0) return;

  currentCaseIndex = (currentCaseIndex + 1) % set.length;
  renderCase();
}

export function prevCase(){
  const set = window.cases?.[currentCaseSet] ?? [];
  if(set.length === 0) return;

  currentCaseIndex = (currentCaseIndex - 1 + set.length) % set.length;
  renderCase();
}

/* =========================
   Internal index
   ========================= */
let currentCaseIndex = 0;

/* =========================
   LOAD CASES FROM DUEL QUESTIONS
   Načíta prípady z JSON otázok (každá otázka = prípad)
   ========================= */
export function loadCasesFromQuestions(questions, areaTitle) {
  const container = $('caseContainer');
  if (!container) return;

  if (!questions || !questions.length) {
    container.innerHTML = '<div class="small muted">Žiadne otázky pre túto oblasť.</div>';
    return;
  }

  // Konvertuj otázky do formátu prípadov (premiešané poradie možností)
  const cases = questions.map((q, i) => {
    const shuffled = shuffleOptions({ options: q.options || [], correct: typeof q.correct === 'number' ? q.correct : 0 });
    return {
      id: `case_${i}`,
      title: q.question || `Prípad ${i + 1}`,
      options: shuffled.options,
      correct: shuffled.correct,
      source: q.source || areaTitle
    };
  });

  // Ulož do window pre renderovanie
  window.__currentCases = cases;
  window.__currentCaseIndex = 0;
  window.__answeredCasesLocal = new Set();

  renderCasesFromQuestions(container);
}

function renderCasesFromQuestions(container) {
  const cases = window.__currentCases || [];
  const idx = window.__currentCaseIndex || 0;
  const answered = window.__answeredCasesLocal || new Set();

  if (!cases.length) return;

  const c = cases[idx];
  const isDone = answered.has(c.id);
  const total = cases.length;

  container.innerHTML = '';

  // Hlavička
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
  header.innerHTML = `
    <div class="small muted">Prípad ${idx + 1} z ${total}
      ${c.source ? `• <em>${c.source}</em>` : ''}
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn" id="casePrevBtn" ${idx === 0 ? 'disabled' : ''} style="padding:4px 10px;font-size:12px">◀</button>
      <button class="btn" id="caseNextBtn" ${idx === total-1 ? 'disabled' : ''} style="padding:4px 10px;font-size:12px">▶</button>
    </div>`;
  container.appendChild(header);

  // Otázka
  const qEl = document.createElement('div');
  qEl.style.cssText = 'font-weight:600;font-size:14px;line-height:1.5;margin-bottom:14px;padding:12px;background:rgba(47,158,143,0.06);border-radius:10px;border-left:3px solid var(--accent-3)';
  qEl.textContent = c.title;
  container.appendChild(qEl);

  // Možnosti
  const optContainer = document.createElement('div');
  optContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  c.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.cssText = 'text-align:left;padding:10px 14px;font-size:13px;border-radius:10px;transition:all .18s;';
    btn.textContent = opt;

    if (isDone) {
      if (i === c.correct) {
        btn.style.background = 'rgba(34,197,94,0.12)';
        btn.style.borderColor = 'rgba(34,197,94,0.4)';
        btn.textContent = opt + '  ✓';
      }
      btn.disabled = true;
    } else {
      btn.onclick = () => {
        const isCorrect = i === c.correct;
        answered.add(c.id);
        window.__answeredCasesLocal = answered;

        optContainer.querySelectorAll('button').forEach((b, bi) => {
          b.disabled = true;
          if (bi === c.correct) {
            b.style.background = 'rgba(34,197,94,0.12)';
            b.style.borderColor = 'rgba(34,197,94,0.4)';
            b.textContent = b.textContent + '  ✓';
          } else if (bi === i && !isCorrect) {
            b.style.background = 'rgba(239,68,68,0.08)';
            b.style.borderColor = 'rgba(239,68,68,0.3)';
            b.textContent = b.textContent + '  ✗';
          }
        });

        // Správa o výsledku
        const msg = document.createElement('div');
        msg.style.cssText = `margin-top:10px;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600;
          background:${isCorrect ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)'};
          color:${isCorrect ? '#16a34a' : '#dc2626'};`;
        msg.textContent = isCorrect
          ? '✅ Správne! Výborne!'
          : `❌ Nesprávne. Správna odpoveď: ${c.options[c.correct]}`;
        container.appendChild(msg);
      };
    }

    optContainer.appendChild(btn);
  });

  container.appendChild(optContainer);

  // Navigácia
  container.querySelector('#casePrevBtn')?.addEventListener('click', () => {
    window.__currentCaseIndex = Math.max(0, idx - 1);
    renderCasesFromQuestions(container);
  });

  container.querySelector('#caseNextBtn')?.addEventListener('click', () => {
    window.__currentCaseIndex = Math.min(total - 1, idx + 1);
    renderCasesFromQuestions(container);
  });

  // Progres
  const prog = document.createElement('div');
  prog.style.cssText = 'margin-top:14px';
  prog.innerHTML = `
    <div class="small muted" style="margin-bottom:4px">
      Vyriešené: ${answered.size} / ${total}
    </div>
    <div class="progress">
      <i style="width:${Math.round(answered.size/total*100)}%;display:block;height:100%;
        background:linear-gradient(90deg,var(--accent-2),var(--accent-3));border-radius:999px"></i>
    </div>`;
  container.appendChild(prog);
}

window.loadCasesFromQuestions = loadCasesFromQuestions;

/* ============================================================
   ROLA (admin/garant edit UI) – skutočná Firebase rola, nikdy
   lokálny "view" prepínač.
============================================================ */
let myRoleCache = null;
function getMyNick() { return localStorage.getItem('playerNick') || 'Anonymous'; }
async function getMyRole() {
  if (myRoleCache !== null) return myRoleCache;
  myRoleCache = await getRole(getMyNick());
  return myRoleCache;
}

/* =========================
   MULTI-STEP PRÍPADY Z JSON
   Jeden prípad = scenár + viac otázok (steps)
   ========================= */
export function loadCasesFromJson(casesArr, areaTitle) {
  const container = $('caseContainer');
  if (!container) return;

  if (!casesArr || !casesArr.length) {
    container.innerHTML = '<div class="small muted">Žiadne prípady pre túto oblasť.</div>';
    return;
  }

  /* Premiešané poradie možností pri každom načítaní prípadov (nie pri
     každom re-renderi - inak by sa poradie menilo spod už zodpovedaného
     kroku pri každom kliknutí). Uložené do window.__jsonCases, takže
     renderJsonCase() číta stabilné, raz zamiešané poradie počas celej
     návštevy tejto oblasti. */
  /* _original: referencia na KANONICKÝ (nezamiešaný) prípad z
     window.areaCases – admin/garant editácia z neho číta/zapisuje,
     nikdy zo zamiešanej kópie nižšie (Task 1 ↔ Task 2 prepojenie). */
  window.__jsonCases = casesArr.map(c => ({
    ...c,
    _original: c,
    steps: (c.steps || []).map(s => Array.isArray(s.options) && s.options.length ? shuffleOptions(s) : s)
  }));
  window.__jsonCaseIndex = 0;
  window.__jsonCaseAnswers = {}; // { caseIdx: { stepIdx: chosenOption } }
  window.__jsonCaseRecorded = new Set(); // ktoré indexy už zapísali progres (Fáza 2)
  window.__jsonCaseScores = {};          // { caseIdx: pct } – podklad pre CASES_PERFECT
  window.__jsonCaseSetRewarded = false;  // § + energia za sadu sa udeľujú raz na načítanie

  renderJsonCase(container, areaTitle);
}

/* ============================================================
   § + ENERGIA ZA DOHRANÚ SADU PRÍPADOV
   Ekonomika prípadov pôvodne visela VÝHRADNE v submitCase() nižšie, ktorá
   pracuje nad window.cases – to však hlavná appka nikdy nenaplní (data.js
   plní window.areaCases), takže živá JSON cesta nikdy nič neudelila ani
   nestrhla. Táto funkcia dopája TIE ISTÉ konštanty na živú cestu; hodnoty
   ani ich význam sa nemenia (ENERGY.CASES_SET / REWARDS.CASES_SET /
   REWARDS.CASES_PERFECT), rovnaký vzor ako finishMemoryGame() v memory.js.

   "Sada" = všetky prípady načítané pre vybranú dvojicu okruhov, ktoré majú
   aspoň jeden krok s možnosťami (prípad bez otázok sa nedá vyhodnotiť, preto
   sa do menovateľa nepočíta – inak by sa sada nikdy neuzavrela).

   Na rozdiel od submitCase() sa tu 100 % NEODVODZUJE od dokončenia: v JSON
   ceste sa krok označí za zodpovedaný aj pri nesprávnej voľbe, takže sada sa
   dá dohrať aj s chybami. CASES_PERFECT preto vyžaduje skutočných 100 % vo
   všetkých prípadoch sady.
============================================================ */
function maybeAwardCaseSet(cases) {
  if (window.__jsonCaseSetRewarded) return;

  const scoreable = (cases || []).filter(c =>
    (c.steps || []).some(s => Array.isArray(s.options) && s.options.length > 0)
  ).length;
  if (!scoreable || window.__jsonCaseRecorded.size < scoreable) return;

  window.__jsonCaseSetRewarded = true;

  const nick = localStorage.getItem('playerNick');

  /* Energia sa berie VŽDY, aj anonymovi (A1) – econEnergy rieši null nick
     sama (localStorage). Až § potrebujú nick: bez neho niet komu pripísať. */
  econEnergy(nick, ECONOMY_CONFIG.ENERGY.CASES_SET, 'dohraná sada prípadov');
  if (!nick) return;

  econAward(nick, ECONOMY_CONFIG.REWARDS.CASES_SET, 'dokončená sada prípadov');

  const scores = Object.values(window.__jsonCaseScores || {});
  if (scores.length === scoreable && scores.every(p => p === 100)) {
    econAward(nick, ECONOMY_CONFIG.REWARDS.CASES_PERFECT, 'sada prípadov na 100 %');
  }

  incrementGamesPlayed();
}

function renderJsonCase(container, areaTitle) {
  const cases = window.__jsonCases || [];
  const idx = window.__jsonCaseIndex || 0;
  const answers = window.__jsonCaseAnswers[idx] || {};
  const c = cases[idx];
  if (!c) return;

  const total = cases.length;
  const questionSteps = c.steps.filter(s => Array.isArray(s.options) && s.options.length > 0);
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount >= questionSteps.length;
  const correctCount = Object.entries(answers)
    .filter(([si, opt]) => {
      const step = c.steps[parseInt(si)];
      return step && opt === step.correct;
    }).length;

  const diffBadge = c.difficulty
    ? `<span class="case-diff case-diff-${c.difficulty}">${c.difficulty}</span>`
    : '';

  let html = `
    <div class="case-header">
      <div>
        <div class="case-counter">Prípad ${idx + 1} / ${total} ${c.source ? '· ' + c.source : ''}</div>
        <div class="case-title">${escapeHtml(c.title)}</div>
      </div>
      ${diffBadge}
    </div>
    <div class="case-steps">
  `;

  let visibleUpTo = 0;
  // Zobrazuj kroky postupne: ďalší krok sa odomkne po zodpovedaní predchádzajúcej otázky
  for (let i = 0; i < c.steps.length; i++) {
    const s = c.steps[i];
    const isScenario = !Array.isArray(s.options) || s.options.length === 0;
    if (isScenario) { visibleUpTo = i; continue; }
    if (answers[i] !== undefined) { visibleUpTo = i; continue; }
    visibleUpTo = i;
    break;
  }

  c.steps.forEach((s, i) => {
    if (i > visibleUpTo) return;
    const isScenario = !Array.isArray(s.options) || s.options.length === 0;

    if (isScenario) {
      html += `<div class="case-scenario">📄 ${escapeHtml(s.question)}</div>`;
      html += renderStepSource(s);
      return;
    }

    const answered = answers[i];
    html += `<div class="case-step">
      <div class="case-step-q">${escapeHtml(s.question)}</div>
      <div class="case-step-opts">`;

    s.options.forEach((opt, oi) => {
      let cls = 'case-step-opt';
      let disabled = '';
      if (answered !== undefined) {
        disabled = 'disabled';
        if (oi === s.correct) cls += ' correct';
        else if (oi === answered) cls += ' wrong';
      }
      html += `<button class="${cls}" ${disabled} data-step="${i}" data-opt="${oi}">${escapeHtml(opt)}</button>`;
    });

    html += `</div>`;

    if (answered !== undefined) {
      const ok = answered === s.correct;
      /* Vysvetlenie z JSON-u (normalizované na {correct,wrong} pri načítaní),
         ak existuje; inak generický fallback text ako doteraz. */
      const exp = s.explanation;
      const text = ok
        ? escapeHtml((exp && exp.correct) || '') || '✅ Správne!'
        : escapeHtml((exp && exp.wrong) || '') || ('❌ Nesprávne. Správna odpoveď: ' + escapeHtml(s.options[s.correct]));
      html += `<div class="case-step-feedback ${ok ? 'ok' : 'no'}">${text}</div>`;
      html += `<div style="margin:4px 0 2px;display:flex;gap:10px">
        <button class="report-q-btn case-report-btn" data-si="${i}" type="button">⚖️ Nahlásiť chybu</button>
        <button class="report-q-btn case-edit-btn" data-si="${i}" type="button" style="display:none">✏️ Upraviť</button>
      </div>`;
      if (s._seal) html += `<div class="small muted">${escapeHtml(formatEditStamp(s._seal))}</div>`;
    }

    html += renderStepSource(s);
    html += `</div>`;
  });

  html += `</div>`;
  html += renderSource(c.zdroj);

  // Výsledok prípadu
  if (allAnswered && questionSteps.length) {
    const pct = Math.round(correctCount / questionSteps.length * 100);
    html += `<div class="case-result ${pct >= 60 ? 'ok' : 'no'}">
      ${pct >= 60 ? '🏆' : '📚'} Prípad vyriešený: ${correctCount}/${questionSteps.length} správne (${pct}%)
    </div>`;

    // 📊 Osobný prehľad progresu (Fáza 2) – najlepší % prípadov per okruh.
    // Zapíš len raz (nie pri každom re-renderi po kliknutí v už dokončenom
    // prípade) a len ak má prípad presnú atribúciu oblasti aj okruhu.
    if (!window.__jsonCaseRecorded.has(idx)) {
      window.__jsonCaseRecorded.add(idx);
      window.__jsonCaseScores[idx] = pct;
      const nick = localStorage.getItem('playerNick');
      if (nick && c.area && c.source) {
        recordOkruhResult(nick, c.area, c.source, PROGRESS_ACTIVITIES.CASES, pct);
      }
      // § + energia za CELÚ sadu – rovnaký "raz" strážca ako zápis progresu vyššie.
      maybeAwardCaseSet(cases);
    }
  }

  // Navigácia – na POSLEDNOM prípade nahraď mŕtve "Ďalší prípad →" (predtým
  // len disabled, nikam neviedlo) za "Koniec", ktoré zatvorí modal – rovnaký
  // mechanizmus ako #closeCases v init.js (closeModal() z core.js sa tu
  // zámerne nepoužíva, na #casesModal nemá žiadny CSS efekt, viď closeCases).
  const isLast = idx >= total - 1;
  html += `<div class="case-nav">
    <button class="btn case-prev" ${idx === 0 ? 'disabled' : ''}>← Predchádzajúci</button>
    <span class="small muted">${answeredCount}/${questionSteps.length} otázok</span>
    ${isLast
      ? `<button class="btn btn-primary case-finish">Koniec ✓</button>`
      : `<button class="btn btn-primary case-next">Ďalší prípad →</button>`}
  </div>`;

  container.innerHTML = html;

  // Event listenery
  container.querySelectorAll('.case-step-opt:not([disabled])').forEach(btn => {
    btn.onclick = () => {
      const si = parseInt(btn.dataset.step);
      const oi = parseInt(btn.dataset.opt);
      if (!window.__jsonCaseAnswers[idx]) window.__jsonCaseAnswers[idx] = {};
      window.__jsonCaseAnswers[idx][si] = oi;
      renderJsonCase(container, areaTitle);
    };
  });

  container.querySelectorAll('.case-report-btn').forEach(btn => {
    btn.onclick = () => {
      const si = parseInt(btn.dataset.si);
      const step = c.steps[si];
      const url = `/?report=1&area=${encodeURIComponent(c.area || areaTitle)}` +
        `&src=${encodeURIComponent(c.source || '')}` +
        `&qtext=${encodeURIComponent(step.question || '')}`;
      window.open(url, '_blank');
    };
  });

  container.querySelectorAll('.case-edit-btn').forEach(btn => {
    const si = parseInt(btn.dataset.si);
    getMyRole().then(role => {
      if (role !== 'admin' && role !== 'garant') return;
      btn.style.display = 'inline-block';
      btn.onclick = () => {
        const app = AREA_SLUGS[c.area];
        const canonical = c._original?.steps?.[si];
        /* KANONICKÝ index prípadu v json.cases jeho okruhu (data.js ho nesie ako
           _ci). NIE `idx` – to je pozícia v plochom, cez-okruhovom a ešte
           filtrovanom zozname, takže pre druhý okruh vybranej dvojice je
           posunutá o počet prípadov prvého okruhu. applyContentOverrides
           (contentOverrides.js) číta case_${ci}_step_${si} podľa kanonického
           poradia – rovnako ako zapisujú študijné appky. Bez _ci sa zápis
           nedá adresovať správne, preto radšej neuložiť nič. */
        const ci = c._ci;
        if (!app || !canonical || typeof ci !== 'number') return;
        openContentEditModal({
          app,
          okruh: c.source,
          cast: `case_${ci}_step_${si}`,
          kind: 'question',
          current: canonical,
          autor: getMyNick(),
          rola: role,
          title: `Upraviť krok prípadu – ${c.source} · prípad ${ci + 1}`,
          onSaved: (saved) => {
            Object.assign(canonical, saved.novyObsah);
            canonical._seal = sealMeta(saved);
            c.steps[si] = shuffleOptions(canonical);
            delete window.__jsonCaseAnswers[idx]?.[si];
            renderJsonCase(container, areaTitle);
          }
        });
      };
    });
  });

  container.querySelector('.case-prev')?.addEventListener('click', () => {
    window.__jsonCaseIndex = Math.max(0, idx - 1);
    renderJsonCase(container, areaTitle);
  });
  container.querySelector('.case-next')?.addEventListener('click', () => {
    window.__jsonCaseIndex = Math.min(total - 1, idx + 1);
    renderJsonCase(container, areaTitle);
  });
  container.querySelector('.case-finish')?.addEventListener('click', () => {
    const modal = $('casesModal');
    if (modal) { modal.style.display = 'none'; modal.classList.remove('open'); }
  });
}

window.loadCasesFromJson = loadCasesFromJson;
