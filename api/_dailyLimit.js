'use strict';

/* ============================================================
   api/_dailyLimit.js — SERVEROVÝ TVRDÝ DENNÝ STROP AI VOLANÍ

   Podčiarkovník v názve je zámerný: Vercel súbory začínajúce na "_"
   NEROUTUJE ako serverless funkcie. Toto je zdieľaný modul, nie endpoint.

   PREČO EXISTUJE. Rate limit per IP v grade-answer.js/quiz-feedback.js je
   modul-level Map – prežije len na jednej teplej inštancii a nechráni
   naprieč paralelnými požiadavkami ani po cold starte (viď komentár pri
   rateLimitMap tam). Proti cielenému zneužitiu verejnej URL je to teda
   slabá vrstva. Tento modul je tvrdý strop: jeden zdieľaný počítač vo
   Firebase, atomicky inkrementovaný, spoločný pre všetky inštancie
   aj regióny.

   ATOMICITA BEZ TRANSAKCIÍ. Firebase REST API transakcie nemá, ale má
   podmienený zápis cez ETag: GET s hlavičkou "X-Firebase-ETag: true"
   vráti ETag aktuálnej hodnoty a PUT s hlavičkou "if-match: <etag>"
   prejde len vtedy, ak sa hodnota medzitým nezmenila (inak 412).
   To je plnohodnotné compare-and-swap – pri kolízii sa čítanie a zápis
   zopakujú (CAS_RETRIES nižšie).

   DEŇ = UTC DÁTUM. Zhodné s todayKey() v scripts/economyConfig.js
   (new Date().toISOString().slice(0,10)) – server a klient sa nesmú
   rozísť v tom, kedy sa deň láme.

   SPRÁVANIE PRI PROBLÉME (vedomé rozhodnutie, nie opomenutie):
   - Firebase NIE JE nakonfigurovaná (chýba FIREBASE_DB_URL /
     FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) → strop sa PRESKOČÍ
     a volanie prejde. Dôvod: bez toho by pridanie tohto modulu zhodilo
     AI skúšku, ktorá dnes funguje aj bez service accountu. Chýbajúca
     konfigurácia nie je to isté ako zlyhanie.
   - Firebase JE nakonfigurovaná, ale čítanie/zápis zlyhá → volanie sa
     ZAMIETNE. Strop má chrániť peniaze; keď sa počítadlo nedá overiť,
     bezpečnejšie je AI nezavolať. Klient má v oboch endpointoch statický
     fallback, takže hráč to nepocíti ako chybu.

   ⚠️ Do Firebase sa zapisuje VÝHRADNE číslo (počet volaní za deň).
   Žiadny nick, žiadne IP, žiadny obsah otázky ani odpovede.
============================================================ */

const crypto = require('crypto');

const CAS_RETRIES = 5;
const FIREBASE_TIMEOUT_MS = 5000;

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Deň sa láme podľa UTC dátumu – rovnaký pojem "dňa" ako todayKey()
   v scripts/economyConfig.js. */
function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

/* Google OAuth2 service-account JWT bearer flow (bez firebase-admin
   balíčka – projekt nemá package.json/node_modules, takže žiadne
   externé závislosti; len vstavaný crypto + fetch).
   Rovnaký postup ako v api/sync-content.js. */
async function getGoogleAccessToken() {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) throw new Error('Chýba FIREBASE_CLIENT_EMAIL alebo FIREBASE_PRIVATE_KEY.');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(privateKey).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!res.ok) throw new Error('Google auth zlyhal: ' + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error('Google auth nevrátil access_token.');
  return data.access_token;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FIREBASE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/* Je strop vôbec nakonfigurovaný? Ak nie, volajúci ho preskočí. */
function isConfigured() {
  return !!(process.env.FIREBASE_DB_URL
    && process.env.FIREBASE_CLIENT_EMAIL
    && process.env.FIREBASE_PRIVATE_KEY);
}

/* Atomicky zvýši denný počítač o 1 a povie, či sa volanie zmestilo
   pod strop.

   counterName – názov vetvy, napr. 'quizFeedback' alebo 'gradeAnswer'
   limit       – maximálny počet volaní za UTC deň

   Vracia { allowed, used, limit, skipped, reason }.
   - skipped: true  → strop nie je nakonfigurovaný, nekontroloval sa
   - allowed: false → strop vyčerpaný (alebo sa nedal overiť)

   Cesta: demoLimits/{UTC-dátum}/{counterName}
   Počítadlo sa NEČISTÍ – staré dni ostávajú ako jednoduchá denná
   štatistika spotreby a zaberajú zanedbateľné miesto. */
async function consumeDailyQuota(counterName, limit) {
  if (!isConfigured()) {
    console.warn(`[dailyLimit] ${counterName}: Firebase nie je nakonfigurovaná, strop sa preskakuje.`);
    return { allowed: true, used: 0, limit, skipped: true, reason: 'not-configured' };
  }

  const dbUrl = String(process.env.FIREBASE_DB_URL).replace(/\/+$/, '');
  const path = `${dbUrl}/demoLimits/${todayKeyUTC()}/${encodeURIComponent(counterName)}.json`;

  let token;
  try {
    token = await getGoogleAccessToken();
  } catch (e) {
    console.error(`[dailyLimit] ${counterName}: autentifikácia zlyhala –`, e.message);
    return { allowed: false, used: null, limit, skipped: false, reason: 'auth-failed' };
  }

  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    let current = 0;
    let etag = null;
    try {
      const getRes = await fetchWithTimeout(path, {
        headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' }
      });
      if (!getRes.ok) throw new Error('GET ' + getRes.status);
      etag = getRes.headers.get('etag');
      const val = await getRes.json();
      current = typeof val === 'number' && Number.isFinite(val) ? val : 0;
    } catch (e) {
      console.error(`[dailyLimit] ${counterName}: čítanie zlyhalo –`, e.message);
      return { allowed: false, used: null, limit, skipped: false, reason: 'read-failed' };
    }

    if (current >= limit) {
      return { allowed: false, used: current, limit, skipped: false, reason: 'limit-reached' };
    }

    const next = current + 1;
    try {
      const putRes = await fetchWithTimeout(path, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          // Podmienený zápis: prejde len ak sa hodnota medzitým nezmenila.
          'if-match': etag || 'null_etag'
        },
        body: JSON.stringify(next)
      });
      if (putRes.status === 412) continue;           // kolízia – prečítaj a skús znova
      if (!putRes.ok) throw new Error('PUT ' + putRes.status);
      return { allowed: true, used: next, limit, skipped: false, reason: 'ok' };
    } catch (e) {
      console.error(`[dailyLimit] ${counterName}: zápis zlyhal –`, e.message);
      return { allowed: false, used: current, limit, skipped: false, reason: 'write-failed' };
    }
  }

  console.error(`[dailyLimit] ${counterName}: CAS sa nepodarilo dokončiť po ${CAS_RETRIES} pokusoch.`);
  return { allowed: false, used: null, limit, skipped: false, reason: 'cas-exhausted' };
}

module.exports = { consumeDailyQuota, todayKeyUTC, isConfigured };
