'use strict';

/* ============================================================
   SENÁTY – skupinová súťaž (skupina = Senát, zakladateľ = Predseda).
   Veľkosť 3–5 členov, súťažný (môže viesť senátne spory) od 3.
   Hráč môže byť členom max 2 senátov.

   Firebase model:
   senaty/{senatId}: { name, founder, members: {nick:{joinedAt,role}},
     status:'forming'|'active', createdAt, wins, draws, losses, points }
   users/{nick}/senaty: { senatId: true }
   senatInvites/{senatId}: { code }
============================================================ */

import { ref, get, set, update, push, runTransaction }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { econAward } from './economy.js';
import { ECONOMY_CONFIG } from './economyConfig.js';
import { showRewardToast } from '../ui.js';
import { pickQuestions, waitForQuestions, DUEL_QUESTION_COUNT } from './duels.js';
import { awardFacultyPoints } from './faculties.js';

function getDb() { return window.db || null; }
function getNick() { return localStorage.getItem('playerNick') || null; }

const MAX_MEMBERS = 5;
const MIN_ACTIVE = 3;
const MAX_SENATY_PER_PLAYER = 2;

/* ============================================================
   Pomocné čítanie
============================================================ */
export async function getSenat(senatId) {
  const db = getDb();
  if (!db || !senatId) return null;
  const snap = await get(ref(db, `senaty/${senatId}`));
  return snap.exists() ? { id: senatId, ...snap.val() } : null;
}

export async function getMojeSenaty(nick) {
  const db = getDb();
  if (!db || !nick) return [];
  const idsSnap = await get(ref(db, `users/${nick}/senaty`));
  if (!idsSnap.exists()) return [];
  const ids = Object.keys(idsSnap.val() || {});
  const senaty = await Promise.all(ids.map(id => getSenat(id)));
  return senaty.filter(Boolean);
}

function memberCount(senat) {
  return senat && senat.members ? Object.keys(senat.members).length : 0;
}

function isPredseda(senat, nick) {
  return !!(senat && senat.members && senat.members[nick] && senat.members[nick].role === 'predseda');
}

/* ============================================================
   ZALOŽENIE SENÁTU
============================================================ */
function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function createSenat(name) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return { ok: false, message: 'Musíš byť prihlásený.' };

  const trimmed = (name || '').trim();
  if (trimmed.length < 3 || trimmed.length > 30) {
    return { ok: false, message: 'Názov triedy musí mať 3–30 znakov.' };
  }

  const mySenaty = await getMojeSenaty(nick);
  if (mySenaty.length >= MAX_SENATY_PER_PLAYER) {
    return { ok: false, message: `Môžeš byť členom max ${MAX_SENATY_PER_PLAYER} tried.` };
  }

  // Kontrola unikátnosti názvu (case-insensitive)
  const allSnap = await get(ref(db, 'senaty'));
  const all = allSnap.exists() ? allSnap.val() : {};
  const nameTaken = Object.values(all).some(s => (s.name || '').toLowerCase() === trimmed.toLowerCase());
  if (nameTaken) {
    return { ok: false, message: 'Trieda s týmto názvom už existuje.' };
  }

  const senatRef = push(ref(db, 'senaty'));
  const senatId = senatRef.key;
  const now = Date.now();

  await set(senatRef, {
    name: trimmed,
    founder: nick,
    members: { [nick]: { joinedAt: now, role: 'predseda' } },
    status: 'forming',
    createdAt: now,
    wins: 0, draws: 0, losses: 0, points: 0
  });

  await set(ref(db, `users/${nick}/senaty/${senatId}`), true);
  await set(ref(db, `senatInvites/${senatId}`), { code: generateInviteCode(), createdAt: now });

  return { ok: true, senatId, name: trimmed };
}

/* ============================================================
   POZVÁNKY
============================================================ */
export function getInviteLink(senatId) {
  return `${location.origin}/?senat=${senatId}`;
}

export function buildInviteMessage(predsedaNick, senatName, senatId) {
  const link = getInviteLink(senatId);
  return `⚖️ ${predsedaNick} ťa pozýva do triedy ${senatName} vo Finančnej lige! Pridaj sa: ${link}`;
}

/* ============================================================
   PRIPOJENIE K SENÁTU
   Členstvo sa zapisuje transakčne (result.committed rozhoduje, nie
   vlajka nastavená vnútri callbacku – vzor ako economy.js settlePeriod),
   aby dvaja hráči nemohli súčasne obsadiť posledné voľné miesto.
============================================================ */
export async function joinSenat(senatId, nick) {
  const db = getDb();
  if (!db || !senatId || !nick) return { ok: false, message: 'Chýba trieda alebo nick.' };

  const senat = await getSenat(senatId);
  if (!senat) return { ok: false, message: 'Trieda neexistuje.' };
  if (senat.members && senat.members[nick]) return { ok: false, message: 'V tomto triede už si.' };
  if (memberCount(senat) >= MAX_MEMBERS) return { ok: false, message: 'Trieda je už plná (5/5).' };

  const mySenaty = await getMojeSenaty(nick);
  if (mySenaty.length >= MAX_SENATY_PER_PLAYER) {
    return { ok: false, message: `Môžeš byť členom max ${MAX_SENATY_PER_PLAYER} tried.` };
  }

  // Nový hráč? (skontroluj PRED akýmkoľvek zápisom)
  const userSnap = await get(ref(db, `users/${nick}`));
  const isNewPlayer = !userSnap.exists();

  const membersRef = ref(db, `senaty/${senatId}/members`);
  const now = Date.now();
  const result = await runTransaction(membersRef, (current) => {
    const members = current || {};
    if (members[nick]) return; // abort – už je členom (konkurenčný beh)
    if (Object.keys(members).length >= MAX_MEMBERS) return; // abort – plný
    return { ...members, [nick]: { joinedAt: now, role: 'clen' } };
  });

  if (!result || !result.committed) {
    return { ok: false, message: 'Nepodarilo sa pridať do triedy (plný alebo už si členom).' };
  }

  await set(ref(db, `users/${nick}/senaty/${senatId}`), true);

  /* Odmena novému hráčovi (jednorazovo). Ekonomika v1: V DENNOM STROPE
     (skipCap odstránený) – obchádzať ho smú už len rebríčky a štátnica.
     Nový nick má strop z definície prázdny, takže sa odmena vždy zmestí. */
  if (isNewPlayer) {
    await econAward(nick, ECONOMY_CONFIG.SENATY.JOIN_NEW_PLAYER, `nový hráč cez triedny link ${senatId}`, { allOrNothing: true });
  }

  // Odmena predsedovi za nábor tohto člena (raz na člena, ochrana cez recruitClaimed)
  const founder = senat.founder;
  if (founder && founder !== nick) {
    const claimedRef = ref(db, `senaty/${senatId}/recruitClaimed/${nick}`);
    const claimResult = await runTransaction(claimedRef, (current) => {
      if (current === true) return; // abort – už vyplatené
      return true;
    });
    /* V1: v dennom strope. Nárok je už v tomto bode transakčne zabraný, takže
       keď strop odmenu nepustí, príznak VRACIAME – inak by predseda o § prišiel
       navždy. Dvojitú výplatu to neotvára: bez ďalšieho pripojenia toho istého
       člena sa sem kód znova nedostane. */
    if (claimResult && claimResult.committed) {
      const paid = await econAward(founder, ECONOMY_CONFIG.SENATY.RECRUIT, `nábor člena ${nick} do triedy`, { allOrNothing: true });
      if (paid === null) await set(claimedRef, null);
    }
  }

  // Aktivácia senátu pri dosiahnutí 3 členov (transakčne raz)
  const newCount = memberCount({ members: (await get(membersRef)).val() });
  if (newCount >= MIN_ACTIVE) {
    const statusRef = ref(db, `senaty/${senatId}/status`);
    const statusResult = await runTransaction(statusRef, (current) => {
      if (current === 'active') return; // abort – už aktivovaný
      return 'active';
    });
    if (statusResult && statusResult.committed) {
      /* V1: v dennom strope. Tu sa príznak vrátiť NEDÁ – je ním samotný
         prechod senátu do stavu 'active', čo je skutočná zmena stavu, nie
         účtovný nárok. Zostatkové riziko: predseda, ktorý má v ten deň strop
         už vyčerpaný, o týchto 10§ príde. Vedomé – prípad je jednorazový a
         úzky (senát sa dokončí práve raz), a rušiť kvôli nemu aktiváciu
         senátu by bolo horšie. */
      if (founder) {
        await econAward(founder, ECONOMY_CONFIG.SENATY.FOUND_COMPLETE, `trieda ${senat.name} dokončená (3 členovia)`, { allOrNothing: true });
      }
      if (nick === getNick()) {
        showRewardToast(`⚖️ Trieda ${senat.name} je kompletná!`);
      }
    }
  }

  return { ok: true, senatName: senat.name, isNewPlayer };
}

/* ============================================================
   SPRÁVA SENÁTU (predseda)
============================================================ */
export async function renameSenat(senatId, newName, nick) {
  const db = getDb();
  const senat = await getSenat(senatId);
  if (!senat) return { ok: false, message: 'Trieda neexistuje.' };
  if (!isPredseda(senat, nick)) return { ok: false, message: 'Len kapitán môže premenovať triedu.' };

  const trimmed = (newName || '').trim();
  if (trimmed.length < 3 || trimmed.length > 30) {
    return { ok: false, message: 'Názov triedy musí mať 3–30 znakov.' };
  }

  await update(ref(db, `senaty/${senatId}`), { name: trimmed });
  return { ok: true };
}

export async function kickMember(senatId, targetNick, byNick) {
  const db = getDb();
  const senat = await getSenat(senatId);
  if (!senat) return { ok: false, message: 'Trieda neexistuje.' };
  if (!isPredseda(senat, byNick)) return { ok: false, message: 'Len kapitán môže vyhodiť člena.' };
  if (targetNick === byNick) return { ok: false, message: 'Nemôžeš vyhodiť sám seba – zruš triedu alebo ju premenuj na iného kapitána.' };
  if (!senat.members || !senat.members[targetNick]) return { ok: false, message: 'Hráč nie je členom tohto triedy.' };

  await update(ref(db, `senaty/${senatId}/members`), { [targetNick]: null });
  await update(ref(db, `users/${targetNick}/senaty`), { [senatId]: null });

  const remaining = memberCount(senat) - 1;
  if (remaining < MIN_ACTIVE) {
    await update(ref(db, `senaty/${senatId}`), { status: 'forming' });
  }

  return { ok: true };
}

export async function leaveSenat(senatId, nick) {
  const db = getDb();
  const senat = await getSenat(senatId);
  if (!senat) return { ok: false, message: 'Trieda neexistuje.' };
  if (isPredseda(senat, nick)) {
    return { ok: false, message: 'Kapitán nemôže odísť – zruš triedu alebo najprv premenuj iného člena na kapitána.' };
  }

  await update(ref(db, `senaty/${senatId}/members`), { [nick]: null });
  await update(ref(db, `users/${nick}/senaty`), { [senatId]: null });

  const remaining = memberCount(senat) - 1;
  if (remaining < MIN_ACTIVE) {
    await update(ref(db, `senaty/${senatId}`), { status: 'forming' });
  }

  return { ok: true };
}

export async function disbandSenat(senatId, nick) {
  const db = getDb();
  const senat = await getSenat(senatId);
  if (!senat) return { ok: false, message: 'Trieda neexistuje.' };
  if (!isPredseda(senat, nick)) return { ok: false, message: 'Len kapitán môže zrušiť triedu.' };

  const members = Object.keys(senat.members || {});
  await Promise.all(members.map(m => update(ref(db, `users/${m}/senaty`), { [senatId]: null })));
  await set(ref(db, `senaty/${senatId}`), null);
  await set(ref(db, `senatInvites/${senatId}`), null);

  return { ok: true };
}

/* ============================================================
   SENÁTNE SPORY – agregát individuálnych pojednávaní medzi senátmi.

   senatSpory/{sporId}: { areaTitle, questions, challenger, opponent,
     deadline, scores:{senatId:{nick:body|null}}, status, winner }

   Skóre senátu = PRIEMER bodov členov (nie súčet), aby 3-členný senát
   nebol znevýhodnený voči 5-člennému. Vyhodnotenie je lazy (pri
   načítaní po deadline), transakčne uzamknuté rovnako ako
   settlePeriod v economy.js – result.committed, nie vlajka v
   callbacku (tá sa pri kontencii môže spustiť viackrát).
============================================================ */
const SPOR_DURATION_MS = 48 * 60 * 60 * 1000;

function sharedMember(senatA, senatB) {
  const membersA = Object.keys(senatA.members || {});
  const membersB = new Set(Object.keys(senatB.members || {}));
  return membersA.some(m => membersB.has(m));
}

export async function getSenatSpor(sporId) {
  const db = getDb();
  if (!db || !sporId) return null;
  const snap = await get(ref(db, `senatSpory/${sporId}`));
  return snap.exists() ? { id: sporId, ...snap.val() } : null;
}

export async function getSporyForSenat(senatId) {
  const db = getDb();
  if (!db || !senatId) return [];
  const snap = await get(ref(db, 'senatSpory'));
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .map(([id, s]) => ({ id, ...s }))
    .filter(s => s.challenger === senatId || s.opponent === senatId);
}

/* Predseda aktívneho senátu vyzve iný aktívny senát bez spoločného člena. */
export async function challengeSenat(challengerSenatId, opponentSenatId, areaName, nick) {
  const db = getDb();
  if (!db || !nick) return { ok: false, message: 'Musíš byť prihlásený.' };
  if (challengerSenatId === opponentSenatId) return { ok: false, message: 'Nemôžeš vyzvať vlastnú triedu.' };

  const challenger = await getSenat(challengerSenatId);
  const opponent = await getSenat(opponentSenatId);
  if (!challenger || !opponent) return { ok: false, message: 'Trieda neexistuje.' };
  if (!isPredseda(challenger, nick)) return { ok: false, message: 'Len kapitán môže vyzvať inú triedu.' };
  if (challenger.status !== 'active' || opponent.status !== 'active') {
    return { ok: false, message: 'Oba triedy musia byť súťažné (aspoň 3 členovia).' };
  }
  if (sharedMember(challenger, opponent)) {
    return { ok: false, message: 'Triedy majú spoločného člena – zápas medzi nimi nie je povolený.' };
  }

  await waitForQuestions(areaName);
  const questions = pickQuestions(areaName);
  if (!questions || !questions.length) {
    return { ok: false, message: 'Nepodarilo sa načítať otázky pre túto oblasť.' };
  }

  const sporRef = push(ref(db, 'senatSpory'));
  const sporId = sporRef.key;
  const now = Date.now();

  await set(sporRef, {
    areaTitle: areaName,
    questions,
    challenger: challengerSenatId,
    opponent: opponentSenatId,
    deadline: now + SPOR_DURATION_MS,
    scores: { [challengerSenatId]: {}, [opponentSenatId]: {} },
    status: 'running',
    winner: null,
    createdAt: now
  });

  return { ok: true, sporId };
}

/* Spustí bežný kvíz engine (window.startDuelQuiz) so spoločnou bankou
   otázok sporu; quiz.js po dohraní zavolá recordSenatSporScore. */
export async function startSenatSporPlay(sporId, senatId) {
  const spor = await getSenatSpor(sporId);
  if (!spor) return { ok: false, message: 'Zápas neexistuje.' };
  if (Date.now() > spor.deadline) return { ok: false, message: 'Termín na odohratie zápasu už vypršal.' };

  window.currentSenatSpor = { sporId, senatId, areaTitle: spor.areaTitle };
  if (typeof window.startDuelQuiz === 'function') {
    window.startDuelQuiz(spor.questions);
  }
  return { ok: true };
}

/* Volané z quiz.js finishQuiz() po dohraní sporových otázok.

   ⚠️ `total` je počet otázok, ktoré hráč naozaj dostal – predtým tu bola
   natvrdo desiatka a po skrátení súboja by hlásila „3/10" pri päťotázkovom
   zápase. Volajúci posiela quiz.questions.length; keby ho niekto vynechal,
   padá sa na DUEL_QUESTION_COUNT, nie na konštantu zapísanú tu. */
export async function recordSenatSporScore(sporId, senatId, nick, score, total) {
  const db = getDb();
  if (!db) return;
  const zo = Number.isFinite(total) && total > 0 ? total : DUEL_QUESTION_COUNT;
  await update(ref(db, `senatSpory/${sporId}/scores/${senatId}`), { [nick]: score });
  showRewardToast(`⚖️ Tvoj výsledok (${score}/${zo}) bol zaznamenaný do zápasu tried.`);
}

async function applySporResult(senat, senatId, outcome, scores) {
  const db = getDb();
  const patch = {};
  if (outcome === 'win') { patch.wins = (senat.wins || 0) + 1; patch.points = (senat.points || 0) + 3; }
  else if (outcome === 'draw') { patch.draws = (senat.draws || 0) + 1; patch.points = (senat.points || 0) + 1; }
  else { patch.losses = (senat.losses || 0) + 1; }
  await update(ref(db, `senaty/${senatId}`), patch);

  const rewardAmount = outcome === 'win' ? ECONOMY_CONFIG.SENATY.SPOR_WIN
    : outcome === 'draw' ? ECONOMY_CONFIG.SENATY.SPOR_DRAW
    : ECONOMY_CONFIG.SENATY.SPOR_LOSS;
  /* V1: senátny spor je V DENNOM STROPE (skipCap odstránený) – mimo stropu
     ostávajú zo senátov už len rebríčkové odmeny (LB_WEEKLY/LB_MONTHLY nižšie).
     allOrNothing: výsledok sporu je udalosť s oznámenou sumou, orezanie na
     zvyšok stropu by bolo mätúce – kto má strop plný, dostane 0 a vie prečo. */
  const members = Object.keys(senat.members || {});
  await Promise.all(members.map(m => econAward(m, rewardAmount, `zápas tried – ${outcome}`, { allOrNothing: true })));

  // 🏛️ Fakulty – individuálny výsledok každého člena, čo odohral, pripíše body jeho fakulte
  await Promise.all(members.map(m => {
    const score = scores && typeof scores[m] === 'number' ? scores[m] : 0;
    return score ? awardFacultyPoints(m, score) : Promise.resolve();
  }));
}

/* Lazy vyhodnotenie jedného sporu po termíne. Uzamknuté transakčne
   (senatSpory/{id}/settling), aby dvaja súbežne otvorení hráči
   nevyhodnotili (a nevyplatili) ten istý spor dvakrát. */
async function settleSenatSpor(sporId) {
  const db = getDb();
  const spor = await getSenatSpor(sporId);
  if (!spor || spor.status !== 'running' || Date.now() < spor.deadline) return null;

  const lockRef = ref(db, `senatSpory/${sporId}/settling`);
  const lockResult = await runTransaction(lockRef, (current) => {
    if (current === true) return; // abort – už sa vyhodnocuje/vyhodnotené
    return true;
  });
  if (!lockResult || !lockResult.committed) return null;

  const challengerSenat = await getSenat(spor.challenger);
  const opponentSenat = await getSenat(spor.opponent);
  if (!challengerSenat || !opponentSenat) return null;

  const challengerMembers = Object.keys(challengerSenat.members || {});
  const opponentMembers = Object.keys(opponentSenat.members || {});
  const challengerScores = (spor.scores && spor.scores[spor.challenger]) || {};
  const opponentScores = (spor.scores && spor.scores[spor.opponent]) || {};

  const challengerPlayed = challengerMembers.filter(m => typeof challengerScores[m] === 'number');
  const opponentPlayed = opponentMembers.filter(m => typeof opponentScores[m] === 'number');
  const halfChallenger = Math.ceil(challengerMembers.length / 2);
  const halfOpponent = Math.ceil(opponentMembers.length / 2);

  if (challengerPlayed.length < halfChallenger || opponentPlayed.length < halfOpponent) {
    await update(ref(db, `senatSpory/${sporId}`), { status: 'done', winner: null, voided: true });
    return { voided: true };
  }

  // Priemer, nie súčet – kto neodohral do deadline počíta 0 bodov.
  const avg = (members, scores) => members.reduce((sum, m) => sum + (scores[m] || 0), 0) / members.length;
  const challengerAvg = avg(challengerMembers, challengerScores);
  const opponentAvg = avg(opponentMembers, opponentScores);

  const winner = Math.abs(challengerAvg - opponentAvg) < 1
    ? 'draw'
    : (challengerAvg > opponentAvg ? spor.challenger : spor.opponent);

  await update(ref(db, `senatSpory/${sporId}`), { status: 'done', winner, challengerAvg, opponentAvg });

  if (winner === 'draw') {
    await applySporResult(challengerSenat, spor.challenger, 'draw', challengerScores);
    await applySporResult(opponentSenat, spor.opponent, 'draw', opponentScores);
  } else if (winner === spor.challenger) {
    await applySporResult(challengerSenat, spor.challenger, 'win', challengerScores);
    await applySporResult(opponentSenat, spor.opponent, 'loss', opponentScores);
  } else {
    await applySporResult(opponentSenat, spor.opponent, 'win', opponentScores);
    await applySporResult(challengerSenat, spor.challenger, 'loss', challengerScores);
  }

  return { winner, challengerAvg, opponentAvg };
}

/* Volané raz pri načítaní stránky – prejde VŠETKY bežiace spory po
   termíne a vyhodnotí ich (lazy, bez servera/cronu). */
export async function settlePendingSenatSpory() {
  const db = getDb();
  if (!db) return;
  try {
    const snap = await get(ref(db, 'senatSpory'));
    if (!snap.exists()) return;
    const now = Date.now();
    const entries = Object.entries(snap.val());
    for (const [id, s] of entries) {
      if (s.status === 'running' && s.deadline < now) {
        await settleSenatSpor(id);
      }
    }
  } catch (e) {
    console.warn('senaty: vyhodnotenie triednych sporov zlyhalo', e);
  }
}

/* ============================================================
   REBRÍČEK SENÁTOV – týždenné/mesačné výplaty (lazy, transakčne
   uzamknuté, rovnaký vzor ako economy.js econSettleLeaderboards).
   Body sa NEresetujú medzi obdobiami (kumulatívne za celý senát) –
   rebríček pri výplate berie aktuálny stav `points` v danom momente.
============================================================ */
/* Rovnaký vzor ako getPreviousWeekPeriod/getPreviousMonthPeriod v
   economy.js – vyhodnocuje sa PREDCHÁDZAJÚCE (už skončené) obdobie,
   nie prebiehajúce, inak by sa výplata spúšťala priebežne počas
   celého týždňa/mesiaca namiesto raz po jeho skončení. */
function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function getWeekStartLocal(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getPreviousWeekKey(now = new Date()) {
  const thisWeekStart = getWeekStartLocal(now);
  const prevWeekStart = new Date(thisWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const { year, week } = isoWeekInfo(prevWeekStart);
  return { key: `W-${year}-${String(week).padStart(2, '0')}`, isPastPeriod: now.getTime() >= thisWeekStart.getTime() };
}

function getPreviousMonthKey(now = new Date()) {
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  return { key: `M-${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, '0')}` };
}

export async function getSenatLeaderboard() {
  const db = getDb();
  if (!db) return [];
  const snap = await get(ref(db, 'senaty'));
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .map(([id, s]) => ({ id, ...s }))
    .filter(s => s.status === 'active')
    .sort((a, b) => (b.points || 0) - (a.points || 0));
}

async function settleSenatLeaderboardPeriod(periodKey, rewardTable) {
  const db = getDb();
  const evaluatedRef = ref(db, `senatRewards/${periodKey}/evaluated`);
  const result = await runTransaction(evaluatedRef, (current) => {
    if (current === true) return;
    return true;
  });
  if (!result || !result.committed) return;

  const top3 = (await getSenatLeaderboard()).slice(0, 3);
  const winners = [];
  for (let i = 0; i < top3.length; i++) {
    const amount = rewardTable[i] || 0;
    if (!amount) continue;
    const members = Object.keys(top3[i].members || {});
    await Promise.all(members.map(m =>
      econAward(m, amount, `${i + 1}. miesto triedy v rebríčku`, { skipCap: true })
    ));
    winners.push({ senatId: top3[i].id, name: top3[i].name, place: i + 1, amount });
  }
  await set(ref(db, `senatRewards/${periodKey}/winners`), winners);
}

/* Ak je hráč členom senátu, ktorý práve vyhral a ešte to nevidel,
   zobraz toast raz (rovnaký vzor ako announceLeaderboardWinIfAny). */
async function announceSenatLeaderboardWinIfAny(nick, periodKeys) {
  const db = getDb();
  if (!db || !nick) return;
  for (const periodKey of periodKeys) {
    const snap = await get(ref(db, `senatRewards/${periodKey}/winners`));
    if (!snap.exists()) continue;
    const winners = snap.val() || [];
    for (const w of winners) {
      const senat = await getSenat(w.senatId);
      if (!senat || !senat.members || !senat.members[nick]) continue;
      const seenRef = ref(db, `senatRewards/${periodKey}/seen/${nick}`);
      const seenSnap = await get(seenRef);
      if (seenSnap.exists()) continue;
      await set(seenRef, true);
      showRewardToast(`⚖️ Vaša trieda ${senat.name} skončil ${w.place}. v rebríčku! +${w.amount}🪙`);
    }
  }
}

export async function settleSenatLeaderboards() {
  const db = getDb();
  if (!db) return;
  const nick = getNick();
  const { key: weekKey } = getPreviousWeekKey();
  const { key: monthKey } = getPreviousMonthKey();
  await settleSenatLeaderboardPeriod(weekKey, ECONOMY_CONFIG.SENATY.LB_WEEKLY);
  await settleSenatLeaderboardPeriod(monthKey, ECONOMY_CONFIG.SENATY.LB_MONTHLY);
  await announceSenatLeaderboardWinIfAny(nick, [weekKey, monthKey]);
}

window.getMojeSenaty = getMojeSenaty;
window.createSenat = createSenat;
window.joinSenat = joinSenat;
