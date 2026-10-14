'use strict';

import { ref, onValue, get }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { $, escapeHtml } from '../core.js';
import { getAvatarBustSrc } from './avatar.js';
import { jePreskocitelnaPrezyvka } from './deletedPlayer.js';

/* ============================================================
   POMOCNÉ FUNKCIE NA KALENDÁRNE OBDOBIA
============================================================ */

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getMonthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0).getTime();
}

function getCutoff(period) {
  if (period === 'week') return getWeekStart();
  if (period === 'month') return getMonthStart();
  return 0;
}

/* ============================================================
   AGREGÁCIA VÝSLEDKOV Z duels/ PODĽA OBDOBIA
============================================================ */
function aggregateStats(duelsData, period) {
  const cutoff = getCutoff(period);
  const stats = {};

  Object.values(duelsData || {}).forEach(duel => {
    if (!duel || duel.status !== 'finished' || !duel.result) return;
    if (!duel.finishedAt || duel.finishedAt < cutoff) return;

    const { firstPlayer, secondPlayer, winner } = duel.result;
    if (!firstPlayer || !secondPlayer) return;

    [firstPlayer, secondPlayer].forEach(p => {
      /* Zmazaný hráč sa do rebríčka nepočíta. Rebríček sa skladá
         zo súbojov, nie z vetvy leaderboard/, takže bez tohto filtra
         by sa po výmaze vrátil späť pod náhradným menom – a Zásady
         pritom sľubujú, že výmaz odstráni zápis v rebríčkoch. */
      if (jePreskocitelnaPrezyvka(p.nick)) return;
      if (!stats[p.nick]) stats[p.nick] = { nick: p.nick, duels: 0, wins: 0, points: 0 };
      stats[p.nick].duels += 1;
      stats[p.nick].points += (typeof p.score === 'number' ? p.score : 0);
      if (winner === p.nick) stats[p.nick].wins += 1;
    });
  });

  return Object.values(stats).sort((a, b) => b.points - a.points);
}

/* ============================================================
   VYKRESLENIE REBRÍČKA – prémiový dizajn
   (HTML štruktúra naviazaná na nové CSS triedy
   .lb-row, .lb-rank, .lb-rank-1/2/3, .lb-name, .lb-stats,
   .lb-bar, .lb-bar-fill – viď styles.css)
============================================================ */
async function renderLeaderboardList(list) {
  const box = $('duelLeaderboard');
  if (!box) return;

  if (!list.length) {
    box.innerHTML = '<div class="small muted">Zatiaľ žiadne odohrané súboja v tomto období.</div>';
    return;
  }

  const maxPoints = list[0].points || 1;

  // Načítaj avatary hráčov z Firebase
  const avatarMap = {};
  try {
    const dbase = window.db;
    if (!dbase) throw new Error('db nedostupná');
    const userSnaps = await Promise.all(
      list.map(p => get(ref(dbase, `users/${p.nick}/avatar`)))
    );
    list.forEach((p, i) => {
      avatarMap[p.nick] = userSnaps[i].exists()
        ? userSnaps[i].val()
        : { type: 'student-f', energy: 100 };
    });
  } catch(e) {
    list.forEach(p => { avatarMap[p.nick] = { type: 'student-f', energy: 100 }; });
  }

  // Avatar data URI mapovanie (rovnaké ako v avatar.js)
  const AVATAR_AWAKE = {
    'student-f': 'assets/avatars/student-f-awake.svg',
    'student-m': 'assets/avatars/student-m-awake.svg',
    'cat':       'assets/avatars/cat-avatar.svg',
    'owl':       'assets/avatars/owl-avatar.svg',
  };

  function getAvatarSrc(type, energy) {
    // Základná sada (18 PNG) – bust (portrét) verzia, rovnaká ako v hlavičke
    const bust = getAvatarBustSrc(type, energy);
    if (bust) return bust;

    // Staré/obchodné avatary bez bust verzie – pôvodná logika bez zmeny
    if (energy <= 0) {
      return type === 'student-f'
        ? 'assets/avatars/student-f-sleep.svg'
        : 'assets/avatars/student-m-sleep.svg';
    }
    return AVATAR_AWAKE[type] || AVATAR_AWAKE['student-f'];
  }

  box.innerHTML = list.map((p, i) => {
    const rankClass = i < 3 ? ` lb-rank-${i + 1}` : '';
    const pct = Math.max(6, Math.round((p.points / maxPoints) * 100));
    const medal = i < 3
      ? `<div class="lb-medal lb-medal-${i + 1}"><span class="lb-medal-ribbon"></span><span class="lb-medal-num">${i + 1}</span></div>`
      : `<span class="lb-rank-num">${i + 1}</span>`;

    const av = avatarMap[p.nick] || { type: 'student-f', energy: 100 };
    const avatarSrc = getAvatarSrc(av.type, av.energy);

    return `
      <div class="lb-row${rankClass}">
        <div class="lb-rank">${medal}</div>
        <img class="lb-avatar" src="${avatarSrc}" alt="avatar" 
          onerror="this.style.display='none'"/>
        <div class="lb-main">
          <div class="lb-top-line">
            <span class="lb-name">${escapeHtml(p.nick)}</span>
            <span class="lb-points">${p.points}<small> b.</small></span>
          </div>
          <div class="lb-bar"><div class="lb-bar-fill" style="width:${pct}%"></div></div>
          <div class="lb-meta">${p.wins}/${p.duels} výhier</div>
        </div>
      </div>
    `;
  }).join('');
}

/* ============================================================
   HLAVNÁ INIT FUNKCIA – NAČÍTANIE + NAPOJENIE FILTROV
============================================================ */
export function initDuelLeaderboard() {
  const box = $('duelLeaderboard');
  if (!box) {
    console.warn('⚠️ #duelLeaderboard sa nenašiel v DOM.');
    return;
  }

  const db = window.db;
  if (!db) {
    console.error('❌ Firebase DB (window.db) nie je inicializovaná – rebríček sa nedá načítať.');
    return;
  }

  let currentPeriod = 'all';
  let latestDuelsData = null;

  function rerender() {
    if (!latestDuelsData) return;
    renderLeaderboardList(aggregateStats(latestDuelsData, currentPeriod));
  }

  const duelsRef = ref(db, 'duels');
  onValue(duelsRef, (snapshot) => {
    latestDuelsData = snapshot.val() || {};
    rerender();
  });

  const filterRow = box.previousElementSibling;
  if (filterRow) {
    const buttons = Array.from(filterRow.querySelectorAll('.chip'));
    const labelToPeriod = {
      'Týždeň': 'week',
      'Mesiac': 'month',
      'Všetko': 'all'
    };

    buttons.forEach(btn => {
      const period = labelToPeriod[btn.textContent.trim()];
      if (!period) return;

      if (period === 'all') btn.classList.add('active');

      btn.addEventListener('click', () => {
        currentPeriod = period;
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rerender();
      });
    });
  } else {
    console.warn('⚠️ Nenašiel sa riadok s filtrami Týždeň/Mesiac/Všetko nad #duelLeaderboard.');
  }
}

/* ============================================================
   ODMENY ZA TÝŽDEŇ / MESIAC – zrušené (Etapa 1, bod 1.2)
   Jediná rebríčková vetva je econSettleLeaderboards v
   scripts/economy.js (tabuľka týždeň 50/30/10, mesiac 200/100/50).
   Tento modul je odteraz čisto read-only zobrazenie rebríčka –
   žiadne zatváranie období, žiadny zápis § do Firebase.
============================================================ */

window.initDuelLeaderboard = initDuelLeaderboard;
