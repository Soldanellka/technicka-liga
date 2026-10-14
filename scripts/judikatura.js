'use strict';

/* ============================================================
   Rešerš judikatúry NS SR – statická sekcia v pravom (.right) stĺpci,
   hneď pod #gamesSection ("Hry a prípady"). Variant A: kurátorovaný
   zoznam inštitútov (JUDIKATURA_CONFIG) → klik → api/nsud-proxy.js
   (searchDecision/getDecision) → zoznam reálnych rozhodnutí s odkazom
   na originál. Bez LLM, bez § ceny.

   Poradie výsledkov = NATÍVNE poradie z API (žiadne triedenie podľa
   ID/dátumu – getDecision sa volá až na finálnych ≤15 ID, dátum teda
   ani nie je k dispozícii skôr, než by sa dalo podľa neho triediť).

   Pôvodne plávajúci panel vpravo dole (position:fixed FAB + panel) –
   nahradené statickou sekciou (2026-07-27), zoznam inštitútov ostáva
   vždy viditeľný, výsledky sa rozbaľujú inline pod kliknutým
   inštitútom (žiadny samostatný view/back-stack, žiadny position:fixed
   kolízny súboj s toastami/bottom-nav).
============================================================ */

import { JUDIKATURA_CONFIG } from './judikaturaConfig.js';

const MAX_RESULTS = 15;
const DETAIL_BATCH_SIZE = 4; // pozri fetchDetailsBatched – nsud.sk bolo pri diagnostike nestabilné (502) pod rýchlou záťažou

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/* =========================
   Retrieval
   ========================= */

async function proxySearch(term) {
  const res = await fetch(`/api/nsud-proxy?action=search&term=${encodeURIComponent(term)}`);
  const json = await res.json().catch(() => null);
  if (!json || !json.ok) throw new Error((json && json.error) || 'Vyhľadávanie zlyhalo.');
  return Array.isArray(json.data) ? json.data : [];
}

async function proxyDetail(id) {
  const res = await fetch(`/api/nsud-proxy?action=detail&id=${encodeURIComponent(id)}`);
  const json = await res.json().catch(() => null);
  if (!json || !json.ok) throw new Error((json && json.error) || 'Detail rozhodnutia zlyhal.');
  return json.data;
}

// AND vnútri skupiny: pole PRVÉHO termu (zachová jeho poradie) sa
// filtruje podľa množín zvyšných termov skupiny. Skupina s jedným
// termom vráti pole prvého termu bezo zmeny (žiadne ostatné množiny
// na filtrovanie).
async function resolveGroupIds(group) {
  const termArrays = await Promise.all(group.map(proxySearch));
  const [first, ...rest] = termArrays;
  if (!first) return [];
  const restSets = rest.map(arr => new Set(arr));
  return first.filter(id => restSets.every(set => set.has(id)));
}

// OR medzi skupinami: spojenie v poradí skupín (skupina 1 celá, potom
// skupina 2, ...) + stabilný dedupe (prvý výskyt ID rozhoduje o jeho
// pozícii). Žiadne triedenie podľa ID/dátumu.
async function resolveInstitutIds(config) {
  const groupResults = await Promise.all(config.queryGroups.map(resolveGroupIds));
  const seen = new Set();
  const merged = [];
  for (const group of groupResults) {
    for (const id of group) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }
  return merged.slice(0, MAX_RESULTS);
}

function buildResultRecord(id, detail) {
  const cislo = detail.cislo || '';
  const slug = cislo.replace(/\//g, '').toLowerCase();
  return {
    id,                              // z hľadania – detail.ID chodí prázdne, NEPOUŽÍVAŤ
    cislo,
    merito: detail.merito || '',
    datum: detail.datum || '',
    kolegium: detail.kolegium != null ? String(detail.kolegium) : '',
    url: slug ? `https://www.nsud.sk/rozhodnutia/${slug}/` : null
  };
}

// getDecision sa volá len pre finálnych ≤15 ID, v malých dávkach
// (nie všetkých naraz) – nsud.sk pri diagnostike pod rýchlou súbežnou
// záťažou občas vrátilo 502. Jedno zlyhané ID sa preskočí (filter),
// nezhodí to zvyšok zoznamu.
async function fetchDetailsBatched(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += DETAIL_BATCH_SIZE) {
    const batch = ids.slice(i, i + DETAIL_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async id => {
      try {
        const detail = await proxyDetail(id);
        return buildResultRecord(id, detail);
      } catch (e) {
        return null;
      }
    }));
    results.push(...batchResults);
  }
  return results.filter(Boolean);
}

async function fetchInstitutResults(institutId) {
  const config = JUDIKATURA_CONFIG.instituty.find(i => i.id === institutId);
  if (!config) throw new Error('Neznámy inštitút.');
  const ids = await resolveInstitutIds(config);
  return fetchDetailsBatched(ids);
}

/* =========================
   UI – statická sekcia, inline rozbaľovanie
   ========================= */

const resultsCache = new Map(); // institutId -> results[] (v rámci session, nie je to proxy cache)

function renderResultsHtml(results) {
  if (!results.length) {
    return `<p class="judikatura-hint">Žiadne rozhodnutia sa nepodarilo načítať.</p>`;
  }
  const cards = results.map(r => `
    <div class="card judikatura-result-card">
      <div class="judikatura-result-cislo">${escapeHtml(r.cislo || '(bez čísla)')}</div>
      <div class="judikatura-result-merito">${escapeHtml(r.merito || '(bez merita)')}</div>
      <div class="judikatura-result-meta">
        ${r.datum ? `<span>${escapeHtml(r.datum)}</span>` : ''}
        ${r.kolegium ? `<span>kolégium ${escapeHtml(r.kolegium)}</span>` : ''}
      </div>
      ${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="btn btn-primary judikatura-result-link">Otvoriť rozhodnutie ↗</a>` : ''}
    </div>
  `).join('');
  return `
    <p class="judikatura-hint">Nájdených ${results.length} rozhodnutí (poradie podľa API):</p>
    <div class="judikatura-results">${cards}</div>
  `;
}

function collapseInstitut(resultsEl, btn) {
  resultsEl.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  btn.classList.remove('judikatura-institut-active');
}

// Jediné miesto, ktoré zapisuje obsah resultsEl a napája "← Zbaliť" –
// loading/error/results stavy ním prechádzajú všetky rovnako, žiadny
// z nich preto nezostane bez funkčného collapse tlačidla.
function setInlineContent(resultsEl, btn, innerHtml) {
  resultsEl.innerHTML = innerHtml + `<button type="button" class="btn judikatura-collapse-btn">← Zbaliť</button>`;
  resultsEl.querySelector('.judikatura-collapse-btn').addEventListener('click', () => collapseInstitut(resultsEl, btn));
}

function expandInstitut(resultsEl, btn) {
  resultsEl.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('judikatura-institut-active');
}

async function toggleInstitut(resultsEl, btn, institutId) {
  const config = JUDIKATURA_CONFIG.instituty.find(i => i.id === institutId);
  if (!config) return;

  // Druhý klik na už rozbalený inštitút = zbaliť (bez znovunačítania).
  if (!resultsEl.hidden) {
    collapseInstitut(resultsEl, btn);
    return;
  }

  expandInstitut(resultsEl, btn);

  if (resultsCache.has(institutId)) {
    setInlineContent(resultsEl, btn, renderResultsHtml(resultsCache.get(institutId)));
    return;
  }

  setInlineContent(resultsEl, btn, `<p class="judikatura-hint">Načítavam rozhodnutia z NS SR…</p>`);
  try {
    const results = await fetchInstitutResults(institutId);
    resultsCache.set(institutId, results);
    setInlineContent(resultsEl, btn, renderResultsHtml(results));
  } catch (e) {
    setInlineContent(resultsEl, btn, `<p class="judikatura-hint judikatura-error">${escapeHtml(e.message || 'Načítanie zlyhalo.')}</p>`);
  }
}

function mountJudikaturaSection() {
  if (document.getElementById('judikaturaSection')) return; // ochrana pred dvojitým mountom

  /* Judikatúra patrí do množiny „Uč sa“ v ĽAVOM stĺpci (výber oblasti
     nepotrebuje) a stojí v nej ako posledná – kotví sa preto `afterend`
     za #biflovackaCard. Krátko bola vpravo kvôli balansu stĺpcov, ale to
     ho prestrelilo na druhú stranu; vyrovnáva sa inak (zbaliteľné
     Návody & odmeny). Podpora hostiteľa #judikaturaHost ostáva pre prípad,
     že by sa niekedy znovu presúvala – ak v markupe je, vloží sa doň.
     Fallback na #quizCard, keby chýbala aj Bifľovačka: lepšie zobraziť
     sekciu inde než ju nezobraziť vôbec. */
  const host = document.getElementById('judikaturaHost');
  const anchor = host
              || document.getElementById('biflovackaCard')
              || document.getElementById('quizCard');
  if (!anchor || !anchor.parentNode) return; // niet kam montovať – nemontovať naslepo

  const section = document.createElement('div');
  section.className = 'card';
  section.id = 'judikaturaSection';
  section.innerHTML = `
    <h3 style="margin:0">⚖️ Judikatúra NS SR</h3>
    <p class="judikatura-hint">Vyber skúšobný inštitút – appka vytiahne reálne rozhodnutia NS SR.</p>
    <div class="judikatura-list">
      ${JUDIKATURA_CONFIG.instituty.map(i => `
        <div class="judikatura-institut-row">
          <button type="button" class="chip judikatura-institut-btn" data-institut="${escapeHtml(i.id)}" aria-expanded="false">
            ${escapeHtml(i.nazov)}
            <span class="judikatura-oblast">${escapeHtml(i.oblast)}</span>
          </button>
          <div class="judikatura-institut-results" hidden></div>
        </div>
      `).join('')}
    </div>
  `;

  // Hostiteľ = vložiť DOVNÚTRA; kotva (fallback) = vložiť ZA ňu.
  if (host) host.appendChild(section);
  else anchor.insertAdjacentElement('afterend', section);

  section.querySelectorAll('.judikatura-institut-btn').forEach(btn => {
    const row = btn.closest('.judikatura-institut-row');
    const resultsEl = row.querySelector('.judikatura-institut-results');
    btn.addEventListener('click', () => toggleInstitut(resultsEl, btn, btn.dataset.institut));
  });
}

mountJudikaturaSection();
