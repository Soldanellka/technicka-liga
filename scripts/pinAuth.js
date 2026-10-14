'use strict';

/* ============================================================
   scripts/pinAuth.js
   PIN logika pre prenos účtu medzi zariadeniami (Fáza 1, 2026-07-19).
   Appka nemá skutočné prihlasovanie (žiadny Firebase Auth) – identita
   je nick v localStorage. PIN chráni PRIVLASTNENIE nicku pri prenose na
   iné zariadenie, NIE surový prístup k databáze (database.rules.json
   ostáva zámerne otvorené – iná téma, appka nemá citlivé dáta).

   ⚠️ Nesolený SHA-256 krátkeho číselného PIN-u (4-6 číslic, max ~1M
   kombinácií) by bol proti niekomu s prístupom k DB triviálne
   prelomiteľný cez JEDNU dúhovú tabuľku platnú naprieč VŠETKÝMI účtami
   naraz (rovnaký PIN = rovnaký hash u každého). Per-účet soľ
   (users/{nick}/pinSalt) toto nerieši dokonale (stále len 4-6 číslic –
   pri znalosti soli je brute-force jedného účtu stále rýchly), ale
   zabraňuje ZDIEĽANEJ dúhovej tabuľke – dvaja hráči s rovnakým PIN-om
   (napr. obaja "1234") dostanú KAŽDÝ inú soľ, teda iný výsledný hash;
   nikto nevidí "aha, tento hash sa opakuje, to je 1234". Primeraná
   úroveň pre appku bez citlivých dát, nie kryptograficky nedobytná.

   ⚠️ PIN sa NEDÁ OBNOVIŤ – appka nemá e-mail ani inú kontaktnú cestu.
   Jediná "záchrana" pri zabudnutí je zmena PIN-u na PÔVODNOM zariadení
   (nick už je v localStorage = dôkaz identity) – setPin() nižšie preto
   zámerne NEOVERUJE starý PIN, o to sa musí postarať volajúci (UI smie
   ponúknuť zmenu PIN-u len v kontexte vlastného zariadenia, nikdy pri
   cudzom prihlásení cez iný nick).
============================================================ */

import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { isDeletedPlayer } from './deletedPlayer.js';

function getDb() { return window.db || null; }

export function isValidPin(pin) {
  return /^\d{4,6}$/.test(pin || '');
}

/* ============================================================
   VALIDÁCIA TVARU NICKU (A2a, 2026-08)

   ⚠️ PLATÍ LEN PRI VZNIKU NOVÉHO NICKU. Pri načítaní uloženého nicku
   z localStorage sa NESMIE volať – v databáze sú nicky z čias, keď
   validácia neexistovala (dlhé, s bodkou, s lomkou). Prevalidovať ich
   pri štarte by znamenalo vyhodiť existujúcich ľudí z ich vlastných
   účtov. Load cesta (app.js `savedNick`, init.js `initNick`) preto
   ide okolo tejto funkcie a nikdy sa nemení.

   Prečo vôbec: nick ide PRIAMO do Firebase RTDB cesty (users/{nick},
   leaderboard/{nick}, duels/{id}/challengeClaimed/{nick}).
   RTDB kľúč nesmie obsahovať . # $ [ ] / – nick „Ján.Novák" alebo „a/b"
   dnes spôsobí výnimku pri prvom zápise. progressTracking.js si nick
   síce sanitizuje, ale ako jediný, takže by progres skončil pod iným
   kľúčom než zvyšok účtu – nekonzistencia horšia než čistá chyba.

   Prefix „anon_" je vyhradený pre anonId (scripts/anonSession.js).
   Nick z toho priestoru by sa v analytike tváril ako anonymné sedenie.

   Vracia { ok: true } alebo { ok: false, reason: <text pre používateľa> }.
============================================================ */
export const NICK_MIN_LENGTH = 2;
export const NICK_MAX_LENGTH = 20;

/* Presne tie znaky, ktoré Firebase RTDB v kľúči nepovoľuje. Medzery,
   diakritika ani pomlčky sem ZÁMERNE nepatria – „Jana Nováková" je
   legitímny nick a zakazovať ho by bolo trenie bez dôvodu. */
const NICK_FORBIDDEN = /[.#$/[\]]/;
/* RTDB nepovoľuje ani riadiace znaky (0–31, 127). */
const NICK_CONTROL = /[\u0000-\u001F\u007F]/;

export function isValidNick(nick) {
  const value = String(nick ?? '').trim();

  if (value.length < NICK_MIN_LENGTH) {
    return { ok: false, reason: `Nick musí mať aspoň ${NICK_MIN_LENGTH} znaky.` };
  }
  if (value.length > NICK_MAX_LENGTH) {
    return { ok: false, reason: `Nick môže mať najviac ${NICK_MAX_LENGTH} znakov.` };
  }
  if (NICK_FORBIDDEN.test(value) || NICK_CONTROL.test(value)) {
    return { ok: false, reason: 'Nick nesmie obsahovať znaky . # $ / [ ]' };
  }
  if (/^anon_/i.test(value)) {
    return { ok: false, reason: 'Nick nesmie začínať na „anon_" – tento tvar je vyhradený.' };
  }
  /* Náhradné meno zmazaného hráča je vyhradené – inak by sa zaň dalo
     vydávať a v súbojoch by nebolo poznať, ktorý záznam je po výmaze. */
  if (isDeletedPlayer(value)) {
    return { ok: false, reason: 'Tento nick je vyhradený – zvoľ si iný.' };
  }
  return { ok: true };
}

/* crypto.subtle vyžaduje secure context (HTTPS alebo localhost) – chýba
   napr. na file:// alebo vo veľmi starom prehliadači. Zámerne ŽIADNY
   fallback na slabší/nesolený hash – radšej jasná chyba volajúcemu,
   než ticho uložiť PIN nebezpečným spôsobom. */
export function isPinHashingAvailable() {
  return !!(window.crypto && window.crypto.subtle);
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* 16 bajtov náhodnosti (32 hex znakov) – viac než dosť na to, aby
   nemalo zmysel budovať zdieľanú dúhovú tabuľku; samotný PIN priestor
   (4-6 číslic) ostáva úzke hrdlo, soľ rieši len "zdieľané" lámanie. */
function generateSalt() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
  return sha256Hex(`${salt}:${pin}`);
}

/* Nastaví/zmení PIN pre daný nick. Vygeneruje NOVÚ soľ pri každom
   volaní (aj pri zmene existujúceho PIN-u) – jednoduchšie než
   znovupoužívať starú soľ, a nemá to žiadnu nevýhodu. */
export async function setPin(nick, pin) {
  if (!isValidPin(pin)) throw new Error('PIN musí mať 4 až 6 číslic.');
  if (!isPinHashingAvailable()) throw new Error('Tento prehliadač nepodporuje bezpečné hashovanie PIN-u (crypto.subtle nie je dostupné – over, že appka beží cez HTTPS alebo localhost).');
  const db = getDb();
  if (!db || !nick) throw new Error('Chýba pripojenie k databáze alebo nick.');

  const salt = generateSalt();
  const hash = await hashPin(pin, salt);
  await set(ref(db, `users/${nick}/pin`), hash);
  await set(ref(db, `users/${nick}/pinSalt`), salt);
}

/* Pre UI (modal "Môj účet") aj pre claimNick() vo Fáze 2 – zisti, či
   daný nick už má nastavený PIN, bez toho, aby sa čokoľvek menilo. */
export async function getPinStatus(nick) {
  const db = getDb();
  if (!db || !nick) return { hasPin: false };
  try {
    const snap = await get(ref(db, `users/${nick}/pin`));
    return { hasPin: snap.exists() && !!snap.val() };
  } catch (e) {
    console.warn('⚠️ pinAuth: getPinStatus zlyhalo', e);
    return { hasPin: false };
  }
}

/* ============================================================
   claimNick() – Fáza 2 (2026-07-20). Vyhodnotí pokus o "prihlásenie sa"
   daným nickom (+ voliteľný PIN pokus). Použité v saveNick (app.js,
   hlavné pole nicku) AJ v cross-device prihlásení (modal "Môj účet",
   Fáza 3) – JEDNA spoločná logika, nie dve kópie.

   ⚠️ NEROBÍ žiadne localStorage zápisy ani reload – to je vždy na
   volajúcom (UI). Táto funkcia len ROZHODNE a vráti výsledok.

   Návratový tvar:
   { ok: true,  isNew: boolean, hadPin: boolean, degraded?: true }
   { ok: false, reason: 'pin-required' | 'pin-mismatch' }

   Vetvy (presne podľa zadania):
   A) users/{nick} neexistuje → nový účet, PIN sa TU nevynucuje (voliteľný,
      ponúkne sa neskôr cez modal "Môj účet").
   B) existuje, ale NEMÁ pin pole → legacy účet (všetci dnešní hráči pred
      Fázou 1) → VŽDY prepustí, nikdy nezablokuje.
   C) existuje A MÁ pin pole → vyžaduje zhodu hashu. Nesedí/chýba pokus →
      odmietne (ok:false), NIKDY nezaloží nový prázdny účet namiesto toho.

   ⚠️ Ak Firebase get() zlyhá (výpadok siete a pod.) – NIKDY nezablokuj
   hráča kvôli tomu. Degraduj na "prepusti ho" (presne dnešné správanie
   spred PIN systému) – radšej občas vynechať kontrolu pri výpadku, než
   appku niekomu uzamknúť kvôli sieti, ktorá s jeho PIN-om nemá nič spoločné. */
export async function claimNick(nick, pinAttempt) {
  const db = getDb();
  if (!db || !nick) return { ok: true, isNew: false, hadPin: false, degraded: true };

  let snap;
  try {
    snap = await get(ref(db, `users/${nick}`));
  } catch (e) {
    console.warn('⚠️ pinAuth: claimNick – Firebase get() zlyhalo (výpadok?), prepúšťam bez kontroly PIN-u (degradované správanie)', e);
    return { ok: true, isNew: false, hadPin: false, degraded: true };
  }

  if (!snap.exists()) {
    return { ok: true, isNew: true, hadPin: false };
  }

  const data = snap.val() || {};
  if (!data.pin) {
    return { ok: true, isNew: false, hadPin: false };
  }

  if (!pinAttempt) {
    return { ok: false, reason: 'pin-required' };
  }

  const attemptHash = await hashPin(pinAttempt, data.pinSalt || '');
  if (attemptHash === data.pin) {
    return { ok: true, isNew: false, hadPin: true };
  }
  return { ok: false, reason: 'pin-mismatch' };
}
