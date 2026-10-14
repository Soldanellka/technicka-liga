'use strict';

/* ============================================================
   reports.js – MOST MEDZI MODULMI A REPORTS/COURTROOM SYSTÉMOM

   Tento súbor zachováva pôvodné exporty (loadReports,
   openReportModal) ktoré používajú init.js a ostatné moduly,
   ale samotné modály (nahlásenie, súdna sieň) žijú inline
   v index.html (window.openReportModal / window.openCourtroomModal)
   – nie v scripts/reports-system.js, ktorý sa nikde nenačítava.

   makeQuestionKey / initSealCache / getQuestionSeal sú tu ako
   jediný zdroj identity otázky a pečatí, importovateľný zo
   všetkých modulov (quiz.js, scripts/duels.js, memoryTrainer.js).
============================================================ */

import { showRewardToast } from './ui.js';

/* loadReports – init.js ho importuje, Firebase verzia
   nepotrebuje lokálnu inicializáciu, ale funkcia musí existovať */
export function loadReports() {
  // Nový systém načítava reporty priamo z Firebase pri otvorení
  // Súdnej siene – tu len ticho uspejeme
  console.log('📋 Reports systém pripravený (Firebase)');
}

/* openReportModal – deleguje na inline modál v index.html */
export function openReportModal(prefill = {}) {
  if (typeof window.openReportModal === 'function') {
    window.openReportModal(prefill);
  } else {
    // Fallback ak sa inline modál ešte nenačítal
    setTimeout(() => {
      if (typeof window.openReportModal === 'function') {
        window.openReportModal(prefill);
      } else {
        showRewardToast('Formulár sa načítava, skús znova.');
      }
    }, 500);
  }
}

/* ============================================================
   IDENTITA OTÁZKY – stabilná naprieč kvízom, duelmi, bifľovačkou
   aj ob-pravo-app, lebo všetky čerpajú z tých istých JSON-ov.
============================================================ */
export function makeQuestionKey(source, questionText) {
  return `${source || 'X'}|${(questionText || '').trim().slice(0, 80)}`;
}

/* ============================================================
   PEČATE – jedno načítanie reports/ pri štarte (žiadne N čítaní
   Firebase per otázka). Kľúč cache: 'area|questionKey'.
============================================================ */
export async function initSealCache() {
  const db = window.db;
  if (!db) { window.__sealCache = window.__sealCache || {}; return; }

  try {
    const { ref, get } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
    );
    const snap = await get(ref(db, 'reports'));
    const data = snap.val() || {};
    const cache = {};

    Object.values(data).forEach(r => {
      if (r.status !== 'approved' || !r.seal || !r.area || !r.questionId) return;
      cache[`${r.area}|${r.questionId}`] = {
        nick: r.seal.nick,
        seal: r.seal.type,
        byGarant: !!(r.verdict && r.verdict.role === 'garant')
      };
    });

    window.__sealCache = cache;
  } catch (e) {
    console.warn('reports.js: seal cache sa nepodarilo načítať', e);
    window.__sealCache = window.__sealCache || {};
  }
}

/* Číta výlučne z cache naplnenej cez initSealCache() – bez Firebase čítania. */
export function getQuestionSeal(area, questionId) {
  const cache = window.__sealCache || {};
  return cache[`${area}|${questionId}`] || null;
}

/* Zachovaj staré exporty pre prípad že ich niečo iné volá */
export function persistReports() {}
export function saveReports() {}
export { openReportModal as createReportModal };

window.makeQuestionKey = makeQuestionKey;
window.getQuestionSeal = getQuestionSeal;
