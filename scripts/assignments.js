'use strict';

/* ============================================================
   AKADEMICKÁ VRSTVA – KROK 2: Test pre skupinu + výsledky

   Firebase model – NOVÉ vetvy, users/, leaderboard/, pojednávania a
   contentOverrides sa nikde v tomto súbore nečítajú ani nezapisujú
   (výnimka: § odmena ide VÝHRADNE cez existujúci econAward()):

   assignments/{id}: {
     title, groupId, garantNick, mode: 'okruhy' | 'oblast',
     areaTitle,
     questions: [ { question, options, correct, explanation, zdroj,
       source, quizIndex } ],   // KANONICKÁ snímka v čase zostavenia,
                                 // nezávislá od neskorších úprav dát
     opensAt, closesAt, createdAt
   }
   assignments/{id}/results/{nick}: {
     score, total, answers: { [questionIndex]: zvolený text odpovede },
     wrongIdx: [ ... ], submittedAt, rewarded
   }

   NEMENNÁ ZÁSADA SÚKROMIA: garant vidí meno + skóre + zlé otázky
   VÝHRADNE z konkrétneho assignments/{id}/results – nikde v tomto
   module sa nečíta ani nezapisuje nič o študentovom tréningu (duely,
   kartičky, prípady, bifľovačka, streak, §, rebríčky).

   Zhoda odpovede sa počíta podľa TEXTU zvolenej možnosti (nie indexu),
   rovnako ako shuffleOptions() v core.js určuje správnosť – vďaka tomu
   test zobrazuje zamiešané poradie, ale vyhodnotenie je vždy voči
   pôvodnému (kanonickému) poradiu uloženému v snímke.
============================================================ */

import { ref, get, set, push, runTransaction }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { econAward } from './economy.js';
import { ECONOMY_CONFIG, getRole } from './economyConfig.js';
import { getGroup } from './groups.js';

function getDb() { return window.db || null; }
function getNick() { return localStorage.getItem('playerNick') || null; }

/* ============================================================
   GARANT – ZOSTAVENIE TESTU
============================================================ */
function shufflePick(pool, count) {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, Math.min(count, copy.length)));
}

function snapshotQuestions(list) {
  return list.map(q => ({
    question: q.question,
    options: q.options,
    correct: q.correct,
    explanation: q.explanation || null,
    zdroj: q.zdroj || null,
    source: q.source,
    quizIndex: q._quizIndex
  }));
}

/* Zoznam okruhov (A1, A2, ...) danej oblasti s počtom otázok a NÁZVOM –
   pre výber v spôsobe (a). Číta z window.areas, rovnaký zdroj ako
   duely/kvíz (musí byť už načítané cez data.js loadJsonQuestions).
   title z window.areaOkruhTitles (naplnené v data.js loadJsonQuestions
   z A*.json title, bez ďalšieho fetchu) – source zostáva interný kľúč
   (checkbox value, posiela sa do createAssignment ako okruhIds), title
   je LEN zobrazenie. */
export function listOkruhy(areaTitle) {
  const all = window.areas?.[areaTitle] || [];
  const counts = {};
  all.forEach(q => { counts[q.source] = (counts[q.source] || 0) + 1; });
  return Object.keys(counts)
    .filter(k => /^A\d+$/.test(k))
    .sort((a, b) => Number(a.replace('A', '')) - Number(b.replace('A', '')))
    .map(source => ({
      source,
      count: counts[source],
      title: window.areaOkruhTitles?.[areaTitle]?.[source] || source
    }));
}

export function listAreaTitles() {
  return Object.keys(window.areas || {});
}

export async function createAssignment({ title, groupId, mode, areaTitle, okruhIds, count, opensAt, closesAt }) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return { ok: false, message: 'Musíš byť prihlásený.' };

  const role = await getRole(nick);
  if (role !== 'garant' && role !== 'admin') {
    return { ok: false, message: 'Test môže zadať len garant alebo admin.' };
  }

  const trimmed = (title || '').trim();
  if (trimmed.length < 3 || trimmed.length > 80) {
    return { ok: false, message: 'Názov testu musí mať 3–80 znakov.' };
  }
  if (!groupId) return { ok: false, message: 'Vyber skupinu.' };
  const group = await getGroup(groupId);
  if (!group) return { ok: false, message: 'Skupina neexistuje.' };
  if (group.garantNick !== nick && role !== 'admin') {
    return { ok: false, message: 'Test môžeš zadať len vo vlastnej skupine.' };
  }
  if (!areaTitle || !window.areas?.[areaTitle]) return { ok: false, message: 'Neplatná oblasť.' };
  if (!opensAt || !closesAt || Number(closesAt) <= Number(opensAt)) {
    return { ok: false, message: 'Termín uzavretia musí byť po termíne otvorenia.' };
  }
  const wantCount = parseInt(count, 10);
  if (!wantCount || wantCount < 1 || wantCount > 100) {
    return { ok: false, message: 'Počet otázok musí byť 1–100.' };
  }

  const all = window.areas[areaTitle] || [];
  let pool;
  if (mode === 'okruhy') {
    if (!okruhIds || !okruhIds.length) return { ok: false, message: 'Vyber aspoň jeden okruh.' };
    pool = all.filter(q => okruhIds.includes(q.source));
  } else if (mode === 'oblast') {
    pool = all;
  } else {
    return { ok: false, message: 'Nepodporovaný spôsob výberu otázok.' };
  }

  const picked = shufflePick(pool, wantCount);
  if (!picked.length) {
    return { ok: false, message: 'Pre zadaný výber nie sú dostupné žiadne otázky.' };
  }

  const assignRef = push(ref(db, 'assignments'));
  await set(assignRef, {
    title: trimmed,
    groupId,
    garantNick: nick,
    mode,
    areaTitle,
    questions: snapshotQuestions(picked),
    opensAt: Number(opensAt),
    closesAt: Number(closesAt),
    createdAt: Date.now()
  });

  return { ok: true, assignmentId: assignRef.key, count: picked.length };
}

export async function deleteAssignment(assignmentId, nick) {
  const db = getDb();
  if (!db || !assignmentId) return { ok: false, message: 'Test neexistuje.' };
  const assignment = await getAssignment(assignmentId);
  if (!assignment) return { ok: false, message: 'Test neexistuje.' };
  if (assignment.garantNick !== nick) return { ok: false, message: 'Len garant testu ho môže zmazať.' };
  await set(ref(db, `assignments/${assignmentId}`), null);
  return { ok: true };
}

/* ============================================================
   ČÍTANIE
============================================================ */
export async function getAssignment(id) {
  const db = getDb();
  if (!db || !id) return null;
  const snap = await get(ref(db, `assignments/${id}`));
  return snap.exists() ? { id, ...snap.val() } : null;
}

async function getAllAssignments() {
  const db = getDb();
  if (!db) return [];
  const snap = await get(ref(db, 'assignments'));
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, a]) => ({ id, ...a }));
}

export async function getAssignmentsForGroup(groupId) {
  const all = await getAllAssignments();
  return all.filter(a => a.groupId === groupId).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getAssignmentsForGarant(nick) {
  if (!nick) return [];
  const all = await getAllAssignments();
  return all.filter(a => a.garantNick === nick).sort((a, b) => b.createdAt - a.createdAt);
}

/* Testy naprieč VŠETKÝMI skupinami, ktorých je nick členom – volajúci
   (UI) odovzdá zoznam groupId z getMyMemberGroups(nick), aby si tento
   modul nemusel sám importovať groups.js (voľné prepojenie modulov). */
export async function getAssignmentsForGroupIds(groupIds) {
  if (!groupIds || !groupIds.length) return [];
  const all = await getAllAssignments();
  return all.filter(a => groupIds.includes(a.groupId)).sort((a, b) => b.createdAt - a.createdAt);
}

/* ============================================================
   ŠTUDENT – STAV A PÍSANIE TESTU
============================================================ */
export function assignmentStatus(assignment, now = Date.now()) {
  if (now < assignment.opensAt) return 'upcoming';
  if (now > assignment.closesAt) return 'closed';
  return 'open';
}

export async function getMyResult(assignmentId, nick) {
  const db = getDb();
  if (!db || !assignmentId || !nick) return null;
  const snap = await get(ref(db, `assignments/${assignmentId}/results/${nick}`));
  return snap.exists() ? snap.val() : null;
}

function rewardForPct(pct) {
  const tiers = ECONOMY_CONFIG.ASSIGNMENTS.REWARD_BY_PCT;
  for (const t of tiers) {
    if (pct >= t.min) return t.reward;
  }
  return 0;
}

/* Vyhodnotí a uloží pokus, TRANSAKČNE (aby dvojklik/paralelný beh
   nemohol zapísať dvakrát) – rovnaký vzor ako joinGroupByCode.
   `answers` = { [questionIndex]: zvolený TEXT odpovede }, tak ako ho
   študent videl (zamiešané poradie sa rieši textovou zhodou, nie
   indexom – pozri hlavičku súboru). */
export async function submitAssignment(assignmentId, answers) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return { ok: false, message: 'Musíš byť prihlásený.' };

  const assignment = await getAssignment(assignmentId);
  if (!assignment) return { ok: false, message: 'Test neexistuje.' };

  const status = assignmentStatus(assignment);
  if (status === 'upcoming') return { ok: false, message: 'Test sa ešte neotvoril.' };
  if (status === 'closed') return { ok: false, message: 'Test je už uzavretý.' };

  const resultRef = ref(db, `assignments/${assignmentId}/results/${nick}`);
  const questions = assignment.questions || [];
  let scoreCount = 0;
  const wrongIdx = [];
  questions.forEach((q, i) => {
    const chosenText = answers[i];
    if (chosenText != null && chosenText === q.options[q.correct]) scoreCount++;
    else wrongIdx.push(i);
  });

  const result = {
    score: scoreCount,
    total: questions.length,
    answers,
    wrongIdx,
    submittedAt: Date.now(),
    rewarded: false
  };

  // Transakčné "claim" – prvý zápis vyhráva, žiadny druhý pokus neprejde.
  const claim = await runTransaction(resultRef, (current) => {
    if (current) return; // abort – niekto (aj tento istý klient dvojklikom) už zapísal
    return result;
  });
  if (!claim || !claim.committed) {
    return { ok: false, message: 'Tento test si už písal/a – máš len jeden pokus.' };
  }

  const pct = questions.length ? Math.round((scoreCount / questions.length) * 100) : 0;
  const reward = rewardForPct(pct);
  if (reward > 0) {
    await econAward(nick, reward, `test skupiny – ${assignment.title}`);
    await set(ref(db, `assignments/${assignmentId}/results/${nick}/rewarded`), true);
  }

  return { ok: true, score: scoreCount, total: questions.length, pct, reward };
}

/* ============================================================
   GARANT – VÝSLEDKY (LEN z tohto testu, nič iné o študentovi)
============================================================ */
export async function getAssignmentResults(assignmentId) {
  const db = getDb();
  if (!db || !assignmentId) return {};
  const snap = await get(ref(db, `assignments/${assignmentId}/results`));
  return snap.exists() ? snap.val() : {};
}
