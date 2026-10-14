'use strict';

/* ============================================================
   ANON SESSION – hráč bez nicku (A1, 2026-08)

   LexArena je „anon-first": celý tréning musí ísť aj bez nicku a nick
   sa pýta až vtedy, keď ho niečo naozaj potrebuje (uloženie, súťaž, §).
   Tento modul drží to jediné, čo anonym potrebuje mať vlastné –
   IDENTITU sedenia a DENNÚ PORCIU ENERGIE.

   ⚠️ ČISTO localStorage. Žiadny Firebase, žiadny Firebase Auth (ten
   príde v samostatnej Auth fáze). Vymazanie úložiska anon sedenie
   resetuje – to je prijateľné, anonym je nezáväzný.

   ⚠️ ANONYM SA NIKDY NEZAPISUJE AKO NICK. Nikde nevzniká reťazec
   „Anonymous"/„Unknown" ako identita – anonym buď nemá čo zapísať,
   alebo sa použije anonId, ktorý je zámerne mimo priestoru nickov
   (prefix „anon_"). Do users/{nick} sa anonym nedostane vôbec.

   ⚠️ anonId NIE JE fingerprint. Je to náhodné číslo vygenerované na
   tomto zariadení; neidentifikuje osobu a nedá sa spojiť s ničím mimo
   tohto prehliadača. Slúži len na to, aby sa dala v analytike (A7)
   odlíšiť jedna anonymná cesta od druhej a neskôr spojiť s nickom,
   ktorý si z nej hráč prípadne spraví.

   ENERGIA je zrkadlom nick modelu z E1 (avatar.js):
     – rovnaká denná porcia ECONOMY_CONFIG.ENERGY.DAILY_FULL,
     – rovnaký pojem „dňa" – todayKey() z economyConfig (UTC),
     – rovnaký lazy reset pri prvom čítaní v novom dni,
     – reset NIKDY neznižuje: max(aktuálna, DAILY_FULL).
   Vďaka tomu sa nick a anonym nemôžu rozísť v tom, kedy sa deň láme.

   Kŕmenie anonym NEMÁ – to stojí §, ktoré sa dajú získať len s nickom.
   Keď mu porcia dôjde, príde prompt „sprav si nick" (A5) alebo počká
   do zajtra. To je celý zmysel modelu.

   ⚠️ FAIL-SOFT PRI NEDOSTUPNOM ÚLOŽISKU. V Safari v súkromnom režime
   (a pri zablokovaných cookies) localStorage HÁDŽE výnimku už pri
   čítaní. Každá funkcia nižšie to znesie a vráti bezpečný default –
   pri energii plnú porciu. Dôsledok: v takom prehliadači sa energia
   neodpočítava a anonym hrá bez limitu. Je to vedomá voľba: radšej
   nechať človeka učiť sa než mu appku zablokovať kvôli nastaveniu
   prehliadača. Nick tým dotknutý nie je – ten má energiu vo Firebase.
============================================================ */

import { ECONOMY_CONFIG, todayKey } from './economyConfig.js';

const LS_ID     = 'lex_anon_id';
const LS_ENERGY = 'lex_anon_energy';
const LS_DAY    = 'lex_anon_energy_day';

/* Anonym = na tomto zariadení nie je uložený nick. Jediná definícia
   v celej appke – ostatné moduly sa pýtajú sem, nie na localStorage.

   try/catch nie je paranoja: v Safari v súkromnom režime (a pri
   zablokovaných cookies) localStorage.getItem HODÍ výnimku. Bez neho
   by pád vytiahol celé updateAvatarUI() a rozbil vykreslenie avatara
   každému takému návštevníkovi. Fail-soft = tvárime sa ako anonym,
   čo je pri nedostupnom úložisku aj pravda. */
export function isAnon() {
  try {
    return !localStorage.getItem('playerNick');
  } catch (e) {
    return true;
  }
}

/* ============================================================
   IDENTITA SEDENIA
   Lazy: vznikne až pri prvom vyžiadaní, nie pri načítaní modulu –
   návštevník, ktorý nič nespraví, nemá dôvod dostať id.
============================================================ */
export function getAnonId() {
  let id = null;
  try { id = localStorage.getItem(LS_ID); } catch (e) { return null; }
  if (id) return id;

  /* crypto.randomUUID nie je na starších iOS Safari; fallback je
     dostatočný – id musí byť len unikátne v rámci prehliadača. */
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  id = `anon_${rand}`;

  try { localStorage.setItem(LS_ID, id); } catch (e) { return null; }
  return id;
}

/* ============================================================
   ENERGIA
============================================================ */
function readNumber(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch (e) { return null; }
}

function writeEnergy(value, day) {
  try {
    localStorage.setItem(LS_ENERGY, String(value));
    localStorage.setItem(LS_DAY, day);
  } catch (e) { /* plné/zakázané úložisko – energia ostane len v pamäti tohto načítania */ }
}

/* Aktuálna energia anonyma, s lazy denným resetom.
   Presne tá istá logika ako applyDailyEnergyReset() v avatar.js:
   pri zmene dňa sa doplní na dennú porciu a nikdy sa neznižuje. */
export function getAnonEnergy() {
  const full = ECONOMY_CONFIG.ENERGY.DAILY_FULL;
  const today = todayKey();

  let day = null;
  try { day = localStorage.getItem(LS_DAY); } catch (e) { return full; }

  const stored = readNumber(LS_ENERGY);

  // Prvý raz na tomto zariadení, alebo nový deň → plná porcia.
  if (day !== today || stored === null) {
    const fresh = Math.max(stored ?? 0, full);
    writeEnergy(fresh, today);
    return fresh;
  }

  return Math.max(0, Math.min(stored, ECONOMY_CONFIG.ENERGY.MAX));
}

/* Odpočíta energiu a vráti novú hodnotu. Nikdy nejde pod 0 – rovnako
   ako deductEnergy() pri nickovi. Volá sa cez getAnonEnergy(), takže
   pri prvej aktivite v novom dni sa najprv uplatní reset. */
export function spendAnonEnergy(amount) {
  const current = getAnonEnergy();
  const next = Math.max(0, current - Math.abs(Number(amount) || 0));
  writeEnergy(next, todayKey());
  return next;
}

/* Zahodí anon energiu pri vzniku nicku (A2).
   ZÁMERNE sa NEPRENÁŠA: prenos by sa dal farmiť – minúť porciu ako
   anonym, spraviť nick a dostať druhú (a to opakovane cez vymazanie
   úložiska). Nick začína s plnou dennou porciou, progres sa migruje,
   energia nie. anonId sa NEMAŽE – A7 ho potrebuje na spojenie
   anonymnej cesty s novým nickom. */
export function clearAnonEnergy() {
  try {
    localStorage.removeItem(LS_ENERGY);
    localStorage.removeItem(LS_DAY);
  } catch (e) { /* nič – najhoršie ostane osirená hodnota, ktorú nikto nečíta */ }
}
