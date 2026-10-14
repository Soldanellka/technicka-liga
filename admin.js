'use strict';

import { $, escapeHtml } from './core.js';
import {
  role,
  reports,
  selectedFaculty,
  selectedArea,
  setRole
} from './state.js';
import { showRewardToast } from './ui.js';
import { persistReports } from './reports.js';

/* ===============================
   Udeľ pečať garanta
   =============================== */
export function grantGuarantee(reportId){
  const r = reports.find(x => x.id === reportId);
  if(!r) return;

  if(role !== 'garant'){
    alert('Iba garant môže udeliť pečať.');
    return;
  }

  r.status = 'guaranteed';
  r.guaranteedBy = 'garant';
  r.guaranteedAt = new Date().toISOString();

  persistReports();
  showRewardToast('Pečať garanta udelená');
  renderAdminPanel();
}

/* ===============================
   Admin schválenie reportu
   =============================== */
export function approveReport(reportId){
  const r = reports.find(x => x.id === reportId);
  if(!r) return;

  if(role !== 'admin'){
    alert('Iba admin môže schváliť.');
    return;
  }

  r.status = 'approved';
  r.approvedBy = 'admin';
  r.approvedAt = new Date().toISOString();

  // aktualizácia otázky
  if(r.type === 'question'){
    let updated = false;

    if(r.questionId){
      Object.keys(catalog || {}).forEach(f => {
        (catalog[f].areas || []).forEach(a => {
          (a.questions || []).forEach(q => {
            if(q.id === r.questionId){
              q.q = r.proposal;
              q.options = r.proposalOptions || q.options;
              q.correct = typeof r.proposalCorrectIndex === 'number'
                ? r.proposalCorrectIndex
                : q.correct;
              q.approved = true;
              updated = true;
            }
          });
        });
      });
    }

    // ak otázka neexistuje → vytvor novú
    if(!updated){
      addQuestionToArea(
        r.targetFaculty || selectedFaculty,
        r.targetArea || (selectedArea && selectedArea.id),
        {
          id: 'q_' + Date.now(),
          q: r.proposal,
          options: r.proposalOptions || [],
          correct: r.proposalCorrectIndex || 0,
          approved: true
        }
      );
    }
  }

  // Samo-odmena adminovi zrušená. § za schválené nahlásenie dostáva REPORTÉR –
  // rieši sa v živej ceste (index.html openVerdictModal), nie v tomto legacy paneli.
  persistReports();
  showRewardToast('Otázka schválená (admin)');
  renderAdminPanel();
}

/* ===============================
   Zamietnutie reportu
   =============================== */
export function rejectReport(reportId){
  const r = reports.find(x => x.id === reportId);
  if(!r) return;

  r.status = 'rejected';
  r.rejectedBy = role;
  r.rejectedAt = new Date().toISOString();

  persistReports();
  renderAdminPanel();
  showRewardToast('Hlásenie zamietnuté.');
}

/* ===============================
   Pridanie otázky do oblasti
   =============================== */
export function addQuestionToArea(facultyName, areaId, questionObj){
  if(!facultyName || !areaId) return;

  if(!catalog[facultyName])
    catalog[facultyName] = { areas: [] };

  const area = catalog[facultyName].areas.find(a => a.id === areaId);

  if(area){
    area.questions = area.questions || [];
    area.questions.push({ ...questionObj, approved: true });
    showRewardToast('Otázka pridaná do oblasti.');
  } else {
    const newArea = {
      id: areaId,
      title: areaId,
      desc: '',
      questions: [{ ...questionObj, approved: true }]
    };
    catalog[facultyName].areas.push(newArea);
    showRewardToast('Otázka pridaná do novej oblasti.');
  }
}

/* ===============================
   Render admin panelu
   =============================== */
export function renderAdminPanel(){
  const panel = $('adminPanel');
  if(!panel) return;

  if(role === 'student'){
    panel.innerHTML = 'Pre zobrazenie prepni rolu na "garant" alebo "admin".';
    return;
  }

  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'small';
  header.innerHTML = `Rola: <strong>${escapeHtml(role)}</strong>`;
  panel.appendChild(header);

  /* --- Reports --- */
  const hReports = document.createElement('h3');
  hReports.style.marginTop = '12px';
  hReports.textContent = 'Hlásenia chýb v obsahu';
  panel.appendChild(hReports);

  if(reports.length === 0){
    const none = document.createElement('div');
    none.className = 'small';
    none.textContent = 'Žiadne hlásenia.';
    panel.appendChild(none);
  } else {
    reports.forEach(r => {
      panel.appendChild(buildReportCard(r));
    });
  }

  /* --- Schvaľovanie otázok --- */
  const hApprove = document.createElement('h3');
  hApprove.style.marginTop = '20px';
  hApprove.textContent = 'Schvaľovanie otázok';
  panel.appendChild(hApprove);

  if(selectedFaculty && selectedArea){
    const area = selectedArea;

    const areaTitleEl = document.createElement('div');
    areaTitleEl.style.marginTop = '10px';
    areaTitleEl.innerHTML = `<strong>${escapeHtml(selectedFaculty)} • ${escapeHtml(area.title)}</strong>`;
    panel.appendChild(areaTitleEl);

    (area.questions || []).forEach((q, idx) => {
      const card = document.createElement('div');
      card.id = `qcard-${idx}`;
      card.style.cssText = `
        border:1px solid rgba(0,0,0,0.04);
        padding:10px;
        margin-top:10px;
        border-radius:8px;
        position:relative;
        background:linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,250,252,0.6))
      `;

      const qTextEl = document.createElement('div');
      qTextEl.style.fontWeight = '600';
      qTextEl.textContent = q.q;
      card.appendChild(qTextEl);

      const small = document.createElement('div');
      small.className = 'small';
      small.style.marginTop = '6px';
      small.textContent = `Schválené: ${q.approved ? 'Áno' : 'Nie'}`;
      card.appendChild(small);

      if(q.approved){
        const img = document.createElement('img');
        img.src = 'assets/icons/check.svg';
        img.style.position = 'absolute';
        img.style.right = '12px';
        img.style.top = '12px';
        img.style.width = '22px';
        img.style.height = '22px';
        card.appendChild(img);
      } else {
        const approveBtn = document.createElement('button');
        approveBtn.className = 'btn btn-primary';
        approveBtn.style.marginTop = '8px';
        approveBtn.textContent = 'Schváliť';
        approveBtn.addEventListener('click', () =>
          approveQuestion(selectedFaculty, selectedArea.id, idx)
        );
        card.appendChild(approveBtn);
      }

      panel.appendChild(card);
    });
  } else {
    const note = document.createElement('div');
    note.className = 'small';
    note.style.marginTop = '8px';
    note.textContent = 'Vyber odbor a oblasť pre zobrazenie otázok.';
    panel.appendChild(note);
  }
}

/* ===============================
   Karta jedného hlásenia
   =============================== */
function buildReportCard(r){
  const card = document.createElement('div');
  card.style.cssText = 'border:1px solid #eee;padding:10px;margin-top:10px;border-radius:8px';

  const idRow = document.createElement('div');
  idRow.innerHTML = `<strong>ID:</strong> ${escapeHtml(String(r.id))}`;
  card.appendChild(idRow);

  const arg = document.createElement('div');
  arg.innerHTML = `<strong>Argumentácia:</strong> ${escapeHtml(r.argument || '')}`;
  card.appendChild(arg);

  const prop = document.createElement('div');
  prop.innerHTML = `<strong>Návrh:</strong> ${escapeHtml(r.proposal || '')}`;
  card.appendChild(prop);

  const status = document.createElement('div');
  status.innerHTML = `<strong>Stav:</strong> ${escapeHtml(r.status || '')}`;
  card.appendChild(status);

  const actions = document.createElement('div');
  actions.style.marginTop = '8px';

  if(role === 'garant' && r.status === 'pending'){
    const gBtn = document.createElement('button');
    gBtn.className = 'btn btn-primary';
    gBtn.textContent = 'Udeľ pečať garanta';
    gBtn.addEventListener('click', () => grantGuarantee(r.id));
    actions.appendChild(gBtn);
  }

  if(role === 'admin' && (r.status === 'pending' || r.status === 'guaranteed')){
    const aBtn = document.createElement('button');
    aBtn.className = 'btn btn-primary';
    aBtn.textContent = 'Schváliť';
    aBtn.addEventListener('click', () => approveReport(r.id));
    actions.appendChild(aBtn);
  }

  const rejBtn = document.createElement('button');
  rejBtn.className = 'btn';
  rejBtn.textContent = 'Zamietnuť';
  rejBtn.addEventListener('click', () => rejectReport(r.id));
  actions.appendChild(rejBtn);

  card.appendChild(actions);
  return card;
}

/* ===============================
   Schválenie otázky (garant/admin)
   =============================== */
export function approveQuestion(faculty, areaId, qIndex){
  if(!catalog || !catalog[faculty]) return;

  const area = catalog[faculty].areas.find(a => a.id === areaId);
  if(area && area.questions && area.questions[qIndex]){
    area.questions[qIndex].approved = true;

    const card = $(`qcard-${qIndex}`);
    if(card){
      try {
        card.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }],
          { duration: 420, easing: 'ease-out' }
        );
      } catch(e){}

      setTimeout(() => {
        const btn = card.querySelector('button');
        if(btn) btn.remove();

        const img = document.createElement('img');
        img.src = 'assets/icons/check.svg';
        img.style.width = '22px';
        img.style.height = '22px';
        img.style.position = 'absolute';
        img.style.right = '12px';
        img.style.top = '12px';
        img.style.opacity = '0';
        img.style.transition = 'opacity 220ms ease, transform 220ms ease';

        card.appendChild(img);

        requestAnimationFrame(() => {
          img.style.opacity = '1';
          img.style.transform = 'translateY(-2px)';
        });
      }, 260);
    }

    renderAdminPanel();
    showRewardToast('Otázka schválená • ďakujeme');
  }
}

window.approveQuestion = approveQuestion;
