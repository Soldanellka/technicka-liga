'use strict';

/* ============================================================
   LEXARENA – EKONOMICKÁ KONFIGURÁCIA
   Jediný zdroj pravdy pre všetky čísla ekonomiky (§ + energia).
   Žiaden modul nesmie mať vlastné hardcodované ceny/odmeny –
   všetko sa číta odtiaľto (cez economy.js, prípadne priamo tu
   pre avatar.js – pozri poznámku nižšie).

   Prečo samostatný súbor a nie priamo v economy.js:
   economy.js interne importuje funkcie z avatar.js (aby UI
   ostalo synchronizované), a avatar.js zároveň potrebuje túto
   konfiguráciu (FEED_COST, STREAK, ...). Keby ECONOMY_CONFIG
   žil v economy.js, vznikol by cyklický import
   avatar.js ↔ economy.js. Tento súbor je list v strome importov
   (nič neimportuje z avatar.js/economy.js), takže cyklus nehrozí.
   economy.js re-exportuje ECONOMY_CONFIG, takže zvyšok appky
   naďalej importuje všetko len z economy.js.

   NÁVOD (#guideModal): VŠETKY ČÍSLA sa už čerpajú ODTIAĽTO za behu –
   § sumy aj energia. Elementy v #guideModal (index.html) nesú atribút
   data-econ s cestou do tohto configu (napr. "REWARDS.DUEL_WIN" alebo
   "ENERGY.DUEL") a fillGuideEconomyValues() v init.js ich doplní pri
   každom otvorení návodu – čísla teda netreba udržiavať ručne, nemôžu
   sa rozísť so správaním appky.
   Pozn.: znamienko (+/−) je autorské v HTML, z configu sa berie len
   veľkosť (Math.abs) – preto ENERGY.* môžu ostať záporné.
============================================================ */

import { ref, get, push }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ============================================================
   ZÁSADY EKONOMIKY v2 (2026-08) – ZAMKNUTÉ, nemeniť bez Babu.

   JEDNA BRÁNA = ENERGIA. Prístup k obsahu a k pomôckam riadi denná
   porcia energie, ktorá sa každý deň obnoví (ENERGY.DAILY_FULL) a je
   rovnaká pre všetkých. § riadia už len to, čo nie je súčasťou učenia.

   1. ŽIADNE PAY-TO-WIN. Za § sa NIKDY nekupuje výhoda v súťaži –
      ani v rebríčku, ani v dueli, ani v senátnom spore.
      Za § sa dá kúpiť UŽ LEN:
        – krmivo pre avatara (ENERGY.FEED_COST → doplní dennú porciu),
        – kozmetika (taláre, prestige avatari).
      Nič viac. Pravidlo je bez výnimky – posledná (poistka streaku za
      15 §) zanikla spolu so štítom.
      ⛔ Nikdy sem nepridávaj: kúpu § bonusu k skóre, kúpu miesta
      v rebríčku, kúpu druhého pokusu v dueli, platené okruhy, platené
      nápovedy ani poistky – čokoľvek, čo súvisí s hraním, stojí energiu.

   2. VSTUP DO HIER A POMÔCKY SA NEPLATIA §. Kvíz, kartičky, prípady,
      Štátnicová sieň, Nočný výcuc, nápoveda 50:50 aj žolíky bifľovačky
      stoja ENERGIU (ENERGY.*), nikdy §. Učenie nesmie byť za peniaze
      a kúpená nápoveda v dueli by bola priama súťažná výhoda.
      Nápoveda v štátnici si navyše sama zníži strop známky
      (HINT_GRADE_FLOOR) – dostáva sa pomoc, nie lepší výsledok.

   3. ODMENY ZA UČENIE SA NEZNIŽUJÚ. Bifľovačka (BIFLOVACKA_*),
      dashboard míľniky (DASHBOARD.*) a modulové odmeny sú jadro
      appky. Ekonomika sa vyvažuje energiou a denným stropom §, nikdy
      orezávaním toho, za čo sa hráč učí.
============================================================ */

/* Cenové tiery prestige avatarov – samostatná konštanta, aby na ňu mohol
   PRESTIGE_AVATAR_MIN nižšie ukázať (objektový literál sa sám na seba
   odkazovať nevie) a nemohli sa rozísť. */
const PRESTIGE_TIERS = [300, 600, 1000, 2000];

export const ECONOMY_CONFIG = {
  /* ENERGIA = DENNÁ PORCIA (model v2, 2026-08).
     Energia sa každý deň obnoví na DAILY_FULL – pre všetkých rovnako. Aktivity
     ju míňajú (ťažké veľa, ľahké málo); na nule avatar zaspí. Jediné doplnenie
     navyše je KŔMENIE za § (FEED_COST → FEED_TO), ktoré má len nick.

     Deň sa láme podľa todayKey() nižšie (UTC dátum) – ZÁMERNE ten istý pojem
     „dňa“, aký používa denný strop LIMITS.DAILY_EARN_CAP a adsWatched/
     spiderGamePlays. Streak (checkDailyLogin) má vlastné 24-hodinové okno,
     to sa tu nepoužíva.

     ⚠️ VŠETKY čísla nižšie sú NA DOLADENIE (ekonomická simulácia Babu).
     Náklady sú záporné, hranice a ceny kladné. */
  ENERGY: {
    MAX: 100,              // horná hranica energie (0–MAX), aj šírka energy baru v %
    DAILY_FULL: 100,       // na doladenie – denná porcia, na ktorú sa energia ráno obnoví
    SLEEP_AT: 0,           // pri tejto hodnote (a nižšej) avatar spí

    /* ⚠️ DEMO: ceny študijných aktivít sú ZÁMERNE 0. Zásada dema znie,
       že učenie sa nikdy neblokuje hernou mechanikou – nikto nesmie
       na prezentácii naraziť na „nemáš energiu“. Mechanika ostáva
       v kóde nedotknutá, len nič nestojí; obnovením pôvodných hodnôt
       (uvedených pri každom riadku) sa energia okamžite vráti do hry. */
    DUEL: 0,               // demo: 0 (pôvodne −5) – odohratý duel
                           //  (E5: pojednávanie sa energiou blokovať nebude → padne na 0)
    BIFLOVACKA_CARD: 0,    // demo: 0 (pôvodne −1) – za kartičku (učenie je jadro appky, netrestať –
                           //  50 kartičiek = polovica energie, nie celá)
    MEMORY_SET: 0,         // demo: 0 (pôvodne −2) – za dohranú sadu pexesa
    CASES_SET: 0,          // demo: 0 (pôvodne −4) – za dohranú sadu prípadov
    SPIDER_GAME: 0,        // demo: 0 (pôvodne −2) – za sedenie pavúkovej hry

    /* DRAHÉ AKTIVITY (E2, 2026-08) – nahradili § vstupné.
       Predtým: Štátnicová sieň 15 §, Nočný výcuc 33 §. Po novom nestoja §
       vôbec, len veľa energie – kto ich chce viac za deň, musí nakŕmiť
       avatara (§ za kŕmenie), nie kúpiť si vstup. Tým sa § z nich stráca
       ako priama „platba za obsah“ a ostáva len ako krmivo + kozmetika. */
    GREMIUM: 0,            // demo: 0 (pôvodne −60) – vstup do AI skúšky
    NIGHT_RECAP: 0,        // demo: 0 (pôvodne −60) – odomknutie Nočného výcucu

    /* POMÔCKY (E3, 2026-08) – nahradili § ceny.
       Predtým: 50:50 3 §, žolíky 3/2/1 §, video znova 2 §. Pomôcka je
       súčasť učenia, nie tovar – nesmie sa dať kúpiť za § (a v dueli by
       kúpená nápoveda bola priama súťažná výhoda, čo zásada 1 zakazuje).
       Náklady sú ZÁMERNE malé: pomôcka nesmie zožrať dennú porciu ako
       celá hra. Všetko na doladenie. */
    /* ⚠️ Jediná pomôcka, ktorá v deme ENERGIU STOJÍ. Nápoveda je výhoda
       v súboji, nie učenie – zadarmo by si ju hráč bral na každú otázku.
       Ostatné aktivity ostávajú na 0: učenie sa blokovať nesmie. */
    HINT_5050: -5,         // nápoveda 50:50 (pôvodná hodnota)
    JOKER_SKELETON: 0,     // demo: 0 (pôvodne −3) – žolík: kostra definície
    JOKER_INITIALS: 0,     // demo: 0 (pôvodne −2) – žolík: iniciály slov
    JOKER_REPLAY: 0,       // demo: 0 (pôvodne −1) – žolík: definícia znova
    JOKER_VIDEO: 0,        // demo: 0 (pôvodne −2) – žolík vo video režime

    FEED_COST: 20,         // § za nakŕmenie (E2: 12 → 20; kŕmenie je po novom
                           //  hlavný § sink, tak musí niesť váhu)
    FEED_TO: 100           // kŕmenie doplní na 100 %
  },

  // ODMENY §
  REWARDS: {
    DUEL_WIN: 7,
    DUEL_DRAW: 3,
    DUEL_LOSS: 0,          // pôvodne +1; pri +1 je duel VŽDY ziskový (20 duelov na plnú
                           //  energiu = min. +20§ vs. kŕmenie 12§) a § stráca hodnotu
    BIFLOVACKA_OKRUH: 2,   // NOVÉ: za dokončený okruh so skóre ≥ 80 % – priebežná motivácia
    BIFLOVACKA_AREA: 10,   // 100 % celej oblasti (pôvodný návrh zachovaný)
    MEMORY_PERFECT: 5,     // sada bez chyby
    CASES_SET: 5,          // dokončená sada
    CASES_PERFECT: 10,     // sada na 100 %
    CHALLENGE_NEW: 7,      // prijatie duel-linku novým nickom (zjednotiť s existujúcou logikou)
    CHALLENGE_EXISTING: 1,
    VIDEO: 12,             // odmena za náukové video – JEDNORAZOVO na video a nick
    QUIZ_PLAYED: 1,        // +1§ za dohraný študijný kvíz (quiz.js finishQuiz, BEZ skipCap – v dennom strope)
    REPORT_APPROVED: 2     // reportérovi za schválené nahlásenie otázky (index.html openVerdictModal,
                           // vetva decision === 'approved', vedľa awardSeal logiky; BEZ skipCap)
  },

  // STREAK – krivka so stropom (pôvodne 1–50§ lineárne; 50§/deň = 1500§/mesiac zadarmo
  //  → inflácia, balíky by nemali zmysel. Krivka so stropom drží hodnotu §.)
  STREAK: {
    BASE: [1, 2, 3, 4, 5, 6, 7],   // deň 1–7
    AFTER: 7,                      // deň 8+ = 7§/deň
    MILESTONES: { 7: 10, 30: 50 }  // bonus navyše v míľnikový deň
  },

  // REBRÍČKY
  LEADERBOARD: {
    WEEKLY:  [50, 30, 10],    // 1., 2., 3. miesto; vyhodnotiť po nedeli 24:00
    MONTHLY: [200, 100, 50]   // po poslednom dni mesiaca 24:00
  },

  // ROLE
  ROLES: {
    ADMIN_UNLIMITED: true,
    GARANT_DAILY_GRANT: 50    // koľko § môže garant rozdať denne
  },

  /* ANTI-ABUSE
     Strop 60§/deň ostáva, ale okruh výnimiek sa v1 ZÚŽIL. Obísť ho smú už
     len tri veci – všetko ostatné je opakovateľná aktivita a musí byť v strope:

       ✅ MIMO stropu (obchádza):
          – streak za prihlásenie (avatar.js checkDailyLogin – ide priamo
            cez awardParagrafy, econAward vôbec nevolá),
          – rebríčkové odmeny: LEADERBOARD.*, SENATY.LB_*, FACULTIES.*,
          – Štátnicová sieň: STATNICE.EXAM_REWARD + vrátenia vkladu.

       ⛔ V STROPE (po novom, predtým obchádzali):
          – senátne odmeny za spory a založenie: SENATY.SPOR_*,
            FOUND_COMPLETE, RECRUIT, JOIN_NEW_PLAYER,
          – dashboard míľniky: DASHBOARD.*,
          – videá návodov: REWARDS.VIDEO,
          – reklama: ADS.REWARD,
          – testy od garanta: ASSIGNMENTS.* (v strope už predtým),
          – schválené nahlásenia: REWARDS.REPORT_APPROVED (v strope už predtým).

     ⚠️ Jednorazové odmeny (video, dashboard míľnik, reklama) sa udeľujú s
     { allOrNothing: true } – buď sa zmestí celá suma, alebo sa nedá nič a
     nárok ostáva na zajtra. Bez toho by strop utrhol časť sľúbenej odmeny
     (napr. z 12§ za video len 5§) a UI by klamalo. Viď econAward v economy.js. */
  LIMITS: {
    DAILY_EARN_CAP: 60
  },

  /* SINKY – na čo sa dajú minúť §.
     Po E2+E3 a zrušení štítu streaku (2026-08) tu ostala UŽ LEN KOZMETIKA;
     kŕmenie avatara má vlastný kľúč ENERGY.FEED_COST. Všetko ostatné
     – vstupy do obsahu, pomôcky aj poistky – prešlo na energiu alebo
     zaniklo. */
  SINKS: {
    /* Prestige avatari – rad 300/600/1000/2000§ (PRESTIGE_TIERS hore).
       PRESTIGE_AVATAR_MIN je len prvý tier, drží sa ho odkazom, aby sa čísla
       nemohli rozísť; používa ho popis dlaždice „Čoskoro – od N§“. */
    PRESTIGE_AVATARS: PRESTIGE_TIERS,
    PRESTIGE_AVATAR_MIN: PRESTIGE_TIERS[0]

    /* ⛔ ZRUŠENÉ KĽÚČE – nepridávať späť.

       STREAK_SHIELD (15 §) – 2026-08. Poistka odpúšťajúca jeden vynechaný
       deň streaku. Bola to posledná § platba mimo krmiva a kozmetiky, takže
       zanikla aj s funkciou buyStreakShield() a vetvou v checkDailyLogin().
       Tlačidlo #buyStreakShieldBtn v HTML aj tak nikdy neexistovalo.
       Staré users/{nick}/streakShield sa už nikde nečíta – osirený kľúč
       je neškodný, migrácia netreba.

       NIGHT_RECAP_UNLOCK (33 §) – E2. Nočný výcuc gate-uje ENERGY.NIGHT_RECAP.

       QUIZ_ENTRY (5 §) – E3. Bola to „mŕtva hodnota“ so živým volajúcim:
       quiz.js:startQuiz() ju naozaj strhával, len tú funkciu nikto
       neimportoval (#startQuizBtn ide na startDuel). Vstup do bežných hier
       je zadarmo (zásada 2) – volanie aj kľúč sú preč, nech sa to nedá
       omylom zapojiť.

       QUIZ_HINT_5050 (3 §), BIFLOVACKA_JOKER_SKELETON (3 §),
       BIFLOVACKA_JOKER_INITIALS (2 §), BIFLOVACKA_JOKER_REPLAY (1 §),
       BIFLOVACKA_VIDEO_REPLAY (2 §) – E3. Pomôcky sa neplatia §, stoja
       energiu (ENERGY.HINT_5050 / JOKER_*).

       Kľúče sú ODSTRÁNENÉ, nie ponechané ako mŕtve hodnoty: pri chýbajúcom
       kľúči vypíše data-econ cesta pomlčku a zaloguje varovanie, takže
       prípadné zabudnuté miesto v HTML je hneď vidieť. */
  },

  /* SENÁTY – skupinová súťaž. V1: spory a založenie/nábor sú V STROPE,
     mimo stropu ostávajú už len senátne REBRÍČKY (LB_WEEKLY/LB_MONTHLY). */
  SENATY: {
    FOUND_COMPLETE: 10,   // predsedovi, keď senát dosiahne 3 členov
    RECRUIT: 5,           // pozývateľovi za každého člena po dokončení senátu (raz na člena)
    JOIN_NEW_PLAYER: 7,   // úplne nový nick, čo sa pridá cez senátny pozývací link
    SPOR_WIN: 15,         // každému členovi víťazného senátu v senátnom spore
    SPOR_DRAW: 6,         // každému členovi pri remíze
    SPOR_LOSS: 2,         // každému členovi prehrávajúceho senátu (útecha, nie 0)
    LB_WEEKLY: [40, 25, 10],   // každému členovi senátu na 1./2./3. mieste týždenného rebríčka
    LB_MONTHLY: [150, 80, 40] // rovnako, mesačný rebríček
  },

  // FAKULTY – tretia úroveň súťaže (skipCap: true pri econAward, mesačná udalosť)
  FACULTIES: {
    MONTHLY_BONUS: 20 // každému aktívnemu hráčovi víťaznej fakulty na konci mesiaca
  },

  // ŠTÁTNICOVÁ SIEŇ – prototyp (skipCap: true pri odmene, je to výkon, nie grind)
  STATNICE: {
    /* EXAM_COST (15 §) ZRUŠENÉ v E2 (2026-08). Vstup do siene sa neplatí §,
       gate-uje ho ENERGY.GREMIUM. Kľúč je odstránený zámerne – viď rovnaká
       poznámka pri NIGHT_RECAP_UNLOCK vyššie. ⛔ Nepridávať späť.
       Odmena za známku ostáva v § a naďalej obchádza denný strop. */
    EXAM_REWARD: { 1: 25, 2: 15, 3: 8, 4: 0 }, // podľa známky zo záverečnej spätnej väzby
    // Nápoveda JE NA ŽIADOSŤ ŠTUDENTA (tlačidlo), nikdy automaticky od komisie –
    // inak by voľba persóny nepriamo ovplyvňovala známku. Každá vyžiadaná
    // nápoveda ZNÍŽI najlepšiu dosiahnuteľnú známku (číslo horšie = nižšia
    // kvalita): index = celkový počet nápovied za skúšku (3+ nápovede → posledná
    // hodnota). Rovnaké pre všetky tri persóny, žiadna výnimka.
    HINT_GRADE_FLOOR: [1, 1, 2, 3], // 0 nápovied→max 1, 1→max 1 (prvá "zadarmo"),
                                    // 2→max 2, 3+→max 3 (zmiernenie round 1, 2026-08)

    // REKALIBRÁCIA HODNOTENIA (2026-07-17) – lokálny textový substitút
    // (evaluateCoverage v statnice.js) NEVIE posúdiť právnu SPRÁVNOSŤ ani
    // SÚVISLOSŤ odpovede, len prítomnosť kľúčových slov. Zámerne prísnejšie
    // než "na pohľad rozumné" hodnoty – falošné "si pripravený/á" tesne
    // pred reálnou štátnicou je horšie než príliš prísna miestna známka.
    POINT_COVERAGE_RATIO: 0.55,  // predtým 0.34 – bod je "pokrytý" až od
                                  // nadpolovičnej zhody jeho slov, nie tretiny
    TERMINOLOGY_WEIGHT: 0.20,    // zmiernenie round 1 (2026-08): 0.35 → 0.20 –
                                  // vysvetlenie vlastnými slovami bez pojmov
                                  // z tiles nemá stiahnuť inak dobrú odpoveď.
                                  // Invariant (anti-gaming) MUSÍ ďalej platiť:
                                  // pri nulovom obsahovom pokrytí (holé
                                  // vymenovanie pojmov bez súvislostí) skóre
                                  // 0*(1-0.20)+100*0.20=20 < 40 (prah známky 3
                                  // v GRADE_THRESHOLDS nižšie) – NIKDY
                                  // neprekročí pásmo "nedostatočné".
                                  // ⚠️ Váhu nestačí posudzovať samu: terminológia
                                  // vie zdvihnúť skóre až o 20 bodov, takže pri
                                  // contentCoverage 50 by sama dotiahla tému na
                                  // 60 = pásmo dvojky a obišla by strop V1.
                                  // Preto je v combineCoverage() (statnice.js)
                                  // poistka – pod prahom dvojky terminológia
                                  // tému do pásma dvojky nikdy neposunie.
                                  // Žiadne nové číslo: poistka číta hranicu
                                  // priamo z GRADE_THRESHOLDS nižšie.
    MIN_ANSWER_WORDS: 15,        // odpoveď kratšia než toto (počet slov za
                                  // JEDNU tému) nemôže dosiahnuť známku 1
                                  // ani 2 bez ohľadu na coverage skóre
    GRADE_THRESHOLDS: [          // avg coverage % → znamka (prvý vyhovujúci
                                  // riadok zhora, min je dolná hranica).
                                  // Zmiernenie round 1 (2026-08): 90/75/55 →
                                  // 80/60/40 – "skoro kompletná" odpoveď má
                                  // padnúť na 1/2, nie na 3.
      { min: 80, znamka: 1 },
      { min: 60, znamka: 2 },
      { min: 40, znamka: 3 },
      { min: 0,  znamka: 4 }
    ],

    // ZMIEŠANÝ VÝBER OKRUHOV (2026-07-18) – "na precvičenie" (slabé <80 %) +
    // "zmiešaný" (prevažne silné ≥80 %, občas nedotknuté 0 %) namiesto
    // dnešného čisto náhodného ťahania. Poistka nováčika: ak má študent v
    // danej oblasti/bazéne menej než toto číslo okruhov s progresom > 0 %,
    // niet z čoho robiť "dôraz na slabé" (a samé 0 % okruhy by boli
    // demotivujúce) – použije sa dnešný čisto náhodný výber.
    MIXED_SELECTION_MIN_STUDIED: 3
  },

  // OSOBNÝ PREHĽAD PROGRESU – Fáza 3 (dashboard). Jednorazové odmeny.
  // ⚠️ V1 (2026-08): míľniky sú PO NOVOM V LIMITS.DAILY_EARN_CAP – pôvodná
  // Cesta B im dávala { skipCap: true }, ten je preč. Jednorazovosť sa naďalej
  // vynucuje cez users/{nick}/dashboardRewards/... flag zapísaný AŽ PO úspešnom
  // econAward, takže míľnik dosiahnutý pri plnom strope sa udelí neskôr, nestratí sa.
  DASHBOARD: {
    // MEDZIMEDAILY (2026-07-18) – proti "dlhému tichu" medzi 0 a 80 %,
    // motivujú priebežne. Malé sumy zámerne (nefarmovateľné jednorazovky,
    // ale netreba ich robiť rovnocenné s TEMA_80).
    TEMA_30: 1,      // prvý raz, čo téma (okruh) dosiahne priemer ≥ 30 %
    TEMA_50: 2,      // prvý raz, čo téma (okruh) dosiahne priemer ≥ 50 %
    TEMA_80: 5,      // prvý raz, čo téma (okruh) dosiahne priemer ≥ 80 %
    OBLAST_100: 50   // prvý raz, čo VŠETKY témy oblasti dosiahnu 100 %
  },

  // AKADEMICKÁ VRSTVA – KROK 2: testy pre skupinu (garant zadá, študent píše
  // raz). Odmena sa udeľuje JEDNORAZOVO cez econAward() BEZ skipCap – teda
  // počíta sa do existujúceho denného stropu LIMITS.DAILY_EARN_CAP, presne
  // ako bežná hra (rozdiel od SENATY/FACULTIES/STATNICE, ktoré cap obchádzajú
  // ako výnimočné udalosti – test je opakovateľná aktivita garanta, preto
  // musí ostať v strope, inak by šlo o nekonečný zdroj §).
  ASSIGNMENTS: {
    REWARD_BY_PCT: [
      { min: 90, reward: 15 },
      { min: 70, reward: 10 },
      { min: 50, reward: 5 },
      { min: 0,  reward: 2 }   // účasť sa oplatí odovzdať aj pri neúspechu, nie 0§
    ]
  },

  // TALÁRE – čisto kozmetické kúpy avatara (scripts/avatar.js AVATAR_CONFIG.AVATARS,
  // unlock:'talar_purchase'). Akademický talár (unlock:'talar_role') sa NIKDY
  // nekupuje – tu zámerne nemá cenu, priraďuje sa len podľa skutočnej Firebase
  // roly (users/{nick}/role === 'garant'|'admin'), viď scripts/avatar.js.
  /* SEZÓNNE ROZŠÍRENIE – obchod je plne dátový, žiadna logika sa nemení.
     getTalarShopEntries() (scripts/avatar.js) iteruje AVATAR_CONFIG.AVATARS a
     berie všetko s unlock:'talar_purchase' pre AKTUÁLNY základný avatar; cenu
     číta z položky (`talarPrice`), nie zo zoznamu tu. Pridanie novej sezónnej
     položky sú preto tri dátové kroky:
       1. sem doplniť cenu novým kľúčom (napr. `ZIMNY: 400`),
       2. do AVATAR_CONFIG.AVATARS pridať položku(-y) s unlock:'talar_purchase',
          talarBaseId (ku ktorému zo 6 základných avatarov patrí), talarRole
          a talarPrice: ECONOMY_CONFIG.TALARE.ZIMNY,
       3. nahrať 6 PNG na cestu z `base` (full/tired/sleep + -bust varianty).
     Kým grafika nie je nahratá, nechaj položku s `hidden: true` – v obchode
     sa neukáže a nedá kúpiť. Ceny v1 ostávajú nezmenené (200–1000§). */
  TALARE: {
    CIERNY: 200,      // ⚫ základný talár
    ADVOKAT: 500,     // 🔵 advokátsky talár
    PROKURATOR: 700,  // 🔴 prokurátorský talár
    SUDCA: 1000       // ⚖️ sudcovský talár
  },

  // MONETIZÁCIA – pripraviť, NEZOBRAZOVAŤ v UI
  PACKS: {
    small:  { sg: 100, eur: 1.99 },
    medium: { sg: 300, eur: 4.99 },
    big:    { sg: 800, eur: 9.99 }
  },
  ADS: {
    ENABLED: true,            // "Získaj §" – zatiaľ placeholder videami, nie skutočným SDK
    REWARD: 3,                // § za pozretie odmeňovanej reklamy (rewarded ad)
    DAILY_MAX: 2              // v1: 3 → 2 (max +6§/deň); reklama je navyše po novom
                              //  V DENNOM STROPE, takže to nie je obchádzka
  },

  // PAVÚKOVÉ HRY (Etapa 2) – § len za VÝSLEDOK celého sedenia, cez econAward
  // BEZ skipCap (v dennom strope 60§). Recall a Blesk sa NEODMEŇUJÚ (nie sú tu).
  // Odmena sa vyhodnocuje z prahov REWARDS[gameId] (prvý vyhovujúci zhora podľa
  // score >= min); pod najnižší prah = 0§ (zero_score, nemíňa počítadlá).
  // Doplnkový zdroj: max ~7§/deň (3 sedenia á 2–3§), pod úrovňou duelov/kartičiek.
  SPIDER_GAMES: {
    DAILY_MAX_SESSIONS: 3,        // spoločný strop ODMENENÝCH sedení/deň za všetky tri hry
    REWARDS: {
      kukucka:      [ { min: 5,  sg: 2 }, { min: 4, sg: 1 } ],  // skóre z 5 (correctFirstTry)
      rozparovanie: [ { min: 5,  sg: 3 }, { min: 4, sg: 1 } ],  // skóre z 5 (cleanRounds)
      kdesom:       [ { min: 10, sg: 2 }, { min: 8, sg: 1 } ]   // skóre z 10 (score)
    }
  }
};

/* ============================================================
   DEŇ – jediná definícia pre celú ekonomiku.
   UTC dátum (YYYY-MM-DD). Používa ho denný strop § (dailyEarned),
   adsWatched, dailyGrant, spiderGamePlays a po novom aj denný reset
   energie (avatar.js). Kým je definícia jedna, nemôžu sa tieto veci
   rozísť a resetovať sa v rôznych okamihoch.
   ⚠️ Pre SK sa deň láme o 02:00 miestneho času (UTC+2 v lete) – je to
   existujúca vlastnosť stropu, ponechaná zámerne. Prípadný prechod na
   lokálny dátum je samostatné rozhodnutie a zmenil by aj strop 60§.
============================================================ */
export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/* ============================================================
   ROLA HRÁČA – vždy zo skutočného Firebase záznamu
   (nie z lokálneho "view" prepínača v localStorage, ten slúži
   len na náhľad UI iných rolí a dal by sa zneužiť na obídenie
   ekonomiky).
============================================================ */
export async function getRole(nick) {
  const db = window.db;
  if (!db || !nick) return 'student';
  try {
    const snap = await get(ref(db, `users/${nick}/role`));
    return snap.exists() ? snap.val() : 'student';
  } catch (e) {
    console.warn('economyConfig: čítanie role zlyhalo', e);
    return 'student';
  }
}

/* ============================================================
   TRANSAKČNÝ LOG – audit aj podklad pre budúcu monetizáciu.
   users/{nick}/transactions (push): { ts, type, amount, reason, balanceAfter }
============================================================ */
export async function logTransaction(nick, entry) {
  const db = window.db;
  if (!db || !nick) return;
  try {
    await push(ref(db, `users/${nick}/transactions`), { ts: Date.now(), ...entry });
  } catch (e) {
    console.warn('economyConfig: zápis transakcie zlyhal', e);
  }
}
