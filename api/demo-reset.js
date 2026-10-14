'use strict';

/* ============================================================
   api/demo-reset.js — Vercel Serverless Function

   Vráti demo do východzieho stavu: zmaže herné vetvy a nahrá ukážkové
   dáta (api/_seedDemo.js). Určené na spustenie PRED KAŽDÝM STRETNUTÍM.

   ⚠️ AUTORIZÁCIA. Endpoint je deštruktívny, preto vyžaduje
   DEMO_RESET_SECRET – buď v hlavičke `x-demo-reset-secret`, alebo
   v query `?secret=`. Porovnanie je časovo konštantné (timingSafeEqual),
   aby sa tajomstvo nedalo uhádnuť po znakoch. Bez nastavenej premennej
   endpoint odmietne čokoľvek spraviť (nie je „otvorený, kým ju
   nenastavíš" – to by bola diera).

   ⚠️ PREČO SERVICE ACCOUNT. Pravidlá v database.rules.json zámerne
   NEPOVOĽUJÚ zápis na koreň ani na vrchol vetvy (anti-wipe), takže
   `set(/users, null)` z klienta je zamietnutý. Service account cez
   Google OAuth2 pravidlá obchádza – preto sa maže odtiaľto a nie
   z admin panelu v prehliadači.

   POSTUP (v tomto poradí):
   1. autorizácia,
   2. zmazanie vetiev z WIPE_BRANCHES,
   3. multi-path PATCH so seedom.
   Mazanie je pred zápisom, aby po ňom neostali cudzie kľúče; seed sa
   zapisuje jedným PATCH-om, takže buď prejde celý, alebo nič.

   POVINNÉ ENV PREMENNÉ:
   - DEMO_RESET_SECRET
   - FIREBASE_DB_URL, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
============================================================ */

const crypto = require('crypto');
const { buildSeed, WIPE_BRANCHES } = require('./_seedDemo.js');

const FIREBASE_TIMEOUT_MS = 15000;

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Časovo konštantné porovnanie – dĺžky sa musia zhodovať, inak
   timingSafeEqual hodí výnimku. */
function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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

/* Google OAuth2 service-account JWT bearer flow – rovnaký postup ako
   v api/_dailyLimit.js a api/sync-content.js (projekt nemá package.json,
   takže žiadny firebase-admin, len vstavaný crypto + fetch). */
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

  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`
    })
  });
  if (!res.ok) throw new Error('Google auth zlyhal: ' + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error('Google auth nevrátil access_token.');
  return data.access_token;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Len GET alebo POST.' });
  }

  /* 1) Autorizácia – PRVÁ vec, pred akýmkoľvek prístupom k Firebase. */
  const expected = process.env.DEMO_RESET_SECRET;
  if (!expected) {
    return res.status(500).json({ ok: false, error: 'Server nie je nakonfigurovaný (chýba DEMO_RESET_SECRET).' });
  }
  const provided = req.headers['x-demo-reset-secret']
    || (req.query && req.query.secret)
    || '';
  if (!secretMatches(provided, expected)) {
    return res.status(403).json({ ok: false, error: 'Neplatné alebo chýbajúce tajomstvo.' });
  }

  const dbUrl = String(process.env.FIREBASE_DB_URL || '').replace(/\/+$/, '');
  if (!dbUrl) {
    return res.status(500).json({ ok: false, error: 'Server nie je nakonfigurovaný (chýba FIREBASE_DB_URL).' });
  }

  let token;
  try {
    token = await getGoogleAccessToken();
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Autentifikácia voči Firebase zlyhala: ' + e.message });
  }

  /* 2) Zmazanie herných vetiev. */
  const wiped = [];
  for (const branch of WIPE_BRANCHES) {
    try {
      const del = await fetchWithTimeout(`${dbUrl}/${branch}.json`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!del.ok) throw new Error('HTTP ' + del.status);
      wiped.push(branch);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: `Mazanie vetvy "${branch}" zlyhalo: ${e.message}`,
        zmazane: wiped
      });
    }
  }

  /* 3) Nahratie seedu jedným multi-path PATCH-om na koreň. */
  const now = Date.now();
  const seed = buildSeed(now);
  try {
    const put = await fetchWithTimeout(`${dbUrl}/.json`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(seed)
    });
    if (!put.ok) {
      const t = await put.text().catch(() => '');
      throw new Error('HTTP ' + put.status + ' ' + t.slice(0, 200));
    }
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'Zápis seedu zlyhal: ' + e.message, zmazane: wiped });
  }

  const pocet = k => Object.keys(seed).filter(x => x.startsWith(k)).length;
  return res.status(200).json({
    ok: true,
    cas: new Date(now).toISOString(),
    zmazane: wiped,
    nahrate: {
      hraci: pocet('users/'),
      suboje: pocet('duels/'),
      triedy: pocet('senaty/'),
      zapasyTried: pocet('senatSpory/'),
      skoly: pocet('faculties/'),
      predznaceneObdobia: pocet('rewards/') + pocet('senatRewards/') + pocet('facultyRewards/')
    },
    poznamka: 'Výzva duels/lektor-demo-01 je znova pending – QR link funguje pre jedného hráča.'
  });
};
