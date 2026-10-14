'use strict';

/* ============================================================
   AKADEMICKÁ VRSTVA – KROK 1: Skupiny garanta (pripojovací kód)

   Firebase model – JEDINÁ nová vetva, users/, leaderboard/ a
   pojednávania sa nikde v tomto súbore nečítajú ani nezapisujú:

   groups/{groupId}: {
     name, code, garantNick, createdAt,
     members: { [nick]: { joinedAt } }
   }

   NEMENNÁ ZÁSADA (akademická vrstva): meno študenta je pre garanta
   viditeľné LEN tam, kde ho študent vedome odovzdal – tu konkrétne
   dobrovoľným pripojením kódom (members/{nick}). Skupina neobsahuje
   a nikdy nebude obsahovať odkaz na tréningové dáta, výsledky kvízov,
   streak ani históriu daného študenta – len jeho nick a čas pripojenia.

   Zmazanie skupiny (deleteGroup) maže LEN tento groups/{groupId}
   záznam (teda membership) – nič v users/, leaderboard/ ani inde sa
   nedotýka, takže študentove tréningové dáta zostávajú nedotknuté.
============================================================ */

import { ref, get, set, update, push, runTransaction }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { getRole } from './economyConfig.js';

function getDb() { return window.db || null; }
function getNick() { return localStorage.getItem('playerNick') || null; }

const MAX_GROUPS_PER_GARANT = 20;
// Bez O/0/I/1 (vizuálna zámena pri prepisovaní kódu).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateGroupCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/* ============================================================
   ČÍTANIE
============================================================ */
export async function getGroup(groupId) {
  const db = getDb();
  if (!db || !groupId) return null;
  const snap = await get(ref(db, `groups/${groupId}`));
  return snap.exists() ? { id: groupId, ...snap.val() } : null;
}

async function getAllGroups() {
  const db = getDb();
  if (!db) return [];
  const snap = await get(ref(db, 'groups'));
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, g]) => ({ id, ...g }));
}

export async function getMyGarantGroups(nick) {
  if (!nick) return [];
  const all = await getAllGroups();
  return all.filter(g => g.garantNick === nick).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function getMyMemberGroups(nick) {
  if (!nick) return [];
  const all = await getAllGroups();
  return all.filter(g => g.members && g.members[nick]).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* ============================================================
   VYTVORENIE SKUPINY (garant alebo admin – rola cez existujúci
   mechanizmus, users/{nick}/role, len ČÍTANÁ, nikdy zapisovaná tu).
============================================================ */
export async function createGroup(name) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return { ok: false, message: 'Musíš byť prihlásený.' };

  const role = await getRole(nick);
  if (role !== 'garant' && role !== 'admin') {
    return { ok: false, message: 'Skupinu môže vytvoriť len garant alebo admin.' };
  }

  const trimmed = (name || '').trim();
  if (trimmed.length < 3 || trimmed.length > 50) {
    return { ok: false, message: 'Názov skupiny musí mať 3–50 znakov.' };
  }

  const myGroups = await getMyGarantGroups(nick);
  if (myGroups.length >= MAX_GROUPS_PER_GARANT) {
    return { ok: false, message: `Môžeš mať max ${MAX_GROUPS_PER_GARANT} skupín.` };
  }

  const all = await getAllGroups();
  let code = generateGroupCode();
  let attempts = 0;
  while (all.some(g => g.code === code) && attempts < 10) {
    code = generateGroupCode();
    attempts++;
  }

  const groupRef = push(ref(db, 'groups'));
  const groupId = groupRef.key;
  const now = Date.now();

  await set(groupRef, {
    name: trimmed,
    code,
    garantNick: nick,
    createdAt: now,
    members: {}
  });

  return { ok: true, groupId, code, name: trimmed };
}

/* ============================================================
   SPRÁVA SKUPINY (len garant danej skupiny)
============================================================ */
export async function renameGroup(groupId, newName, nick) {
  const group = await getGroup(groupId);
  if (!group) return { ok: false, message: 'Skupina neexistuje.' };
  if (group.garantNick !== nick) return { ok: false, message: 'Len garant skupiny ju môže premenovať.' };

  const trimmed = (newName || '').trim();
  if (trimmed.length < 3 || trimmed.length > 50) {
    return { ok: false, message: 'Názov skupiny musí mať 3–50 znakov.' };
  }

  await update(ref(getDb(), `groups/${groupId}`), { name: trimmed });
  return { ok: true };
}

export async function deleteGroup(groupId, nick) {
  const group = await getGroup(groupId);
  if (!group) return { ok: false, message: 'Skupina neexistuje.' };
  if (group.garantNick !== nick) return { ok: false, message: 'Len garant skupiny ju môže zmazať.' };

  // Maže len membership tejto skupiny (groups/{groupId}) – nič v
  // users/, leaderboard/ ani inde; študentove tréningové dáta ostávajú.
  await set(ref(getDb(), `groups/${groupId}`), null);
  return { ok: true };
}

/* ============================================================
   PRIPOJENIE KÓDOM – dobrovoľný akt ktoréhokoľvek prihláseného
   hráča, žiadne automatické pridávanie.
============================================================ */
export async function joinGroupByCode(rawCode, nick) {
  const db = getDb();
  if (!db || !nick) return { ok: false, message: 'Musíš byť prihlásený.' };

  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, message: 'Zadaj pripojovací kód.' };

  const all = await getAllGroups();
  const group = all.find(g => g.code === code);
  if (!group) return { ok: false, message: 'Neplatný kód – skupina neexistuje.' };
  if (group.garantNick === nick) return { ok: false, message: 'Toto je tvoja vlastná skupina.' };
  if (group.members && group.members[nick]) return { ok: false, message: 'V tejto skupine už si.' };

  const membersRef = ref(db, `groups/${group.id}/members`);
  const now = Date.now();
  const result = await runTransaction(membersRef, (current) => {
    const members = current || {};
    if (members[nick]) return; // abort – konkurenčný beh, už členom
    return { ...members, [nick]: { joinedAt: now } };
  });

  if (!result || !result.committed) {
    return { ok: false, message: 'Nepodarilo sa pripojiť (skús znova).' };
  }

  return { ok: true, groupId: group.id, groupName: group.name };
}

export async function leaveGroup(groupId, nick) {
  const group = await getGroup(groupId);
  if (!group) return { ok: false, message: 'Skupina neexistuje.' };
  if (!group.members || !group.members[nick]) return { ok: false, message: 'Nie si členom tejto skupiny.' };

  await update(ref(getDb(), `groups/${groupId}/members`), { [nick]: null });
  return { ok: true };
}
