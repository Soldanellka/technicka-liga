'use strict';

/* ============================================================
   api/sync-content.js — Vercel Serverless Function

   Úloha 3: admin na povel zapečie schválené Firebase overridy
   (contentOverrides/{app}/{okruh}/{cast}, vytvorené Úlohou 2) späť
   do data/*.json v repe cez GitHub API. Toto NIKDY nebeží automaticky
   (žiadny cron) – iba na explicitné volanie z admin panelu.

   PRVÝ RIADOK OBRANY: overenie admina. Táto appka nepoužíva Firebase
   Authentication (žiadny sign-in flow existuje nikde v appke – nick
   je len self-declared localStorage hodnota), takže "admin rola cez
   Firebase auth token" nie je reálne implementovateľné. Namiesto toho:
   zdieľané admin heslo, uložené LEN tu ako env premenná, posielané
   klientom v Authorization hlavičke. Kto pozná heslo, je admin – toto
   je vedomý kompromis (schválený zadávateľkou), nie prehliadnutie.

   POVINNÉ ENV PREMENNÉ (nastaviť vo Vercel project settings, NIKDY
   v kóde/klientovi):
   - ADMIN_SYNC_SECRET      zdieľané heslo, ktoré admin zadáva v UI
   - GITHUB_TOKEN           GitHub PAT s právom zapisovať do repa
   - GITHUB_REPO_OWNER      napr. "Soldanellka"
   - GITHUB_REPO_NAME       napr. "LexArena"
   - GITHUB_BRANCH          voliteľné, default "main"
   - FIREBASE_CLIENT_EMAIL  z JSON servisného účtu Firebase
   - FIREBASE_PRIVATE_KEY   z JSON servisného účtu (so \n v hodnote)
   - FIREBASE_DB_URL        napr. "https://lexarena-af45f-default-rtdb.europe-west1.firebasedatabase.app"

   Žiadna z týchto hodnôt sa nikdy neposiela do prehliadača.
============================================================ */

const crypto = require('crypto');

/* Musí zostať zosynchronizované s AREA_SLUGS v scripts/contentOverrides.js
   a MEMORY_AREAS v memoryDefinitions.js – app slug -> priečinok s A*.json. */
const AREA_PATHS = {
  osobne: 'data/',
  invest: 'data/invest/',
  makro: 'data/makro/'
};

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Google OAuth2 service-account JWT bearer flow (bez firebase-admin
   balíčka – projekt nemá package.json/node_modules, takže žiadne
   externé závislosti; len vstavaný crypto + fetch). */
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
  const signature = signer.sign(privateKey).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!res.ok) throw new Error('Google auth zlyhal: ' + await res.text());
  const data = await res.json();
  return data.access_token;
}

async function fetchOverrides(googleToken, dbUrl) {
  const res = await fetch(`${dbUrl}/contentOverrides.json`, {
    headers: { Authorization: `Bearer ${googleToken}` }
  });
  if (!res.ok) throw new Error('Firebase čítanie zlyhalo: ' + res.status);
  const data = await res.json();
  return data || {};
}

/* Odtlačok obsahu overridu. Kľúče sa triedia rekurzívne, aby to isté
   `novyObsah` dalo vždy ten istý hash bez ohľadu na poradie kľúčov, v akom
   ho vráti Firebase. */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
function contentHash(novyObsah) {
  return crypto.createHash('sha256').update(stableStringify(novyObsah == null ? null : novyObsah)).digest('hex');
}

/* Čaká override na zapečenie?

   Nestačí sa spoliehať na vlajku `committed`: editor ukladá cez Firebase
   update(), ktorý payload MERGUJE – vlajka z predchádzajúceho syncu prežije
   uloženie novej verzie textu a náhľad by úpravu nikdy neukázal (presne toto
   sa stalo po prvom synce 7ed2886 s TPP A13–A17).

   Preto rozhoduje obsah, nie vlajka:
   - `committedHash` sedí  -> v repe je presne toto, netreba nič robiť;
   - `committedHash` nesedí -> obsah sa po zapečení zmenil, znova do frontu;
   - `committedHash` chýba  -> override zapečený ešte pred touto opravou;
     porovná sa čas uloženia proti času zapečenia (úprava po zapečení = pending).

   Vďaka tomu je zdrojom pravdy stav dát, nie disciplína zapisovacích ciest:
   aj keby budúca save cesta na zhodenie vlajky zabudla, zmena sa v náhľade
   objaví. Klientske `committed: false` v contentOverrides.js/spiderOverrides.js
   je druhá, nezávislá poistka. */
function isPending(ov) {
  if (!ov) return false;
  if (!ov.committed) return true;
  if (ov.committedHash) return contentHash(ov.novyObsah) !== ov.committedHash;
  return Number(ov.timestamp || 0) > Number(ov.committedAt || 0);
}

async function markOverrideCommitted(googleToken, dbUrl, app, okruh, cast, commitSha, novyObsah) {
  await fetch(`${dbUrl}/contentOverrides/${app}/${okruh}/${cast}.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      committed: true,
      committedAt: Date.now(),
      committedHash: contentHash(novyObsah),
      commitSha
    })
  });
}

const GH_API = 'https://api.github.com';
function ghHeaders(token, extra) {
  return Object.assign({ Authorization: `Bearer ${token}`, 'User-Agent': 'financna-liga-content-sync' }, extra || {});
}
async function ghGet(path, token) {
  const res = await fetch(`${GH_API}${path}`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GitHub GET ${path} zlyhalo (${res.status}): ${await res.text()}`);
  return res.json();
}
async function ghPost(path, token, body) {
  const res = await fetch(`${GH_API}${path}`, {
    method: 'POST', headers: ghHeaders(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub POST ${path} zlyhalo (${res.status}): ${await res.text()}`);
  return res.json();
}
async function ghPatch(path, token, body) {
  const res = await fetch(`${GH_API}${path}`, {
    method: 'PATCH', headers: ghHeaders(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub PATCH ${path} zlyhalo (${res.status}): ${await res.text()}`);
  return res.json();
}

/* Validný tvar pavúka – prenesené z isValidSpider() v
   scripts/spiderOverrides.js. Nevalidný override sa NEAPLIKUJE (a teda ani
   neoznačí za vybavený), nech sa pokazeným tvarom nedá prepísať súbor v repe. */
function isValidSpider(sp) {
  return !!sp && typeof sp === 'object'
    && (sp.center === undefined || sp.center === null || typeof sp.center === 'string')
    && Array.isArray(sp.branches)
    && sp.branches.every(b =>
        b && typeof b.label === 'string'
        && Array.isArray(b.leaves)
        && b.leaves.every(l => typeof l === 'string'));
}

/* Rovnaká logika ako applyContentOverrides() v scripts/contentOverrides.js
   (+ applySpiderOverride() v scripts/spiderOverrides.js pre cast 'spider')
   – zámerne duplikovaná (server nemá bundler na import ESM z klienta),
   udržiavať zosynchronizované pri zmene formátu overridu.

   Vracia { result, applied }, kde `applied` je zoznam castov, ktoré sa naozaj
   premietli do výsledku. Volajúci podľa neho označuje `committed` – dovtedy
   sa označovali VŠETKY casty okruhu, takže cast, ktorý táto funkcia nepozná
   (predtým 'spider' a 'tile_*') alebo nemá kam sadnúť (index mimo poľa), sa
   označil za vybavený bez zapísania a zo syncu navždy zmizol.

   `_seal` sa do súboru ZÁMERNE nepíše – je to zobrazovacia meta, ktorú si
   klient odvodí z overridu vo Firebase (ten sa nemaže, len značkuje). */
function applyOverrides(json, overridesForOkruh) {
  const applied = [];
  if (!overridesForOkruh || !Object.keys(overridesForOkruh).length) return { result: json, applied };
  const result = Object.assign({}, json);

  const summaryOv = overridesForOkruh.summary;
  if (summaryOv && summaryOv.novyObsah && typeof summaryOv.novyObsah.summary === 'string') {
    result.summary = summaryOv.novyObsah.summary;
    applied.push('summary');
  }

  /* Pavúk: json.spider = {center, branches[]} – rovnaké pole, aké číta
     spider.js/spiderGames.js/spiderMap.js. Zapisuje sa aj do okruhu, ktorý
     zatiaľ žiadny json.spider nemá (override ho práve zavádza). */
  const spiderOv = overridesForOkruh.spider;
  if (spiderOv && spiderOv.novyObsah && isValidSpider(spiderOv.novyObsah.spider)) {
    result.spider = spiderOv.novyObsah.spider;
    applied.push('spider');
  }

  if (Array.isArray(json.quiz)) {
    result.quiz = json.quiz.map((q, i) => {
      const ov = overridesForOkruh[`quiz_${i}`];
      if (!ov || !ov.novyObsah) return q;
      applied.push(`quiz_${i}`);
      return Object.assign({}, q, ov.novyObsah);
    });
  }

  /* Dlaždice (term/definition/zdroj) – per-index vzor ako quiz vyššie.
     Klient ich prekrýval už dávno, server nie; teraz paritne. */
  if (Array.isArray(json.tiles)) {
    result.tiles = json.tiles.map((t, i) => {
      const ov = overridesForOkruh[`tile_${i}`];
      if (!ov || !ov.novyObsah) return t;
      applied.push(`tile_${i}`);
      return Object.assign({}, t, ov.novyObsah);
    });
  }

  if (Array.isArray(json.cases)) {
    result.cases = json.cases.map((c, ci) => {
      if (!Array.isArray(c.steps)) return c;
      const steps = c.steps.map((s, si) => {
        const ov = overridesForOkruh[`case_${ci}_step_${si}`];
        if (!ov || !ov.novyObsah) return s;
        applied.push(`case_${ci}_step_${si}`);
        return Object.assign({}, s, ov.novyObsah);
      });
      return Object.assign({}, c, { steps });
    });
  }

  return { result, applied };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Len POST.' });
  }

  /* POVINNÉ, NIE VOLITEĽNÉ: bez správneho hesla sa nespustí vôbec nič
     nižšie, ani preview. Priame volanie URL neadminom je odmietnuté tu. */
  const authHeader = req.headers['authorization'] || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expected = process.env.ADMIN_SYNC_SECRET || '';
  if (!expected || !timingSafeEqualStr(provided, expected)) {
    return res.status(403).json({ ok: false, error: 'Neplatné admin heslo.' });
  }

  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const ghToken = process.env.GITHUB_TOKEN;
  const dbUrl = process.env.FIREBASE_DB_URL;
  if (!owner || !repo || !ghToken || !dbUrl) {
    return res.status(500).json({ ok: false, error: 'Server nie je nakonfigurovaný (chýbajú env premenné).' });
  }

  const preview = !!(req.body && req.body.preview);

  try {
    const googleToken = await getGoogleAccessToken();
    const overridesByApp = await fetchOverrides(googleToken, dbUrl);

    // Nájdi {app, okruh} dvojice s aspoň jedným ešte-nezapečeným overridom.
    const affected = [];
    for (const app of Object.keys(overridesByApp)) {
      if (!AREA_PATHS[app]) continue;
      const byOkruh = overridesByApp[app] || {};
      for (const okruh of Object.keys(byOkruh)) {
        const casts = byOkruh[okruh] || {};
        const pendingCount = Object.values(casts).filter(isPending).length;
        if (pendingCount > 0) {
          affected.push({ app, okruh, path: `${AREA_PATHS[app]}${okruh}.json`, overridesCount: pendingCount });
        }
      }
    }

    if (preview) {
      return res.status(200).json({
        ok: true,
        preview: true,
        affected,
        totalOverrides: affected.reduce((sum, a) => sum + a.overridesCount, 0)
      });
    }

    if (!affected.length) {
      return res.status(200).json({ ok: true, committed: true, files: [], overridesBaked: 0, message: 'Žiadne nevybavené zmeny na zapečenie.' });
    }

    // 1) Základ vetvy – commit sha + strom.
    const refData = await ghGet(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, ghToken);
    const baseCommitSha = refData.object.sha;
    const baseCommit = await ghGet(`/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, ghToken);
    const baseTreeSha = baseCommit.tree.sha;

    /* 2) Pre každý dotknutý okruh: pôvodný JSON + navrstvenie -> nový blob.
       `appliedByOkruh` si drží, ktoré casty sa naozaj zapísali – krok 6 nižšie
       podľa neho značkuje. Okruh, z ktorého sa neaplikovalo NIČ, sa preskočí
       úplne (žiadny blob, žiadny záznam v strome) – inak by vznikol commit,
       ktorý nemení ani bajt. */
    const treeEntries = [];
    const filesChanged = [];
    const appliedByOkruh = {};
    const skipped = [];
    for (const a of affected) {
      const fileRes = await ghGet(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(AREA_PATHS[a.app]).replace(/%2F/g, '/')}${a.okruh}.json?ref=${branch}`,
        ghToken
      );
      const original = JSON.parse(Buffer.from(fileRes.content, 'base64').toString('utf8'));
      const { result: merged, applied } = applyOverrides(original, overridesByApp[a.app][a.okruh]);

      const pendingApplied = applied.filter(cast => isPending(overridesByApp[a.app][a.okruh][cast]));
      if (!pendingApplied.length) {
        skipped.push({ path: a.path, reason: 'žiadny z nevybavených overridov sa nedal zapísať' });
        continue;
      }

      const content = JSON.stringify(merged, null, 2) + '\n';
      const blob = await ghPost(`/repos/${owner}/${repo}/git/blobs`, ghToken, { content, encoding: 'utf-8' });
      treeEntries.push({ path: a.path, mode: '100644', type: 'blob', sha: blob.sha });
      filesChanged.push(a.path);
      appliedByOkruh[`${a.app}/${a.okruh}`] = pendingApplied;
    }

    if (!treeEntries.length) {
      return res.status(200).json({
        ok: true, committed: false, files: [], overridesBaked: 0, skipped,
        message: 'Nič sa nedalo zapísať – žiadny commit nevznikol, overridy ostávajú nevybavené.'
      });
    }

    // 3) Nový strom + 4) commit (zatiaľ nedotknuté v hlavnej vetve).
    const newTree = await ghPost(`/repos/${owner}/${repo}/git/trees`, ghToken, { base_tree: baseTreeSha, tree: treeEntries });
    const dateStr = new Date().toISOString().slice(0, 10);
    const commit = await ghPost(`/repos/${owner}/${repo}/git/commits`, ghToken, {
      message: `Finančná liga obsah sync ${dateStr}`,
      tree: newTree.sha,
      parents: [baseCommitSha]
    });

    // 5) Bod bez návratu: presun vetvy na nový commit. Až TERAZ je zmena
    //    reálne v repe – ak čokoľvek vyššie zlyhalo, hlavná vetva je
    //    nedotknutá a Firebase overridy ostávajú nezmenené.
    await ghPatch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, ghToken, { sha: commit.sha });

    /* 6) Označ zapečené overridy ako "committed" (nemažú sa, aby bola
       história dohľadateľná; opakovaný beh ich preskočí).
       Značkujú sa VÝHRADNE casty z appliedByOkruh, teda tie, ktoré applyOverrides
       naozaj premietla do blobu. Cast, ktorý sa zapísať nedal, ostáva `false` a
       objaví sa v ďalšom náhľade znova – radšej opakovane viditeľný než ticho
       stratený. */
    let overridesBaked = 0;
    for (const key of Object.keys(appliedByOkruh)) {
      const [app, okruh] = key.split('/');
      for (const castKey of appliedByOkruh[key]) {
        const ov = overridesByApp[app][okruh][castKey];
        await markOverrideCommitted(googleToken, dbUrl, app, okruh, castKey, commit.sha, ov && ov.novyObsah);
        overridesBaked++;
      }
    }

    return res.status(200).json({ ok: true, committed: true, files: filesChanged, overridesBaked, skipped, commitSha: commit.sha });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
