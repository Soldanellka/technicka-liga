'use strict';

/* ============================================================
   scripts/contentOverrides.js

   Firebase vrstva NAD pôvodným (read-only, statickým) data/*.json
   obsahom – rovnaký vzor ako memoryDefinitions.js biflovackaOverrides
   (Firebase prekryje zodpovedajúcu časť pri každom načítaní okruhu).

   Firebase: contentOverrides/{app}/{okruh}/{cast} = {
     app, okruh, cast, novyObsah, autor, rola, pecat, timestamp
   }
   - app: slug oblasti (AREA_SLUGS nižšie)
   - okruh: názov súboru bez prípony, napr. "A23"
   - cast: 'summary' | `quiz_${i}` | `tile_${i}` | `case_${ci}_step_${si}` (i/ci/si sú
     indexy do KANONICKÉHO, nezamiešaného poľa quiz[]/cases[].steps[]
     tak, ako ho vracia normalizeOkruh() – nikdy zo zamiešaného
     zobrazenia po shuffleOptions()).
   - novyObsah: pre 'summary' { summary }, pre otázku/krok
     { question, options, correct, explanation, zdroj }, pre dlaždicu
     { term, definition, zdroj }.
   - rola: skutočná Firebase rola autora (users/{nick}/role), nikdy
     lokálny "view" prepínač – inak by si hocikto mohol lokálne
     nastaviť pečať 🎓.
   - pecat: true ak rola === 'garant' (garantova zmena nesie pečať,
     viditeľnú všetkým hráčom).

   Task 3 (Firebase → GitHub sync) číta z tej istej kolekcie – nič sa
   tu NEZAPISUJE do súborov v repe, to je samostatná, oddelená akcia.
============================================================ */

export const AREA_SLUGS = {
  // Pripravované oblasti slug nepotrebujú – loader sa pre ne nespúšťa.
  'Osobné financie': 'osobne',
  'Investovanie': 'invest',
  'Makroekonómia': 'makro',
  // ⏳ dočasná téma, viď README-DEMO.md
  'Číselné sústavy': 'ciselne',
  'Logické funkcie': 'logika',
  'Počítačové siete': 'siete',
  'Elektrotechnika': 'elektro',
  'Fyzika': 'fyzika'
};

let fbApiPromise = null;
function fbApi() {
  if (!fbApiPromise) {
    fbApiPromise = import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  }
  return fbApiPromise;
}

/* Načíta všetky overridy pre daný okruh (jedno čítanie, nie N-krát
   per cast). Chýbajúca Firebase alebo chýbajúci override → {} –
   volajúci potom jednoducho zobrazí pôvodný JSON bez zmeny.

   ⚠️ NEMENIŤ signatúru ani správanie – používajú to študijné appky
   (ob-pravo-app, pravo-app) a Štátnicová sieň, ktoré načítavajú
   jednotlivé okruhy na požiadanie. Hlavná appka (data.js) prešla na
   loadContentOverridesForApp() nižšie. */
export async function loadContentOverrides(app, okruh) {
  try {
    const db = window.db;
    if (!db || !app || !okruh) return {};
    const { ref, get } = await fbApi();
    const snap = await get(ref(db, `contentOverrides/${app}/${okruh}`));
    return snap.exists() ? snap.val() : {};
  } catch (e) {
    console.warn(`⚠️ contentOverrides: čítanie zlyhalo pre ${app}/${okruh}`, e);
    return {};
  }
}

/* ============================================================
   OVERRIDY CELEJ OBLASTI NARAZ (pre loader v data.js)

   Uzol contentOverrides/{app} má tvar { [okruh]: { [cast]: payload } },
   takže overridesByApp[okruh] je BIT-IDENTICKÉ s tým, čo pre ten istý
   okruh vráti loadContentOverrides(app, okruh). Sémantika sa nemení,
   mení sa len zdroj: jeden get na oblasť namiesto jedného na okruh
   (233 čítaní pre celú appku → 6).

   ⚠️ ČAKANIE NA window.db JE NUTNÉ, nie kozmetika. firebase.js je
   v index.html až ZA data.js, takže window.db vzniká typicky až počas
   prvého fetchu loadera. Pri per-okruh čítaní by zlé načasovanie stálo
   overridy JEDNÉHO okruhu; tu by stálo overridy CELEJ oblasti – tichá
   strata obsahu, ktorú by nikto nevidel. Preto krátky bounded poll
   a hlasné console.warn, ak sa Firebase nedočkáme.
============================================================ */
const DB_WAIT_MS = 3000;
const DB_POLL_MS = 50;

function waitForDb() {
  if (window.db) return Promise.resolve(window.db);
  return new Promise(resolve => {
    const deadline = Date.now() + DB_WAIT_MS;
    const timer = setInterval(() => {
      if (window.db) { clearInterval(timer); resolve(window.db); return; }
      if (Date.now() >= deadline) { clearInterval(timer); resolve(null); }
    }, DB_POLL_MS);
  });
}

export async function loadContentOverridesForApp(app) {
  if (!app) return {};
  try {
    const db = await waitForDb();
    if (!db) {
      console.warn(
        `⚠️ contentOverrides: Firebase sa do ${DB_WAIT_MS} ms neobjavila – ` +
        `oblasť "${app}" sa načíta BEZ admin/garant úprav (pôvodný obsah z JSON).`
      );
      return {};
    }
    const { ref, get } = await fbApi();
    const snap = await get(ref(db, `contentOverrides/${app}`));
    return snap.exists() ? (snap.val() || {}) : {};
  } catch (e) {
    console.warn(`⚠️ contentOverrides: čítanie celej oblasti zlyhalo pre ${app}`, e);
    return {};
  }
}

/* Meta poslednej úpravy – vracia sa VŽDY, keď override existuje (nielen pri
   pečati), aby sa dala zobraziť stopa „✏️ Upravené … – autor" aj pri admin
   úprave. `pecat` rozlišuje, či ide navyše o akademickú pečať garanta.
   Pozn.: `type: 'garant'` ostáva kvôli spätnej kompatibilite tvaru, ale
   rozhoduje `pecat` – volajúci nesmie z existencie meta usudzovať pečať. */
export function sealMeta(ov) {
  if (!ov) return null;
  return {
    pecat: !!ov.pecat,
    type: ov.pecat ? 'garant' : 'admin',
    autor: ov.autor || '',
    rola: ov.rola || (ov.pecat ? 'garant' : 'admin'),
    timestamp: ov.timestamp || null
  };
}

/* Jednotný formát stopy poslednej úpravy pre celú appku (hlavná aj študijné).
   Vracia string alebo '' – DOM si stavia volajúci. */
/* Admin zasahuje NEVIDITEĽNE: že úpravu spravil admin, vidí len admin.
   Garantove úpravy vidia všetci aj s podpisom – garant za ne ručí menom a
   nesie akademickú pečať. Skrýva sa VÝHRADNE meno autora, nie samotný fakt
   úpravy ani dátum: hráč naďalej vidí, že otázka bola opravená.

   Rola prezerajúceho sa číta z `playerFirebaseRole` – to je SKUTOČNÁ rola
   z Firebase (ukladá ju initRoleSystem), nie náhľadový prepínač
   `playerRole`, takže admin v režime „garant“ podpis stále uvidí.
   Je to len zobrazovacia vec: čítať sa dá synchrónne počas renderu a
   prípadné podvrhnutie hodnoty v localStorage neodomkne žiadne právo,
   odhalilo by len meno – schvaľovacie práva idú cez getRealRole/Firebase. */
export function formatEditStamp(seal) {
  if (!seal) return '';
  const d = seal.timestamp ? new Date(seal.timestamp).toLocaleDateString('sk-SK') : '';

  let viewerRole = 'student';
  try { viewerRole = localStorage.getItem('playerFirebaseRole') || 'student'; } catch (e) {}
  const skryAutora = seal.rola === 'admin' && viewerRole !== 'admin';

  if (skryAutora) return `✏️ Upravené${d ? ' ' + d : ''}`;

  const kto = seal.autor || 'neznámy';
  return `✏️ Upravené${d ? ' ' + d : ''} – ${kto}${seal.pecat ? ' · 🎓 akademická pečať' : ''}`;
}

/* Navrství overrides na už normalizovaný okruh (normalizeOkruh()).
   Nemutuje vstup – vracia nový objekt. Chýbajúci override pre danú
   časť necháva pôvodnú hodnotu bez zmeny (žiadny fiktívny stav). */
export function applyContentOverrides(json, overrides) {
  if (!json || !overrides || !Object.keys(overrides).length) return json;

  const result = { ...json };

  const summaryOv = overrides.summary;
  if (summaryOv && summaryOv.novyObsah && typeof summaryOv.novyObsah.summary === 'string') {
    result.summary = summaryOv.novyObsah.summary;
    result._summarySeal = sealMeta(summaryOv);
  }

  if (Array.isArray(json.quiz)) {
    result.quiz = json.quiz.map((q, i) => {
      const ov = overrides[`quiz_${i}`];
      if (!ov || !ov.novyObsah) return q;
      return { ...q, ...ov.novyObsah, _seal: sealMeta(ov) };
    });
  }

  /* Kartičky/dlaždice – rovnaký per-index vzor ako quiz vyššie (tiles je pole
     { term, definition, zdroj? } so stabilnými indexmi). Guard na pole: okruhy
     bez tiles ostanú nedotknuté. */
  if (Array.isArray(json.tiles)) {
    result.tiles = json.tiles.map((t, i) => {
      const ov = overrides[`tile_${i}`];
      if (!ov || !ov.novyObsah) return t;
      return { ...t, ...ov.novyObsah, _seal: sealMeta(ov) };
    });
  }

  if (Array.isArray(json.cases)) {
    result.cases = json.cases.map((c, ci) => {
      if (!Array.isArray(c.steps)) return c;
      const steps = c.steps.map((s, si) => {
        const ov = overrides[`case_${ci}_step_${si}`];
        if (!ov || !ov.novyObsah) return s;
        return { ...s, ...ov.novyObsah, _seal: sealMeta(ov) };
      });
      return { ...c, steps };
    });
  }

  return result;
}

/* Pomocník pre loadery: normalizeOkruh(raw) → navrstviť overridy.
   app = AREA_SLUGS[areaTitle], okruh = napr. "A23". */
export async function applyOverridesForOkruh(json, areaTitle, okruh) {
  const app = AREA_SLUGS[areaTitle];
  if (!app || !okruh) return json;
  const overrides = await loadContentOverrides(app, okruh);
  return applyContentOverrides(json, overrides);
}

/* Rovnaké ako applyOverridesForOkruh, ale bez siete – overridy si volajúci
   načítal dopredu jedným loadContentOverridesForApp(app). SYNCHRÓNNE, takže
   sa dá volať v tesnej slučke bez awaitu.

   Výsledok je zhodný s applyOverridesForOkruh(): oba nakoniec volajú tú istú
   applyContentOverrides() s objektom { [cast]: payload } pre daný okruh –
   jeden ho má z per-okruh getu, druhý z predčítanej mapy oblasti. */
export function applyOverridesFromMap(json, areaTitle, okruh, overridesByOkruh) {
  const app = AREA_SLUGS[areaTitle];
  if (!app || !okruh) return json;
  const overrides = (overridesByOkruh && overridesByOkruh[okruh]) || {};
  return applyContentOverrides(json, overrides);
}

/* Uloží/aktualizuje jeden override (admin alebo garant). `rola` musí
   byť SKUTOČNÁ Firebase rola volajúceho (users/{nick}/role) – volajúci
   kód ju musí sám overiť pred zavolaním tejto funkcie. */
export async function saveContentOverride({ app, okruh, cast, novyObsah, autor, rola }) {
  const db = window.db;
  if (!db) throw new Error('Firebase nie je dostupná – zmena sa neuložila.');
  if (!app || !okruh || !cast) throw new Error('Chýba app/okruh/cast pre uloženie zmeny.');

  const { ref, update } = await fbApi();
  /* `committed: false` sa musí zapísať EXPLICITNE. update() payload merguje,
     takže vlajka z predchádzajúceho syncu by prežila uloženie novej verzie
     textu a sync by úpravu považoval za vybavenú (stalo sa po prvom synce
     pri TPP A13–A17). Rovnako sa čistí committedHash/commitSha, nech
     nezostane odtlačok cudzieho obsahu. Server má vlastnú, nezávislú
     kontrolu podľa hashu – toto je poistka, nie jediná obrana. */
  const payload = {
    app, okruh, cast, novyObsah,
    autor: autor || 'Anonymous',
    rola: rola === 'garant' ? 'garant' : 'admin',
    pecat: rola === 'garant',
    timestamp: Date.now(),
    committed: false,
    committedAt: null,
    committedHash: null,
    commitSha: null
  };
  await update(ref(db, `contentOverrides/${app}/${okruh}/${cast}`), payload);
  return payload;
}
