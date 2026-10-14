'use strict';

import { ref, push, update, get, onValue }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ============================================================
   KONFIGURÁCIA PEČATÍ
============================================================ */
const SEAL_CONFIG = {
  bronze: { label: '🥉 Bronzová pečať', min: 1,   max: 6   },
  silver: { label: '🥈 Strieborná pečať', min: 7,  max: 99  },
  gold:   { label: '🥇 Zlatá pečať',     min: 100, max: Infinity }
};

function getSealType(approvedCount) {
  if (approvedCount >= 100) return 'gold';
  if (approvedCount >= 7)   return 'silver';
  if (approvedCount >= 1)   return 'bronze';
  return null;
}

function getSealEmoji(type) {
  return { gold: '🥇', silver: '🥈', bronze: '🥉' }[type] || '';
}

/* ============================================================
   POMOCNÉ FUNKCIE
============================================================ */
function getDb() { return window.db || null; }
function getNick() { return localStorage.getItem('playerNick') || null; }

/* ============================================================
   MODAL NA NAHLASOVANIE
============================================================ */
export function openReportModal(prefill = {}) {
  const existing = document.getElementById('reportModal');
  if (existing) {
    existing.style.display = 'flex';
    if (prefill.questionId) {
      const qField = document.getElementById('reportQuestionId');
      if (qField) qField.value = prefill.questionId;
    }
    if (prefill.area) {
      const aField = document.getElementById('reportArea');
      if (aField) aField.value = prefill.area;
    }
    if (prefill.questionText) {
      const tField = document.getElementById('reportQuestionText');
      if (tField) tField.value = prefill.questionText;
    }
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'reportModal';
  modal.className = 'avatar-modal';
  modal.style.display = 'flex';

  modal.innerHTML = `
    <div class="avatar-panel report-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h3 style="margin:0">⚖️ Nahlásiť chybu</h3>
          <div class="small muted">Vysvetli, prečo je to zle, a navrhni správne znenie</div>
        </div>
        <button class="btn" id="closeReportModal">✕</button>
      </div>

      <div class="report-form">

        <div class="form-row">
          <label class="form-label">Oblasť práva *</label>
          <select id="reportArea" class="form-input">
            <option value="">– Vyber oblasť –</option>
            <option value="Pracovné právo">Pracovné právo</option>
            <option value="Trestné právo hmotné">Trestné právo hmotné</option>
            <option value="Trestné právo procesné">Trestné právo procesné</option>
            <option value="Občianske právo">Občianske právo</option>
            <option value="Rímske právo">Rímske právo</option>
            <option value="Dejiny práva">Dejiny práva</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">Číslo otázky *
            <span class="small muted">(napr. A23 / otázka 3, alebo text otázky)</span>
          </label>
          <input id="reportQuestionId" class="form-input" type="text"
            placeholder="napr. A23 / otázka 3" maxlength="100"
            value="${prefill.questionId || ''}"/>
        </div>

        <div class="form-row">
          <label class="form-label">Text otázky (voliteľné)</label>
          <textarea id="reportQuestionText" class="feedback-textarea" rows="2"
            placeholder="Skopíruj text otázky pre lepšiu identifikáciu..."
            maxlength="500">${prefill.questionText || ''}</textarea>
        </div>

        <div class="form-row">
          <label class="form-label">Typ chyby *</label>
          <div class="report-type-btns">
            <button class="report-type-btn active" data-type="wrong_answer">❌ Nesprávna odpoveď</button>
            <button class="report-type-btn" data-type="outdated">📅 Zastaraná informácia</button>
            <button class="report-type-btn" data-type="unclear">❓ Nejasné znenie</button>
            <button class="report-type-btn" data-type="other">📝 Iné</button>
          </div>
        </div>

        <div class="form-row">
          <label class="form-label">Vysvetlenie, prečo je to zle * 
            <span class="small muted">(min. 50 znakov)</span>
          </label>
          <textarea id="reportArgument" class="feedback-textarea" rows="5"
            placeholder="Napr.: Odporúčaná rezerva je 3–6 mesiacov výdavkov, nie 1 mesiac – viď zhrnutie okruhu a metodika NBS k finančnej gramotnosti."
            maxlength="2000"></textarea>
          <div style="text-align:right;margin-top:4px">
            <span id="reportArgCharCount" class="small muted">0 / 2000</span>
          </div>
        </div>

        <div class="form-row">
          <label class="form-label">Zdroj</label>
          <input id="reportSource" class="form-input" type="text"
            placeholder="napr. NBS, učebnica, článok…" maxlength="200"/>
        </div>

        <div id="reportError" class="report-error" style="display:none"></div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-primary" id="submitReportBtn" style="flex:1">
            ⚖️ Odoslať do Poroty
          </button>
          <button class="btn" id="cancelReportBtn">Zrušiť</button>
        </div>
      </div>

      <div id="reportSuccess" style="display:none;text-align:center;padding:20px">
        <div style="font-size:48px;margin-bottom:12px">⚖️</div>
        <h3 style="margin:0 0 8px 0">Nahlásené!</h3>
        <p class="small muted">Tvoje nahlásenie bolo presunuté do Poroty.<br>
        Ostatní hráči sa môžu vyjadriť, potom to posúdi admin.</p>
        <button class="btn" id="closeReportSuccess" style="margin-top:16px">Zavrieť</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Zatvoriť
  const close = () => { modal.style.display = 'none'; };
  modal.querySelector('#closeReportModal').onclick = close;
  modal.querySelector('#cancelReportBtn').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.querySelector('#closeReportSuccess').onclick = () => {
    modal.style.display = 'none';
    modal.querySelector('.report-form').style.display = 'block';
    modal.querySelector('#reportSuccess').style.display = 'none';
  };

  // Typ nezrovnalosti
  let selectedType = 'wrong_answer';
  modal.querySelectorAll('.report-type-btn').forEach(btn => {
    btn.onclick = () => {
      modal.querySelectorAll('.report-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
    };
  });

  // Počítadlo znakov
  const argArea = modal.querySelector('#reportArgument');
  const argCount = modal.querySelector('#reportArgCharCount');
  argArea.oninput = () => {
    argCount.textContent = `${argArea.value.length} / 2000`;
  };

  // Predvyplnenie oblasti
  if (prefill.area) {
    const sel = modal.querySelector('#reportArea');
    if (sel) sel.value = prefill.area;
  }

  // Odoslanie
  modal.querySelector('#submitReportBtn').onclick = async () => {
    const area = modal.querySelector('#reportArea').value;
    const questionId = modal.querySelector('#reportQuestionId').value.trim();
    const questionText = modal.querySelector('#reportQuestionText').value.trim();
    const argument = modal.querySelector('#reportArgument').value.trim();
    const source = modal.querySelector('#reportSource').value.trim();
    const errorEl = modal.querySelector('#reportError');

    // Validácia
    if (!area) return showError(errorEl, 'Vyber oblasť práva.');
    if (!questionId) return showError(errorEl, 'Zadaj číslo alebo identifikátor otázky.');
    if (argument.length < 50) return showError(errorEl, 'Argumentácia musí mať aspoň 50 znakov.');

    errorEl.style.display = 'none';
    const submitBtn = modal.querySelector('#submitReportBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Odosielam...';

    const nick = getNick() || 'Anonymous';
    const db = getDb();

    try {
      if (db) {
        const reportRef = await push(ref(db, 'reports'), {
          nick,
          area,
          questionId,
          questionText,
          type: selectedType,
          argument,
          source,
          status: 'in_court',
          createdAt: Date.now(),
          votes: { for: 0, against: 0 }
        });

        // Inicializuj courtroom pre toto nahlásenie
        await update(ref(db, `courtroom/${reportRef.key}`), {
          reportId: reportRef.key,
          createdAt: Date.now()
        });
      }

      modal.querySelector('.report-form').style.display = 'none';
      modal.querySelector('#reportSuccess').style.display = 'block';

    } catch(e) {
      showError(errorEl, 'Chyba pri odoslaní. Skús znova.');
      console.error(e);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '⚖️ Odoslať do Poroty';
    }
  };
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

/* ============================================================
   SÚDNA SIEŇ – zobrazenie nahlásení s diskusiou
============================================================ */
export function openCourtroomModal() {
  const existing = document.getElementById('courtroomModal');
  if (existing) {
    existing.style.display = 'flex';
    loadCourtroom();
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'courtroomModal';
  modal.className = 'avatar-modal';
  modal.style.display = 'flex';

  modal.innerHTML = `
    <div class="avatar-panel courtroom-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h3 style="margin:0">🏛️ Porota</h3>
          <div class="small muted">Nahlásené otázky čakajúce na posúdenie</div>
        </div>
        <button class="btn" id="closeCourtroomModal">✕</button>
      </div>

      <div id="courtroomFilter" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="chip courtroom-filter active" data-status="in_court">⏳ Čakajúce</button>
        <button class="chip courtroom-filter" data-status="approved">✅ Schválené</button>
        <button class="chip courtroom-filter" data-status="rejected">❌ Zamietnuté</button>
      </div>

      <div id="courtroomList" style="max-height:65vh;overflow-y:auto">
        <div class="small muted" style="text-align:center;padding:20px">Načítavam...</div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#closeCourtroomModal').onclick = () => modal.style.display = 'none';
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  let currentFilter = 'in_court';
  modal.querySelectorAll('.courtroom-filter').forEach(btn => {
    btn.onclick = () => {
      modal.querySelectorAll('.courtroom-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.status;
      loadCourtroom(currentFilter);
    };
  });

  loadCourtroom('in_court');
}

async function loadCourtroom(status = 'in_court') {
  const list = document.getElementById('courtroomList');
  if (!list) return;

  list.innerHTML = '<div class="small muted" style="text-align:center;padding:20px">Načítavam...</div>';

  const db = getDb();
  if (!db) return;

  const snap = await get(ref(db, 'reports'));
  const data = snap.val() || {};
  const nick = getNick();
  const role = localStorage.getItem('playerRole') || 'student';

  const filtered = Object.entries(data)
    .filter(([, r]) => r.status === status)
    .sort(([, a], [, b]) => b.createdAt - a.createdAt);

  if (!filtered.length) {
    list.innerHTML = '<div class="small muted" style="text-align:center;padding:20px">Žiadne nahlásenia v tejto kategórii.</div>';
    return;
  }

  list.innerHTML = filtered.map(([id, r]) => `
    <div class="courtroom-item" data-id="${id}">
      <div class="courtroom-item-header">
        <div>
          <span class="report-type-badge type-${r.type}">${getTypeLabel(r.type)}</span>
          <strong>${r.area}</strong> · otázka <code>${r.questionId}</code>
        </div>
        <div class="small muted">${formatDate(r.createdAt)} · ${r.nick}</div>
      </div>

      ${r.questionText ? `<div class="courtroom-question-text small">"${r.questionText}"</div>` : ''}

      <div class="courtroom-argument">${r.argument}</div>

      ${r.source ? `<div class="small muted" style="margin-top:4px">📚 ${r.source}</div>` : ''}

      <div class="courtroom-actions">
        <div style="display:flex;gap:6px">
          <button class="btn courtroom-vote-btn vote-for" data-id="${id}" data-vote="for">
            👍 Za (${r.votes?.for || 0})
          </button>
          <button class="btn courtroom-vote-btn vote-against" data-id="${id}" data-vote="against">
            👎 Proti (${r.votes?.against || 0})
          </button>
          <button class="btn courtroom-comment-btn" data-id="${id}">
            💬 Komentár
          </button>
        </div>
        ${role === 'admin' || role === 'garant' ? `
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary admin-approve" data-id="${id}" data-nick="${r.nick}">✅ Schváliť</button>
            <button class="btn admin-reject" data-id="${id}">❌ Zamietnuť</button>
          </div>
        ` : ''}
      </div>

      <div id="comments-${id}" class="courtroom-comments" style="display:none"></div>
    </div>
  `).join('');

  // Event listeners
  list.querySelectorAll('.courtroom-vote-btn').forEach(btn => {
    btn.onclick = () => castVote(btn.dataset.id, btn.dataset.vote);
  });

  list.querySelectorAll('.courtroom-comment-btn').forEach(btn => {
    btn.onclick = () => toggleComments(btn.dataset.id);
  });

  list.querySelectorAll('.admin-approve').forEach(btn => {
    btn.onclick = () => adminDecide(btn.dataset.id, 'approved', btn.dataset.nick);
  });

  list.querySelectorAll('.admin-reject').forEach(btn => {
    btn.onclick = () => adminDecide(btn.dataset.id, 'rejected', null);
  });
}

/* ============================================================
   HLASOVANIE
============================================================ */
async function castVote(reportId, voteType) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return;

  const voteKey = `courtroom_voted_${reportId}`;
  if (localStorage.getItem(voteKey)) {
    alert('Už si hlasoval/a k tejto otázke.');
    return;
  }

  const snap = await get(ref(db, `reports/${reportId}/votes`));
  const votes = snap.val() || { for: 0, against: 0 };
  votes[voteType] = (votes[voteType] || 0) + 1;

  await update(ref(db, `reports/${reportId}/votes`), votes);
  localStorage.setItem(voteKey, voteType);

  // Refresh
  const currentFilter = document.querySelector('.courtroom-filter.active')?.dataset.status || 'in_court';
  loadCourtroom(currentFilter);
}

/* ============================================================
   KOMENTÁRE
============================================================ */
async function toggleComments(reportId) {
  const el = document.getElementById(`comments-${reportId}`);
  if (!el) return;

  if (el.style.display === 'block') {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';
  el.innerHTML = '<div class="small muted">Načítavam komentáre...</div>';

  const db = getDb();
  const snap = await get(ref(db, `courtroom/${reportId}/comments`));
  const comments = snap.val() ? Object.values(snap.val()) : [];

  const nick = getNick();
  el.innerHTML = `
    ${comments.length ? comments.sort((a,b) => a.createdAt - b.createdAt).map(c => `
      <div class="courtroom-comment">
        <div class="comment-header">
          <strong>${c.nick}</strong>
          <span class="comment-stance stance-${c.stance}">${c.stance === 'for' ? '👍 Súhlasím' : '👎 Nesúhlasím'}</span>
          <span class="small muted">${formatDate(c.createdAt)}</span>
        </div>
        <div class="small">${c.text}</div>
      </div>
    `).join('') : '<div class="small muted">Zatiaľ žiadne komentáre.</div>'}

    <div class="comment-form">
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn comment-stance-btn active" data-stance="for">👍 Súhlasím</button>
        <button class="btn comment-stance-btn" data-stance="against">👎 Nesúhlasím</button>
      </div>
      <textarea class="feedback-textarea comment-textarea" rows="2"
        placeholder="Pridaj argument..." maxlength="500"></textarea>
      <button class="btn btn-primary send-comment-btn" data-id="${reportId}"
        style="margin-top:6px;width:100%">Odoslať komentár</button>
    </div>
  `;

  let stance = 'for';
  el.querySelectorAll('.comment-stance-btn').forEach(btn => {
    btn.onclick = () => {
      el.querySelectorAll('.comment-stance-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      stance = btn.dataset.stance;
    };
  });

  el.querySelector('.send-comment-btn').onclick = async () => {
    const text = el.querySelector('.comment-textarea').value.trim();
    if (!text || text.length < 10) return;

    await push(ref(db, `courtroom/${reportId}/comments`), {
      nick: nick || 'Anonymous',
      text,
      stance,
      createdAt: Date.now()
    });

    toggleComments(reportId);
    setTimeout(() => toggleComments(reportId), 100);
  };
}

/* ============================================================
   ADMIN – SCHVÁLENIE / ZAMIETNUTIE
============================================================ */
async function adminDecide(reportId, decision, reporterNick) {
  const db = getDb();
  if (!db) return;

  await update(ref(db, `reports/${reportId}`), {
    status: decision,
    decidedAt: Date.now(),
    decidedBy: getNick()
  });

  if (decision === 'approved' && reporterNick) {
    await awardSeal(reporterNick, reportId);
  }

  const currentFilter = document.querySelector('.courtroom-filter.active')?.dataset.status || 'in_court';
  loadCourtroom(currentFilter);
}

/* ============================================================
   PEČATE
============================================================ */
async function awardSeal(nick, reportId) {
  const db = getDb();
  if (!db) return;

  const userRef = ref(db, `users/${nick}`);
  const snap = await get(userRef);
  const data = snap.val() || {};

  const newCount = (data.approvedReports || 0) + 1;
  const sealType = getSealType(newCount);

  await update(userRef, {
    approvedReports: newCount
  });

  // Ulož pečať na otázku (v reporte)
  if (sealType) {
    await update(ref(db, `reports/${reportId}`), {
      seal: { nick, type: sealType, emoji: getSealEmoji(sealType) }
    });
    await update(ref(db, `users/${nick}/seals`), {
      [sealType]: (data.seals?.[sealType] || 0) + 1
    });
  }
}

export async function getQuestionSeal(area, questionId) {
  const db = getDb();
  if (!db) return null;

  const snap = await get(ref(db, 'reports'));
  const data = snap.val() || {};

  const match = Object.values(data).find(r =>
    r.status === 'approved' &&
    r.area === area &&
    r.questionId === questionId &&
    r.seal
  );

  return match?.seal || null;
}

/* ============================================================
   HELPER FUNKCIE
============================================================ */
function getTypeLabel(type) {
  return {
    wrong_answer: '❌ Nesprávna odpoveď',
    outdated: '📅 Zastaraná info',
    unclear: '❓ Nejasné znenie',
    other: '📝 Iné'
  }[type] || type;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`;
}

/* ============================================================
   GLOBÁLNE EXPORTY
============================================================ */
window.openReportModal = openReportModal;
window.openCourtroomModal = openCourtroomModal;
window.getQuestionSeal = getQuestionSeal;
