'use strict';

/* ============================================================
   scripts/spiderEditor.js  (Etapa 2 – admin editácia pavúkov)

   Samostatný overlay editor pavúčej štruktúry ({center, branches[]}).
   Voľba samostatného modulu (vykázané v Správe A): musí byť volateľný aj
   zo študijných appiek (pravo-app, ob-pravo-app) BEZ panel/sec kontextu
   launchera – vlastný overlay je čistejší a save-logika je len na jednom
   mieste (saveSpiderOverride).

   Prefill (efektívny stav = s aplikovaným override) dodáva VOLAJÚCI:
   - hlavná appka: getOkruh() (override-aware) → { center, branches }
   - sub-appka: applySpiderOverride(okruh,…) → okruh.spider
   Editor teda sám nefetchuje (basePath sa medzi kontextami líši).

   Save ide výhradne cez saveSpiderOverride (RTDB), okruhCache v spiderGames
   sa zneplatní cez window.invalidateOkruhCache (len ak je modul načítaný).
   Fail-soft: pri zlyhaní uloženia hláška a dáta ostávajú v editore.
============================================================ */

import { saveSpiderOverride } from './spiderOverrides.js';
import { formatEditStamp } from './contentOverrides.js';

let overlayEl = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = 'spiderEditorOverlay';
  overlayEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:none;align-items:center;justify-content:center;z-index:10600;padding:16px;box-sizing:border-box;overflow-y:auto;font-family:inherit;';
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* Prefill → pracovný model (obranný: zahodí nevalidné, doplní prázdne polia). */
function toModel(spider) {
  const branches = Array.isArray(spider && spider.branches) ? spider.branches : [];
  return {
    center: (spider && typeof spider.center === 'string') ? spider.center : '',
    branches: branches.map(b => ({
      label: (b && typeof b.label === 'string') ? b.label : '',
      leaves: Array.isArray(b && b.leaves) ? b.leaves.map(l => String(l ?? '')) : []
    }))
  };
}

const BTN = 'font:inherit;font-size:13px;border:1px solid #d0d5dd;border-radius:8px;padding:6px 10px;background:#f7f8fa;color:#333;cursor:pointer;';
const INP = 'width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #d0d5dd;border-radius:8px;font-size:14px;font-family:inherit;';

export function openSpiderEditor({ areaTitle, okruhCislo, spider, autor, rola, onSaved }) {
  const overlay = ensureOverlay();
  const model = toModel(spider);
  // Stopa poslednej úpravy (Krok 3) – prefill nesie _seal z applySpiderOverride.
  const stampText = formatEditStamp(spider && spider._seal);

  const panel = document.createElement('div');
  panel.style.cssText = 'background:#fff;color:#1a1a1a;border-radius:16px;padding:22px;max-width:640px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

  // hlavička + center
  const head = document.createElement('div');
  head.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h3 style="margin:0;font-size:18px">🕸️ Upraviť pavúka – A${esc(okruhCislo)}</h3>
      <button id="seClose" style="background:none;border:none;font-size:18px;cursor:pointer;color:#666">✕</button>
    </div>
    <div style="font-size:12px;color:#777;margin-bottom:10px">Zmena sa uloží ako Firebase override – pôvodný JSON sa nemení. Ostatní ju uvidia po načítaní okruhu.</div>
    ${stampText ? `<div style="font-size:12px;color:#555;margin:-4px 0 10px">${esc(stampText)}</div>` : ''}
    <label style="display:block;font-size:12px;font-weight:600;color:#444">Center (názov v strede pavúka)</label>
    <textarea id="seCenter" rows="2" style="${INP};margin-top:4px">${esc(model.center)}</textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 6px">
      <strong style="font-size:14px">Vetvy</strong>
      <button id="seAddBranch" style="${BTN}">+ vetva</button>
    </div>
  `;
  const branchesWrap = document.createElement('div');

  const err = document.createElement('div');
  err.style.cssText = 'display:none;color:#dc2626;font-size:13px;margin-top:10px';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;margin-top:16px';
  actions.innerHTML = `
    <button id="seSave" style="flex:1;background:#1a56db;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer">💾 Uložiť</button>
    <button id="seCancel" style="background:#f2f2f2;color:#333;border:none;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer">Zrušiť</button>
  `;

  panel.append(head, branchesWrap, err, actions);
  overlay.innerHTML = '';
  overlay.appendChild(panel);
  overlay.style.display = 'flex';

  const close = () => { overlay.style.display = 'none'; overlay.innerHTML = ''; };

  // center → model
  head.querySelector('#seCenter').addEventListener('input', e => { model.center = e.target.value; });
  head.querySelector('#seClose').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };

  /* Rebuild branch blokov z modelu (jednoduchšie a bezpečnejšie než mutovať DOM
     pri každom +/−; vstupy sa napojia na model cez input handlery). */
  function renderBranches() {
    branchesWrap.innerHTML = '';
    model.branches.forEach((branch, bi) => {
      const block = document.createElement('div');
      block.style.cssText = 'border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:10px;background:#fafafa';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px';
      const label = document.createElement('input');
      label.type = 'text'; label.value = branch.label; label.placeholder = 'Názov vetvy';
      label.style.cssText = INP;
      label.addEventListener('input', e => { model.branches[bi].label = e.target.value; });
      const delBranch = document.createElement('button');
      delBranch.textContent = '− vetva'; delBranch.style.cssText = BTN + 'flex-shrink:0';
      delBranch.onclick = () => { model.branches.splice(bi, 1); renderBranches(); };
      row.append(label, delBranch);

      const leavesWrap = document.createElement('div');
      branch.leaves.forEach((leaf, li) => {
        const lrow = document.createElement('div');
        lrow.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0 0 12px';
        const linp = document.createElement('input');
        linp.type = 'text'; linp.value = leaf; linp.placeholder = 'List (pojem)';
        linp.style.cssText = INP;
        linp.addEventListener('input', e => { model.branches[bi].leaves[li] = e.target.value; });
        const delLeaf = document.createElement('button');
        delLeaf.textContent = '−'; delLeaf.title = 'Odobrať list';
        delLeaf.style.cssText = BTN + 'flex-shrink:0';
        delLeaf.onclick = () => { model.branches[bi].leaves.splice(li, 1); renderBranches(); };
        lrow.append(linp, delLeaf);
        leavesWrap.appendChild(lrow);
      });

      const addLeaf = document.createElement('button');
      addLeaf.textContent = '+ list'; addLeaf.style.cssText = BTN + 'margin:8px 0 0 12px';
      addLeaf.onclick = () => { model.branches[bi].leaves.push(''); renderBranches(); };

      block.append(row, leavesWrap, addLeaf);
      branchesWrap.appendChild(block);
    });
  }
  renderBranches();

  head.querySelector('#seAddBranch').onclick = () => { model.branches.push({ label: '', leaves: [] }); renderBranches(); };
  actions.querySelector('#seCancel').onclick = close;

  actions.querySelector('#seSave').onclick = async () => {
    // Vyčisti: trim, prázdne listy vyhoď, prázdne vetvy (bez labelu) sú chyba.
    const cleaned = {
      center: (model.center || '').trim(),
      branches: model.branches.map(b => ({
        label: (b.label || '').trim(),
        leaves: b.leaves.map(l => (l || '').trim()).filter(Boolean)
      }))
    };
    if (cleaned.branches.some(b => !b.label)) {
      err.textContent = 'Každá vetva musí mať neprázdny názov (alebo ju odober).';
      err.style.display = 'block';
      return;
    }
    err.style.display = 'none';

    // Upozornenie (nie blok): žiadna vetva nemá ≥2 listy → hry nebudú mať dosť dát.
    const enoughForGames = cleaned.branches.some(b => b.leaves.length >= 2);
    if (!enoughForGames && !window.confirm('Žiadna vetva nemá aspoň 2 listy – pavúkové hry na tomto okruhu nebudú mať dosť dát. Uložiť aj tak?')) {
      return;
    }

    const saveBtn = actions.querySelector('#seSave');
    saveBtn.disabled = true; saveBtn.textContent = 'Ukladám...';
    try {
      const saved = await saveSpiderOverride({ areaTitle, okruhCislo, spider: cleaned, autor, rola });
      // Zneplatni okruhCache v spiderGames – LEN ak je modul načítaný (window binding).
      try { if (typeof window.invalidateOkruhCache === 'function') window.invalidateOkruhCache(areaTitle, okruhCislo); } catch (e) {}
      close();
      if (typeof onSaved === 'function') onSaved(saved);
    } catch (e) {
      err.textContent = 'Chyba pri ukladaní: ' + e.message + ' (dáta ostávajú v editore)';
      err.style.display = 'block';
      saveBtn.disabled = false; saveBtn.textContent = '💾 Uložiť';
    }
  };
}
