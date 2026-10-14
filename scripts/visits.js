'use strict';

/* ============================================================
   scripts/visits.js
   Počítanie otvorení aplikácie — agregovane, bez identifikátora.

   ČO SA POČÍTA: koľkokrát sa aplikácia za deň otvorila. Nič viac.
   Zapisuje sa jedno číslo do analyticsDaily/{YYYY-MM-DD}/visits.

   ČO SA NEROBÍ (a prečo je to celý zmysel tohto modulu):
   - do zariadenia sa NEUKLADÁ nič: žiadne localStorage, žiadne
     sessionStorage, žiadna cookie, žiadny identifikátor návštevy,
   - NEROZLIŠUJE sa nový a vracajúci sa návštevník,
   - číslo sa NESPÁJA s prezývkou ani s IP adresou.

   PREČO TAK. Uloženie a spätné prečítanie údaja v zariadení
   používateľa vyžaduje súhlas (ePrivacy, u nás § 109 ods. 8 zákona
   o elektronických komunikáciách), ak nie je nevyhnutné pre službu.
   Štatistika nevyhnutná nie je. Otázku „je tento návštevník nový?“
   pritom NEJDE zodpovedať bez toho, aby si appka prehliadač označila
   a pri ďalšej návšteve tú značku prečítala — tým by si súhlas
   vypýtať musela. Samotné pripočítanie jednotky na serveri žiadnu
   pamäť v zariadení nepotrebuje, takže súhlas nepotrebuje ani ono.

   Zásady ochrany súkromia (bod 9, odsek „Počítanie návštev“) sľubujú
   presne toto. Čo je tu, musí sedieť s tým.

   ⚠️ REŽIM S IDENTIFIKÁTOROM je pripravený v REZIM_S_IDENTIFIKATOROM
   nižšie, ale je VYPNUTÝ. Zapnúť ho smie až rozhodnutie advokáta
   SPOLU so súhlasovou lištou — bez nej by bol protiprávny a Zásady
   by prestali sedieť. Viď poznámku pri konštante.

   Beží na pozadí a nikdy neblokuje UI — zlyhanie ide len do konzoly.
============================================================ */

import { ref, runTransaction }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ⚠️ NEZAPÍNAŤ bez súhlasovej lišty a bez pokynu majiteľky.
   true = režim s identifikátorom (nový vs. vracajúci sa), ktorý
   ukladá značku do zariadenia, a teda VYŽADUJE súhlas používateľa.
   Návrh lišty je v README-DEMO.md, sekcia „Počítanie návštev“. */
const REZIM_S_IDENTIFIKATOROM = false;

/* Deň sa láme podľa UTC — rovnaký pojem „dňa“ ako todayKey()
   v scripts/economyConfig.js a todayKeyUTC() v api/_dailyLimit.js,
   aby sa klient a server nerozišli v tom, kedy sa deň mení. */
function denKey() {
  return new Date().toISOString().slice(0, 10);
}

/* Zavolaj raz pri štarte appky. Nepotrebuje prezývku — a zámerne ju
   ani neberie, aby sa číslo nedalo s nikým spojiť. */
export async function zapocitajOtvorenie() {
  try {
    const db = window.db || null;
    if (!db) return;

    if (REZIM_S_IDENTIFIKATOROM) {
      console.warn('⚠️ visits: režim s identifikátorom je zapnutý, ale nie je implementovaný – ' +
        'bez súhlasovej lišty sa zapínať nesmie. Počítam agregovane.');
    }

    /* Transakcia, nie update: stránku otvára viacero ľudí naraz
       a prosté čítanie + zápis by si navzájom prepísali.
       Rovnaký vzor ako settlePeriod v scripts/economy.js. */
    await runTransaction(ref(db, `analyticsDaily/${denKey()}/visits`), (cur) => (cur || 0) + 1);
  } catch (e) {
    console.warn('⚠️ visits: počítadlo otvorení zlyhalo', e);
  }
}

/* ============================================================
   ADMIN PREHĽAD — denné počty za posledných 30 dní.
   Jedno čítanie analyticsDaily/*, žiadne čítanie per hráč.
============================================================ */
export async function nacitajPrehladNavstev(dni = 30) {
  const db = window.db || null;
  if (!db) return null;

  const { get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const snap = await get(ref(db, 'analyticsDaily'));
  const daily = snap.exists() ? snap.val() : {};

  const rad = [];
  for (let i = dni - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    const zaznam = daily[k];
    /* Staršie dni z pôvodného merania mali okrem visits aj newUsers
       a returningUsers. Tie sú preč; čítame výhradne visits. */
    const visits = (zaznam && typeof zaznam.visits === 'number') ? zaznam.visits : 0;
    rad.push({ den: k, otvorenia: visits });
  }

  const spolu = rad.reduce((s, x) => s + x.otvorenia, 0);
  const dnes = rad.length ? rad[rad.length - 1].otvorenia : 0;
  const poslednych7 = rad.slice(-7).reduce((s, x) => s + x.otvorenia, 0);

  return { rad, spolu, dnes, poslednych7, dni };
}
