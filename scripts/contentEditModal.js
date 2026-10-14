'use strict';

/* ============================================================
   scripts/contentEditModal.js

   Zdieľaný inline-edit modál pre admina/garanta (summary/quiz/case
   otázka) – funguje rovnako v hlavnej appke (index.html) aj v
   samostatných študijných appkách (pracovne/trestne/eu-pravo-app,
   ob-pravo-app), preto je celý štylovaný inline (žiadna závislosť
   na styles.css ani engine.css). Uloženie ide cez
   scripts/contentOverrides.js -> Firebase (nie do JSON súborov).
============================================================ */

import { saveContentOverride } from './contentOverrides.js';

let modalEl = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.id = 'contentEditModal';
  modalEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:10500;padding:16px;box-sizing:border-box;overflow-y:auto;font-family:inherit;';
  document.body.appendChild(modalEl);
  return modalEl;
}

const inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;font-size:14px;font-family:inherit;margin-top:4px;';
const labelStyle = 'display:block;font-size:12px;font-weight:600;color:#444;margin-top:12px;';

/* ctx = { app, okruh, cast, kind: 'summary'|'question'|'tile', current, autor, rola, title, onSaved } */
export function openContentEditModal(ctx) {
  const modal = ensureModal();
  const isSummary = ctx.kind === 'summary';
  const isTile = ctx.kind === 'tile';

  const optionsHtml = (isSummary || isTile) ? '' : (ctx.current.options || []).map((opt, i) => `
    <label style="${labelStyle}">Možnosť ${i + 1} ${i === ctx.current.correct ? '(správna)' : ''}</label>
    <input type="text" class="ce-opt" data-i="${i}" value="${escapeAttr(opt)}" style="${inputStyle}"/>
  `).join('');

  modal.innerHTML = `
    <div style="background:#fff;color:#1a1a1a;border-radius:16px;padding:24px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="margin:0;font-size:18px">✏️ ${ctx.title || 'Upraviť obsah'}</h3>
        <button id="ceClose" style="background:none;border:none;font-size:18px;cursor:pointer;color:#666">✕</button>
      </div>
      <div style="font-size:12px;color:#777;margin-bottom:8px">Zmena sa uloží ako Firebase override – pôvodný JSON súbor sa nemení. Ostatní ju uvidia okamžite.</div>

      ${isSummary ? `
        <label style="${labelStyle}">Text zhrnutia</label>
        <textarea id="ceSummary" rows="8" style="${inputStyle}">${escapeHtmlText(ctx.current.summary || '')}</textarea>
      ` : isTile ? `
        <label style="${labelStyle}">Pojem</label>
        <input type="text" id="ceTerm" value="${escapeAttr(ctx.current.term || '')}" style="${inputStyle}"/>

        <label style="${labelStyle}">Definícia</label>
        <textarea id="ceDefinition" rows="5" style="${inputStyle}">${escapeHtmlText(ctx.current.definition || '')}</textarea>

        <label style="${labelStyle}">Zdroj (citácia)</label>
        <input type="text" id="ceTileZdroj" value="${escapeAttr((ctx.current.zdroj && ctx.current.zdroj.citation) || '')}" style="${inputStyle}"/>
      ` : `
        <label style="${labelStyle}">Znenie otázky</label>
        <textarea id="ceQuestion" rows="2" style="${inputStyle}">${escapeHtmlText(ctx.current.question || '')}</textarea>

        ${optionsHtml}

        <label style="${labelStyle}">Index správnej možnosti (0 = prvá)</label>
        <input type="number" id="ceCorrect" min="0" value="${ctx.current.correct || 0}" style="${inputStyle}"/>

        <label style="${labelStyle}">Vysvetlenie – správna odpoveď</label>
        <textarea id="ceExpCorrect" rows="2" style="${inputStyle}">${escapeHtmlText((ctx.current.explanation && ctx.current.explanation.correct) || '')}</textarea>

        <label style="${labelStyle}">Vysvetlenie – nesprávna odpoveď</label>
        <textarea id="ceExpWrong" rows="2" style="${inputStyle}">${escapeHtmlText((ctx.current.explanation && ctx.current.explanation.wrong) || '')}</textarea>

        <label style="${labelStyle}">Zdroj (citácia)</label>
        <input type="text" id="ceZdrojCitation" value="${escapeAttr((ctx.current.zdroj && ctx.current.zdroj.citation) || '')}" style="${inputStyle}"/>
      `}

      <div id="ceError" style="display:none;color:#dc2626;font-size:13px;margin-top:10px"></div>

      <div style="display:flex;gap:8px;margin-top:18px">
        <button id="ceSave" style="flex:1;background:#1a56db;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer">💾 Uložiť zmenu</button>
        <button id="ceCancel" style="background:#f2f2f2;color:#333;border:none;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer">Zrušiť</button>
      </div>
    </div>`;

  modal.style.display = 'flex';

  const close = () => { modal.style.display = 'none'; };
  modal.querySelector('#ceClose').onclick = close;
  modal.querySelector('#ceCancel').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };

  modal.querySelector('#ceSave').onclick = async () => {
    const errEl = modal.querySelector('#ceError');
    const btn = modal.querySelector('#ceSave');
    let novyObsah;

    if (isSummary) {
      const summary = modal.querySelector('#ceSummary').value.trim();
      if (!summary) { errEl.textContent = 'Zhrnutie nesmie byť prázdne.'; errEl.style.display = 'block'; return; }
      novyObsah = { summary };
    } else if (isTile) {
      const term = modal.querySelector('#ceTerm').value.trim();
      const definition = modal.querySelector('#ceDefinition').value.trim();
      const tileZdroj = modal.querySelector('#ceTileZdroj').value.trim();
      if (!term) { errEl.textContent = 'Pojem nesmie byť prázdny.'; errEl.style.display = 'block'; return; }
      if (!definition) { errEl.textContent = 'Definícia nesmie byť prázdna.'; errEl.style.display = 'block'; return; }
      novyObsah = {
        term, definition,
        zdroj: tileZdroj ? { type: 'zakon', citation: tileZdroj } : (ctx.current.zdroj || null)
      };
    } else {
      const question = modal.querySelector('#ceQuestion').value.trim();
      const options = Array.from(modal.querySelectorAll('.ce-opt')).map(inp => inp.value.trim());
      const correct = parseInt(modal.querySelector('#ceCorrect').value, 10) || 0;
      const expCorrect = modal.querySelector('#ceExpCorrect').value.trim();
      const expWrong = modal.querySelector('#ceExpWrong').value.trim();
      const zdrojCitation = modal.querySelector('#ceZdrojCitation').value.trim();

      if (!question) { errEl.textContent = 'Znenie otázky nesmie byť prázdne.'; errEl.style.display = 'block'; return; }
      if (options.some(o => !o)) { errEl.textContent = 'Žiadna možnosť nesmie byť prázdna.'; errEl.style.display = 'block'; return; }
      if (correct < 0 || correct >= options.length) { errEl.textContent = 'Index správnej možnosti je mimo rozsahu.'; errEl.style.display = 'block'; return; }

      novyObsah = {
        question, options, correct,
        explanation: (expCorrect || expWrong) ? { correct: expCorrect, wrong: expWrong } : null,
        zdroj: zdrojCitation ? { type: 'zakon', citation: zdrojCitation } : (ctx.current.zdroj || null)
      };
    }

    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Ukladám...';

    try {
      const saved = await saveContentOverride({
        app: ctx.app, okruh: ctx.okruh, cast: ctx.cast,
        novyObsah, autor: ctx.autor, rola: ctx.rola
      });
      close();
      if (typeof ctx.onSaved === 'function') ctx.onSaved(saved);
    } catch (e) {
      errEl.textContent = 'Chyba pri ukladaní: ' + e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Uložiť zmenu';
    }
  };
}

function escapeAttr(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeHtmlText(s) {
  return escapeAttr(s);
}
