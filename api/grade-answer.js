'use strict';

/* ============================================================
   api/grade-answer.js — Vercel Serverless Function

   Fáza 2 (LLM hodnotenie štátnice, 2026-07-18): hodnotí odpoveď
   študenta oproti zhrnutiu okruhu a kľúčovým bodom cez Claude (model
   claude-haiku-4-5). V Fáze 3 ho scripts/statnice.js (gradeAnswer())
   zavolá ako PRVÚ voľbu, s fallbackom späť na lokálny evaluateCoverage()
   pri akomkoľvek zlyhaní – tento súbor sám o sebe žiadny fallback
   nerieši, len vracia jasný chybový stav, keď niečo zlyhá.

   Hlavný dôvod migrácie oproti lokálnemu evaluateCoverage(): posúdenie
   VECNEJ SPRÁVNOSTI (incorrect[]) – bag-of-words matcher to nikdy
   nevedel rozpoznať, len prítomnosť kľúčových slov.

   ⚠️ SÚKROMIE: endpoint NEPRIJÍMA ani nespracúva žiadnu identitu (nick,
   meno, e-mail, akýkoľvek identifikátor). Z req.body sa vyberajú
   VÝHRADNE 4 očakávané polia nižšie – čokoľvek navyše v tele požiadavky
   (aj keby ho klient omylom poslal) sa sem vôbec nedostane a nikam sa
   neposiela. Do Anthropic API ide len obsah odpovede a rubrika
   (summary/keyPoints/glossary/answerText) – hodnotenie je anonymné.

   ⚠️ KĽÚČ: ANTHROPIC_API_KEY sa číta VÝHRADNE z process.env (Vercel env
   premenná, Production aj Preview) – nikdy v klientskom kóde, nikdy sa
   neposiela ani nezobrazuje v žiadnej odpovedi tohto endpointu.

   ⚠️ OCHRANA PRED ZNEUŽITÍM (2026-07-18, prepracované 2026-07-19) – endpoint
   je verejný, hocikto pozná URL. Tri vrstvy, v tomto poradí (najlacnejšie/
   najskôr zamietajúce prvé):
   1. Rate limit per IP (best-effort, pozri poznámku pri rateLimitMap
      nižšie – NIE je to spoľahlivé naprieč všetkými instanciami).
   2. Origin check (ALLOWED_ORIGINS nižšie) – NAHRADIL pôvodný shared secret
      (2026-07-19). Secret v klientskom kóde by bol (rovnako ako appka
      nemá build krok) doslovný reťazec, verejne viditeľný v zdrojovom kóde
      stránky – teda v skutočnosti len iná forma "žiadnej ochrany", nie
      slabšia verzia niečoho reálneho. Origin hlavičku naopak nemôže JS
      bežiaceho na inej stránke z prehliadača sfalšovať (forbidden header
      name) – blokuje teda reálne cudzie weby/CSRF z prehliadača. Cielený
      útočník, ktorý si endpoint volá priamo (curl/skript, nie prehliadač),
      si Origin hlavičku samozrejme nastaví sám – pred TÝMTO originom
      check nechráni, presne ako predtým nechránil secret vytiahnutý z JS.
      Skutočný strop nákladov pri cielenom zneužití je rate limit + limity
      dĺžky nižšie, nie táto vrstva.
   3. Limit dĺžky vstupu (MAX_SUMMARY_LENGTH/MAX_ANSWER_LENGTH nižšie) –
      zabráni nafúknutiu ceny jedného volania aj legitímnym, no príliš
      veľkým vstupom.

   POVINNÁ ENV PREMENNÁ:
   - ANTHROPIC_API_KEY
   (GRADE_ANSWER_SECRET sa už nepoužíva – endpoint ju nikde nečíta, môže sa
   z Vercel env zmazať.)

   Nič iné tento endpoint nerobí – žiadny zápis do Firebase, žiadne §,
   žiadna identita. Čisto: vstup → Claude → štruktúrovaný JSON výstup.

   ⚠️ CORS: appka aj endpoint bežia na TEJ ISTEJ doméne (klient volá
   fetch('/api/grade-answer') relatívnou cestou) – ide teda vždy o
   same-origin požiadavku z pohľadu prehliadača, nie cross-origin. Žiadne
   Access-Control-Allow-Origin hlavičky ani OPTIONS/preflight handling
   nie sú potrebné – prehliadač preflight vôbec nespúšťa pre same-origin
   požiadavky. (Origin hlavička sa napriek tomu posiela aj pri same-origin
   POST – prehliadače ju od istého času posielajú pri všetkých "unsafe"
   metódach, nielen cross-origin, viď isAllowedOrigin nižšie.)
============================================================ */

const { consumeDailyQuota } = require('./_dailyLimit.js');

/* ============================================================
   POISTKY PROTI TICHÉMU PÁDU (2026-10)

   Endpoint predtým vracal 502 na ôsmich miestach a ANI JEDNO z nich
   nič nezapísalo do logu. Vo Vercel sa to javilo ako "funkcia spadla
   bez výpisu" – v skutočnosti to bola riadne spracovaná chyba, len
   neviditeľná. Po novom:

   1. Každá chyba sa zaloguje so stavom a dôvodom (NIKDY nie kľúč).
   2. Upstream zlyhania vracajú HTTP 200 s { ok:false } namiesto 502 –
      klient kontroluje aj res.ok aj data.ok, takže padne na svoj
      statický fallback presne ako doteraz, bez hlášky pre hráča.
      Stavy 400/403/405/429 ostávajú, tie sú vecne správne.
   3. Celý handler je v try/catch, takže ani neočakávaná výnimka
      nezhodí proces a nevráti 502 bez vysvetlenia.
   4. Neodchytený odmietnutý prísľub sa zaloguje – bez tohto by zhodil
      celý proces a Vercel by vrátil 502 opäť bez jediného riadku.
============================================================ */

/* Vercel načíta modul raz na inštanciu, ale pri opakovanom require by
   sa poslucháči hromadili – príznak to spoľahlivo vylúči. */
if (!process.__flSafetyHandlers) {
  process.__flSafetyHandlers = true;
  process.on('unhandledRejection', (d) => {
    console.error('[grade-answer] NEODCHYTENÝ ODMIETNUTÝ PRÍSĽUB:', scrubSecrets(d && d.stack ? d.stack : d));
  });
  /* Zámerne sa NEUKONČUJE proces: na serverless inštancii je jedna
     zaznamenaná chyba lepšia než tichý pád bez logu. */
  process.on('uncaughtException', (e) => {
    console.error('[grade-answer] NEODCHYTENÁ VÝNIMKA:', scrubSecrets(e && e.stack ? e.stack : e));
  });
}

/* Do logu sa nesmie dostať API kľúč ani omylom. V tele odpovede
   Anthropicu nie je, ale logujeme cudzí text a nespoliehame sa na to. */
function scrubSecrets(v) {
  return String(v == null ? '' : v)
    .replace(/sk-ant-[A-Za-z0-9_\-]+/g, 'sk-ant-***')
    .slice(0, 1000);
}

/* Jediné miesto, kde sa odpovedá. Zabráni zápisu do už odoslanej
   odpovede (ERR_HTTP_HEADERS_SENT by inak zhodil proces). */
function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) {
    console.error('[grade-answer] odpoveď už bola odoslaná, druhý zápis zahadzujem:', payload && payload.reason);
    return;
  }
  return res.status(status).json(payload);
}

/* Z chybového tela Anthropicu vytiahne typ chyby na zalogovanie. */
function anthropicErrorReason(telo) {
  try {
    const j = JSON.parse(telo);
    if (j && j.error) return (j.error.type || 'unknown') + ': ' + (j.error.message || '');
  } catch (e) { /* nie JSON – vrátime orezaný text nižšie */ }
  return telo ? telo.slice(0, 300) : '(prázdne telo)';
}


const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';
// Haiku by mal na túto úlohu (klasifikácia/extrakcia, žiadne extended
// thinking) odpovedať v priebehu pár sekúnd – radšej jasná chyba klientovi
// (ktorý má v Fáze 3 lokálny fallback), než visieť až do limitu Vercel funkcie.
const REQUEST_TIMEOUT_MS = 20000;
const MAX_OUTPUT_TOKENS = 2048;

// Limity dĺžky vstupu – zabránia nafúknutiu ceny jedného volania (aj pri
// legitímnom, len neprimerane veľkom vstupe). Nad limit -> 400, BEZ volania
// Anthropic API (nič sa nezaplatí).
const MAX_SUMMARY_LENGTH = 8000;
const MAX_ANSWER_LENGTH = 4000;
const MAX_KEY_POINTS = 30;
const MAX_GLOSSARY_TERMS = 30;

// Rate limit per IP – best-effort, POZOR na limity nižšie.
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minúta
const RATE_LIMIT_MAX_REQUESTS = 10;

/* Tvrdý denný strop naprieč všetkými inštanciami (api/_dailyLimit.js).
   AI skúška je na verejnej URL – rate limit per IP je len modul-level Map
   a nechráni naprieč inštanciami, takže toto je jediný skutočný strop
   nákladov. Pri vyčerpaní klient spadne na lokálny evaluateCoverage(). */
const DAILY_LIMIT = 50;
const DAILY_COUNTER = 'gradeAnswer';
/* ⚠️ Modul-level Map prežije len na JEDNEJ "teplej" (warm) inštancii tejto
   funkcie medzi jej vlastnými sekvenčnými volaniami – NIE naprieč
   paralelnými požiadavkami (každá môže bežať na inej inštancii), NIE po
   cold starte, NIE naprieč viacerými regiónmi. Toto je preto SLABÁ,
   len-lepšia-než-nič ochrana, nie skutočný distribuovaný rate limit
   (ten by potreboval zdieľaný store – Vercel KV/Upstash cez REST API –
   čo tento projekt zámerne nemá, žiadne externé závislosti). Ak treba
   spoľahlivú ochranu, toto je miesto na doplnenie neskôr. */
const rateLimitMap = new Map();

// Povolené pôvody požiadavky (viď komentár "Origin check" v hlavičke vyššie).
// Appka je reálne dostupná na všetkých troch adresách, preto sú v zozname
// všetky – inak by origin check na niektorej z nich vrátil 403.
const ALLOWED_ORIGINS = new Set([
  'https://financna-liga.sk',
  'https://www.financna-liga.sk',
  /* Pôvodná Vercel adresa ostáva napojená, takže staršie zdieľané výzvy
     a QR kódy vygenerované pred prechodom na vlastnú doménu fungujú ďalej.
     Preview URL jednotlivých branchov/PR tu ZÁMERNE nie sú. */
  'https://financna-liga.vercel.app'
]);

/* Origin sa nedá sfalšovať z JS bežiaceho v prehliadači (forbidden header
   name) – Referer sa dá teoreticky ovplyvniť menej priamo, používa sa preto
   len ako FALLBACK, ak Origin chýba (niektoré požiadavky ho nemajú, napr.
   staršie/niektoré non-fetch cesty). Chýbajúci/nerozpoznateľný pôvod (Origin
   AJ Referer chýba, alebo Referer nie je platná URL) sa berie ako
   NEPOVOLENÝ – bezpečnejšie zamietnuť legitímny okrajový prípad, než
   omylom prepustiť niečo bez zisteného pôvodu. */
function isAllowedOrigin(req) {
  const origin = req.headers['origin'];
  if (origin) return ALLOWED_ORIGINS.has(origin);
  const referer = req.headers['referer'];
  if (referer) {
    try {
      return ALLOWED_ORIGINS.has(new URL(referer).origin);
    } catch (e) {
      return false;
    }
  }
  return false;
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  // Ľahké priebežné čistenie – zabráni neobmedzenému rastu Map na
  // dlho bežiacej teplej inštancii.
  if (rateLimitMap.size > 1000) {
    for (const [key, entry] of rateLimitMap) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
    }
  }
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX_REQUESTS;
}

const SYSTEM_PROMPT = `Si skúšajúci na právnických skúškach na Slovensku. Dostaneš zhrnutie skúšobného okruhu (summary), zoznam kľúčových bodov, ktoré má správna odpoveď pokryť (keyPoints), glosár odbornej terminológie okruhu (glossary) a prepis ústnej odpovede študenta (answerText – prepis rozpoznávania reči, môže obsahovať preklepy/zámeny podobne znejúcich slov; nepenalizuj zjavné chyby prepisu, posudzuj zamýšľaný význam).

Over odpoveď PROTI summary a keyPoints a urč:
1. "covered" – ktoré kľúčové body odpoveď skutočne pokrýva (aj parafrázou, netreba doslovné znenie, ale povrchné vymenovanie pojmov BEZ vecnej súvislosti sa nepočíta ako pokrytie). Vráť presné znenie bodu tak, ako je uvedené v keyPoints.
2. "missing" – ktoré kľúčové body odpoveď nepokrýva. Každý bod zo keyPoints musí byť buď v "covered", alebo v "missing" (nikdy v oboch, nikdy v žiadnom).
3. "incorrect" – ktoré tvrdenia v odpovedi sú VECNE NESPRÁVNE (zámena pojmov, nesprávny právny vzťah, chybná definícia, nesprávne priradenie k inému inštitútu). Stručne (jedna veta na tvrdenie) popíš každé nesprávne tvrdenie. Ak odpoveď neobsahuje žiadne vecne nesprávne tvrdenie – aj keď je neúplná – nechaj "incorrect" prázdne: samotná neúplnosť NIE JE nesprávnosť, tá patrí len do "missing".
4. "terminologyScore" (celé číslo 0-100) – koľko percent pojmov z glossary študent reálne a vecne správne v kontexte použil.
5. "contentCoverage" (celé číslo 0-100) – celkové obsahové pokrytie keyPoints, zohľadňujúce aj hĺbku/kvalitu vysvetlenia, nielen počet spomenutých bodov.

Buď prísny, ale spravodlivý. Odpovedz VÝHRADNE JSON objektom presne podľa zadanej schémy – žiadny text pred ani za JSON.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    covered: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    incorrect: { type: 'array', items: { type: 'string' } },
    contentCoverage: { type: 'integer' },
    terminologyScore: { type: 'integer' }
  },
  required: ['covered', 'missing', 'incorrect', 'contentCoverage', 'terminologyScore'],
  additionalProperties: false
};

function isStringArray(v) {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

// Schéma vyššie nevie vynútiť rozsah 0-100 (JSON Schema numeric constraints
// nie sú v structured outputs podporované) – model overuje ručne po prijatí.
function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildUserMessage(summary, keyPoints, glossary, answerText) {
  const keyPointsList = keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const glossaryList = glossary.length ? glossary.join(', ') : '(žiadny glosár pre tento okruh)';
  return [
    `ZHRNUTIE OKRUHU (summary):\n${summary}`,
    `KĽÚČOVÉ BODY (keyPoints):\n${keyPointsList}`,
    `GLOSÁR PRÁVNEJ TERMINOLÓGIE (glossary):\n${glossaryList}`,
    `PREPIS ODPOVEDE ŠTUDENTA (answerText):\n${answerText}`
  ].join('\n\n');
}

async function handleRequest(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Len POST.' });
  }

  // 1) Rate limit per IP – najlacnejšia kontrola, PRED overením originu.
  //    Best-effort, pozri poznámku pri rateLimitMap.
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ ok: false, error: 'Príliš veľa požiadaviek, skús to o chvíľu znova.' });
  }

  // 2) Origin check – PRED volaním Anthropicu, nech neplatný pôvod nič nestojí.
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Neplatný pôvod požiadavky.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'Server nie je nakonfigurovaný (chýba ANTHROPIC_API_KEY).' });
  }

  // ⚠️ SÚKROMIE: vyber VÝHRADNE tieto 4 polia z tela požiadavky – nič iné
  // (napr. nick, ak by ho klient niekedy omylom poslal) sa ďalej nepoužije.
  const body = req.body || {};
  const summary = body.summary;
  const keyPoints = body.keyPoints;
  const glossary = body.glossary;
  const answerText = body.answerText;

  if (typeof summary !== 'string' || !summary.trim()) {
    return res.status(400).json({ ok: false, error: 'Chýba alebo je neplatné pole "summary".' });
  }
  if (summary.length > MAX_SUMMARY_LENGTH) {
    return res.status(400).json({ ok: false, error: `Pole "summary" je príliš dlhé (max ${MAX_SUMMARY_LENGTH} znakov).` });
  }
  if (!isStringArray(keyPoints) || !keyPoints.length) {
    return res.status(400).json({ ok: false, error: 'Chýba alebo je neplatné pole "keyPoints".' });
  }
  if (keyPoints.length > MAX_KEY_POINTS) {
    return res.status(400).json({ ok: false, error: `Pole "keyPoints" má príliš veľa položiek (max ${MAX_KEY_POINTS}).` });
  }
  if (glossary !== undefined && glossary !== null && !isStringArray(glossary)) {
    return res.status(400).json({ ok: false, error: 'Neplatné pole "glossary".' });
  }
  if (Array.isArray(glossary) && glossary.length > MAX_GLOSSARY_TERMS) {
    return res.status(400).json({ ok: false, error: `Pole "glossary" má príliš veľa položiek (max ${MAX_GLOSSARY_TERMS}).` });
  }
  if (typeof answerText !== 'string' || !answerText.trim()) {
    return res.status(400).json({ ok: false, error: 'Chýba alebo je neplatné pole "answerText".' });
  }
  if (answerText.length > MAX_ANSWER_LENGTH) {
    return res.status(400).json({ ok: false, error: `Pole "answerText" je príliš dlhé (max ${MAX_ANSWER_LENGTH} znakov).` });
  }

  // 4) Tvrdý denný strop – posledná kontrola pred zaplatením volania.
  const quota = await consumeDailyQuota(DAILY_COUNTER, DAILY_LIMIT);
  if (!quota.allowed) {
    return res.status(429).json({ ok: false, error: 'Denný limit AI hodnotení je vyčerpaný.', reason: quota.reason });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: buildUserMessage(summary, keyPoints, glossary || [], answerText) }
        ],
        output_config: {
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA }
        }
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      console.error('[grade-answer] Anthropic API neodpovedalo do ' + REQUEST_TIMEOUT_MS + ' ms.');
      return sendJson(res, 200, { ok: false, error: 'Anthropic API neodpovedalo včas (timeout).', reason: 'timeout' });
    }
    console.error('[grade-answer] volanie Anthropic API zlyhalo:', scrubSecrets(e && e.stack ? e.stack : e));
    return sendJson(res, 200, { ok: false, error: 'Volanie Anthropic API zlyhalo.', reason: 'network' });
  }
  clearTimeout(timeoutId);

  /* ⚠️ Stav a typ obsahu sa overujú PRED parsovaním. Chybový stav vracia
     Anthropic ako JSON, ale brána/proxy pred ním môže vrátiť HTML alebo
     čistý text – .json() by na ňom vyhodil výnimku. */
  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => '');
    console.error(`[grade-answer] Anthropic API vrátilo ${anthropicRes.status}: ` + scrubSecrets(anthropicErrorReason(errText)));
    return sendJson(res, 200, { ok: false, error: 'Anthropic API vrátilo chybu.', reason: 'anthropic-' + anthropicRes.status });
  }

  const contentType = (anthropicRes.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    const telo = await anthropicRes.text().catch(() => '');
    console.error(`[grade-answer] Anthropic nevrátilo JSON (content-type: ${contentType || '(chýba)'}):`, scrubSecrets(telo));
    return sendJson(res, 200, { ok: false, error: 'Anthropic API vrátilo neplatnú odpoveď (nie JSON).', reason: 'not-json' });
  }

  let data;
  try {
    data = await anthropicRes.json();
  } catch (e) {
    console.error('[grade-answer] odpoveď Anthropicu sa nedala rozparsovať:', scrubSecrets(e && e.message));
    return sendJson(res, 200, { ok: false, error: 'Anthropic API vrátilo neplatnú odpoveď (nie JSON).', reason: 'parse' });
  }

  // Bezpečnostné klasifikátory môžu request odmietnuť (HTTP 200, stop_reason
  // "refusal") – to nie je network/parse chyba, ale tiež to nie je platné
  // hodnotenie, takže ho hlásime rovnako ako inú chybu (klient spadne na fallback).
  if (data.stop_reason === 'refusal') {
    console.error('[grade-answer] model odmietol odpovedať (stop_reason: refusal).');
    return sendJson(res, 200, { ok: false, error: 'Model odmietol odpovedať.', reason: 'refusal' });
  }

  const textBlock = Array.isArray(data.content) ? data.content.find(b => b && b.type === 'text') : null;
  if (!textBlock || typeof textBlock.text !== 'string') {
    console.error('[grade-answer] v odpovedi chýba textový blok, stop_reason:', data.stop_reason);
    return sendJson(res, 200, { ok: false, error: 'Anthropic API nevrátilo očakávaný textový blok.', reason: 'no-text' });
  }

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    console.error('[grade-answer] model nevrátil platný JSON:', scrubSecrets(textBlock.text));
    return sendJson(res, 200, { ok: false, error: 'Model nevrátil platný JSON.', reason: 'model-json' });
  }

  if (!isStringArray(parsed.covered) || !isStringArray(parsed.missing) || !isStringArray(parsed.incorrect)) {
    console.error('[grade-answer] neplatný tvar covered/missing/incorrect.');
    return sendJson(res, 200, { ok: false, error: 'Model vrátil neplatný tvar covered/missing/incorrect.', reason: 'shape' });
  }
  const contentCoverage = clampScore(parsed.contentCoverage);
  const terminologyScore = clampScore(parsed.terminologyScore);
  if (contentCoverage === null || terminologyScore === null) {
    console.error('[grade-answer] neplatné skóre od modelu.');
    return sendJson(res, 200, { ok: false, error: 'Model vrátil neplatné skóre.', reason: 'score' });
  }

  return sendJson(res, 200, {
    ok: true,
    covered: parsed.covered,
    missing: parsed.missing,
    incorrect: parsed.incorrect,
    contentCoverage,
    terminologyScore
  });
}

/* Vonkajší obal – posledná poistka. Čokoľvek, čo prepadne cez všetky
   kontroly vyššie, skončí tu: zaloguje sa a klient dostane čistý JSON,
   na ktorom spadne na lokálny evaluateCoverage(). Žiadna 502, žiadna
   hláška pre hráča. */
module.exports = async (req, res) => {
  try {
    return await handleRequest(req, res);
  } catch (e) {
    console.error('[grade-answer] NEOČAKÁVANÁ CHYBA:', scrubSecrets(e && e.stack ? e.stack : e));
    return sendJson(res, 200, { ok: false, error: 'Hodnotenie sa nepodarilo.', reason: 'unexpected' });
  }
};
