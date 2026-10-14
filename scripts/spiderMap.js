'use strict';

/* ============================================================
   scripts/spiderMap.js — MAPA OKRUHOV (klastre → okruhy → strom)
   Samostatný modul popri scripts/spider.js. spider.js SA NEMENÍ –
   jeho openSpiderBrowser() nemá exportované vnútro (renderAreas/
   renderOkruhy sú súkromné), takže rozšíriť ju zvonka sa nedá.
   Riešenie (schválené, rovnaký vzor ako duplikácia AREA_PATHS zo
   statnice.js v spider.js): tento modul duplikuje minimálny
   oblasť→okruh picker a NAHRÁDZA volanie spider.js openSpiderBrowser()
   v init.js (jeden riadok). Pre oblasti BEZ _map.json sa picker správa
   presne ako doteraz (plochý zoznam → openSpider). Pre oblasti S
   _map.json pribúda prepínač Strom/Mapa a dvojúrovňová mapa (Z1
   klastre → Z2 okruhy v klastri).

   Z2 → Z3 (existujúci strom okruhu): volá sa openSpider(key, areaTitle)
   z spider.js cez lazy await import() v try/catch (rovnaký containment
   vzor ako všade inde). Z2 modal sa PRED otvorením Z3 NEODSTRAŇUJE –
   zostáva v DOM pod openSpider-ovým vlastným modalom. Keď užívateľ
   zatvorí Z3 (jeho vlastné tlačidlo „Zavrieť“, nezávisle od tohto
   modulu), Z2 sa objaví presne tam, kde bol – to je efekt „späť“ bez
   toho, aby sa čokoľvek menilo na openSpider samotnom.

   Vykresľovanie Z1/Z2 (druhá verzia, prepísaná z SVG+viewBox na čisté
   HTML/CSS): každý uzol je JEDEN <div> (tvar, farba aj text v jednom
   elemente), inšpirované .spider-branch v spider.js – pevná šírka,
   height:auto, žiadna ručná synchronizácia dvoch súradnicových
   sústav. Pan/zoom je jeden CSS transform: translate() scale() na
   obalovom .spider-map-world; text sa škáluje s ním automaticky
   (žiadny ručný font-size prepočet). Predchádzajúca SVG+viewBox verzia
   mala tri samostatné bugy s rovnakým koreňom (text mimo dlaždice,
   letterboxing, nevysvetlená biela dlaždica) – všetky pramenili z toho,
   že SVG <rect> a HTML popisok museli byť ručne synchronizované pri
   každom pan/zoome. Tento prepis ten koreň odstraňuje úplne.

   Dáta: ob-pravo-app/data/procesne/_map.json { area, clusters[], links[] }.
   links[] vykresľuje samostatný modul scripts/spiderRelated.js ("Súvisí
   s" sekcia v Z3 strome + odznaky ⇄N na Z2 dlaždiciach) – rovnaký
   containment vzor (lazy import, vlastný try/catch), spiderMap.js jeho
   vnútro nepozná, len ho volá a odovzdá mu kontajner/kľúč oblasti.
   Žiadna hra, žiadny Firebase zápis, žiadny progres – rovnako ako
   spider.js, ide o nehodnotenú pomôcku.
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchMapJson(areaTitle) {
  const basePath = AREA_PATHS[areaTitle];
  if (!basePath) return null;
  try {
    const res = await fetch(`${basePath}_map.json`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.clusters) || !json.clusters.length) return null;
    return json;
  } catch (e) {
    console.warn('[MAPA] fetch _map.json zlyhal (oblasť pravdepodobne nemá mapu):', e);
    return null;
  }
}

async function fetchOkruhTitle(key, areaTitle) {
  const basePath = AREA_PATHS[areaTitle];
  if (!basePath) return key;
  try {
    const res = await fetch(`${basePath}${key}.json`);
    if (!res.ok) return key;
    let json = await res.json();
    // Admin spider override (Etapa 2) – aby labely uzlov ukázali upravený center; fail-soft.
    try {
      const { applySpiderOverride } = await import('./spiderOverrides.js');
      json = await applySpiderOverride(json, areaTitle, Number(key.slice(1)));
    } catch (e) { console.warn('[MAPA] spider override zlyhal – originál', e); }
    return (json && (json.spider?.center || json.title)) || key;
  } catch (e) {
    console.warn('[MAPA] fetch okruhu zlyhal:', e);
    return key;
  }
}

function ensureSpiderMapCss() {
  if (document.getElementById('spider-map-css')) return;
  const style = document.createElement('style');
  style.id = 'spider-map-css';
  style.textContent = `
    .spider-map-host {
      position: relative; width: 100%; height: 60vh; max-height: 520px; border-radius: 12px;
      overflow: hidden; background: var(--bg, #f5faf9); border: 1px solid var(--card-border, rgba(0,0,0,0.08));
      touch-action: none; cursor: grab;
    }
    .spider-map-host.dragging { cursor: grabbing; }
    .spider-map-world { position: relative; transform-origin: 0 0; }
    .spider-map-node {
      position: absolute; box-sizing: border-box; padding: 8px 10px;
      font-size: 12px; font-weight: 600; line-height: 1.25; text-align: center;
      color: var(--text, #14262c); border: 1px solid rgba(0,0,0,0.12); cursor: pointer;
      overflow-wrap: break-word; max-height: 7em; overflow: hidden;
    }
    .spider-map-node:focus { outline: 2px solid var(--accent-3, #0f6ea8); outline-offset: 2px; }
    .spider-map-node-sub { font-weight: 400; font-size: 0.82em; }
    .spider-map-node-has-badge { padding-bottom: 22px; }
    .spider-map-related-badge {
      position: absolute; right: 4px; bottom: 3px; font-size: 11px; font-weight: 600;
      padding: 1px 5px; border-radius: 8px; background: rgba(0,0,0,0.28); color: #fff;
      pointer-events: none; line-height: 1.4;
    }
    :root[data-theme="dark"] .spider-map-related-badge { background: rgba(255,255,255,0.28); color: #1c2430; }
    .spider-map-area-tile {
      display: inline-block; box-sizing: border-box; padding: 10px 14px; margin: 0;
      font: inherit; font-size: 13px; font-weight: 600; text-align: center; line-height: 1.3;
      color: var(--text, #14262c); border: 1px solid rgba(0,0,0,0.12); border-radius: 14px;
      cursor: pointer; flex: 1 1 150px; max-width: 220px;
    }
    .spider-map-area-tile:focus { outline: 2px solid var(--accent-3, #0f6ea8); outline-offset: 2px; }
    :root[data-theme="dark"] .spider-map-area-tile { border-color: rgba(255,255,255,0.14); color: var(--text, #e6eef6); }
    .spider-map-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .spider-map-c0 { background: #cfe3fb; }
    .spider-map-c1 { background: #cdeed9; }
    .spider-map-c2 { background: #e3d6f7; }
    .spider-map-c3 { background: #fce0bd; }
    .spider-map-c4 { background: #fbd0dd; }
    .spider-map-c5 { background: #c9ece7; }
    .spider-map-c6 { background: #f7ecc0; }
    .spider-map-c7 { background: #f8d0ce; }
    .spider-map-c8 { background: #d6d9f7; }
    .spider-map-c9 { background: #e3f0c0; }
    :root[data-theme="dark"] .spider-map-c0 { background: #1f3a5c; }
    :root[data-theme="dark"] .spider-map-c1 { background: #1f4a38; }
    :root[data-theme="dark"] .spider-map-c2 { background: #3a2d54; }
    :root[data-theme="dark"] .spider-map-c3 { background: #5a4322; }
    :root[data-theme="dark"] .spider-map-c4 { background: #5a2c3a; }
    :root[data-theme="dark"] .spider-map-c5 { background: #1f4e48; }
    :root[data-theme="dark"] .spider-map-c6 { background: #5a4d1a; }
    :root[data-theme="dark"] .spider-map-c7 { background: #5c2420; }
    :root[data-theme="dark"] .spider-map-c8 { background: #2b2f5a; }
    :root[data-theme="dark"] .spider-map-c9 { background: #3d4a1a; }
    :root[data-theme="dark"] .spider-map-node { border-color: rgba(255,255,255,0.14); color: var(--text, #e6eef6); }
    @media (max-width: 480px) {
      .spider-map-host { height: 50vh; }
    }
  `;
  document.head.appendChild(style);
}

/* Deterministický mriežkový layout, 5 stĺpcov, žiadna fyzika/náhoda.
   cx/cy sú stredy uzlov v pevnom (base) súradnicovom priestore – dnes
   sa interpretujú priamo ako px (predtým ako SVG-jednotky viewBoxu),
   samotná funkcia sa nemení. */
function gridLayout(count, { cols, nodeW, nodeH, stepX, stepY, marginX, marginY }) {
  const usedCols = Math.min(cols, Math.max(1, count));
  const positions = Array.from({ length: count }, (_, i) => ({
    cx: marginX + (i % usedCols) * stepX,
    cy: marginY + Math.floor(i / usedCols) * stepY
  }));
  const rows = Math.ceil(count / usedCols);
  const viewBox = {
    x: 0,
    y: 0,
    w: marginX + (usedCols - 1) * stepX + marginX,
    h: marginY + (rows - 1) * stepY + marginY
  };
  return { positions, nodeW, nodeH, viewBox };
}

function computeZ1Layout(count) {
  return gridLayout(count, { cols: 4, nodeW: 150, nodeH: 90, stepX: 180, stepY: 180, marginX: 70, marginY: 70 });
}

function computeZ2Layout(count) {
  return gridLayout(count, { cols: 3, nodeW: 130, nodeH: 84, stepX: 150, stepY: 110, marginX: 85, marginY: 70 });
}

/* Počiatočný scale/translate pri prvom vykreslení (aj po resize) –
   nahrádza to, čo predtým robil SVG viewBox+preserveAspectRatio
   automaticky. Obsah sa zmenší/zväčší tak, aby sa celý zmestil do
   hostiteľa, s malou rezervou (marža), a vycentruje sa. */
function computeInitialTransform(hostEl, worldW, worldH) {
  const hostRect = hostEl.getBoundingClientRect();
  const hostW = hostRect.width || worldW || 1;
  const hostH = hostRect.height || worldH || 1;
  const rawScale = Math.min(hostW / worldW, hostH / worldH) * 0.97;
  const scale = Math.min(rawScale, 1.5);
  const tx = (hostW - worldW * scale) / 2;
  const ty = (hostH - worldH * scale) / 2;
  return { tx, ty, scale };
}

/* Pan (mouse drag + 1-prst touch) a zoom (koliesko + pinch) cez CSS
   transform: translate(tx,ty) scale(s) na .spider-map-world. `state`
   je zdieľaný mutovateľný objekt {tx,ty,scale}; keďže translate sa
   v CSS transform reťazí AŽ PO scale (translate je vo "vonkajších",
   nezoomovaných px hostiteľa), panBy je len priame pripočítanie
   obrazovkovej delty – netreba ju prepočítavať cez aktuálny scale
   (na rozdiel od predošlej viewBox verzie). destroy() odpojí všetky
   listenery (volá sa pri prechode na inú úroveň mapy). reset() sa
   používa pri resize hostiteľa (nová veľkosť = nové centrovanie). */
function setupPanZoom(worldEl, hostEl, state) {
  const baseScale = state.scale;
  const minScale = baseScale * 0.5;
  const maxScale = baseScale * 3;

  function applyTransform() {
    worldEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  }
  applyTransform();

  function zoomAt(clientX, clientY, factor) {
    const rect = hostEl.getBoundingClientRect();
    const localX = (clientX - rect.left - state.tx) / state.scale;
    const localY = (clientY - rect.top - state.ty) / state.scale;
    const newScale = Math.max(minScale, Math.min(maxScale, state.scale * factor));
    state.tx = (clientX - rect.left) - localX * newScale;
    state.ty = (clientY - rect.top) - localY * newScale;
    state.scale = newScale;
    applyTransform();
  }

  function panBy(dxPx, dyPx) {
    state.tx += dxPx;
    state.ty += dyPx;
    applyTransform();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onMouseDown = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; hostEl.classList.add('dragging'); };
  const onMouseMove = e => {
    if (!dragging) return;
    panBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  };
  const onMouseUp = () => { dragging = false; hostEl.classList.remove('dragging'); };
  const onWheel = e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.1);
  };

  let touchMode = null; // 'drag' | 'pinch'
  let touchLastX = 0;
  let touchLastY = 0;
  let pinchLastDist = 0;
  const touchDist = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  const touchMid = (t0, t1) => ({ x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 });

  const onTouchStart = e => {
    if (e.touches.length === 1) {
      touchMode = 'drag';
      touchLastX = e.touches[0].clientX;
      touchLastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      touchMode = 'pinch';
      pinchLastDist = touchDist(e.touches[0], e.touches[1]);
    }
  };
  const onTouchMove = e => {
    if (touchMode === 'drag' && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      panBy(t.clientX - touchLastX, t.clientY - touchLastY);
      touchLastX = t.clientX; touchLastY = t.clientY;
    } else if (touchMode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const dist = touchDist(e.touches[0], e.touches[1]);
      const mid = touchMid(e.touches[0], e.touches[1]);
      if (pinchLastDist > 0) zoomAt(mid.x, mid.y, dist / pinchLastDist);
      pinchLastDist = dist;
    }
  };
  const onTouchEnd = () => { touchMode = null; pinchLastDist = 0; };

  hostEl.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  hostEl.addEventListener('wheel', onWheel, { passive: false });
  hostEl.addEventListener('touchstart', onTouchStart, { passive: true });
  hostEl.addEventListener('touchmove', onTouchMove, { passive: false });
  hostEl.addEventListener('touchend', onTouchEnd, { passive: true });
  hostEl.addEventListener('touchcancel', onTouchEnd, { passive: true });

  function destroy() {
    hostEl.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    hostEl.removeEventListener('wheel', onWheel);
    hostEl.removeEventListener('touchstart', onTouchStart);
    hostEl.removeEventListener('touchmove', onTouchMove);
    hostEl.removeEventListener('touchend', onTouchEnd);
    hostEl.removeEventListener('touchcancel', onTouchEnd);
  }

  function reset(newState) {
    state.tx = newState.tx;
    state.ty = newState.ty;
    state.scale = newState.scale;
    applyTransform();
  }

  return { destroy, reset };
}

/* Rozdelenie popisku uzla na tučný "hlavný pojem" a tenší "popis" podľa
   prvého výskytu " – " (en-dash) – typický tvar spider.center ("Nájomná
   zmluva – pojem, náležitosti..."). Ak label oddeľovač neobsahuje
   (viaceré nemajú), zobrazí sa celý text bez delenia – nehádame, kde
   delenie nedáva zmysel. el.title je vždy plný pôvodný text, nezmenené
   týmto delením. Používa sa na dvoch miestach (renderMapNodes aj
   dofetchovanie titulu v renderZ2) – preto samostatná funkcia, aby
   štýlovanie neplatilo len pri prvom vykreslení. */
function setNodeLabel(el, label) {
  // Odznak ⇄N (pridáva addRelatedBadge, Z2-only) je tiež priamy potomok
  // el – el.textContent='' by ho zmazal, ak by fetchOkruhTitle dobehol
  // AŽ PO relatedCount fetchi. Poradie oboch async operácií nie je
  // garantované, preto sa tu odznak pred vyčistením odloží a späť
  // pripojí až na konci.
  const badge = el.querySelector('.spider-map-related-badge');
  el.textContent = '';
  const idx = label.indexOf(' – ');
  if (idx === -1) {
    el.textContent = label;
  } else {
    const strong = document.createElement('strong');
    strong.textContent = label.slice(0, idx);
    const sub = document.createElement('span');
    sub.className = 'spider-map-node-sub';
    sub.textContent = label.slice(idx);
    el.append(strong, sub);
  }
  el.title = label;
  if (badge) el.appendChild(badge);
}

/* Spoločné vykreslenie jednej úrovne mapy (Z1 aj Z2 zdieľajú presne
   tento kód – líšia sa len vo vstupných dátach uzlov). Jeden <div> na
   uzol nesie tvar (farba cez triedu spider-map-cN), text aj klik/
   klávesovú interakciu naraz – žiadny samostatný popisok, žiadna
   druhá súradnicová sústava na synchronizáciu. */
function renderMapNodes(container, nodesData, worldSize, { ariaLabel, radius, fontSize }) {
  container.innerHTML = `
    <div class="spider-map-host" role="group" aria-label="${escapeHtml(ariaLabel)}">
      <div class="spider-map-world"></div>
    </div>`;
  const hostEl = container.querySelector('.spider-map-host');
  const worldEl = container.querySelector('.spider-map-world');
  worldEl.style.width = `${worldSize.w}px`;
  worldEl.style.height = `${worldSize.h}px`;

  nodesData.forEach(n => {
    const node = document.createElement('div');
    node.className = `spider-map-node ${n.colorClass}`;
    node.style.left = `${n.cx - n.w / 2}px`;
    node.style.top = `${n.cy - n.h / 2}px`;
    node.style.width = `${n.w}px`;
    node.style.borderRadius = `${radius}px`;
    if (fontSize) node.style.fontSize = `${fontSize}px`;
    setNodeLabel(node, n.label);
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', n.label);
    node.addEventListener('click', n.onClick);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.onClick(); } });
    worldEl.appendChild(node);
    n.el = node;
  });

  const state = computeInitialTransform(hostEl, worldSize.w, worldSize.h);
  const panzoom = setupPanZoom(worldEl, hostEl, state);

  /* Na rozdiel od resize v predošlej verzii (kde sa pri zmene veľkosti
     hostiteľa len prepočítali pozície popiskov voči nezmenenému
     viewBoxu) tu tx/ty/scale sú absolútne px – pri zmene veľkosti
     hostiteľa treba centrovanie prepočítať odznova, inak by obsah
     mohol skončiť mimo viditeľnej oblasti. Cena: resize počas
     rozťahaného/priblíženého zobrazenia zresetuje pohľad na "fit"
     (prijateľný kompromis, resize uprostred interakcie je zriedkavý). */
  const resizeObserver = new ResizeObserver(() => {
    panzoom.reset(computeInitialTransform(hostEl, worldSize.w, worldSize.h));
  });
  resizeObserver.observe(hostEl);

  return () => { panzoom.destroy(); resizeObserver.disconnect(); };
}

/* Z1: 10 bublín klastrov, farba = poradie v clusters[] (c0..c9).
   Vracia destroy() funkciu (pan/zoom + resize listenery). */
function renderZ1(container, mapData, onClusterClick) {
  ensureSpiderMapCss();
  const clusters = mapData.clusters;
  const layout = computeZ1Layout(clusters.length);
  const nodesData = clusters.map((cl, i) => ({
    cx: layout.positions[i].cx,
    cy: layout.positions[i].cy,
    w: layout.nodeW,
    h: layout.nodeH,
    label: cl.label,
    colorClass: `spider-map-c${i % 10}`,
    onClick: () => onClusterClick(i)
  }));
  return renderMapNodes(container, nodesData, layout.viewBox, { ariaLabel: 'Mapa klastrov', radius: 20, fontSize: 14 });
}

/* Odznak ⇄N vpravo dole na Z2 dlaždici (relatedCount z spiderRelated.js).
   N=0 → nič sa nevykreslí. Vlastný try/catch: pád "Súvisí s" featuru
   nesmie zhodiť Z2 mapu (rovnaký containment vzor ako pri Z3 nižšie). */
function addRelatedBadge(nodeEl, count) {
  nodeEl.classList.add('spider-map-node-has-badge');
  const badge = document.createElement('span');
  badge.className = 'spider-map-related-badge';
  badge.textContent = `⇄ ${count}`;
  nodeEl.appendChild(badge);
  const existingLabel = nodeEl.getAttribute('aria-label') || '';
  nodeEl.setAttribute('aria-label', `${existingLabel}, ${count} súvisiacich okruhov`);
}

/* Z2: bubliny okruhov vybraného klastra, zdedená farba klastra.
   Popisok je zo začiatku "A{n}" a dobehnutím fetchOkruhTitle sa
   prepíše na spider.center (fallback title) – progresívne, nezávisle
   pre každý uzol, nič neblokuje počiatočné vykreslenie. */
function renderZ2(container, mapData, clusterIndex, areaTitle, onOkruhClick) {
  ensureSpiderMapCss();
  const cluster = mapData.clusters[clusterIndex];
  const layout = computeZ2Layout(cluster.okruhy.length);
  const colorClass = `spider-map-c${clusterIndex % 10}`;
  const nodesData = cluster.okruhy.map((num, i) => ({
    cx: layout.positions[i].cx,
    cy: layout.positions[i].cy,
    w: layout.nodeW,
    h: layout.nodeH,
    label: `A${num}`,
    okruh: num,
    colorClass,
    onClick: () => onOkruhClick(num)
  }));
  const destroy = renderMapNodes(container, nodesData, layout.viewBox, { ariaLabel: `Okruhy klastra ${cluster.label}`, radius: 14 });
  nodesData.forEach(n => {
    fetchOkruhTitle(n.label, areaTitle).then(title => {
      setNodeLabel(n.el, title);
    });
    import('./spiderRelated.js')
      .then(rel => rel.relatedCount(areaTitle, n.okruh))
      .then(count => { if (count > 0) addRelatedBadge(n.el, count); })
      .catch(e => console.error('spiderMap: related badge failed', e));
  });
  return destroy;
}

/* Vstupný bod – nahrádza volanie spider.js openSpiderBrowser() v init.js.
   Stavy: 'areas' → (oblasť má mapu?) → 'flat' (plochý zoznam, dnešné
   správanie) alebo 'z1' (klastre) → 'z2' (okruhy klastra) → Z3 (existujúci
   strom cez openSpider, mimo tohto stavového stroja). Späť ide vždy o
   jednu úroveň: z2→z1, z1→areas, flat→areas. Strom/Mapa je bočný
   prepínač medzi 'flat' a 'z1' (nepočíta sa ako krok späť). */
export function openStructureBrowser() {
  ensureSpiderMapCss();

  const existing = document.getElementById('spiderMapModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'spiderMapModal';
  modal.className = 'avatar-modal';
  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) closeModal(); };

  const state = { area: null, mapData: null, destroyLevel: null };

  function cleanupLevel() {
    if (state.destroyLevel) { state.destroyLevel(); state.destroyLevel = null; }
  }

  function closeModal() { cleanupLevel(); modal.remove(); }

  async function openOkruhTree(key, areaTitle, keepUnderneath) {
    if (!keepUnderneath) { cleanupLevel(); modal.remove(); }
    try {
      const m = await import('./spider.js');
      await m.openSpider(key, areaTitle);
      /* "← Späť" má zmysel len keď Z2 modal ostal pod Z3 (keepUnderneath) –
         v plochom zozname (keepUnderneath=false) sa Z2/mapa modal už
         pred otvorením Z3 zrušil, tam "Zavrieť" ostáva presné. Tlačidlo
         hľadáme až PO await m.openSpider(...) – openSpider je async a
         DOM (vrátane #spiderCloseBtn) vytvára synchrónne tesne pred
         návratom, takže po vyriešení promisy je buď hotové, alebo (pri
         zlyhaní fetchu/chýbajúcom obsahu) modal vôbec nevznikol – odtiaľ
         null-check, nie čakanie na ďalší frame. spider.js sa nemení. */
      if (keepUnderneath) {
        const closeBtn = document.getElementById('spiderCloseBtn');
        if (closeBtn) {
          closeBtn.textContent = '← Späť';
          closeBtn.style.width = 'auto';
          closeBtn.style.flex = '1';
          const wrap = closeBtn.parentElement;
          if (wrap) { wrap.style.display = 'flex'; wrap.style.gap = '8px'; }
          const fullCloseBtn = document.createElement('button');
          fullCloseBtn.className = 'btn';
          fullCloseBtn.style.flex = '1';
          fullCloseBtn.textContent = 'Zavrieť';
          fullCloseBtn.onclick = () => {
            document.getElementById('spiderModal')?.remove();
            closeModal();
          };
          closeBtn.insertAdjacentElement('afterend', fullCloseBtn);
        }
        /* "Súvisí s" (Z1/Z2 mapa → Z3 strom, links[] z _map.json) –
           nezávislý modul scripts/spiderRelated.js, vlastný try/catch:
           pád tohto featuru nesmie zhodiť práve nastavené tlačidlá
           vyššie. Kontajner sa pripojí vždy (aj bez dát) – renderRelatedInto
           ho sama nechá prázdny pri N=0. Existujúca .spiderRelatedSec sa
           pred pripojením zmaže – ochrana pred pretekaním, keď predošlý
           async render ešte dobieha a užívateľ medzitým klikne na ďalší
           riadok (reťazenie skokov cez openTreeWithRelated). */
        try {
          const spiderModal = document.getElementById('spiderModal');
          const panel = spiderModal?.querySelector('.avatar-panel');
          if (panel) {
            const existingSec = panel.querySelector('.spiderRelatedSec');
            if (existingSec) existingSec.remove();
            const sec = document.createElement('div');
            sec.className = 'spiderRelatedSec';
            panel.appendChild(sec);
            const n = Number(key.slice(1));
            const rel = await import('./spiderRelated.js');
            await rel.renderRelatedInto(sec, areaTitle, n, {
              navigate: true,
              onNavigate: peer => openTreeWithRelated(peer)
            });
          }
        } catch (e) { console.error('spiderMap: related section failed', e); }

        /* Hry v strome okruhu – launcher žije v scripts/spiderGames.js,
           pribúdanie hier už tento patch nemení. Containment ako "Súvisí s"
           (lazy import, vlastný try/catch – pád hier nesmie zhodiť Z3 ani
           "Súvisí s"). Beží len pri keepUnderneath === true (vstup z mapy /
           "Súvisí s") – pri vstupe z plochého zoznamu hry nie sú (zámer). */
        try {
          const gameModal = document.getElementById('spiderModal');
          const gamePanel = gameModal?.querySelector('.avatar-panel');
          if (gamePanel) {
            const g = await import('./spiderGames.js');
            // 4. param = re-render Z3 stromu po uložení admin editora pavúka
            // (existujúca cesta openOkruhTree, nevymýšľa sa vlastné prekreslenie).
            g.mountLauncher(gamePanel, areaTitle, Number(key.slice(1)),
              () => openOkruhTree(key, areaTitle, true));
          }
        } catch (e) { console.error('spiderMap: game launcher failed', e); }
      }
    } catch (e) { console.error('spiderMap: openSpider load failed', e); }
  }

  /* Klik na riadok v rozbalenej "Súvisí s" sekcii – znova otvorí Z3
     strom pre susedný okruh, s rovnakým keepUnderneath=true, aby
     "← Späť"/"Zavrieť" aj nová "Súvisí s" sekcia fungovali ďalej. */
  function openTreeWithRelated(peer) {
    openOkruhTree(`A${peer}`, state.area, true);
  }

  function renderAreas() {
    cleanupLevel();
    state.mapData = null;
    const items = Object.keys(AREA_PATHS).map((area, i) =>
      `<button class="spider-map-area-tile spider-map-c${i % 10}" data-area="${escapeHtml(area)}">${escapeHtml(area)}</button>`
    ).join('');
    modal.innerHTML = `
      <div class="avatar-panel spider-panel">
        <h3 style="margin:0 0 12px 0">🕸️ Štruktúra otázok – vyber oblasť</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${items}</div>
        <div style="margin-top:16px">
          <button class="btn" id="spiderMapCloseBtn" style="width:100%">Zavrieť</button>
        </div>
      </div>`;
    modal.querySelectorAll('[data-area]').forEach(btn => {
      btn.onclick = () => selectArea(btn.getAttribute('data-area'));
    });
    modal.querySelector('#spiderMapCloseBtn').onclick = closeModal;
  }

  async function selectArea(area) {
    state.area = area;
    state.mapData = await fetchMapJson(area);
    if (state.mapData) renderZ1Screen();
    else renderFlatScreen();
  }

  function renderFlatScreen() {
    cleanupLevel();
    const count = AREA_COUNTS[state.area] || 0;
    const titles = window.areaOkruhTitles?.[state.area] || {};
    const items = Array.from({ length: count }, (_, i) => {
      const key = `A${i + 1}`;
      const label = titles[key] || key;
      return `<button class="btn" style="width:100%;text-align:left;margin-bottom:6px" data-key="${key}">${escapeHtml(label)}</button>`;
    }).join('');
    const toggle = state.mapData
      ? `<button class="btn" id="spiderMapToggleBtn" style="flex:1">🗺️ Mapa</button>`
      : '';
    modal.innerHTML = `
      <div class="avatar-panel spider-panel">
        <h3 style="margin:0 0 4px 0">🕸️ ${escapeHtml(state.area)}</h3>
        <div class="small muted" style="margin-bottom:10px">Vyber okruh</div>
        <div style="max-height:50vh;overflow-y:auto">${items || '<div class="small muted">Žiadne okruhy.</div>'}</div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="btn" id="spiderMapBackBtn" style="flex:1">← Späť</button>
          ${toggle}
          <button class="btn" id="spiderMapCloseBtn" style="flex:1">Zavrieť</button>
        </div>
      </div>`;
    modal.querySelectorAll('[data-key]').forEach(btn => {
      btn.onclick = () => openOkruhTree(btn.getAttribute('data-key'), state.area, false);
    });
    modal.querySelector('#spiderMapBackBtn').onclick = renderAreas;
    modal.querySelector('#spiderMapCloseBtn').onclick = closeModal;
    if (state.mapData) modal.querySelector('#spiderMapToggleBtn').onclick = renderZ1Screen;
  }

  function renderZ1Screen() {
    cleanupLevel();
    modal.innerHTML = `
      <div class="avatar-panel spider-panel">
        <h3 style="margin:0 0 4px 0">🕸️ ${escapeHtml(state.area)} – mapa</h3>
        <div class="small muted" style="margin-bottom:10px">Klik na klaster · ťahaj / koliesko (pinch na mobile) na priblíženie</div>
        <div id="spiderMapZ1Host"></div>
        <div id="spiderMapZ1GameBar" style="margin-top:12px"></div>
        <div class="spider-map-toolbar" style="margin-top:12px">
          <button class="btn" id="spiderMapBackBtn" style="flex:1">← Späť</button>
          <button class="btn" id="spiderMapListBtn" style="flex:1">📋 Zoznam</button>
          <button class="btn" id="spiderMapCloseBtn" style="flex:1">Zavrieť</button>
        </div>
      </div>`;
    const host = modal.querySelector('#spiderMapZ1Host');
    state.destroyLevel = renderZ1(host, state.mapData, clusterIndex => renderZ2Screen(clusterIndex));
    modal.querySelector('#spiderMapBackBtn').onclick = renderAreas;
    modal.querySelector('#spiderMapListBtn').onclick = renderFlatScreen;
    modal.querySelector('#spiderMapCloseBtn').onclick = closeModal;
    /* 🧭 Kde som? – hra na úrovni Z1 (pod mriežkou klastrov). Launcher žije
       v scripts/spiderGames.js (lazy import, vlastný try/catch). Pred
       odovzdaním modalu hre uprace Z1 pan/zoom + resize listenery cez
       cleanupLevel() (state.destroyLevel = panzoom.destroy()+observer
       disconnect, nič viac – overené). onExit vráti späť na čerstvý Z1
       render. Idempotencia netreba: renderZ1Screen prepíše modal.innerHTML
       nanovo pri každom vstupe (Z2→Z1 späť, 🗺️ Mapa toggle, výber oblasti). */
    const gameBar = modal.querySelector('#spiderMapZ1GameBar');
    if (gameBar) {
      const kdeSomBtn = document.createElement('button');
      kdeSomBtn.className = 'btn';
      kdeSomBtn.style.width = '100%';
      kdeSomBtn.textContent = '🧭 Kde som?';
      kdeSomBtn.onclick = async () => {
        try {
          cleanupLevel();
          const g = await import('./spiderGames.js');
          g.startKdeSom(modal, state.area, state.mapData, () => renderZ1Screen());
        } catch (e) {
          console.error('spiderMap: kde som failed', e);
          renderZ1Screen(); // import zlyhal → obnov čistý Z1 (cleanupLevel už prebehol, listenery treba znova)
        }
      };
      gameBar.appendChild(kdeSomBtn);
    }
  }

  function renderZ2Screen(clusterIndex) {
    cleanupLevel();
    const cluster = state.mapData.clusters[clusterIndex];
    modal.innerHTML = `
      <div class="avatar-panel spider-panel">
        <h3 style="margin:0 0 4px 0">🕸️ ${escapeHtml(cluster.label)}</h3>
        <div class="small muted" style="margin-bottom:10px">Klik na okruh · ťahaj / koliesko (pinch na mobile) na priblíženie</div>
        <div id="spiderMapZ2Host"></div>
        <div class="spider-map-toolbar" style="margin-top:12px">
          <button class="btn" id="spiderMapBackBtn" style="flex:1">← Späť</button>
          <button class="btn" id="spiderMapCloseBtn" style="flex:1">Zavrieť</button>
        </div>
      </div>`;
    const host = modal.querySelector('#spiderMapZ2Host');
    state.destroyLevel = renderZ2(host, state.mapData, clusterIndex, state.area, n => openOkruhTree(`A${n}`, state.area, true));
    modal.querySelector('#spiderMapBackBtn').onclick = renderZ1Screen;
    modal.querySelector('#spiderMapCloseBtn').onclick = closeModal;
  }

  renderAreas();
}
