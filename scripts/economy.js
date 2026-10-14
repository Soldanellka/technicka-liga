'use strict';

/* ============================================================
   LEXARENA – ECONOMY ENGINE
   Jediná brána pre § a energiu avatara. Žiaden iný modul
   nesmie zapisovať § ani energiu priamo do Firebase – všetko
   ide cez econAward / econSpend / econEnergy / econGrant nižšie.

   Hodnota § = vzácnosť §. Bežný aktívny deň má skončiť približne
   na nule; na drahé veci (streak shield, prestige avatar, balíky)
   hráč šetrí alebo si ich neskôr kúpi.
============================================================ */

import { ref, get, set, update, runTransaction }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { awardParagrafy, spendParagrafy, deductEnergy, canPlayDuel, getEnergy }
from './avatar.js';
import { ECONOMY_CONFIG, getRole, logTransaction, todayKey } from './economyConfig.js';
import { isAnon } from './anonSession.js';
import { jePreskocitelnaPrezyvka } from './deletedPlayer.js';
import { showRewardToast } from '../ui.js';

export { ECONOMY_CONFIG };

/* ---------- HELPERY ---------- */
function getDb() { return window.db || null; }
function getNick() { return localStorage.getItem('playerNick') || null; }
/* todayKey() sa po novom importuje z economyConfig.js – jedna definícia „dňa“
   pre strop §, reklamy, granty aj denný reset energie (avatar.js). */

async function getBalance(db, nick) {
  const snap = await get(ref(db, `users/${nick}/paragrafy`));
  return snap.exists() ? snap.val() : 0;
}

/* Priamy zápis § pre ĽUBOVOĽNÝ nick (napr. súper v dueli, ktorý
   nesedí za týmto zariadením) – avatar.js vie pracovať len
   s aktuálnym lokálnym hráčom. */
async function awardParagrafyRemote(db, nick, amount) {
  const userRef = ref(db, `users/${nick}`);
  const snap = await get(userRef);
  const data = snap.exists() ? snap.val() : {};
  const current = data.paragrafy || 0;
  const newTotal = current + amount;
  await update(userRef, {
    paragrafy: newTotal,
    totalParagraphsEarned: (data.totalParagraphsEarned || 0) + amount,
    lastParUpdate: Date.now()
  });
  return newTotal;
}

async function spendParagrafyRemote(db, nick, amount) {
  const current = await getBalance(db, nick);
  if (current < amount) return { ok: false, balanceAfter: current };
  const balanceAfter = current - amount;
  await update(ref(db, `users/${nick}`), { paragrafy: balanceAfter, lastParUpdate: Date.now() });
  return { ok: true, balanceAfter };
}

/* Dorovná denný strop zárobku pre daný nick. Vráti povolenú (prípadne
   orezanú) sumu, alebo null ak sa nedá udeliť nič.

   allOrNothing: pre JEDNORAZOVÉ odmeny, ktoré UI sľúbi celou sumou (video,
   dashboard míľnik, reklama). Orezanie by tam znamenalo, že hráč vidí „+12§“
   a dostane 5§ – alebo, pri jednorazovkách s príznakom, že o zvyšok príde
   navždy. Preto sa buď zmestí celá suma, alebo sa nedá nič a nárok ostáva
   na zajtra. Opakovateľné odmeny (duel, kvíz, senátny spor) orezanie znesú –
   tam je čiastočná výplata lepšia než nič. */
async function applyDailyCap(db, nick, amount, allOrNothing = false) {
  const cap = ECONOMY_CONFIG.LIMITS.DAILY_EARN_CAP;
  const capRef = ref(db, `users/${nick}/dailyEarned/${todayKey()}`);
  const snap = await get(capRef);
  const earned = snap.exists() ? snap.val() : 0;
  const remaining = cap - earned;

  if (remaining <= 0 || (allOrNothing && remaining < amount)) {
    if (nick === getNick()) {
      showRewardToast(`Dosiahol/a si dnešný limit ${cap}🪙 z aktivít. Streak, rebríčky a skúška idú ďalej!`);
    }
    return null;
  }

  const allowed = Math.min(amount, remaining);
  await set(capRef, earned + allowed);
  return allowed;
}

/* ============================================================
   1️⃣ econAward – pripíše §

   opts.skipCap = true SMÚ používať už len tri veci (ekonomika v1, viď
   LIMITS v economyConfig.js): rebríčkové odmeny (LEADERBOARD, SENATY.LB_*,
   FACULTIES), štátnicová sieň (odmena + vrátenie vkladu) a granty/promo od
   admina. Streak cap nerieši vôbec – ide priamo cez awardParagrafy.
   ⛔ Nepridávaj skipCap novým zdrojom bez rozhodnutia Babu; senátne spory,
   dashboard míľniky, videá a reklama ho v1 stratili zámerne.

   opts.allOrNothing = true pre jednorazovky, ktorých sumu UI sľúbi vopred –
   buď celá, alebo nič (viď applyDailyCap vyššie).
============================================================ */
export async function econAward(nick, amount, reason = '', opts = {}) {
  const db = getDb();
  if (!db || !nick || !amount) return null;

  const role = await getRole(nick);
  const skipCap = !!opts.skipCap || role === 'admin';

  let grantAmount = amount;
  if (!skipCap) {
    grantAmount = await applyDailyCap(db, nick, amount, !!opts.allOrNothing);
    if (grantAmount === null) return null;
  }
  if (!grantAmount) return null;

  let balanceAfter;
  if (nick === getNick()) {
    balanceAfter = await awardParagrafy(grantAmount, reason);
  } else {
    balanceAfter = await awardParagrafyRemote(db, nick, grantAmount);
  }

  await logTransaction(nick, { type: 'award', amount: grantAmount, reason, balanceAfter });
  return balanceAfter;
}

/* ============================================================
   2️⃣ econSpend – odpíše §, zlyhá pri nedostatku
   admin: vždy zadarmo (bez odpočtu)
============================================================ */
export async function econSpend(nick, amount, reason = '') {
  const db = getDb();
  if (!db || !nick || !amount) return false;

  const role = await getRole(nick);
  if (role === 'admin') {
    await logTransaction(nick, { type: 'spend', amount: 0, reason: `${reason} (admin zadarmo)`, balanceAfter: null });
    return true;
  }

  if (nick === getNick()) {
    const ok = await spendParagrafy(amount, reason);
    if (!ok) return false;
    const balanceAfter = await getBalance(db, nick);
    await logTransaction(nick, { type: 'spend', amount, reason, balanceAfter });
    return true;
  }

  const result = await spendParagrafyRemote(db, nick, amount);
  if (!result.ok) return false;
  await logTransaction(nick, { type: 'spend', amount, reason, balanceAfter: result.balanceAfter });
  return true;
}

/* Len na čítanie – aktuálny zostatok § pre nick (napr. zobrazenie
   "Máš: X§" pri žolíkoch v Bifľovačke). */
export async function econBalance(nick) {
  const db = getDb();
  if (!db || !nick) return 0;
  return await getBalance(db, nick);
}

/* ============================================================
   3️⃣ econEnergy – zmení energiu avatara (0–MAX)
   Energia je viazaná na toto zariadenie (aktuálny lokálny hráč).

   ANONYM (A1): `nick` je null a energia sa mení v localStorage –
   deductEnergy() si to rieši samo. Transakčný log sa NEPÍŠE: ide do
   users/{nick}/transactions, kam anonym nepatrí, a zapisovať ho pod
   nejakým náhradným reťazcom by bolo horšie než ho nemať.
============================================================ */
export async function econEnergy(nick, delta, reason = '') {
  if (!delta) return;

  if (!nick) {
    await deductEnergy(Math.abs(delta));
    return;
  }

  if (nick !== getNick()) return;
  const newEnergy = await deductEnergy(Math.abs(delta));
  await logTransaction(nick, { type: 'energy', amount: delta, reason, balanceAfter: newEnergy });
}

/* ============================================================
   4️⃣ econCanPlay – kontrola pred hraním (duel, bifľovačka,
   memory, prípady). Vráti false + toast, ak avatar spí.
============================================================ */
export async function econCanPlay(activity = '') {
  return await canPlayDuel();
}

/* ============================================================
   ENERGETICKÁ BRÁNA PRE DRAHÉ AKTIVITY (E2)
   Štátnicová sieň a Nočný výcuc sa po novom neplatia §, ale energiou.
   Na rozdiel od econCanPlay (ktoré len pýta „nespíš?“) sa tu overuje,
   či energia POKRYJE konkrétny náklad – 60 z porcie 100 je veľa a
   pustiť hráča do mínusu by zmazalo zmysel váh.

   econEnergyLeft()  – koľko energie hráč má (bez zápisu)
   econEnergyMissingMsg(cost, left) – jednotná hláška pre oba vstupy
   econSpendEnergy(nick, cost, reason) – znovu overí a odpočíta;
        true = smie ísť ďalej, false = nemá dosť (volajúci zobrazí hlášku)

   Admin má energiu zadarmo – rovnako, ako mal doteraz § vstup zadarmo
   cez econSpend. Bez toho by sa sieň nedala testovať bez čakania na
   ďalší deň.

   ANONYM (A1): funguje rovnako, len nad localStorage energiou. Rolu sa
   ho nepýtame (nemá kde byť uložená) a hláška mu neponúka kŕmenie –
   § sa dajú získať až s nickom.
============================================================ */
export async function econEnergyLeft() {
  return await getEnergy();
}

/*  je voliteľná – bez nej sa hláška správa presne ako doteraz,
   s ňou pomenuje, na ČO energia nestačí („Nemáš na nápovedu dosť…").
   Dôvod: pri tlačidle, ktoré sa po kliku nič nespraví, hráč nevie, či
   je chyba v appke alebo mu len došla energia. */
export function econEnergyMissingMsg(cost, left, aktivita = '') {
  const co = aktivita ? `na ${aktivita} ` : '';
  const base = `😴 Nemáš ${co}dosť energie (treba ${Math.abs(cost)}, máš ${left}).`;
  return isAnon()
    ? `${base} Energia sa obnoví zajtra – alebo si sprav nick a doplň ju kŕmením.`
    : `${base} Nakŕm avatara za ${ECONOMY_CONFIG.ENERGY.FEED_COST}🪙, alebo sa vráť zajtra – energia sa obnoví.`;
}

export async function econSpendEnergy(nick, cost, reason = '') {
  const need = Math.abs(cost);
  if (!need) return true;

  /* Rola sa číta len pri nickovi – getRole(null) by bolo zbytočné
     Firebase čítanie s istým výsledkom 'student'. */
  if (nick) {
    const role = await getRole(nick);
    if (role === 'admin') {
      await logTransaction(nick, { type: 'energy', amount: 0, reason: `${reason} (admin zadarmo)`, balanceAfter: null });
      return true;
    }
  }

  const left = await getEnergy();
  if (left < need) return false;

  await econEnergy(nick, -need, reason);
  return true;
}

/* ============================================================
   5️⃣ VIDEÁ – jednorazová odmena na video a nick
============================================================ */
export async function econVideoReward(videoId) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick || !videoId) return false;

  const claimedRef = ref(db, `users/${nick}/videoRewards/${videoId}`);
  const already = await get(claimedRef);
  if (already.exists()) {
    showRewardToast('Odmenu za toto video si už získal/a.');
    return false;
  }

  /* Poradie je KRITICKÉ: odmena najprv, príznak „vyzdvihnuté“ až po nej.
     Video je v1 v dennom strope (predtým ho obchádzalo) a odmena je
     jednorazová na video a nick – keby sa príznak zapísal ako predtým PRED
     econAward, hráč, ktorý má strop vyčerpaný, by o 12§ prišiel NAVŽDY a UI
     by mu pritom sľubovalo odmenu. Rovnaký vzor, aký už používajú dashboard
     míľniky (scripts/dashboardRewards.js). allOrNothing bráni orezaniu na
     časť sumy. Pri neúspechu vraciame false → UI nechá tlačidlo aktívne a
     hráč si odmenu vyzdvihne zajtra. */
  const balanceAfter = await econAward(
    nick, ECONOMY_CONFIG.REWARDS.VIDEO, 'za pozretie videa 🎬', { allOrNothing: true }
  );
  if (balanceAfter === null) return false;

  await set(claimedRef, true);
  return true;
}

/* Len na čítanie – pre UI (napr. zobrazenie "už vyzdvihnuté" v modáli videa). */
export async function econIsVideoClaimed(videoId) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick || !videoId) return false;
  const snap = await get(ref(db, `users/${nick}/videoRewards/${videoId}`));
  return snap.exists();
}

/* ============================================================
   6️⃣ REKLAMY – "Získaj §" karta 📺
   econAdStatus(): len na čítanie, pre render karty (koľko zostáva dnes).
   econAdComplete(): volať AŽ PO dopozeraní (20 s časovač v UI vrstve);
   denný limit sa vynucuje transakčne (result.committed), potom sa
   pripíše odmena cez econAward.
============================================================ */
export async function econAdStatus() {
  if (!ECONOMY_CONFIG.ADS.ENABLED) return { enabled: false, remaining: 0 };

  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return { enabled: true, remaining: 0 };

  const snap = await get(ref(db, `users/${nick}/adsWatched/${todayKey()}`));
  const count = snap.exists() ? snap.val() : 0;
  return { enabled: true, remaining: Math.max(0, ECONOMY_CONFIG.ADS.DAILY_MAX - count) };
}

export async function econAdComplete() {
  if (!ECONOMY_CONFIG.ADS.ENABLED) return { success: false, reason: 'disabled' };

  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return { success: false, reason: 'no_user' };

  const max = ECONOMY_CONFIG.ADS.DAILY_MAX;
  const countRef = ref(db, `users/${nick}/adsWatched/${todayKey()}`);

  // Transakčne – nie get-potom-set – aby dve súbežné reklamy v tú istú
  // sekundu nemohli obe prejsť cez limit. Rozhoduje result.committed.
  const result = await runTransaction(countRef, (current) => {
    const count = current || 0;
    if (count >= max) return; // abort – limit už vyčerpaný
    return count + 1;
  });

  if (!result.committed) {
    showRewardToast(`Dnešný limit ${max} reklám je vyčerpaný. Vráť sa zajtra!`);
    return { success: false, reason: 'daily_max' };
  }

  // TODO: pri aktivácii monetizácie sem doplniť volanie SDK poskytovateľa
  // odmeňovanej reklamy PRED zavolaním econAdComplete (t. j. zavolať túto
  // funkciu až po potvrdení od SDK, že reklama bola skutočne dopozeraná),
  // napr.: const result = await adProvider.showRewardedAd();
  //        if (!result.completed) return; // nevolaj econAdComplete()

  /* Reklama je v1 v dennom strope (predtým ho obchádzala). Denný slot je už
     v tomto bode spotrebovaný transakciou vyššie, takže keď strop odmenu
     nepustí, musíme ho VRÁTIŤ – inak by hráč prišiel aj o § aj o pokus.
     allOrNothing: 3§ za 20 s pozerania nemá zmysel orezávať na 1§. */
  const balanceAfter = await econAward(
    nick, ECONOMY_CONFIG.ADS.REWARD, 'za pozretie reklamy', { allOrNothing: true }
  );
  if (balanceAfter === null) {
    await runTransaction(countRef, (current) => Math.max(0, (current || 1) - 1));
    return { success: false, reason: 'daily_cap' };
  }
  return { success: true };
}

/* Spätná kompatibilita – pôvodná jednofázová funkcia (get+set, nie
   transakcia). Nová UI cez econAdStatus/econAdComplete ju nepoužíva. */
export async function econWatchAd() {
  const status = await econAdStatus();
  if (!status.enabled || status.remaining <= 0) return { available: false };
  const result = await econAdComplete();
  return { available: result.success };
}

/* ============================================================
   PROMO KÓDY – 🎟️ "Zadaj kód" karta
   promoCodes/{CODE}: { amount, active, maxUses, usedCount, expiresAt,
                         createdBy, createdAt, redeemed: { [nick]: true } }
   Jeden nick môže jeden kód uplatniť len raz. Atomicita cez transakciu
   na CELOM uzle (všetky podmienky overené znova v callbacku), double-click
   ochrana rovnako ako pri econAdComplete: rozhoduje result.committed.
============================================================ */
export async function econRedeemCode(rawCode) {
  const db = getDb();
  const nick = getNick();
  const code = (rawCode || '').trim().toUpperCase();
  if (!db || !nick || !code) return { ok: false, message: '❌ Neplatný kód' };

  const codeRef = ref(db, `promoCodes/${code}`);
  const snap = await get(codeRef);

  if (!snap.exists() || snap.val().active !== true) {
    return { ok: false, message: '❌ Neplatný kód' };
  }
  const preData = snap.val();
  if (preData.redeemed && preData.redeemed[nick]) {
    return { ok: false, message: '❌ Kód si už použil/a' };
  }
  const now = Date.now();
  const preExpired = typeof preData.expiresAt === 'number' && preData.expiresAt < now;
  const preExhausted = typeof preData.maxUses === 'number' && (preData.usedCount || 0) >= preData.maxUses;
  if (preExpired || preExhausted) {
    return { ok: false, message: '❌ Kód vypršal alebo bol vyčerpaný' };
  }

  const result = await runTransaction(codeRef, (current) => {
    if (!current || current.active !== true) return; // abort – neplatný/neexistujúci
    if (current.redeemed && current.redeemed[nick]) return; // abort – už uplatnil
    const expired = typeof current.expiresAt === 'number' && current.expiresAt < Date.now();
    const exhausted = typeof current.maxUses === 'number' && (current.usedCount || 0) >= current.maxUses;
    if (expired || exhausted) return; // abort

    return {
      ...current,
      usedCount: (current.usedCount || 0) + 1,
      redeemed: { ...(current.redeemed || {}), [nick]: true }
    };
  });

  if (!result.committed) {
    const final = result.snapshot.val();
    if (!final || final.active !== true) return { ok: false, message: '❌ Neplatný kód' };
    if (final.redeemed && final.redeemed[nick]) return { ok: false, message: '❌ Kód si už použil/a' };
    return { ok: false, message: '❌ Kód vypršal alebo bol vyčerpaný' };
  }

  const amount = result.snapshot.val().amount || 0;
  await econAward(nick, amount, `promo kód ${code}`, { skipCap: true });
  showRewardToast(`🎟️ +${amount}🪙 za kód ${code}!`);
  return { ok: true, message: `✅ Kód ${code}: +${amount}🪙!`, amount };
}

/* ============================================================
   7️⃣ GARANT – denný limit rozdávania §
============================================================ */
export async function econGrant(fromGarant, toNick, amount) {
  const db = getDb();
  if (!db || !fromGarant || !toNick || !amount) return false;

  const role = await getRole(fromGarant);
  if (role !== 'garant' && role !== 'admin') {
    showRewardToast('Len garant alebo admin môže rozdávať 🪙.');
    return false;
  }

  if (role === 'garant') {
    const cap = ECONOMY_CONFIG.ROLES.GARANT_DAILY_GRANT;
    const grantRef = ref(db, `users/${fromGarant}/dailyGrant/${todayKey()}`);
    const snap = await get(grantRef);
    const already = snap.exists() ? snap.val() : 0;
    if (already + amount > cap) {
      showRewardToast(`Denný limit garanta vyčerpaný (${cap}🪙).`);
      return false;
    }
    await set(grantRef, already + amount);
  }

  await econAward(toNick, amount, `dar od garanta ${fromGarant}`, { skipCap: true });
  await logTransaction(fromGarant, { type: 'grant', amount: -amount, reason: `dar pre ${toNick}`, balanceAfter: null });
  return true;
}

/* ============================================================
   8️⃣ REBRÍČKY – LAZY vyhodnotenie s ochranou proti dvojitej výplate
============================================================ */
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

function getPreviousWeekPeriod(now = new Date()) {
  const thisWeekStart = getWeekStartLocal(now);
  const prevWeekStart = new Date(thisWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const { year, week } = isoWeekInfo(prevWeekStart);
  return {
    key: `W-${year}-${String(week).padStart(2, '0')}`,
    start: prevWeekStart.getTime(),
    end: thisWeekStart.getTime(),
    rewardTable: ECONOMY_CONFIG.LEADERBOARD.WEEKLY,
    label: 'týždennom'
  };
}

function getPreviousMonthPeriod(now = new Date()) {
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  return {
    key: `M-${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, '0')}`,
    start: prevMonthStart.getTime(),
    end: thisMonthStart.getTime(),
    rewardTable: ECONOMY_CONFIG.LEADERBOARD.MONTHLY,
    label: 'mesačnom'
  };
}

/* Rovnaká agregácia ako scripts/leaderboard.js (duels/{id}.result),
   len ohraničená na konkrétne uzavreté obdobie [start, end). */
function aggregateDuelStats(duelsData, start, end) {
  const stats = {};
  Object.values(duelsData || {}).forEach(duel => {
    if (!duel || duel.status !== 'finished' || !duel.result) return;
    if (!duel.finishedAt || duel.finishedAt < start || duel.finishedAt >= end) return;

    const { firstPlayer, secondPlayer, winner } = duel.result;
    if (!firstPlayer || !secondPlayer) return;

    [firstPlayer, secondPlayer].forEach(p => {
      /* Zmazaný hráč nesmie vyhrať odmenu za obdobie – nemá ju kde
         dostať a v zozname výhercov by ostalo náhradné meno. */
      if (jePreskocitelnaPrezyvka(p.nick)) return;
      if (!stats[p.nick]) stats[p.nick] = { nick: p.nick, points: 0 };
      stats[p.nick].points += (typeof p.score === 'number' ? p.score : 0);
    });
  });
  return Object.values(stats).sort((a, b) => b.points - a.points);
}

/* Transaction lock na rewards/{key}/evaluated – kto prvý zapíše true,
   ten vyhodnocuje; ostatní (paralelne otvorení hráči) preskočia.
   POZOR: rozhoduje sa podľa result.committed (návratová hodnota
   runTransaction), NIE podľa vlajky nastavenej vnútri callbacku – ten sa
   môže pri kontencii zavolať viackrát/aj keď transakcia napokon abortne,
   čo pri optimistickom vyhodnocovaní vie spôsobiť dvojitú výplatu. */
async function settlePeriod(db, period) {
  const evaluatedRef = ref(db, `rewards/${period.key}/evaluated`);

  const result = await runTransaction(evaluatedRef, (current) => {
    if (current === true) return; // abort – už vyhodnotené
    return true;
  });

  if (!result || !result.committed) return;

  const duelsSnap = await get(ref(db, 'duels'));
  const duelsData = duelsSnap.exists() ? duelsSnap.val() : {};
  const top3 = aggregateDuelStats(duelsData, period.start, period.end).slice(0, 3);

  const winners = [];
  for (let i = 0; i < top3.length; i++) {
    const amount = period.rewardTable[i] || 0;
    if (amount > 0) {
      await econAward(top3[i].nick, amount, `${i + 1}. miesto v ${period.label} rebríčku`, { skipCap: true });
      winners.push({ nick: top3[i].nick, amount, place: i + 1 });
    }
  }

  await set(ref(db, `rewards/${period.key}/winners`), winners);
}

/* Ak je aktuálny hráč medzi výhercami a ešte to nevidel, zobraz toast raz. */
async function announceLeaderboardWinIfAny(db, periods) {
  const nick = getNick();
  if (!nick) return;

  for (const period of periods) {
    const winnersSnap = await get(ref(db, `rewards/${period.key}/winners`));
    if (!winnersSnap.exists()) continue;

    const winners = winnersSnap.val() || [];
    const mine = winners.find(w => w.nick === nick);
    if (!mine) continue;

    const seenRef = ref(db, `rewards/${period.key}/seen/${nick}`);
    const seenSnap = await get(seenRef);
    if (seenSnap.exists()) continue;

    await set(seenRef, true);
    showRewardToast(`🏆 Skončil/a si ${mine.place}. v ${period.label} rebríčku! +${mine.amount}🪙`);
  }
}

export async function econSettleLeaderboards() {
  const db = getDb();
  if (!db) return;

  const periods = [getPreviousWeekPeriod(), getPreviousMonthPeriod()];
  for (const period of periods) {
    await settlePeriod(db, period);
  }
  await announceLeaderboardWinIfAny(db, periods);
}

/* ============================================================
   MOST PRE SUB-APPKY (pravo-app, ob-pravo-app)
   Sub-appky bežia v samostatnom okne a k ekonomike pristupujú
   cez window.opener. Pripíše § aktuálnemu lokálnemu hráčovi cez
   jednotnú bránu econAward – teda V DENNOM STROPE (bez skipCap),
   s transakčným logom, presne ako bežná hra. Vráti balanceAfter
   alebo null (napr. strop vyčerpaný / žiadny nick).
============================================================ */
export async function econBridgeAward(amount, reason = '') {
  const nick = getNick();
  if (!nick || !amount) return null;
  return await econAward(nick, amount, reason);
}

/* ============================================================
   PAVÚKOVÉ HRY (Etapa 2) – § za výsledok sedenia Kukučky/Rozpárovania/
   Kde som? Volá sa z koncovej obrazovky hry v scripts/spiderGames.js.
   Recall a Blesk sa NEODMEŇUJÚ (nevolajú túto funkciu).

   Poradie checkov (žiadna priama RTDB výplata – všetko cez econAward):
     no nick → 'no_user'
     score pod prah → 'zero_score' (počítadlá sa NEdotknú)
     okruh dnes už odmenený → 'okruh_played'
     spoločný denný strop 3 sedení vyčerpaný → 'daily_max'
     inak → econAward; okruh flag AŽ PO úspešnej výplate → 'full' | 'near'
   Ak econAward nevyplatí (napr. denný strop 60§) → 'daily_max' a okruh sa
   NEZAMKNE (spresnenie 4). Vráti jeden z reťazcov vyššie (fail-soft: hra
   ho len zobrazí, pád ekonomiky ju nezhodí).
============================================================ */
function sanitizeKey(s) {
  // RTDB kľúč nesmie obsahovať . # $ [ ] / ; orez na 100 znakov.
  return String(s || '').replace(/[.#$/[\]]/g, '_').slice(0, 100);
}

function spiderRewardFor(gameId, score) {
  const table = ECONOMY_CONFIG.SPIDER_GAMES.REWARDS[gameId] || [];
  for (const tier of table) {
    if (score >= tier.min) return tier.sg;   // prvý vyhovujúci prah zhora
  }
  return 0;
}

export async function econSpiderGameReward(gameId, score, okruhKey) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return 'no_user';

  const sg = spiderRewardFor(gameId, score);
  if (!sg) return 'zero_score';               // pod prah – počítadlá sa nedotknú

  const day = todayKey();
  const okKey = `${gameId}::${sanitizeKey(okruhKey)}`;   // per-hra + okruh (spresnenie 2)
  const okruhRef = ref(db, `users/${nick}/spiderGameOkruhy/${day}/${okKey}`);

  // (1) okruh dnes už odmenený?
  const okSnap = await get(okruhRef);
  if (okSnap.exists()) return 'okruh_played';

  // (2) spoločný denný strop odmenených sedení – transakčne (vzor econAdComplete)
  const max = ECONOMY_CONFIG.SPIDER_GAMES.DAILY_MAX_SESSIONS;
  const playsRef = ref(db, `users/${nick}/spiderGamePlays/${day}`);
  const tx = await runTransaction(playsRef, (current) => {
    const count = current || 0;
    if (count >= max) return;                 // abort – strop vyčerpaný
    return count + 1;
  });
  if (!tx.committed) return 'daily_max';

  // (3) výplata cez jednotnú bránu (bez skipCap – v dennom strope 60§)
  const balanceAfter = await econAward(nick, sg, `pavúková hra – ${gameId}`);
  if (balanceAfter === null) return 'daily_max';   // 60§ strop – okruh NEZAMYKAŤ

  // (4) okruh flag AŽ PO úspešnej výplate (spresnenie 4)
  await set(okruhRef, true);

  const top = ECONOMY_CONFIG.SPIDER_GAMES.REWARDS[gameId]?.[0];
  return (top && score >= top.min) ? 'full' : 'near';
}

// ECONOMY_CONFIG na window kvôli inline skriptom v index.html (napr. openVerdictModal),
// ktoré nie sú ES moduly a nemôžu importovať – čerpajú sumy odtiaľto (žiadny hardcode).
window.ECONOMY_CONFIG = ECONOMY_CONFIG;
window.econAward = econAward;
window.econSpend = econSpend;
window.econBalance = econBalance;
window.econEnergy = econEnergy;
window.econCanPlay = econCanPlay;
window.econEnergyLeft = econEnergyLeft;
window.econSpendEnergy = econSpendEnergy;
window.econVideoReward = econVideoReward;
window.econIsVideoClaimed = econIsVideoClaimed;
window.econWatchAd = econWatchAd;
window.econAdStatus = econAdStatus;
window.econAdComplete = econAdComplete;
window.econRedeemCode = econRedeemCode;
window.econGrant = econGrant;
window.econSettleLeaderboards = econSettleLeaderboards;
window.econBridgeAward = econBridgeAward;
window.econSpiderGameReward = econSpiderGameReward;
