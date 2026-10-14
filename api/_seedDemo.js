'use strict';

/* ============================================================
   api/_seedDemo.js — GENERÁTOR UKÁŽKOVÝCH DÁT

   Podčiarkovník je zámerný: Vercel súbory začínajúce na "_" NEROUTUJE
   ako serverless funkcie. Toto je zdieľaný modul pre api/demo-reset.js.

   PREČO KÓD A NIE STATICKÝ JSON. Časové značky musia byť RELATÍVNE
   k okamihu resetu. Súboj s pevným `finishedAt` by po pár dňoch vypadol
   z týždenného rebríčka a demo by ukazovalo prázdnu tabuľku. Preto sa
   všetko počíta od `now`, ktoré príde ako parameter.

   ⚠️ PREDZNAČENÉ VYHODNOTENIA – bez nich by seed nevydržal.
   Appka pri načítaní lenivo dopočítava uzavreté obdobia:
     - economy.js  econSettleLeaderboards()  → rewards/{obdobie}
     - senaty.js   settleSenatLeaderboards() → senatRewards/{obdobie}
     - faculties.js settleFacultyMonth()     → facultyRewards/{mesiac}
   Prvé dve by fiktívnym hráčom vyplatili mince a sypali toasty. TRETIE
   JE DEŠTRUKTÍVNE: archivuje školy a VYNULUJE points, activePlayers
   a players. Demo prechádza cez zlom mesiaca, takže bez predznačenia by
   sa rebríček škôl sám vyprázdnil.
   Riešenie bez zásahu do logiky: vopred zapíšeme `evaluated: true`.
   Transakcia v tých funkciách potom abortne a vyhodnotenie sa preskočí.
   Značia sa aj obdobia DOPREDU, aby demo prežilo niekoľko týždňov.

   ⚠️ Kľúče období musia PRESNE sedieť s appkou:
     týždeň – `W-{ISO rok}-{ISO týždeň}` (isoWeekInfo v economy.js/senaty.js)
     mesiac – `M-{rok}-{mesiac}` z LOKÁLNEHO času (getPreviousMonthPeriod)
   Preto sú obe funkcie nižšie kópiou tých z appky, nie vlastný výpočet.
============================================================ */

/* ---------- kľúče období (zhodné s appkou) ---------- */

function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function weekKey(date) {
  const { year, week } = isoWeekInfo(date);
  return `W-${year}-${String(week).padStart(2, '0')}`;
}

function monthKey(date) {
  return `M-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const DAY = 86400000;

/* ---------- ukážkoví hráči ---------- */

const SCHOOL_NAMES = {
  'gym-ruzinov': '3.B Gymnázium Ružinov',
  'oa-nitra': '2.A OA Nitra',
  'sps-kosice': '4.C SPŠ Košice',
  'gym-zilina': '1.A Gymnázium Žilina'
};
const SCHOOLS = Object.keys(SCHOOL_NAMES);
const AVATARS = ['studentka-tmava', 'studentka-medena', 'studentka-blond',
  'student-tmavy', 'student-medeny', 'student-blond', 'macka', 'pes', 'sova'];

/* 14 fiktívnych hráčov. Nick, mince, avatar, škola. */
const PLAYERS = [
  { nick: 'BystrySporitel07', mince: 420, avatar: 'studentka-tmava', skola: 'gym-ruzinov' },
  { nick: 'ZlatyDukat12', mince: 385, avatar: 'student-medeny', skola: 'gym-ruzinov' },
  { nick: 'TichyInvestor44', mince: 350, avatar: 'sova', skola: 'gym-ruzinov' },
  { nick: 'MudryRozpocet21', mince: 310, avatar: 'studentka-medena', skola: 'gym-ruzinov' },
  { nick: 'RychlyUcet03', mince: 295, avatar: 'student-blond', skola: 'oa-nitra' },
  { nick: 'PokojnyFond88', mince: 270, avatar: 'macka', skola: 'oa-nitra' },
  { nick: 'SmelyPoklad15', mince: 240, avatar: 'studentka-blond', skola: 'oa-nitra' },
  { nick: 'VernyMesec62', mince: 225, avatar: 'pes', skola: 'oa-nitra' },
  { nick: 'OstryZisk09', mince: 200, avatar: 'student-tmavy', skola: 'sps-kosice' },
  { nick: 'ZvedavyTrezor31', mince: 180, avatar: 'sova', skola: 'sps-kosice' },
  { nick: 'StatocnyGros55', mince: 165, avatar: 'student-medeny', skola: 'sps-kosice' },
  { nick: 'VytrvalyPlan27', mince: 140, avatar: 'studentka-tmava', skola: 'sps-kosice' },
  { nick: 'ChladnyBankar74', mince: 120, avatar: 'student-blond', skola: 'gym-zilina' },
  { nick: 'PrisnyUrok38', mince: 95, avatar: 'macka', skola: 'gym-zilina' }
];

const AREAS = ['Osobné financie', 'Investovanie', 'Makroekonómia'];

/* Triedy – 3 tímy po 4 členoch, zostavené z hráčov vyššie. */
const CLASSES = [
  { id: 'trieda-ruzinov', name: '3.B Gymnázium Ružinov', clenovia: [0, 1, 2, 3], w: 2, d: 0, l: 0, body: 24 },
  { id: 'trieda-nitra', name: '2.A OA Nitra', clenovia: [4, 5, 6, 7], w: 1, d: 0, l: 1, body: 14 },
  { id: 'trieda-kosice', name: '4.C SPŠ Košice', clenovia: [8, 9, 10, 11], w: 0, d: 0, l: 1, body: 6 }
];

/* ---------- zostavenie seedu ---------- */

/* Vracia jeden plochý objekt {cesta: hodnota} pripravený na multi-path
   zápis do Firebase (PATCH na koreň). */
function buildSeed(now) {
  const nowDate = new Date(now);
  const seed = {};

  /* --- admin, ktorý musí prežiť každý reset --- */
  seed['users/Babu'] = {
    role: 'admin',
    paragrafy: 1000,
    totalParagraphsEarned: 1000,
    avatar: 'sova',
    energy: 100,
    loginStreak: 5
  };

  /* --- fiktívni hráči --- */
  PLAYERS.forEach(p => {
    seed[`users/${p.nick}`] = {
      role: 'student',
      paragrafy: p.mince,
      totalParagraphsEarned: p.mince,
      avatar: p.avatar,
      faculty: p.skola,
      facultyChangedAt: now - 20 * DAY,
      energy: 100,
      loginStreak: 1 + (p.mince % 7),
      demoSeed: true
    };
  });

  /* --- 20 odohraných súbojov naprieč všetkými tromi oblasťami ---
     finishedAt je RELATÍVNY (now − 1..6 dní), aby súboje ostali
     v týždennom rebríčku bez ohľadu na to, kedy sa reset spustil. */
  for (let i = 0; i < 20; i++) {
    const a = PLAYERS[i % PLAYERS.length];
    const b = PLAYERS[(i * 5 + 3) % PLAYERS.length];
    if (a.nick === b.nick) continue;

    /* ⚠️ Skóre NESMIE presiahnuť počet otázok súboja (DUEL_QUESTION_COUNT
       v scripts/duels.js, dnes 5). Pôvodné rozsahy 4..10 a 3..9 pochádzali
       z čias desaťotázkového súboja a po skrátení by rebríček ukazoval
       výsledky, ktoré sa nedajú dosiahnuť – „10 b." vedľa hry, kde je
       maximum 5. Rozptyl je zámerne zachovaný (nie samé päťky), aby
       rebríček vyzeral živo. */
    const scoreA = 2 + ((i * 3) % 4);        // 2..5
    const scoreB = 1 + ((i * 5) % 4);        // 1..4
    const winner = scoreA === scoreB ? null : (scoreA > scoreB ? a.nick : b.nick);
    const finishedAt = now - (1 + (i % 6)) * DAY - (i * 37 * 60000);

    seed[`duels/demo-duel-${String(i + 1).padStart(2, '0')}`] = {
      id: `demo-duel-${String(i + 1).padStart(2, '0')}`,
      from: a.nick,
      acceptedBy: b.nick,
      areaTitle: AREAS[i % AREAS.length],
      created: finishedAt - 20 * 60000,
      expiresIn: 86400,
      status: 'finished',
      finishedAt,
      result: {
        firstPlayer: { nick: a.nick, score: scoreA },
        secondPlayer: { nick: b.nick, score: scoreB },
        winner
      },
      demoSeed: true
    };
  }

  /* --- pevná pending výzva pre QR zálohu ---
     ⚠️ JEDNORAZOVÁ: prvý, kto ju prijme, prepne status na 'accepted'
     a ďalším sa zobrazí „Táto výzva už nie je aktívna". Reset ju vráti
     do pending – preto sa spúšťa pred každým stretnutím.
     `questions` sa zámerne nepredvypĺňa: klient si ich po prijatí
     doťahuje z oblasti sám, a natvrdo uložená desiatka by sa rozišla
     s obsahom pri každej úprave datasetu. */
  seed['duels/lektor-demo-01'] = {
    id: 'lektor-demo-01',
    from: 'Lektor',
    areaTitle: 'Osobné financie',
    created: now - 5 * 60000,
    expiresIn: 86400,
    status: 'pending',
    result: null,
    demoSeed: true
  };

  /* --- triedy + pozvánky ---
     ⚠️ Členstvo sa zapisuje PRIAMO do objektu hráča (seed['users/X'].senaty),
     nie ako samostatná cesta 'users/X/senaty/Y'. Multi-path PATCH vo
     Firebase odmieta dvojicu ciest, kde je jedna predkom druhej – 'users/X'
     a 'users/X/senaty/Y' by celý zápis zhodili. */
  CLASSES.forEach(c => {
    const members = {};
    c.clenovia.forEach((idx, poradie) => {
      const nick = PLAYERS[idx].nick;
      members[nick] = {
        joinedAt: now - (25 - poradie) * DAY,
        role: poradie === 0 ? 'predseda' : 'clen'
      };
      const u = seed[`users/${nick}`];
      u.senaty = u.senaty || {};
      u.senaty[c.id] = true;
    });
    seed[`senaty/${c.id}`] = {
      name: c.name,
      founder: PLAYERS[c.clenovia[0]].nick,
      members,
      status: 'active',
      createdAt: now - 25 * DAY,
      wins: c.w, draws: c.d, losses: c.l, points: c.body,
      demoSeed: true
    };
    seed[`senatInvites/${c.id}`] = {
      code: c.id.slice(-6).toUpperCase(),
      createdAt: now - 25 * DAY
    };
  });

  /* --- jeden ODOHRANÝ zápas tried (konečný stav) ---
     status 'done' + vyplnený winner: settleSenatSpor() sa ho nedotkne,
     lebo spracúva výhradne spory so status 'running' po termíne. */
  const ruz = CLASSES[0], nit = CLASSES[1];
  const scoresRuz = {}, scoresNit = {};
  /* Rovnaký strop ako pri dueloch vyššie: najviac 5. Ružinov ostáva
     víťazom (priemer 4,00 proti 3,00), takže uložený `winner` sedí. */
  ruz.clenovia.forEach((idx, k) => { scoresRuz[PLAYERS[idx].nick] = 3 + (k % 3); });
  nit.clenovia.forEach((idx, k) => { scoresNit[PLAYERS[idx].nick] = 2 + (k % 3); });
  const avg = o => Object.values(o).reduce((s, v) => s + v, 0) / Object.values(o).length;

  seed['senatSpory/demo-spor-01'] = {
    areaTitle: 'Osobné financie',
    questions: [],
    challenger: ruz.id,
    opponent: nit.id,
    createdAt: now - 4 * DAY,
    deadline: now - 2 * DAY,
    scores: { [ruz.id]: scoresRuz, [nit.id]: scoresNit },
    status: 'done',
    settling: true,
    winner: ruz.id,
    challengerAvg: avg(scoresRuz),
    opponentAvg: avg(scoresNit),
    demoSeed: true
  };

  /* --- školy s bodmi a aktívnymi hráčmi --- */
  SCHOOLS.forEach(id => {
    const hraci = PLAYERS.filter(p => p.skola === id);
    const players = {};
    hraci.forEach(p => { players[p.nick] = true; });
    seed[`faculties/${id}`] = {
      name: SCHOOL_NAMES[id],
      points: hraci.reduce((s, p) => s + Math.round(p.mince / 3), 0),
      activePlayers: hraci.length,
      players,
      demoSeed: true
    };
  });

  /* --- predznačené vyhodnotenia (viď hlavička) ---
     Značí sa dozadu aj DOPREDU: appka si vždy pýta PREDCHÁDZAJÚCE
     obdobie, takže s pribúdajúcimi týždňami vznikajú nové kľúče. */
  for (let w = -1; w <= 8; w++) {
    const k = weekKey(new Date(now + w * 7 * DAY));
    seed[`rewards/${k}/evaluated`] = true;
    seed[`senatRewards/${k}/evaluated`] = true;
  }
  for (let m = -1; m <= 3; m++) {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + m, 1);
    const k = monthKey(d);
    seed[`rewards/${k}/evaluated`] = true;
    seed[`senatRewards/${k}/evaluated`] = true;
    seed[`facultyRewards/${k}/evaluated`] = true;   // deštruktívne – toto je to hlavné
  }

  return seed;
}

/* Vetvy, ktoré reset zmaže pred nahratím seedu. */
/* ⚠️ 'analyticsDaily' tu ZÁMERNE NIE JE a pridávať sa nesmie: denné
   počty otvorení musia prežiť reset pred stretnutiami, inak by sa
   história využívania zakaždým stratila. Nie sú to údaje hráčov –
   je to jedno číslo na deň bez akéhokoľvek identifikátora
   (viď scripts/visits.js).

   Vetva 'analytics' zanikla 2026-10-05; dátumy prezývky žijú po novom
   v users/{nick}, ktorý sa maže aj tak. */
const WIPE_BRANCHES = [
  'users', 'duels', 'senaty', 'senatSpory', 'senatInvites',
  'faculties', 'reports'
];

module.exports = { buildSeed, WIPE_BRANCHES, weekKey, monthKey, PLAYERS, CLASSES };
