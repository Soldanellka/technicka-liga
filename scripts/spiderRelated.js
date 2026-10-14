'use strict';

/* ============================================================
   scripts/spiderRelated.js — "Súvisí s" (krížové prepojenia okruhov)
   Samostatný modul, nezávislý od spider.js (spider.js SA NEDOTÝKA).
   Číta _map.json.links[] (nie spider.js dáta) – links[] je NESMEROVANÝ
   zoznam hrán (from/to je len JSON zápis hrany, nie vzťah "závisí od"),
   preto sa pri indexovaní zlučujú OBA smery pre daný okruh.

   AREA_PATHS je duplikované (rovnaký vzor ako spider.js dupluje zo
   statnice.js, spiderMap.js zo spider.js – menší blast radius než
   zdieľanie cez import).

   Farby prúžku/odznaku VEDOME PREBERAJÚ existujúce CSS triedy
   spider-map-c0..c9 zo scripts/spiderMap.js namiesto vlastnej kópie
   palety (zadanie: "cez existujúcu paletu"). Toto je funkčné len
   vtedy, keď ensureSpiderMapCss() už bežala pred renderRelatedInto –
   v tomto (v1) zapojení je to vždy zaručené, keďže jediné volanie
   renderRelatedInto ide zo spiderMap.js po tom, čo Z1/Z2 mapa už
   svoje CSS vložila. Ak by sa modul v budúcnosti volal odniekiaľ
   inam (napr. študijný modul bez mapy), treba tento predpoklad overiť
   znova alebo pridať vlastnú kópiu palety.

   loadArea() memoizuje výsledok podľa areaKey (Map v module-scope) –
   _map.json sa nefetchuje opakovane pri prepínaní okruhov v tej istej
   relácii.
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchMapJson(areaKey) {
  const basePath = AREA_PATHS[areaKey];
  if (!basePath) return null;
  try {
    const res = await fetch(`${basePath}_map.json`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.clusters)) return null;
    return json;
  } catch (e) {
    console.warn('[SÚVISÍ] fetch _map.json zlyhal:', e);
    return null;
  }
}

/* Krátky názov cieľa (json.title) – ZÁMERNE iné pole než fetchOkruhTitle
   v spiderMap.js (ktoré uprednostňuje spider.center, dlhý text vhodný
   pre Z2 dlaždicu). Riadok "Súvisí s" je jednoriadkový – json.title je
   tu vhodnejší. Vráti null pri zlyhaní (nie fallback na key), volajúci
   podľa toho rozhodne o zablokovaní kliku. */
async function fetchOkruhShortTitle(key, areaKey) {
  const basePath = AREA_PATHS[areaKey];
  if (!basePath) return null;
  try {
    const res = await fetch(`${basePath}${key}.json`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json && json.title) || null;
  } catch (e) {
    console.warn('[SÚVISÍ] fetch okruhu zlyhal:', e);
    return null;
  }
}

function buildIndexes(mapJson, areaKey) {
  const clusterOf = new Map(); // okruh(number) -> { label, colorClass }
  (mapJson.clusters || []).forEach((cl, i) => {
    const colorClass = `spider-map-c${i % 10}`;
    (cl.okruhy || []).forEach(o => {
      clusterOf.set(Number(o), { label: cl.label, colorClass });
    });
  });

  const related = new Map(); // okruh(number) -> [{peer, note}]
  const addEdge = (a, b, note) => {
    if (!related.has(a)) related.set(a, []);
    related.get(a).push({ peer: b, note });
  };

  (mapJson.links || []).forEach(link => {
    const from = Number(link.from);
    const to = Number(link.to);
    const note = link.note || '';
    if (from === to) {
      console.warn(`[SÚVISÍ] ${areaKey}: self-link A${from} → A${to} zahodený`);
      return;
    }
    if (!clusterOf.has(from) || !clusterOf.has(to)) {
      console.warn(`[SÚVISÍ] ${areaKey}: hrana ${from}→${to} odkazuje na okruh mimo clusters, zahodená`);
      return;
    }
    addEdge(from, to, note);
    addEdge(to, from, note);
  });

  // Obranná deduplikácia per okruh (podľa peer, bez ohľadu na smer) –
  // aj keby zdroj niekedy obsahoval {a,b} aj {b,a} zvlášť, výsledný
  // zoznam pre daný okruh nebude mať toho istého peera dvakrát.
  const dedupedRelated = new Map();
  for (const [okruh, list] of related.entries()) {
    const seenPeers = new Set();
    const dedup = [];
    for (const item of list) {
      if (seenPeers.has(item.peer)) continue;
      seenPeers.add(item.peer);
      dedup.push(item);
    }
    dedupedRelated.set(okruh, dedup);
  }

  return { related: dedupedRelated, clusterOf };
}

const areaCache = new Map(); // areaKey -> Promise<{related, clusterOf} | null>

export function loadArea(areaKey) {
  if (areaCache.has(areaKey)) return areaCache.get(areaKey);
  const promise = fetchMapJson(areaKey).then(json => (json ? buildIndexes(json, areaKey) : null));
  areaCache.set(areaKey, promise);
  return promise;
}

export async function relatedCount(areaKey, n) {
  const idx = await loadArea(areaKey);
  if (!idx) return 0;
  const list = idx.related.get(Number(n));
  return list ? list.length : 0;
}

function ensureRelatedCss() {
  if (document.getElementById('spider-related-css')) return;
  const style = document.createElement('style');
  style.id = 'spider-related-css';
  style.textContent = `
    .spider-related-section { margin-top: 14px; border-top: 1px solid var(--card-border, rgba(0,0,0,0.08)); padding-top: 10px; }
    .spider-related-header {
      display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; box-sizing: border-box;
      background: none; border: none; padding: 8px 4px; cursor: pointer;
      font-size: 13px; font-weight: 600; color: var(--text, #14262c); text-align: left;
    }
    .spider-related-arrow { display: inline-block; width: 1em; }
    .spider-related-list { margin-top: 4px; display: flex; flex-direction: column; gap: 6px; }
    .spider-related-row {
      display: flex; align-items: stretch; gap: 10px; min-height: 44px; width: 100%; box-sizing: border-box;
      background: var(--surface, #fff); border: 1px solid var(--card-border, rgba(0,0,0,0.08));
      border-radius: 10px; padding: 6px 10px 6px 0; text-align: left; font: inherit; color: inherit;
    }
    button.spider-related-row { cursor: pointer; }
    div.spider-related-row { cursor: default; }
    .spider-related-row-disabled { opacity: 0.55; cursor: default; }
    .spider-related-stripe { display: block; width: 4px; border-radius: 4px; flex-shrink: 0; align-self: stretch; }
    .spider-related-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; padding: 4px 0; }
    .spider-related-title-line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .spider-related-title-line strong { font-size: 13px; font-weight: 700; color: var(--text, #14262c); }
    .spider-related-cluster-badge {
      font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 8px;
      background: var(--bg, #f5faf9); color: var(--muted, #6b7280); white-space: nowrap; flex-shrink: 0;
    }
    .spider-related-note { font-size: 12px; color: var(--muted, #6b7280); }
    :root[data-theme="dark"] .spider-related-header { color: var(--text, #e6eef6); }
    :root[data-theme="dark"] .spider-related-row { background: var(--surface, #1c2430); border-color: rgba(255,255,255,0.12); }
    :root[data-theme="dark"] .spider-related-title-line strong { color: var(--text, #e6eef6); }
  `;
  document.head.appendChild(style);
}

/* Vykreslí sekciu "Súvisí s" do `el`. Ak niet dát alebo N=0, `el`
   ostane prázdny (žiadny placeholder). opts.navigate zapína klik na
   riadok (volá opts.onNavigate(peer)); bez navigate sú riadky len na
   čítanie (div, nie button). */
export async function renderRelatedInto(el, areaKey, n, opts = {}) {
  if (!el) return;
  el.innerHTML = '';

  const idx = await loadArea(areaKey);
  if (!idx) return;
  const list = idx.related.get(Number(n)) || [];
  if (!list.length) return;

  ensureRelatedCss();

  const sorted = [...list].sort((a, b) => a.peer - b.peer);
  const navigate = !!opts.navigate;
  const onNavigate = typeof opts.onNavigate === 'function' ? opts.onNavigate : null;

  const section = document.createElement('div');
  section.className = 'spider-related-section';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'spider-related-header';
  header.setAttribute('aria-expanded', 'false');
  const arrow = document.createElement('span');
  arrow.className = 'spider-related-arrow';
  arrow.textContent = '▸';
  const headerLabel = document.createElement('span');
  headerLabel.textContent = `⇄ Súvisí s (${sorted.length})`;
  header.append(arrow, headerLabel);

  const listEl = document.createElement('div');
  listEl.className = 'spider-related-list';
  listEl.style.display = 'none';

  header.onclick = () => {
    const expanded = listEl.style.display !== 'none';
    if (expanded) {
      listEl.style.display = 'none';
      header.setAttribute('aria-expanded', 'false');
      arrow.textContent = '▸';
    } else {
      listEl.style.display = 'flex';
      header.setAttribute('aria-expanded', 'true');
      arrow.textContent = '▾';
      header.scrollIntoView({ block: 'nearest' });
    }
  };

  sorted.forEach(({ peer, note }) => {
    const clusterInfo = idx.clusterOf.get(peer);
    const row = document.createElement(navigate ? 'button' : 'div');
    if (navigate) row.type = 'button';
    row.className = 'spider-related-row';

    const stripe = document.createElement('span');
    stripe.className = `spider-related-stripe ${clusterInfo ? clusterInfo.colorClass : ''}`;

    const body = document.createElement('span');
    body.className = 'spider-related-body';

    const titleLine = document.createElement('span');
    titleLine.className = 'spider-related-title-line';
    const strong = document.createElement('strong');
    strong.textContent = `A${peer} · ${clusterInfo ? clusterInfo.label : ''}`;
    titleLine.appendChild(strong);
    if (clusterInfo) {
      const badge = document.createElement('span');
      badge.className = 'spider-related-cluster-badge';
      badge.textContent = clusterInfo.label;
      titleLine.appendChild(badge);
    }

    const noteLine = document.createElement('span');
    noteLine.className = 'spider-related-note';
    noteLine.textContent = note;

    body.append(titleLine, noteLine);
    row.append(stripe, body);
    listEl.appendChild(row);

    if (navigate && onNavigate) {
      row.onclick = () => onNavigate(peer);
    }

    fetchOkruhShortTitle(`A${peer}`, areaKey).then(title => {
      if (title) {
        strong.textContent = `A${peer} · ${title}`;
      } else if (navigate) {
        row.onclick = null;
        row.disabled = true;
        row.classList.add('spider-related-row-disabled');
      }
    });
  });

  section.append(header, listEl);
  el.appendChild(section);
}
