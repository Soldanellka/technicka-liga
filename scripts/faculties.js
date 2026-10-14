'use strict';

/* ============================================================
   scripts/faculties.js
   Fakulty – tretia úroveň súťaže (jednotlivec → senát → fakulta).
   Fakulta je automatická príslušnosť (škola hráča), nie zakladaná
   skupina. Hráč si ju zvolí raz, zmena max 1× za 30 dní.

   Firebase model:
   faculties/{facultyId}: { name, points, activePlayers, players:{nick:true} }
     – BEŽIACE obdobie (od poslednej mesačnej vyhodnotenia).
   facultyStats/{periodKey}/{facultyId}: archív stavu fakúlt pri
     uzavretí obdobia (snapshot pred resetom).
   facultyRewards/{periodKey}: { evaluated, winner:{id,name,players}, seen:{nick:true} }
   users/{nick}: faculty, facultyChangedAt
============================================================ */

import { ref, get, set, update, runTransaction }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { econAward } from './economy.js';
import { ECONOMY_CONFIG } from './economyConfig.js';
import { showRewardToast } from '../ui.js';

function getDb() { return window.db || null; }
function getNick() { return localStorage.getItem('playerNick') || null; }

const FACULTY_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export const FACULTY_LIST = [
  { id: 'gym-ruzinov', name: '3.B Gymnázium Ružinov', abbrev: '3.B' },
  { id: 'oa-nitra', name: '2.A OA Nitra', abbrev: '2.A' },
  { id: 'sps-kosice', name: '4.C SPŠ Košice', abbrev: '4.C' },
  { id: 'gym-zilina', name: '1.A Gymnázium Žilina', abbrev: '1.A' },
  { id: 'ina', name: 'Iná škola', abbrev: 'iná' },
  { id: 'nezaradeny', name: 'Nezaradený', abbrev: '' }
];

function getFacultyName(facultyId) {
  const f = FACULTY_LIST.find(x => x.id === facultyId);
  return f ? f.name : facultyId;
}

export function getFacultyList() {
  return FACULTY_LIST;
}

export async function getPlayerFaculty(nick) {
  const db = getDb();
  if (!db || !nick) return null;
  const snap = await get(ref(db, `users/${nick}/faculty`));
  return snap.exists() ? snap.val() : null;
}

/* Krátky odznak fakulty pri nicku (namiesto celého názvu v hlavičke).
   Vráti null pre nezaradeného/bez fakulty – vtedy sa odznak nezobrazuje. */
export async function getFacultyBadge(nick) {
  const facultyId = await getPlayerFaculty(nick);
  if (!facultyId || facultyId === 'nezaradeny') return null;
  const f = FACULTY_LIST.find(x => x.id === facultyId);
  if (!f || !f.abbrev) return null;
  return { abbrev: f.abbrev, name: f.name };
}

/* Zmena fakulty max 1× za 30 dní. Prvá voľba (bez predchádzajúcej
   fakulty) nie je obmedzená. */
export async function setPlayerFaculty(nick, facultyId) {
  const db = getDb();
  if (!db || !nick) return { ok: false, message: 'Chýba prihlásenie.' };
  if (!FACULTY_LIST.some(f => f.id === facultyId)) {
    return { ok: false, message: 'Neplatná škola.' };
  }

  const userRef = ref(db, `users/${nick}`);
  const snap = await get(userRef);
  const user = snap.exists() ? snap.val() : {};

  if (user.faculty) {
    const elapsed = Date.now() - (user.facultyChangedAt || 0);
    if (elapsed < FACULTY_CHANGE_COOLDOWN_MS) {
      const daysLeft = Math.ceil((FACULTY_CHANGE_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
      return { ok: false, message: `Školu môžeš zmeniť znova o ${daysLeft} dní.` };
    }
  }

  await update(userRef, { faculty: facultyId, facultyChangedAt: Date.now() });
  return { ok: true };
}

/* Volané po odohranom pojednávaní (duels.js finalizeDuel) a po
   vyhodnotenom senátnom spore (senaty.js applySporResult) – pripíše
   body fakulte hráča. "Nezaradený" a neplatná/chýbajúca fakulta sa
   preskočí (žiadne súťaženie bez zvolenej fakulty). */
export async function awardFacultyPoints(nick, points) {
  const db = getDb();
  if (!db || !nick || !points) return;

  const facultyId = await getPlayerFaculty(nick);
  if (!facultyId || facultyId === 'nezaradeny') return;

  const playerRef = ref(db, `faculties/${facultyId}/players/${nick}`);
  const existed = (await get(playerRef)).exists();
  if (!existed) {
    await set(playerRef, true);
    await runTransaction(ref(db, `faculties/${facultyId}/activePlayers`), (cur) => (cur || 0) + 1);
  }
  await runTransaction(ref(db, `faculties/${facultyId}/points`), (cur) => (cur || 0) + points);
  await update(ref(db, `faculties/${facultyId}`), { name: getFacultyName(facultyId) });
}

/* Živý rebríček bežiaceho obdobia, radený podľa priemeru bodov na
   aktívneho hráča (nie hrubého súčtu) – väčšia fakulta tak nemá
   automatickú výhodu. "Iná fakulta" sa počíta, "Nezaradený" nie. */
export async function getFacultyLeaderboard() {
  const db = getDb();
  if (!db) return [];
  const snap = await get(ref(db, 'faculties'));
  const val = snap.exists() ? snap.val() : {};

  return FACULTY_LIST
    .filter(f => f.id !== 'nezaradeny')
    .map(f => {
      const s = val[f.id] || {};
      const activePlayers = s.activePlayers || 0;
      const points = s.points || 0;
      return {
        id: f.id,
        name: f.name,
        points,
        activePlayers,
        average: activePlayers ? points / activePlayers : 0
      };
    })
    .filter(f => f.activePlayers > 0)
    .sort((a, b) => b.average - a.average);
}

function getPreviousMonthKey(now = new Date()) {
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  return { key: `M-${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, '0')}` };
}

/* Mesačné vyhodnotenie (lazy, transaction-locked ako ostatné
   rebríčky): archivuje bežiaci stav do facultyStats/{periodKey},
   vyplatí TOP fakulte (podľa priemeru) pečať + bonus všetkým jej
   aktívnym hráčom tohto obdobia, potom vynuluje bežiace počítadlá
   pre nové obdobie. */
async function settleFacultyMonth() {
  const db = getDb();
  if (!db) return;

  const { key: monthKey } = getPreviousMonthKey();
  const evaluatedRef = ref(db, `facultyRewards/${monthKey}/evaluated`);
  const result = await runTransaction(evaluatedRef, (current) => {
    if (current === true) return;
    return true;
  });
  if (!result || !result.committed) return;

  const leaderboard = await getFacultyLeaderboard();

  const snap = await get(ref(db, 'faculties'));
  await set(ref(db, `facultyStats/${monthKey}`), snap.exists() ? snap.val() : {});

  if (leaderboard.length) {
    const winner = leaderboard[0];
    const playersSnap = await get(ref(db, `faculties/${winner.id}/players`));
    const players = playersSnap.exists() ? Object.keys(playersSnap.val()) : [];
    await Promise.all(players.map(nick =>
      econAward(nick, ECONOMY_CONFIG.FACULTIES.MONTHLY_BONUS, `škola ${winner.name} vyhrala mesiac`, { skipCap: true })
    ));
    await set(ref(db, `facultyRewards/${monthKey}/winner`), { id: winner.id, name: winner.name, players });
  }

  const resets = {};
  FACULTY_LIST.forEach(f => {
    if (f.id === 'nezaradeny') return;
    resets[`faculties/${f.id}/points`] = 0;
    resets[`faculties/${f.id}/activePlayers`] = 0;
    resets[`faculties/${f.id}/players`] = null;
    resets[`faculties/${f.id}/name`] = f.name;
  });
  await update(ref(db), resets);
}

/* Putovná pečať – zobrazí sa hráčom víťaznej fakulty z posledného
   uzavretého mesiaca (t.j. celý nasledujúci kalendárny mesiac). */
export async function getFacultyBadgeInfo(nick) {
  const db = getDb();
  if (!db || !nick) return null;
  const { key: monthKey } = getPreviousMonthKey();
  const snap = await get(ref(db, `facultyRewards/${monthKey}/winner`));
  if (!snap.exists()) return null;
  const winner = snap.val();
  if (!winner.players || !winner.players.includes(nick)) return null;
  return { name: winner.name };
}

async function announceFacultyWinIfAny(nick) {
  const db = getDb();
  if (!db || !nick) return;

  const { key: monthKey } = getPreviousMonthKey();
  const snap = await get(ref(db, `facultyRewards/${monthKey}/winner`));
  if (!snap.exists()) return;

  const winner = snap.val();
  if (!winner.players || !winner.players.includes(nick)) return;

  const seenRef = ref(db, `facultyRewards/${monthKey}/seen/${nick}`);
  if ((await get(seenRef)).exists()) return;

  await set(seenRef, true);
  showRewardToast(`🏛️ Tvoja škola ${winner.name} vyhrala mesiac! +${ECONOMY_CONFIG.FACULTIES.MONTHLY_BONUS}🪙`);
}

export async function settleFacultyLeaderboard() {
  const db = getDb();
  if (!db) return;
  const nick = getNick();
  await settleFacultyMonth();
  await announceFacultyWinIfAny(nick);
}
