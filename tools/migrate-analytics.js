'use strict';

/* ============================================================
   tools/migrate-analytics.js
   JEDNORAZOVÁ migrácia, spustená 2026-10-05. Tu je kvôli záznamu,
   čo presne sa s databázou spravilo – znova ju spúšťať netreba
   a po zmazaní vetvy analytics/ už ani nemá čo robiť.

   ČO ROBILA. Vetva analytics/ merala návštevnosť a na rozlíšenie
   „nový vs. vracajúci sa návštevník“ potrebovala identifikátor
   relácie v zariadení. Z nej sa zachovali LEN dve časové pečiatky:

     analytics/{nick}/firstSeen  →  users/{nick}/createdAt
     analytics/{nick}/lastSeen   →  users/{nick}/lastActiveAt

   visitCount ani days:{} sa NEMIGROVALI – zmazali sa spolu so
   zvyškom vetvy. Rovnako analyticsDaily/ (denné súhrny návštev).

   AKO SA SPÚŠŤALA. V konzole prehliadača na nasadenej stránke, kde
   window.db už žije – appka nemá Firebase Auth a klient píše priamo.
   Service account ani env premenné teda netreba.

   ⚠️ Vetvu nejde zmazať jedným zápisom: database.rules.json povoľuje
   zápis až od DRUHEJ úrovne (anti-wipe), takže set(/analytics, null)
   Rules zamietnu. Preto sa maže dieťa po dieťati.

   VÝSLEDOK BEHU: 9 prezývok prenesených (z toho 1 bez uzla users/,
   ktorý vznikol), 9 uzlov analytics/ a 16 dní analyticsDaily/
   zmazaných. Overené porovnaním oboch polí pred mazaním.
============================================================ */

/* eslint-disable no-undef */
async function migrujAnalytics() {
  const m = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  const db = window.db;

  const aSnap = await m.get(m.ref(db, 'analytics'));
  const A = aSnap.val() || {};
  const log = [];

  for (const nick of Object.keys(A)) {
    const z = A[nick] || {};
    if (typeof z.firstSeen !== 'number' || typeof z.lastSeen !== 'number') {
      log.push({ nick, stav: 'preskočené – chybné dátumy' });
      continue;
    }

    const uSnap = await m.get(m.ref(db, `users/${nick}`));
    const u = uSnap.exists() ? uSnap.val() : null;

    /* Keď už hodnoty existujú, berie sa skorší vznik a neskoršia
       aktivita – migrácia nesmie údaje posunúť, len doplniť. */
    const created = (typeof u?.createdAt === 'number')
      ? Math.min(u.createdAt, z.firstSeen) : z.firstSeen;
    const active = (typeof u?.lastActiveAt === 'number')
      ? Math.max(u.lastActiveAt, z.lastSeen) : z.lastSeen;

    await m.update(m.ref(db, `users/${nick}`), { createdAt: created, lastActiveAt: active });
    log.push({ nick, novyUzol: !u, createdAt: created, lastActiveAt: active });
  }

  console.table(log);
  return log;
}

/* Spúšťať AŽ po overení, že migrácia vyššie sedí. */
async function zmazAnalytics() {
  const m = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  const db = window.db;

  const [aSnap, dSnap] = await Promise.all([
    m.get(m.ref(db, 'analytics')),
    m.get(m.ref(db, 'analyticsDaily'))
  ]);

  const nicks = Object.keys(aSnap.val() || {});
  const dni = Object.keys(dSnap.val() || {});

  for (const n of nicks) await m.remove(m.ref(db, `analytics/${n}`));
  for (const d of dni) await m.remove(m.ref(db, `analyticsDaily/${d}`));

  return { zmazanychNickov: nicks.length, zmazanychDni: dni.length };
}
