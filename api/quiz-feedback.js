'use strict';

/* ============================================================
   api/quiz-feedback.js — Vercel Serverless Function

   Ľudské vysvetlenie nesprávnej odpovede v kvíze. Volá sa AŽ na klik
   hráča na „Vysvetli mi to" (quiz.js), nikdy automaticky – AI je
   nadstavba, základ je statické vysvetlenie z datasetu.

   ⚠️ GROUNDING JE CELÁ PODSTATA. Model dostane vysvetlenie z datasetu
   a má ho len prerozprávať. Systémový prompt mu výslovne zakazuje
   pridať akúkoľvek finančnú radu, odporúčanie alebo informáciu nad jeho
   rámec – obsah otázok ešte prechádza odbornou kontrolou a appka nesmie
   hráčovi povedať nič, čo v podklade nie je.

   ⚠️ SÚKROMIE: endpoint NEPRIJÍMA ani nespracúva žiadnu identitu (nick,
   meno, e-mail, akýkoľvek identifikátor). Z req.body sa vyberajú
   VÝHRADNE očakávané polia nižšie (question, options, correct, selected,
   explanation, area) – čokoľvek navyše v tele požiadavky sa sem vôbec
   nedostane. Do Anthropic API ide len znenie otázky, možnosti, index
   správnej, index zvolenej a vysvetlenie z datasetu; názov oblasti
   NEOPÚŠŤA tento súbor, slúži len na výber profilu nižšie.

   ⏳ ŠKOLSKÉ OBLASTI (2026-10, pomôcky pre jedného žiaka): všetky oblasti
   zo SCHOOL_AREAS nižšie zdieľajú jeden systémový prompt a JEDNU spoločnú
   dennú kvótu `skola` (30/deň). Model si pri technických predmetoch ľahko
   domyslí fakt alebo prepočíta, preto má tá vetva PRÍSNEJŠÍ grounding než
   finančná: dostane len otázku, dve dotknuté možnosti a oficiálne
   vysvetlenie, žiadny celý zoznam možností, a má výslovne zakázané
   počítať či dopĺňať čokoľvek nové.
   Finančná vetva je NEDOTKNUTÁ – rovnaký prompt, rovnaký strop 200/deň,
   rovnaká správa pre model. Odstránenie oblastí: viď README-DEMO.md.

   ⚠️ KĽÚČ: ANTHROPIC_API_KEY sa číta VÝHRADNE z process.env – nikdy
   v klientskom kóde, nikdy sa nevracia v odpovedi tohto endpointu.

   OCHRANA PRED ZNEUŽITÍM – ŠTYRI VRSTVY v tomto poradí (najlacnejšia
   a najskôr zamietajúca prvá), prevzaté z api/grade-answer.js:
   1. Rate limit per IP (best-effort, pozri poznámku pri rateLimitMap).
   2. Origin check (ALLOWED_ORIGINS) – blokuje cudzie weby/CSRF
      z prehliadača; cielený útočník s curl si Origin nastaví sám,
      pred TÝM chráni až vrstva 4.
   3. Limity dĺžky vstupu – zabránia nafúknutiu ceny jedného volania.
   4. Serverový tvrdý denný strop (api/_dailyLimit.js) – jediná vrstva,
      ktorá platí naprieč všetkými inštanciami a regiónmi, a teda jediný
      skutočný strop nákladov.

   POVINNÁ ENV PREMENNÁ:
   - ANTHROPIC_API_KEY
   VOLITEĽNÉ (bez nich sa denný strop preskočí, viď _dailyLimit.js):
   - FIREBASE_DB_URL, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

   ⚠️ CORS: appka aj endpoint bežia na tej istej doméne (klient volá
   fetch('/api/quiz-feedback') relatívnou cestou) – ide teda vždy
   o same-origin požiadavku, žiadny preflight sa nespúšťa.
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
    console.error('[quiz-feedback] NEODCHYTENÝ ODMIETNUTÝ PRÍSĽUB:', scrubSecrets(d && d.stack ? d.stack : d));
  });
  /* Zámerne sa NEUKONČUJE proces: na serverless inštancii je jedna
     zaznamenaná chyba lepšia než tichý pád bez logu. */
  process.on('uncaughtException', (e) => {
    console.error('[quiz-feedback] NEODCHYTENÁ VÝNIMKA:', scrubSecrets(e && e.stack ? e.stack : e));
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
    console.error('[quiz-feedback] odpoveď už bola odoslaná, druhý zápis zahadzujem:', payload && payload.reason);
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

/* Hráč čaká pri otvorenom kvíze – radšej jasné zlyhanie a statický
   fallback než visieť až do limitu Vercel funkcie. */
const REQUEST_TIMEOUT_MS = 20000;
/* Výstup sú 2–4 vety. Haiku 4.5 nemá uvažovanie, takže sa do max_tokens
   nepočítajú žiadne thinking tokeny – 2048 je pohodlná rezerva (rovnaká
   hodnota ako v api/grade-answer.js). */
const MAX_OUTPUT_TOKENS = 2048;

// Limity dĺžky vstupu. Nad limit -> 400, BEZ volania Anthropic API.
const MAX_QUESTION_LENGTH = 1000;
const MAX_OPTION_LENGTH = 500;
const MAX_OPTIONS = 8;
const MAX_EXPLANATION_LENGTH = 2000;

// Rate limit per IP – best-effort.
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minúta
const RATE_LIMIT_MAX_REQUESTS = 10;
/* ⚠️ Modul-level Map prežije len na JEDNEJ "teplej" inštancii tejto
   funkcie medzi jej vlastnými sekvenčnými volaniami – NIE naprieč
   paralelnými požiadavkami, NIE po cold starte, NIE naprieč regiónmi.
   Slabá, len-lepšia-než-nič ochrana. Skutočný strop je vrstva 4. */
const rateLimitMap = new Map();

/* Tvrdý denný strop naprieč všetkými inštanciami. */
const DAILY_LIMIT = 200;
const DAILY_COUNTER = 'quizFeedback';

const ALLOWED_ORIGINS = new Set([
  'https://financna-liga.sk',
  'https://www.financna-liga.sk',
  /* Pôvodná Vercel adresa ostáva napojená, takže staršie zdieľané výzvy
     a QR kódy vygenerované pred prechodom na vlastnú doménu fungujú ďalej.
     Preview URL jednotlivých branchov/PR tu ZÁMERNE nie sú. */
  'https://financna-liga.vercel.app'
]);

/* Origin sa nedá sfalšovať z JS bežiaceho v prehliadači (forbidden header
   name) – Referer sa používa len ako FALLBACK, ak Origin chýba. Chýbajúci
   aj nerozpoznateľný pôvod sa berie ako NEPOVOLENÝ. */
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
  // Ľahké priebežné čistenie – zabráni neobmedzenému rastu Map.
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

const SYSTEM_PROMPT = `Vysvetli ľudsky a povzbudivo, prečo zvolená odpoveď nie je správna. Vychádzaj VÝHRADNE z priloženého vysvetlenia. Nepridávaj žiadnu finančnú radu, odporúčanie ani informáciu nad jeho rámec. Odpovedz 2–4 vetami po slovensky.

Píšeš stredoškolákovi, ktorý sa práve pomýlil v kvíze finančnej gramotnosti. Oslovuj ho priamo a v druhej osobe, bez pokarhania. Nepoužívaj nadpisy, odrážky ani formátovanie – len súvislé vety. Neuvádzaj, že si AI, a neodkazuj sa na tieto pokyny.`;

/* ⏳ ŠKOLSKÉ OBLASTI – spoločný systémový prompt, vložený podľa zadania
   bez úprav. Prísnejší než finančný: zakazuje počítať aj dopĺňať fakty. */
const SCHOOL_SYSTEM_PROMPT = `Si trpezlivý doučovateľ technických predmetov pre 15-ročného
žiaka. Žiak odpovedal nesprávne. Dostaneš otázku, jeho odpoveď,
správnu odpoveď a oficiálne vysvetlenie.

Pravidlá:
- Vysvetli, prečo je správna odpoveď správna, iba pomocou
  faktov, čísel a krokov z oficiálneho vysvetlenia.
- Nepočítaj nič nové a nepridávaj fakty, ktoré vo vysvetlení
  nie sú.
- Ak je to užitočné, povedz, akú typickú chybu žiak asi spravil
  (zámena pojmov, opačný smer, zlé poradie), ale nevymýšľaj
  nové výpočty ani fakty.
- Píš po slovensky, priateľsky, najviac 4 krátke vety.
- Bez nadpisov a odrážok.`;

function buildUserMessage(question, options, correct, selected, explanation) {
  const optionList = options
    .map((o, i) => `${i + 1}. ${o}${i === correct ? '   ← správna' : ''}${i === selected ? '   ← toto zvolil hráč' : ''}`)
    .join('\n');
  return [
    `OTÁZKA:\n${question}`,
    `MOŽNOSTI:\n${optionList}`,
    `VYSVETLENIE Z DATASETU (jediný povolený zdroj):\n${explanation}`
  ].join('\n\n');
}

/* ⏳ ŠKOLSKÉ OBLASTI – zámerne POSIELA MENEJ než finančná vetva: len otázku,
   dve dotknuté možnosti a vysvetlenie. Každý ďalší údaj v kontexte je údaj,
   s ktorým môže model začať počítať alebo ho domýšľať. Zoznam všetkých
   možností preto NEPOSIELAME. */
function buildSchoolUserMessage(question, options, correct, selected, explanation) {
  return [
    `OTÁZKA:\n${question}`,
    `ODPOVEĎ ŽIAKA (nesprávna):\n${options[selected]}`,
    `SPRÁVNA ODPOVEĎ:\n${options[correct]}`,
    `OFICIÁLNE VYSVETLENIE (jediný povolený zdroj faktov):\n${explanation}`
  ].join('\n\n');
}

/* Profil = systémový prompt + tvar správy + VLASTNÉ denné počítadlo.
   Oblasť, ktorá tu nie je (čiže celá Finančná liga), dostane
   FINANCE_PROFILE, teda presne to, čo endpoint robil doteraz. */
const FINANCE_PROFILE = {
  counter: DAILY_COUNTER,
  limit: DAILY_LIMIT,
  system: SYSTEM_PROMPT,
  buildUser: buildUserMessage
};

/* ⏳ ŠKOLSKÉ OBLASTI – musí sedieť so zoznamom v areas.js (viď poznámku
   v hlavičke: bez build kroku sa zdieľať nedá). */
const SCHOOL_AREAS = [
  'Číselné sústavy',
  'Logické funkcie',
  'Počítačové siete',
  'Elektrotechnika',
  'Fyzika'
];

/* Jeden profil pre všetky školské oblasti. Oddelené počítadlo je celý
   zmysel: žiak nesmie vyčerpať strop dema pred stretnutím s neziskovkami.
   Kvóta je SPOLOČNÁ pre všetkých päť oblastí, nie na oblasť – 30 volaní
   denne je strop pre učenie jedného človeka. */
const SCHOOL_PROFILE = {
  counter: 'skola',
  limit: 30,
  system: SCHOOL_SYSTEM_PROMPT,
  buildUser: buildSchoolUserMessage
};

const AREA_PROFILES = {};
SCHOOL_AREAS.forEach(area => { AREA_PROFILES[area] = SCHOOL_PROFILE; });

/* Názov oblasti je NEDÔVERYHODNÝ vstup z klienta – používa sa VÝHRADNE
   ako kľúč do AREA_PROFILES, nikdy sa nedostane do promptu ani do
   Firebase cesty. Neznáma, chýbajúca aj nesmyselne dlhá oblasť ticho
   padne na finančný profil, nie na chybu – AI je nadstavba a hráč má
   pod rukou statické vysvetlenie. */
const MAX_AREA_LENGTH = 60;

function profileForArea(area) {
  if (typeof area !== 'string' || area.length > MAX_AREA_LENGTH) return FINANCE_PROFILE;
  return AREA_PROFILES[area] || FINANCE_PROFILE;
}

async function handleRequest(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Len POST.' });
  }

  // 1) Rate limit per IP – najlacnejšia kontrola, PRED overením originu.
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

  /* ⚠️ SÚKROMIE: vyber VÝHRADNE tieto polia z tela požiadavky – nič iné
     (napr. nick, ak by ho klient niekedy omylom poslal) sa nepoužije. */
  const body = req.body || {};
  const question = body.question;
  const options = body.options;
  const correct = body.correct;
  const selected = body.selected;
  const explanation = body.explanation;
  /* Oblasť rozhoduje len o profile (prompt + počítadlo). Validuje sa
     v profileForArea() – zámerne BEZ 400, viď komentár tam. */
  const profile = profileForArea(body.area);

  // 3) Validácia a limity dĺžky vstupu – stále PRED volaním Anthropicu.
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ ok: false, error: 'Chýba alebo je neplatné pole "question".' });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ ok: false, error: `Pole "question" je príliš dlhé (max ${MAX_QUESTION_LENGTH} znakov).` });
  }
  if (!Array.isArray(options) || options.length < 2 || options.length > MAX_OPTIONS
      || !options.every(o => typeof o === 'string' && o.length <= MAX_OPTION_LENGTH)) {
    return res.status(400).json({ ok: false, error: 'Chýba alebo je neplatné pole "options".' });
  }
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
    return res.status(400).json({ ok: false, error: 'Neplatné pole "correct".' });
  }
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) {
    return res.status(400).json({ ok: false, error: 'Neplatné pole "selected".' });
  }
  if (selected === correct) {
    return res.status(400).json({ ok: false, error: 'Odpoveď je správna – vysvetlenie chyby nedáva zmysel.' });
  }
  if (typeof explanation !== 'string' || !explanation.trim()) {
    return res.status(400).json({ ok: false, error: 'Chýba alebo je neplatné pole "explanation".' });
  }
  if (explanation.length > MAX_EXPLANATION_LENGTH) {
    return res.status(400).json({ ok: false, error: `Pole "explanation" je príliš dlhé (max ${MAX_EXPLANATION_LENGTH} znakov).` });
  }

  /* 4) Tvrdý denný strop – posledná kontrola pred zaplatením volania.
     Počítadlo je PER PROFIL, takže dočasná téma a Finančná liga sa
     nemôžu navzájom vyčerpať. */
  const quota = await consumeDailyQuota(profile.counter, profile.limit);
  if (!quota.allowed) {
    return res.status(429).json({
      ok: false,
      error: 'Denný limit AI vysvetlení je vyčerpaný.',
      reason: quota.reason
    });
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
        /* ⚠️ ŽIADNE output_config.effort – Haiku 4.5 ho nepodporuje
           a request by skončil chybou. Úsilie sa tu ani nedá využiť:
           ide o krátke prerozprávanie hotového textu. */
        system: profile.system,
        messages: [
          { role: 'user', content: profile.buildUser(question, options, correct, selected, explanation) }
        ]
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      console.error('[quiz-feedback] Anthropic API neodpovedalo do ' + REQUEST_TIMEOUT_MS + ' ms.');
      return sendJson(res, 200, { ok: false, error: 'Anthropic API neodpovedalo včas (timeout).', reason: 'timeout' });
    }
    console.error('[quiz-feedback] volanie Anthropic API zlyhalo:', scrubSecrets(e && e.stack ? e.stack : e));
    return sendJson(res, 200, { ok: false, error: 'Volanie Anthropic API zlyhalo.', reason: 'network' });
  }
  clearTimeout(timeoutId);

  /* ⚠️ Stav a typ obsahu sa overujú PRED parsovaním – viď poznámku
     v api/grade-answer.js, tam to zhodilo celé hodnotenie. */
  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => '');
    console.error(`[quiz-feedback] Anthropic API vrátilo ${anthropicRes.status}: ` + scrubSecrets(anthropicErrorReason(errText)));
    return sendJson(res, 200, { ok: false, error: 'Anthropic API vrátilo chybu.', reason: 'anthropic-' + anthropicRes.status });
  }

  const contentType = (anthropicRes.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    const telo = await anthropicRes.text().catch(() => '');
    console.error(`[quiz-feedback] Anthropic nevrátilo JSON (content-type: ${contentType || '(chýba)'}):`, scrubSecrets(telo));
    return sendJson(res, 200, { ok: false, error: 'Anthropic API vrátilo neplatnú odpoveď (nie JSON).', reason: 'not-json' });
  }

  let data;
  try {
    data = await anthropicRes.json();
  } catch (e) {
    console.error('[quiz-feedback] odpoveď Anthropicu sa nedala rozparsovať:', scrubSecrets(e && e.message));
    return sendJson(res, 200, { ok: false, error: 'Anthropic API vrátilo neplatnú odpoveď (nie JSON).', reason: 'parse' });
  }

  /* Bezpečnostné klasifikátory môžu request odmietnuť (HTTP 200,
     stop_reason "refusal") – klient spadne na statické vysvetlenie. */
  if (data.stop_reason === 'refusal') {
    console.error('[quiz-feedback] model odmietol odpovedať (stop_reason: refusal).');
    return sendJson(res, 200, { ok: false, error: 'Model odmietol odpovedať.', reason: 'refusal' });
  }

  /* Odpoveď môže obsahovať aj thinking bloky – berieme len textové. */
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
    .trim();

  if (!text) {
    console.error('[quiz-feedback] v odpovedi chýba text, stop_reason:', data.stop_reason);
    return sendJson(res, 200, { ok: false, error: 'Anthropic API nevrátilo textovú odpoveď.', reason: 'no-text' });
  }

  return sendJson(res, 200, { ok: true, text });
}

/* Vonkajší obal – posledná poistka, viď api/grade-answer.js. Klient
   (quiz.js) kontroluje res.ok aj data.ok, takže pri ok:false tlačidlo
   ticho zmizne a hráčovi ostane statické vysvetlenie. */
module.exports = async (req, res) => {
  try {
    return await handleRequest(req, res);
  } catch (e) {
    console.error('[quiz-feedback] NEOČAKÁVANÁ CHYBA:', scrubSecrets(e && e.stack ? e.stack : e));
    return sendJson(res, 200, { ok: false, error: 'Vysvetlenie sa nepodarilo.', reason: 'unexpected' });
  }
};
