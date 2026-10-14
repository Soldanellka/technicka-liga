'use strict';

/* ============================================================
   scripts/spider.js — PAMÄŤOVÝ PAVÚK (concept-map strom per okruh)
   Samostatný, odpojený subsystém: štatická hierarchia (stred → vetvy →
   listy) pre rýchle učenie štruktúry témy. NIE hodnotená aktivita –
   nezapisuje sa nikam do progresu, nepridáva sa do computeOkruhStats.

   Zámerne DUPLIKUJE basePath tabuľku a fetch z scripts/statnice.js
   namiesto ich zdieľania: fetchOkruh tam je lokálna neexportovaná
   funkcia, ktorá navyše zahadzuje `tiles`/`spider` (vracia len 6 polí
   pre potreby hodnotenia). Menší blast radius – statnice.js sa
   nedotýka vôbec.

   Dáta (voliteľné, autorské, vedľa tiles v A{n}.json):
     topic.spider = { branches: [ { label, leaves: [string, ...] }, ... ] }
   Chýba topic.spider → fallback "hviezdica" z topic.tiles[].term (uzly
   bez detí, žiadna druhá úroveň). Chýba aj tiles → nič sa nevykreslí
   (fail-soft, len console.warn).
   Browser (openSpiderBrowser): oblasť→okruh výber pre globálnu dlaždicu.
   Počty okruhov NEDUPLIKUJEME lokálne – čítame DASHBOARD_AREAS (už
   exportovaná, čistý dátový modul, žiadny top-level Firebase/DOM side
   effect – overené pred importom). Názvy tém sú oportunistické z
   window.areaOkruhTitles (vypĺňa ho data.js pri štarte appky, žiadny
   nový fetch) – kým sa oblasť nenaloadovala, ukáže sa holé "A{n}".
============================================================ */

import { DASHBOARD_AREAS } from './dashboardStats.js';

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

const AREA_COUNTS = DASHBOARD_AREAS.flatMap(a => a.subAreas)
  .reduce((acc, s) => { acc[s.areaTitle] = s.maxOkruh; return acc; }, {});

const BRANCH_COLORS = ['spider-c0', 'spider-c1', 'spider-c2', 'spider-c3', 'spider-c4', 'spider-c5'];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchTopicJson(key, areaTitle) {
  const basePath = AREA_PATHS[areaTitle];
  if (!basePath) {
    console.warn(`[PAVÚK] Neznáma areaTitle "${areaTitle}", basePath sa nedá určiť.`);
    return null;
  }
  try {
    const res = await fetch(`${basePath}${key}.json`);
    if (!res.ok) return null;
    let json = await res.json();
    if (!(json && json.title)) return null;
    // Admin spider override (Etapa 2) – jediné miesto obalenia fetchu; fail-soft.
    try {
      const { applySpiderOverride } = await import('./spiderOverrides.js');
      json = await applySpiderOverride(json, areaTitle, Number(key.slice(1)));
    } catch (e) { console.warn('[PAVÚK] spider override zlyhal – originál', e); }
    return json;
  } catch (e) {
    console.warn('[PAVÚK] fetch okruhu zlyhal:', e);
    return null;
  }
}

/* branches: [{ label, leaves: string[] }]. Bez topic.spider sa vezme
   hviezdica z tiles (uzly bez potomkov – klik na ne rovno otvorí detail,
   nie je čo skrývať/odkrývať). */
function buildBranches(json) {
  if (json.spider && Array.isArray(json.spider.branches) && json.spider.branches.length) {
    return json.spider.branches
      .filter(b => b && b.label)
      .map(b => ({ label: b.label, leaves: Array.isArray(b.leaves) ? b.leaves.filter(Boolean) : [] }));
  }
  if (Array.isArray(json.tiles) && json.tiles.length) {
    return json.tiles.filter(t => t && t.term).map(t => ({ label: t.term, leaves: [] }));
  }
  return [];
}

function findDefinition(json, label) {
  const tile = (json.tiles || []).find(t => t && t.term === label);
  return tile ? tile.definition : null;
}

/* Top-down HTML/CSS strom (krok A, prepracované): centrálna dlaždica hore,
   pod ňou rad farebných vetiev (zbalené), pod rozbalenou vetvou jej listy
   zvisle pod sebou. Žiadna SVG geometria (R1/R2/wedge/wrapLabel/measureTile)
   – HTML/CSS rieši zalamovanie textu, výšku dlaždice a zalomenie riadkov
   vetiev samo (flex-wrap), nič sa nepočíta ručne. Vetva bez listov (fallback
   hviezdica z tiles) sa vykreslí ako obyčajná vetva bez šípky/listov –
   klik na ňu rovno otvorí detail (rovnaká click-logika ako predtým). */
function renderTree(container, json, branches, state) {
  const branchesHtml = branches.map((branch, i) => {
    const colorClass = BRANCH_COLORS[i % BRANCH_COLORS.length];
    const collapsed = !!state.collapsed[i];
    const hasChildren = branch.leaves.length > 0;
    const toggle = hasChildren
      ? `<span class="spider-toggle">${collapsed ? `▸ (${branch.leaves.length})` : '▾'}</span>`
      : '';
    const leavesHtml = (hasChildren && !collapsed)
      ? `<div class="spider-leaves">${branch.leaves.map((leaf, j) =>
          `<div class="spider-leaf spider-node" data-node-id="b${i}l${j}" tabindex="0" role="button">${escapeHtml(leaf)}</div>`
        ).join('')}</div>`
      : '';
    return `
      <div class="spider-branch-col">
        <div class="spider-branch spider-node ${colorClass}" data-node-id="b${i}" tabindex="0" role="button">
          <span class="spider-branch-label">${escapeHtml(branch.label)}</span>
          ${toggle}
        </div>
        ${leavesHtml}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="spider-tree">
      <div class="spider-center">${escapeHtml(json.spider?.center || json.title)}</div>
      <div class="spider-branches">${branchesHtml}</div>
    </div>`;
}

function ensureSpiderCss() {
  if (document.getElementById('spider-css')) return;
  const style = document.createElement('style');
  style.id = 'spider-css';
  style.textContent = `
    .spider-panel { max-width: 760px; }
    .spider-tree-host { overflow: auto; max-width: 100%; max-height: 60vh; border-radius: 12px; }
    .spider-tree { display: flex; flex-direction: column; align-items: center; padding: 8px 4px 4px; }
    .spider-center {
      font-weight: 700; font-size: 14px; text-align: center; line-height: 1.3;
      background: var(--surface, #fff); border: 2px solid var(--accent-3, #0f6ea8);
      border-radius: 14px; padding: 10px 16px; max-width: 280px;
    }
    .spider-center::after { content: ''; display: block; width: 2px; height: 14px; background: var(--card-border, rgba(0,0,0,0.15)); margin: 4px auto 0; }
    .spider-branches { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 14px 10px; margin-top: 4px; }
    .spider-branch-col { display: flex; flex-direction: column; align-items: stretch; width: 150px; }
    .spider-node { cursor: pointer; }
    .spider-branch {
      border-radius: 12px; padding: 8px 10px; font-size: 12px; font-weight: 600;
      text-align: center; color: var(--text, #14262c); border: 1px solid rgba(0,0,0,0.08);
      overflow-wrap: break-word;
    }
    .spider-branch-label { display: block; }
    .spider-toggle { display: block; font-size: 11px; font-weight: 400; opacity: 0.75; margin-top: 2px; }
    .spider-leaves { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding-left: 10px; border-left: 2px solid var(--card-border, rgba(0,0,0,0.15)); }
    .spider-leaf {
      background: var(--surface, #fff); border: 1px solid var(--card-border, rgba(0,0,0,0.08));
      border-radius: 10px; padding: 6px 8px; font-size: 11px; color: var(--text, #14262c);
      overflow-wrap: break-word;
    }
    .spider-c0 { background: #cfe3fb; }
    .spider-c1 { background: #cdeed9; }
    .spider-c2 { background: #e3d6f7; }
    .spider-c3 { background: #fce0bd; }
    .spider-c4 { background: #fbd0dd; }
    .spider-c5 { background: #c9ece7; }
    :root[data-theme="dark"] .spider-c0 { background: #1f3a5c; }
    :root[data-theme="dark"] .spider-c1 { background: #1f4a38; }
    :root[data-theme="dark"] .spider-c2 { background: #3a2d54; }
    :root[data-theme="dark"] .spider-c3 { background: #5a4322; }
    :root[data-theme="dark"] .spider-c4 { background: #5a2c3a; }
    :root[data-theme="dark"] .spider-c5 { background: #1f4e48; }
    :root[data-theme="dark"] .spider-branch { border-color: rgba(255,255,255,0.12); color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-leaf { border-color: rgba(255,255,255,0.12); color: var(--text, #e6eef6); }
    @media (max-width: 480px) {
      .spider-branch-col { width: 130px; }
    }
    .spider-detail { margin-top: 14px; padding: 10px 12px; border-radius: 12px; background: var(--bg, #f5faf9); border: 1px solid var(--card-border, rgba(0,0,0,0.06)); }
  `;
  document.head.appendChild(style);
}

export async function openSpider(key, areaTitle) {
  const json = await fetchTopicJson(key, areaTitle);
  if (!json) {
    console.warn(`[PAVÚK] Okruh ${key} (${areaTitle}) sa nepodarilo načítať – pavúk sa nezobrazí.`);
    return;
  }
  const branches = buildBranches(json);
  if (!branches.length) {
    console.warn(`[PAVÚK] Okruh ${key} nemá ani spider, ani tiles – niet čo vykresliť.`);
    return;
  }

  ensureSpiderCss();

  const existing = document.getElementById('spiderModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'spiderModal';
  modal.className = 'avatar-modal';

  modal.innerHTML = `
    <div class="avatar-panel spider-panel">
      <h3 style="margin:0 0 4px 0">${escapeHtml(json.title)}</h3>
      <div class="small muted" style="margin-bottom:10px">Klik na vetvu skryje/odkryje listy · klik na list ukáže definíciu</div>
      <div id="spiderTreeHost" class="spider-tree-host"></div>
      <div id="spiderDetailHost"></div>
      <div style="margin-top:16px">
        <button class="btn" id="spiderCloseBtn" style="width:100%">Zavrieť</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const treeHost = modal.querySelector('#spiderTreeHost');
  const detailHost = modal.querySelector('#spiderDetailHost');
  const state = { collapsed: {} };
  branches.forEach((b, i) => { if (b.leaves.length > 0) state.collapsed[i] = true; }); // A1: vetvy zbalené na začiatku

  function showDetail(label) {
    const def = findDefinition(json, label);
    detailHost.innerHTML = `
      <div class="spider-detail">
        <div style="font-weight:600">${escapeHtml(label)}</div>
        ${def ? `<div class="small" style="margin-top:4px">${escapeHtml(def)}</div>` : ''}
      </div>`;
  }

  function redraw() {
    renderTree(treeHost, json, branches, state);
    treeHost.querySelectorAll('.spider-node').forEach(node => {
      node.addEventListener('click', () => {
        const id = node.getAttribute('data-node-id');
        const m = id.match(/^b(\d+)(?:l(\d+))?$/);
        if (!m) return;
        const bi = Number(m[1]);
        if (m[2] === undefined && branches[bi].leaves.length > 0) {
          state.collapsed[bi] = !state.collapsed[bi];
          redraw();
        } else {
          const label = m[2] !== undefined ? branches[bi].leaves[Number(m[2])] : branches[bi].label;
          showDetail(label);
        }
      });
    });
  }
  redraw();

  const close = () => modal.remove();
  modal.querySelector('#spiderCloseBtn').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
}

/* Inline variant pre študijný modul (krok 2, pilot ob-pravo-app) – kreslí
   priamo do zadaného kontajnera namiesto modalu, žiadny Zavrieť. openSpider
   vyššie ostáva NEDOTKNUTÁ (vlastný modal wrapper) – táto funkcia zdieľa tie
   isté nízkoúrovňové kúsky (fetchTopicJson/buildBranches/renderTree/
   findDefinition/ensureSpiderCss), interaktivitu (redraw/detail) má vlastnú,
   keďže openSpider sa kvôli containmentu nesmie meniť.

   `el` sa môže volať opakovane pri rýchlom preklikávaní okruhov (študijný
   modul volá pri KAŽDOM výbere okruhu) – token na `el.dataset.spiderToken`
   chráni pred tým, aby neskôr-doletený fetch staršieho okruhu prepísal
   medzičasom vykreslený novší strom. */
let spiderInlineSeq = 0;
export async function renderSpiderInto(el, key, areaTitle) {
  if (!el) return;
  const myToken = String(++spiderInlineSeq);
  el.dataset.spiderToken = myToken;
  el.innerHTML = '';

  const json = await fetchTopicJson(key, areaTitle);
  if (el.dataset.spiderToken !== myToken) return; // medzitým prekreslené novším volaním
  if (!json) {
    console.warn(`[PAVÚK] Okruh ${key} (${areaTitle}) sa nepodarilo načítať – inline pavúk sa nezobrazí.`);
    return;
  }
  const branches = buildBranches(json);
  if (!branches.length) {
    console.warn(`[PAVÚK] Okruh ${key} nemá ani spider, ani tiles – niet čo vykresliť.`);
    return;
  }

  ensureSpiderCss();

  el.innerHTML = `
    <div class="small muted" style="margin:10px 0">Klik na vetvu skryje/odkryje listy · klik na list ukáže definíciu</div>
    <div class="spider-inline-tree spider-tree-host"></div>
    <div class="spider-inline-detail"></div>`;
  if (el.dataset.spiderToken !== myToken) return;

  const treeHost = el.querySelector('.spider-inline-tree');
  const detailHost = el.querySelector('.spider-inline-detail');
  const state = { collapsed: {} };
  branches.forEach((b, i) => { if (b.leaves.length > 0) state.collapsed[i] = true; }); // A1: vetvy zbalené na začiatku

  function showDetail(label) {
    const def = findDefinition(json, label);
    detailHost.innerHTML = `
      <div class="spider-detail">
        <div style="font-weight:600">${escapeHtml(label)}</div>
        ${def ? `<div class="small" style="margin-top:4px">${escapeHtml(def)}</div>` : ''}
      </div>`;
  }

  function redraw() {
    renderTree(treeHost, json, branches, state);
    treeHost.querySelectorAll('.spider-node').forEach(node => {
      node.addEventListener('click', () => {
        const id = node.getAttribute('data-node-id');
        const m = id.match(/^b(\d+)(?:l(\d+))?$/);
        if (!m) return;
        const bi = Number(m[1]);
        if (m[2] === undefined && branches[bi].leaves.length > 0) {
          state.collapsed[bi] = !state.collapsed[bi];
          redraw();
        } else {
          const label = m[2] !== undefined ? branches[bi].leaves[Number(m[2])] : branches[bi].label;
          showDetail(label);
        }
      });
    });
  }
  redraw();
}

/* Globálna dlaždica ("Hry a prípady") nemá kontext okruhu – dvojúrovňový
   výber oblasť → okruh, potom deleguje na openSpider (nezmenená). Čisto
   synchrónne/read-only: žiadny nový fetch, len AREA_PATHS (lokálne) a
   window.areaOkruhTitles (už naplnené data.js, ak stihlo doletieť). */
export function openSpiderBrowser() {
  ensureSpiderCss();

  const existing = document.getElementById('spiderBrowserModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'spiderBrowserModal';
  modal.className = 'avatar-modal';
  document.body.appendChild(modal);

  const state = { view: 'areas', area: null };

  function renderAreas() {
    const items = Object.keys(AREA_PATHS).map(area =>
      `<button class="btn" style="width:100%;text-align:left;margin-bottom:6px" data-area="${escapeHtml(area)}">${escapeHtml(area)}</button>`
    ).join('');
    modal.innerHTML = `
      <div class="avatar-panel spider-panel">
        <h3 style="margin:0 0 12px 0">🕸️ Štruktúra otázok – vyber oblasť</h3>
        <div>${items}</div>
        <div style="margin-top:16px">
          <button class="btn" id="spiderBrowserCloseBtn" style="width:100%">Zavrieť</button>
        </div>
      </div>`;
    modal.querySelectorAll('[data-area]').forEach(btn => {
      btn.onclick = () => { state.view = 'okruhy'; state.area = btn.getAttribute('data-area'); renderOkruhy(); };
    });
    modal.querySelector('#spiderBrowserCloseBtn').onclick = () => modal.remove();
  }

  function renderOkruhy() {
    const count = AREA_COUNTS[state.area] || 0;
    const titles = window.areaOkruhTitles?.[state.area] || {};
    const items = Array.from({ length: count }, (_, i) => {
      const key = `A${i + 1}`;
      const label = titles[key] || key;
      return `<button class="btn" style="width:100%;text-align:left;margin-bottom:6px" data-key="${key}">${escapeHtml(label)}</button>`;
    }).join('');
    modal.innerHTML = `
      <div class="avatar-panel spider-panel">
        <h3 style="margin:0 0 4px 0">🕸️ ${escapeHtml(state.area)}</h3>
        <div class="small muted" style="margin-bottom:10px">Vyber okruh</div>
        <div style="max-height:50vh;overflow-y:auto">${items || '<div class="small muted">Žiadne okruhy.</div>'}</div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="btn" id="spiderBrowserBackBtn" style="flex:1">← Späť</button>
          <button class="btn" id="spiderBrowserCloseBtn" style="flex:1">Zavrieť</button>
        </div>
      </div>`;
    modal.querySelectorAll('[data-key]').forEach(btn => {
      btn.onclick = () => {
        const key = btn.getAttribute('data-key');
        modal.remove();
        openSpider(key, state.area);
      };
    });
    modal.querySelector('#spiderBrowserBackBtn').onclick = () => { state.view = 'areas'; state.area = null; renderAreas(); };
    modal.querySelector('#spiderBrowserCloseBtn').onclick = () => modal.remove();
  }

  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  renderAreas();
}
