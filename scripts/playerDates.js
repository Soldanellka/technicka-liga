'use strict';

/* ============================================================
   scripts/playerDates.js
   Dátum vzniku prezývky a dátum jej poslednej aktivity.

   Nahradil scripts/analytics.js (zrušený 2026-10-05). Ten počítal
   návštevy a rozlišoval „nový vs. vracajúci sa návštevník“, na čo
   potreboval identifikátor relácie v zariadení (sessionStorage).
   Ukladanie do zariadenia, ktoré nie je nevyhnutné pre fungovanie
   služby, vyžaduje súhlas – a tomu sa appka vyhýba.

   Tento modul preto NEMÁ:
   - žiadne úložisko v zariadení (localStorage, sessionStorage, cookie),
   - žiadny identifikátor návštevníka ani odtlačok prehliadača,
   - žiadne počítadlo návštev ani zoznam dní,
   - žiadne rozlišovanie nového a vracajúceho sa návštevníka.

   Zapisuje VÝHRADNE dve časové pečiatky pod prezývku, ktorú si hráč
   sám zvolil:
     users/{nick}/createdAt     – prvé prihlásenie prezývky (zapíše sa raz)
     users/{nick}/lastActiveAt  – posledná aktivita (prepisuje sa)

   Bez identifikátora relácie sa lastActiveAt zapíše pri každom načítaní
   stránky, nie raz za 30 minút. Je to jeden malý zápis navyše a stojí
   za to: okno relácie sa bez úložiska v zariadení udržať nedá.

   Beží na pozadí a nikdy neblokuje UI – zlyhanie ide len do konzoly.
============================================================ */

import { ref, get, update }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* Zavolaj raz po zistení prezývky pri štarte appky. Nič nevracia. */
export async function touchPlayerDates(nick) {
  try {
    if (!nick) return;
    const db = window.db || null;
    if (!db) return;

    const now = Date.now();
    const zmeny = { lastActiveAt: now };

    /* createdAt sa nastaví len vtedy, keď ešte nie je – prepísanie by
       zo starého hráča spravilo nového a skreslilo prehľad. */
    const snap = await get(ref(db, `users/${nick}/createdAt`));
    if (!snap.exists() || typeof snap.val() !== 'number') {
      zmeny.createdAt = now;
    }

    await update(ref(db, `users/${nick}`), zmeny);
  } catch (e) {
    console.warn('⚠️ playerDates: zápis dátumov zlyhal', e);
  }
}
