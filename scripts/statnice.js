'use strict';

/* ============================================================
   scripts/statnice.js
   Štátnicová sieň – interaktívna komisia (v3). Podporované oblasti:
   Pracovné právo a Európske právo (jeden bazén, dvojica okruhov
   A(2k-1)+A(2k)) a Občianske právo (DVA oddelené bazény – hmotné +
   procesné, po jednom náhodnom okruhu z každého). Nová oblasť sa
   pridáva do AREA_CONFIG nižšie, bez zásahu do existujúcich oblastí.

   ⚠️ HODNOTENIE (Fáza 3, 2026-07-19): PRIMÁRNE cez /api/grade-answer
   (Claude Haiku, serverless, viď api/grade-answer.js) – posudzuje aj
   VECNÚ SPRÁVNOSŤ (`incorrect`), čo lokálny substitút nikdy nevedel.
   Pri AKOMKOĽVEK zlyhaní volania (sieť/timeout/HTTP chyba/neplatný
   JSON/neplatný tvar) sa TICHO spadne na lokálny evaluateCoverage()
   nižšie – študent NIKDY nezostane bez hodnotenia. Do konzoly sa
   vždy zaloguje, keď sa fallback použil, viď gradeAnswer() nižšie.

   extractKeyPoints() zostáva lokálna substitúcia "Krok A" (parsuje
   existujúcu sekciu "Kľúčové slová (štátnicové):" v každom `summary`
   – to sú presne tie isté "kľúčové body", ktoré by Claude vytiahol,
   len už vopred pripravené autorkou obsahu) – server dostáva tieto
   už-extrahované keyPoints, nerobí extrakciu sám.

   evaluateCoverage() zostáva ako FALLBACK substitút "Kroku B": každý
   kľúčový bod sa overuje samostatne cez prítomnosť jeho vlastných
   podstatných slov v odpovedi – parafráza/iné poradie viet bodu
   neuškodí, kým zaznejú jeho nosné pojmy. `incorrect` (vecne zlé
   tvrdenia) lokálne spoľahlivo nevieme rozpoznať – vo fallbacku
   ostáva vždy prázdne pole (poctivo priznané obmedzenie substitútu).
   Oba výstupy (LLM aj lokálny fallback) majú po namapovaní presne
   ten istý JSON tvar, takže zvyšok súboru (enterHodnotenie a ďalej)
   nevie a nepotrebuje vedieť, ktorý z nich práve odpovedal.

   Prepis odpovede a poznámky sa NIKDY neukladajú verejne – len
   dočasne v pamäti tejto relácie. Voliteľne sa ukladá len výsledná
   známka + dátum + oblasť do users/{nick}/examResults.
============================================================ */

import { econAward, econEnergyLeft, econEnergyMissingMsg, econSpendEnergy, ECONOMY_CONFIG }
from './economy.js';
import { escapeHtml } from '../core.js';
import { getAvatarCatalog, getTalarAvatars, avatarStateSrc } from './avatarCatalog.js';
import { showRewardToast } from '../ui.js';
import { speakText, isSpeechRecognitionSupported, createSpeechRecognizer, isLikelyDesktop } from '../memoryTrainer.js';
import { normalizeOkruhText, normalizeZdroj } from './contentNormalize.js';
import { applyOverridesForOkruh } from './contentOverrides.js';
import { renderSource } from './sourceUtil.js';
import { ensureVoicesLoaded, pickVoice, getAvailableSkGenders } from '../biflovackaVideo.js';
import { recordOkruhResult, PROGRESS_ACTIVITIES } from './progressTracking.js';

/* ZÁMERNE relatívna cesta – demo nesmie ťahať obsah z produkčnej domény. */
const LIVE = '';
const OSOBNE_AREA_NAME = 'Osobné financie';
const OSOBNE_DATA_PATH = LIVE + 'data/';
/* ⚠️ count = koľko okruhov má SKÚŠKOVÝ obsah (zhrnutie, z ktorého
   extractKeyPoints vráti aspoň jeden bod), nie koľko je súborov. */
const OSOBNE_OKRUH_COUNT = 2;

const INVEST_AREA_NAME = 'Investovanie';
const INVEST_DATA_PATH = LIVE + 'data/invest/';
const INVEST_OKRUH_COUNT = 2;

const MAKRO_AREA_NAME = 'Makroekonómia';
const MAKRO_DATA_PATH = LIVE + 'data/makro/';
const MAKRO_OKRUH_COUNT = 2;

/* ============================================================
   REGISTER OBLASTÍ ŠTÁTNICOVEJ SIENE – nová oblasť sa pridáva sem,
   bez zásahu do existujúcich záznamov.
   - mode "pair": JEDEN bazén, dvojica okruhov A(2k-1)+A(2k)
     (rovnaké párovanie ako pojednávania v scripts/duels.js).
   - mode "dual-pool": DVA oddelené bazény, po JEDNOM náhodnom
     okruhu z každého (napr. hmotné + procesné právo).
   progressAreaTitle/pools[].progressAreaTitle – MUSÍ byť presne zhodné s
   DASHBOARD_AREAS[].subAreas[].areaTitle v scripts/dashboardStats.js, inak
   getOkruhPercentMap() nenájde žiadny progres (findAreaAndSubArea zlyhá
   ticho, vráti {} – čo je v poriadku, len spustí poistku nováčika nižšie).
============================================================ */
/* Len oblasti s hotovým obsahom. Pripravovaná oblasť sa sem pridá až
   spolu so svojimi zhrnutiami – dovtedy ju AI skúška neponúka. */
const AREA_CONFIG = {
  [OSOBNE_AREA_NAME]: {
    mode: 'pair',
    pool: { path: OSOBNE_DATA_PATH, count: OSOBNE_OKRUH_COUNT },
    progressAreaTitle: 'Osobné financie'
  },
  [INVEST_AREA_NAME]: {
    mode: 'pair',
    pool: { path: INVEST_DATA_PATH, count: INVEST_OKRUH_COUNT },
    progressAreaTitle: 'Investovanie'
  },
  [MAKRO_AREA_NAME]: {
    mode: 'pair',
    pool: { path: MAKRO_DATA_PATH, count: MAKRO_OKRUH_COUNT },
    progressAreaTitle: 'Makroekonómia'
  }
};

/* ============================================================
   KOĽKO OTÁZOK SKÚŠKA POLOŽÍ

   Demo kladie JEDNU otázku: jedno zadanie → jedna ústna odpoveď →
   hodnotenie. Plná verzia mala dve. Návrat = zmena tohto jedného čísla.

   ⚠️ Prečo sa témy najprv načítajú DVE a až potom oreže:
   buildTopicsFromSharedSelection() má tri stráže na `topics.length < 2`
   (doplnenie z bazéna, vzdanie sa, hláška „Komisia nie je dostupná“).
   Tie ZÁMERNE ostávajú nedotknuté – naďalej overia, že sa zdieľaná
   dvojica okruhov naozaj načítala. Orezanie je až posledný krok, takže
   sa nemôže stať, že by skúška odštartovala nad rozbitým obsahom.
   Cena je jeden načítaný a zahodený JSON – lokálny a malý.

   Tok skúšky je na počte nezávislý: advanceQuestion() ide na ďalšiu
   tému, kým `nextIdx < topics.length`, inak prejde na záver. Pri jednej
   téme teda položí jednu otázku a rovno hodnotí.
============================================================ */
const EXAM_TOPIC_COUNT = 1;

/* ============================================================
   PERSÓNY SKÚŠAJÚCEHO – menia VÝHRADNE TÓN/ZNENIE spätnej väzby.
   Hodnotenie je 100% lokálne (extractKeyPoints + evaluateCoverage,
   pozri vyššie) – žiadny LLM prompt v appke neexistuje, takže tu nejde
   o rozdelenie "hodnotiaci prompt vs. podávací prompt", ale presne o to,
   čo pýta zadanie pre lokálne hodnotenie: persóna mení len textové
   šablóny (buildPersonaFeedback nižšie), NIKDY evaluateCoverage() ani
   znamka v buildFinalFeedback() – tá sa počíta úplne rovnako pre
   všetky tri, priamo z tej istej `evaluations` štruktúry.
============================================================ */
const EXAM_PERSONA_KEY = 'lexExamPersona';
const EXAM_VOICE_KEY = 'lexExamVoice'; // 'm' | 'f' | 'off'
const DEFAULT_PERSONA = 'rational';

const PERSONAS = {
  strict: {
    emoji: '🎓', label: 'Profesor',
    desc: 'Náročný a vecný, žiadne chválenie navyše.',
    greet: (title) => `Začnite prosím prvou otázkou: ${title}.`,
    next: (title) => `Ďalšia otázka: ${title}.`,
    followUp: (point) => `Toto je neúplné – chýba: ${point}. Doplňte to.`,
    followUpGeneric: (title) => `Odpoveď je nedostatočná. Rozveďte podstatné náležitosti k otázke „${title}".`,
    coveredLine: (title, covered) => `Téma „${title}" – zvládnuté body: ${covered.join('; ')}.`,
    // znamka 1-2: pôvodné znenie (nemenené – tón má ostať uznanlivý/vecný,
    // nie sa sprísniť). znamka 3-4: kritickejšie, BEZ zľahčovania rozsahu
    // medzery (žiadne "len doplňte") – presne podľa zadania 2026-07-19.
    missingLine: (title, missing, znamka) => {
      if (znamka >= 4) return `Téma „${title}" – zásadne nezodpovedané, chýba: ${missing.join('; ')}.`;
      if (znamka >= 3) return `Téma „${title}" – odpoveď má podstatné medzery, chýba: ${missing.join('; ')}.`;
      return `Téma „${title}" – chýba, doštudujte: ${missing.join('; ')}.`;
    },
    // Vecná chyba (LLM incorrect[]) – ODLIŠNÉ od missingLine: toto NIE JE
    // chýbajúci bod na doplnenie, je to NESPRÁVNE tvrdenie. anyIncorrect vždy
    // vynúti znamka>=2 (buildFinalFeedback, zmiernenie round 1 2026-08), takže
    // táto veta sa nikdy nezobrazí pri znamke 1 – vecné znenie sedí pre 2-4.
    incorrectLine: (title, incorrect) => `Téma „${title}" – vecná chyba (nesprávne tvrdenie, nie chýbajúci bod): ${incorrect.join('; ')}.`,
    noCoveredFallback: 'Žiadny bod nebol pokrytý dostatočne.',
    odporucaniaWithGaps: ['Zamerajte sa presne na vymenované chýbajúce body – bez toho skúška neobstojí.', 'Držte štruktúru: pojem → znaky → príklad.'],
    odporucaniaClean: ['Držte túto úroveň, netreba poľaviť.'],
    zaver: {
      1: 'Solídny výkon, bez zásadných výhrad.',
      2: 'Priemer – medzery sú viditeľné, doriešte ich.',
      3: 'Slabé. Toto si musíte zásadne doštudovať.',
      4: 'Nedostatočné. Pri reálnej komisii by ste takto neuspeli.'
    }
  },
  supportive: {
    emoji: '🤝', label: 'Lektor',
    desc: 'Povzbudí, oceňuje, medzery pomenuje láskavo.',
    greet: (title) => `Poď smelo na prvú otázku: ${title}. Netreba sa báť, poďme na to spolu.`,
    next: (title) => `Skvele, ideme ďalej. Ďalšia otázka: ${title}.`,
    followUp: (point) => `Dobrý základ! Ešte by som privítal/a doplniť: ${point}. Skús to rozviesť.`,
    followUpGeneric: (title) => `Skús sa k otázke „${title}" vrátiť a doplniť, čo ťa napadne navyše – pokojne aj krok za krokom.`,
    coveredLine: (title, covered) => `Pri téme „${title}" ti pekne sadli tieto body: ${covered.join('; ')}.`,
    // znamka 1-2: pôvodné znenie (nemenené). znamka 3-4: aj podporujúca
    // persóna smie zostať vecná v DELIVERY tónu (voľba slov "poďme sa
    // pozrieť"), ale nesmie MINIMALIZOVAŤ rozsah medzery – preč "len kúsok
    // práce navyše", ktoré presne zodpovedalo nahlásenému problému.
    missingLine: (title, missing, znamka) => {
      if (znamka >= 4) return `Pri téme „${title}" toto zásadne chýba, nie je to drobnosť: ${missing.join('; ')}.`;
      if (znamka >= 3) return `Pri téme „${title}" chýba podstatná časť, poďme sa na to pozrieť: ${missing.join('; ')}.`;
      return `Pri téme „${title}" ešte doplň: ${missing.join('; ')} – je to len kúsok práce navyše.`;
    },
    incorrectLine: (title, incorrect) => `Pri téme „${title}" si niečo povedal/a nesprávne, nie len neúplne – to treba opraviť, nie doplniť: ${incorrect.join('; ')}.`,
    noCoveredFallback: 'Aspoň si sa pokúsil/a odpovedať – budeme na tom stavať ďalej.',
    odporucaniaWithGaps: ['Zameraj sa na chýbajúce body vyššie, zvládneš to.', 'Skús si pri učení držať štruktúru pojem → znaky → príklad, pomôže ti to zapamätať si viac.'],
    odporucaniaClean: ['Skvelá práca, pokojne skús aj náročnejšie okruhy!'],
    zaver: {
      1: 'Výborne, naozaj pekný výkon! Tému zvládaš na vysokej úrovni.',
      2: 'Veľmi pekné, drobné medzery vôbec neubrali na dojme.',
      3: 'Odpoveď má podstatné medzery – poďme sa na ne pozrieť, nech to nabudúce sedí.',
      4: 'Táto odpoveď zásadne nezodpovedá téme – viaceré veci chýbali alebo boli vecne nesprávne. Poďme sa na okruh pozrieť odznova, nech budúca odpoveď sedí.'
    }
  },
  rational: {
    emoji: '📊', label: 'Skúšajúci',
    desc: 'Bez emócií – fakty: čo odznelo, čo chýba, čo je správne.',
    greet: (title) => `Nech sa páči, môžete začať odpovedať na prvú otázku: ${title}.`,
    next: (title) => `Ďakujeme. Ďalšia otázka: ${title}.`,
    followUp: (point) => `Spomenuli ste tému, no chýba mi konkrétny bod – ${point}. Viete to bližšie vysvetliť?`,
    followUpGeneric: (title) => `Môžete to rozviesť a doplniť podstatné náležitosti k otázke „${title}"?`,
    coveredLine: (title, covered) => `Téma „${title}" – pokryté: ${covered.join('; ')}.`,
    // znamka 1-2: pôvodné znenie (nemenené). znamka 3-4: kritickejšie.
    missingLine: (title, missing, znamka) => {
      if (znamka >= 4) return `Téma „${title}" – zásadne nezodpovedané: ${missing.join('; ')}.`;
      if (znamka >= 3) return `Téma „${title}" – podstatná medzera, chýba: ${missing.join('; ')}.`;
      return `Téma „${title}" – doštudovať: ${missing.join('; ')}.`;
    },
    incorrectLine: (title, incorrect) => `Téma „${title}" – vecne nesprávne (nie chýbajúce, ale NESPRÁVNE tvrdenie): ${incorrect.join('; ')}.`,
    noCoveredFallback: 'Snaha odpovedať.',
    odporucaniaWithGaps: ['Zameraj sa na vymenované chýbajúce body – doštuduj ich v plnom vypracovaní okruhu.', 'Drž sa štruktúry: pojem → znaky → príklad.'],
    odporucaniaClean: ['Pokračuj v tomto tempe, skús aj náročnejšie okruhy.'],
    zaver: {
      1: 'Výborný výkon – tému ovládaš na vysokej úrovni.',
      2: 'Veľmi dobrý výkon, drobné medzery neubrali na celkovom dojme.',
      3: 'Odpoveď má podstatné medzery, viaceré kľúčové body chýbajú – pozri si odporúčania.',
      4: 'Odpoveď zásadne nezodpovedá požadovanému rozsahu – chýbajú kľúčové body alebo obsahuje vecné chyby. Tému si dôkladne preštuduj znova.'
    }
  }
};

function getPersona(key) {
  return PERSONAS[key] || PERSONAS[DEFAULT_PERSONA];
}

/* ============================================================
   HLAS KOMISIE – nadväzuje na existujúci mechanizmus z bifľovačky
   (pickVoice/ensureVoicesLoaded z biflovackaVideo.js), NEROBÍ druhý.
   Prísnejšia politika než video: video akceptuje aj cs alebo hocijaký
   hlas ako náhradu, štátnica NIE – ak nie je žiadny sk hlas, radšej
   ticho (len text) než cudzojazyčný hlas v skúškovej situácii.
============================================================ */
async function resolveExamVoice(voicePref) {
  if (voicePref === 'off' || !('speechSynthesis' in window)) return null;
  await ensureVoicesLoaded();
  const voices = window.speechSynthesis.getVoices();
  const hasSk = voices.some(v => v.lang && v.lang.toLowerCase().startsWith('sk'));
  if (!hasSk) return null; // žiadny SK hlas → ticho, len text (bez chyby, bez mätúcej hlášky)

  if (voicePref === 'm' || voicePref === 'f') return pickVoice(voicePref);

  // voicePref === 'voice' – neutrálna voľba bez sľubu pohlavia (buildPersonaOverlay
  // ju ponúka len keď je k dispozícii PRÁVE JEDNO rozlíšiteľné pohlasie); zober to,
  // ktoré reálne existuje, nech pickVoice() nájde skutočnú zhodu, nie náhodný pool[0].
  const { hasMale, hasFemale } = getAvailableSkGenders();
  return pickVoice(hasFemale && !hasMale ? 'f' : 'm');
}

/* Prehrá text daným hlasom komisie, alebo ak examVoice===null (vypnuté
   / žiadny sk hlas), rovno zavolá onEnd bez čakania – žiadna 6s pauza
   na TTS fallback, keď sa ani nepokúšame hovoriť.

   ⚠️ cancelPrevious:false – speakText() by inak PRED KAŽDÝM (aj druhým,
   tretím...) prejavom nepodmienene zavolal speechSynthesis.cancel().
   Zdokumentovaný Chrome/Android bug: cancel() tesne pred ďalším .speak()
   v tej istej relácii vie spôsobiť, že onend NASLEDUJÚCEJ utterance
   vystrelí takmer okamžite – predtým, než z reproduktora reálne čokoľvek
   zaznie. Presne to vysvetľuje vzor "prvá otázka OK, druhá+ nie" (prvý
   prejav na stránke nemá čo cancelovať, každý ďalší áno). Cancelujeme
   preto LEN keď je reálne čo cancelovať (niečo ešte beží/čaká na
   prehratie) – nikdy nepodmienene pred každým volaním. */
function speakOrSkip(text, examVoice, { onEnd }) {
  if (!examVoice) { if (onEnd) onEnd(); return; }
  if (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  const played = speakText(text, { voice: examVoice.voice, pitch: examVoice.pitch, onEnd, cancelPrevious: false });
  if (!played && onEnd) onEnd();
}

const PREP_SECONDS = 5 * 60;
const ON_TOPIC_MIN_THRESHOLD = 15;   // pod týmto = úplne mimo témy (guard proti falošne kladnému skóre)
const MAX_FOLLOWUPS_PER_QUESTION = 2;

/* ⚠️ ODHAD, nie meranie – rôzne hlasy/zariadenia hovoria rôzne rýchlo, takže
   toto NIKDY nesmie byť to, čo primárne spúšťa počúvanie. Skutočný spúšťač
   JE VŽDY utterance.onend (viď speakThenListen nižšie) – tento časovač
   slúži VÝHRADNE ako poistka pre prípad, že onend v danom prehliadači/
   zariadení vôbec nepríde (zdokumentovaný okrajový prípad Web Speech API,
   nie bežný stav). Preto ×3 rezerva navyše oproti odhadu (2026-07-18:
   zdvihnuté z ×2.5 – aj pri podstatne pomalšom hlase/zariadení má poistka
   spustiť počúvanie AŽ PO reálnom konci reči, nikdy pred ním; radšej pár
   sekúnd zbytočne čaká, než aby zachytila vlastný hlas komisie). */
function estimateSpeechMs(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length || 1;
  return Math.min(30000, Math.max(4000, words * 450 + 2000));
}
function ttsFallbackDelay(text) {
  return Math.min(60000, estimateSpeechMs(text) * 3);
}

function getDb() { return window.db || null; }
function getNick() { return localStorage.getItem('playerNick') || null; }

// isLikelyDesktop() – zdieľané s bifľovačkou (memory-trainer.html), presunuté
// a exportované z memoryTrainer.js (2026-07-19), kde žije aj createSpeechRecognizer.
// Pozri jeho JSDoc tam pre plný rozbor (best-effort signál, nikdy bariéra).

export function isStatniceAvailable(areaName) {
  return Object.prototype.hasOwnProperty.call(AREA_CONFIG, areaName);
}

/* ============================================================
   VÝBER DVOJICE OKRUHOV (A1+A2, A3+A4, …, A49+A50) – rovnaké
   párovanie ako pojednávania (scripts/duels.js pickQuestions).
============================================================ */

/* ------------------------------------------------------------
   Lokálny tokenizér pre porovnávanie kľúčových bodov (nezávislý
   od memoryTrainer.js – tento súbor porovnáva JEDNOTLIVÉ krátke
   body, nie celé odseky, takže si vystačí s vlastnou jednoduchou
   verziou bez závislosti na inom module).
------------------------------------------------------------ */
const SK_STOPWORDS = new Set([
  'a', 'alebo', 'ale', 'je', 'sa', 'na', 'v', 'vo', 'do', 'z', 'zo', 'za', 'pre', 'ako', 'pri', 'po', 'od',
  'ku', 'k', 's', 'so', 'ktory', 'ktora', 'ktore', 'ktori', 'tento', 'tato', 'toto', 'tieto', 'nie', 'ano',
  'aj', 'uz', 'len', 'iba', 'teda', 'preto', 'ak', 'ci', 'no', 'tak', 'byt', 'bol', 'bola', 'boli', 'ma',
  'maju', 'mat', 'su', 'bude', 'budu', 'ich', 'jej', 'jeho', 'im', 'mu', 'ju', 'ho', 'ten', 'ta', 'to', 'ti', 'tie'
]);
const DIACRITIC_MAP = {
  'á': 'a', 'ä': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'í': 'i', 'ĺ': 'l', 'ľ': 'l',
  'ň': 'n', 'ó': 'o', 'ô': 'o', 'ŕ': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ý': 'y', 'ž': 'z'
};
function stripDiacritics(s) {
  return String(s).split('').map(ch => DIACRITIC_MAP[ch] || ch).join('');
}
function normalizeWords(text) {
  return stripDiacritics(String(text || '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
function significantWords(text) {
  return normalizeWords(text).filter(w => w.length > 3 && !SK_STOPWORDS.has(w));
}

/* ------------------------------------------------------------
   extractKeyPoints() – lokálny substitút za "Krok A" (Claude API
   extrakcia kľúčových bodov). Každý A*.json má v `summary` sekciu
   "Kľúčové slová (štátnicové):" – presne zoznam bodov, ktoré má
   Claude podľa zadania vytiahnuť, tu už vopred pripravený autorkou
   obsahu. Fallback (ak sekcia chýba): rozdeliť hlavný text na vety.
------------------------------------------------------------ */
function extractKeyPoints(rawSummary, title) {
  const text = String(rawSummary || '');

  /* Tri tvary nadpisu, všetky od autorky obsahu:
     - staršie zhrnutia (Pracovné, Občianske, EÚ): „Kľúčové slová (štátnicové):"
     - Trestné hmotné aj procesné:                „Zapamätaj si …"
     - staršie Trestné procesné:                  „Zhrnutie (štátnicové jadro)"

     Vzor „Zapamätaj si" je zámerne TOLERANTNÝ na prívlastok aj interpunkciu –
     `[^\n:]*:?` pokryje „Zapamätaj si", „Zapamätaj si:" aj „Zapamätaj si
     (štátnicové jadro)", `i` navyše veľkosť písmen. Overené na všetkých
     štyroch tvaroch (2026-08-07), netreba ho rozširovať.

     Poradie „Zapamätaj si" PRED „Zhrnutie" je podstatné: TPP A3–A7 majú OBE
     sekcie – „Zhrnutie" hore ako súvislý odstavec a „Zapamätaj si" dole ako
     zoznam odrážok. Jadrom je ten zoznam, preto sa „Zhrnutie" uplatní len
     ako záloha pre okruhy, ktoré zoznam nemajú.
     Druhý a tretí nadpis NEMAJÚ dvojbodku a sekcia končí až pri „Zdroj", preto
     majú vlastné vzory, nie rozšírenie prvého. Poradie je zámerné: prvý vzor sa
     skúša najskôr, takže pre existujúce oblasti sa správanie nemení vôbec.
     Texty autorky sa nijako neupravujú – prispôsobuje sa parser. */
  const sectionMatch =
       text.match(/Kľúčové slová[^:]*:\s*\n([\s\S]*?)(?=\n\nZapamätaj si|\n\n$|$)/i)
    /* Odrážky NA TOM ISTOM RIADKU ako nadpis – „Zapamätaj si (štátnicové jadro)
       – prvý bod. – druhý bod." Musí sa skúšať PRED riadkovým vzorom nižšie:
       ten by pri takomto tvare preskočil celý zoznam a zachytil až nasledujúci
       odstavec, teda spravidla citáciu zákona (namerané pri TPP A10 a A11 –
       jediným „kľúčovým bodom" bol riadok „Zdroj (overené) – Trestný poriadok…").
       Podmienka `[ \t]*–` nesmie prejsť cez koniec riadka, takže texty
       s odrážkami na ďalších riadkoch (TPH, väčšina TPP) sem nespadnú. */
    || text.match(/Zapamätaj si[^\n:]*?:?[ \t]*(–[^\n]*)(?=\n|$)/i)
    || text.match(/Zapamätaj si[^\n:]*:?[ \t]*\n([\s\S]*?)(?=\n\nZdroj|\n\n$|$)/i)
    /* ⚠️ „Zhrnutie (štátnicové jadro)" má INÚ polohu než predošlé dva: nestojí
       na konci ako zoznam odrážok, ale HORE, hneď za úvodným odstavcom, a
       nasleduje ho jeden hutný odstavec jadra – až potom ide celý rozpísaný
       text okruhu. Preto sa berie len po PRVÝ prázdny riadok, nie po „Zdroj";
       inak by sa ako „kľúčové body" zobral celý okruh (namerané: 30 bodov pri
       TPP A1 namiesto jadra). */
    || text.match(/Zhrnutie[^\n:]*:?[ \t]*\n([\s\S]*?)(?=\n[ \t]*\n|$)/i);

  if (sectionMatch) {
    const rawLines = sectionMatch[1]
      /* Odrážky natlačené do jedného riadka („… = § 89a. – Odňatie veci = § 90.")
         sa najprv rozlámu na samostatné riadky. Vzor je úzky ZÁMERNE – vyžaduje
         koniec vety pred pomlčkou, takže bežnú pomlčku vnútri vety
         („Vec dôležitá – definícia") nerozdelí. */
      .replace(/([.:;])\s+[–—-]\s+/g, '$1\n')
      .split('\n')
      // Odrážky: pomlčka, en/em pomlčka aj guľôčka – novšie zhrnutia používajú „–".
      .map(l => l.replace(/^[-–—•]\s*/, '').trim())
      .filter(Boolean);

    // Niektoré okruhy majú "Kľúčové slová:" ako JEDEN riadok pojmov oddelených
    // bodkočiarkou namiesto odrážky na riadok – bez rozdelenia by z toho vznikol
    // jeden obrovský "bod" namiesto samostatne overiteľných kľúčových bodov.
    const points = [];
    rawLines.forEach(line => {
      const segments = line.split(';').map(s => s.replace(/[.,]\s*$/, '').trim()).filter(Boolean);
      if (segments.length > 1) points.push(...segments);
      else points.push(line.replace(/[.,;]\s*$/, '').trim());
    });
    if (points.length) return points.filter(Boolean);
  }

  const cutMarkers = ['\n\nPríklad:', '\nPríklad:', '\n\nKľúčové slová', '\nKľúčové slová'];
  let cutIdx = text.length;
  for (const m of cutMarkers) {
    const idx = text.indexOf(m);
    if (idx !== -1 && idx < cutIdx) cutIdx = idx;
  }
  const narrative = text.slice(0, cutIdx).trim();
  // Bežné skratky (napr., resp., atď., zák., čl., ods., písm., tzv.) majú bodku,
  // ktorá NIE je koniec vety – bez ochrany by sa veta rozsekla uprostred a bod
  // by pôsobil ako polovičatá, gramaticky rozbitá veta (najmä v doplňujúcej otázke).
  const protectedText = narrative.replace(/\b(napr|resp|atď|atd|zák|čl|ods|písm|tzv|tzn|str|tj)\.(\s)/gi, '$1∎$2');
  const sentences = protectedText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/∎/g, '.').trim())
    .filter(s => s.length > 25);
  return sentences.length ? sentences.slice(0, 6) : (title ? [title] : []);
}

/* Preklad basePath → názov oblasti pre contentOverrides (AREA_SLUGS kľúčuje
   podľa NÁZVU oblasti, nie cesty). Odvodené z AREA_CONFIG, aby pribudnutie
   oblasti nevyžadovalo ďalšiu tabuľku. */
function areaTitleForPath(basePath) {
  for (const [areaName, config] of Object.entries(AREA_CONFIG)) {
    if (config.mode === 'pair' && config.pool.path === basePath) {
      return config.progressAreaTitle || areaName;
    }
    if (config.mode === 'dual-pool') {
      const pool = config.pools.find(p => p.path === basePath);
      if (pool) return pool.progressAreaTitle;
    }
  }
  return null;
}

async function fetchOkruh(basePath, n) {
  try {
    const res = await fetch(`${basePath}A${n}.json`);
    if (!res.ok) return null;
    let json = await res.json();
    if (!json || !json.title) return null;

    /* Firebase overridy (garant/admin úpravy zhrnutí) – rovnaká klientská
       cesta, akou ich aplikuje zvyšok appky (data.js, memoryDefinitions.js).
       Bez toho sieň skúšala z pôvodného textu v repe, nie z vyeditovaných
       zhrnutí, a bola tak závislá od toho, či prebehol GitHub sync.

       Fail-soft: applyOverridesForOkruh vracia pri chýbajúcej Firebase,
       neznámej oblasti aj chýbajúcom override PÔVODNÝ json bez zmeny, takže
       fallback na súbor je automatický a nepotrebuje vlastnú vetvu.
       Náklad: jedno čítanie contentOverrides/{app}/{okruh} na okruh, teda
       2 navyše na skúšku – deje sa raz pri štarte, súbežne s fetchom
       samotného okruhu, nie počas odpovedania. */
    const areaTitle = areaTitleForPath(basePath);
    if (areaTitle) json = await applyOverridesForOkruh(json, areaTitle, `A${n}`);

    const summaryText = normalizeOkruhText(json);
    if (!summaryText) return null;
    const keyPoints = extractKeyPoints(summaryText, json.title);
    if (!keyPoints.length) return null;
    // Glosár okruhu (Fáza D.3) – tiles = 5 kurátorovaných pojmov + definícií,
    // rovnaký zdroj ako kartičky/duel. Použité v evaluateCoverage() na
    // hodnotenie právnej terminológie ako ZLOŽKY známky, nie celej známky.
    const glossary = Array.isArray(json.tiles) ? json.tiles.map(t => t && t.term).filter(Boolean) : [];
    // summary: surový text zhrnutia okruhu – dnešný lokálny grader ho
    // nepotrebuje (pracuje z už extrahovaných keyPoints), ale budúci LLM
    // grader (Fáza 2/3) ho bude potrebovať na posúdenie vecnej správnosti,
    // preto sa nesie na topic objekte už teraz.
    return { id: `A${n}`, title: json.title, summary: summaryText, keyPoints, glossary, zdroj: normalizeZdroj(json) };
  } catch (e) {
    return null;
  }
}

/* ============================================================
   COMMIT 4b – PREKLAD ZDIEĽANÉHO VÝBERU (window.__selectedOkruhPair
   z app.js/scripts/duels.js) NA basePath, KTORÝ POTREBUJE fetchOkruh.

   Postavené DYNAMICKY z AREA_CONFIG (žiadna ručná duplicita ciest) –
   kľúčuje podľa progressAreaTitle, presne to isté pole, aké nesie
   sources[i].area zo zdieľaného výberu:
   - mode 'pair'      → jeden bazén, progressAreaTitle == top-level kľúč
                        (napr. "Pracovné právo"), žiadny label.
   - mode 'dual-pool' → hľadá v pools[] podľa progressAreaTitle, vráti
                        aj label ("Hmotné právo"/"Procesné právo"), nech
                        vie štátnica označiť, z ktorého bazéna téma je.
   Ak pribudne nová oblasť do AREA_CONFIG (napr. Trestné/Európske), táto
   funkcia ju pokryje bez akejkoľvek úpravy – nič tu nie je naviazané na
   konkrétny názov oblasti.
============================================================ */
function findAreaPoolInfo(areaTitle) {
  for (const config of Object.values(AREA_CONFIG)) {
    if (config.mode === 'pair' && config.progressAreaTitle === areaTitle) {
      return { path: config.pool.path };
    }
    if (config.mode === 'dual-pool') {
      const pool = config.pools.find(p => p.progressAreaTitle === areaTitle);
      if (pool) return { path: pool.path, label: pool.label, count: pool.count };
    }
  }
  return null;
}

/* Všetky bazény jednej oblasti siene (pre doplnenie témy nižšie). Bazén s
   count === 0 je vedome prázdny – oblasť ho pozná, ale zatiaľ preň niet
   skúškového obsahu (dnes Trestné procesné). */
function poolsOfArea(areaName) {
  const config = AREA_CONFIG[areaName];
  if (!config) return [];
  if (config.mode === 'pair') {
    return [{ path: config.pool.path, count: config.pool.count, label: null }];
  }
  return config.pools.map(p => ({ path: p.path, count: p.count, label: p.label }));
}

/* Preloží zdieľaný výber (shared.sources – dve { area, key } dvojice,
   pozri diagnostiku 4b) na presne ten istý tvar topics[], aký doteraz
   staval pickExamTopics cez fetchOkruh – render/gradeAnswer/záver sa
   nemenia, dostávajú rovnaké objekty ako dnes.

   HYBRIDNÉ DOPLNENIE (2026-08, „cesta A hybridne"): ak sa zo zdieľanej
   dvojice podarí načítať len JEDNU tému, druhá sa dobrá z bazénov TEJ ISTEJ
   oblasti, ktoré skúškový obsah majú. Dôvod: Aréna ponúka „Trestné právo"
   ako dvojicu hmotné+procesné, ale procesné zatiaľ nemá ani jedno zhrnutie –
   bez doplnenia by každý pokus skončil strhnutím a vrátením 15 § a hláškou
   „Komisia nie je dostupná“. Akonáhle procesné zhrnutia dostane (stačí zdvihnúť
   `count` v AREA_CONFIG), obe témy sa načítajú zo zdieľanej dvojice a doplnenie
   sa už nespustí – žiadna ďalšia zmena kódu.

   Rozlišuje sa PREČO téma nevyšla:
   - zdroj nemá skúškový obsah (neznámy bazén, count 0, okruh mimo rozsahu)
     → doplní sa náhradná téma,
   - bazén aj okruh sú v poriadku, ale fetchOkruh zlyhal (sieť, rozbitý JSON)
     → vráti sa [] a volajúci skúšku nespustí.
   Bez tohto rozlíšenia by hráč, ktorému pojednávanie vytiahlo napr. hmotný
   okruh A22 (mimo skúškového rozsahu), dostal namiesto skúšky len hlášku –
   teda presne ten problém, ktorý má doplnenie riešiť.
   (E2: energia sa odpočíta až PO úspešnom zostavení tém, takže neúspech
   tu hráča nič nestojí a refund netreba.)

   `count` v AREA_CONFIG je zároveň hranica SKÚŠKOVÉHO obsahu: okruh mimo
   rozsahu sa nepoužije ani zo zdieľanej dvojice, aj keby súbor existoval
   (napr. Trestné hmotné má 30 súborov, ale zhrnutia zatiaľ len A1–A13). */
async function buildTopicsFromSharedSelection(shared, areaName) {
  const used = new Set();
  let hadRealFailure = false;

  const results = await Promise.all(shared.sources.map(async (source) => {
    const info = findAreaPoolInfo(source.area);
    if (!info || info.count === 0) return null;          // bazén bez skúškového obsahu
    const n = Number(String(source.key).replace(/^A/, ''));
    if (!Number.isFinite(n)) return null;
    if (typeof info.count === 'number' && (n < 1 || n > info.count)) return null; // mimo rozsahu
    const topic = await fetchOkruh(info.path, n);
    if (!topic) { hadRealFailure = true; return null; }  // platný okruh, ale nenačítal sa
    used.add(`${info.path}A${n}`);
    if (info.label) topic.label = info.label;
    return topic;
  }));

  const topics = results.filter(Boolean);
  if (hadRealFailure) return [];

  if (topics.length < 2) {
    const candidates = [];
    poolsOfArea(areaName)
      .filter(p => p.count > 0)
      .forEach(p => { for (let n = 1; n <= p.count; n++) candidates.push({ ...p, n }); });
    // Fisher–Yates, nech doplnená téma nie je vždy tá istá.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    // Strop pokusov: pri oblasti s desiatkami okruhov by sériové fetchovanie
    // až do vyčerpania zbytočne zdržalo štart skúšky.
    let attempts = 0;
    for (const c of candidates) {
      if (topics.length >= 2 || attempts >= 8) break;
      const id = `${c.path}A${c.n}`;
      if (used.has(id)) continue;
      attempts++;
      const topic = await fetchOkruh(c.path, c.n);
      if (!topic) continue;
      used.add(id);
      if (c.label) topic.label = c.label;
      topics.push(topic);
    }
    if (topics.length < 2) return [];
    console.log('[AI SKÚŠKA] Druhá téma doplnená z bazéna oblasti:', areaName, topics.map(t => t.id).join('+'));
  }

  console.log('[AI SKÚŠKA] Témy zo zdieľaného výberu:', shared.area, `[${shared.mode}]`, topics.map(t => t.id).join('+'));

  /* Orezanie AŽ TU, keď sú stráže vyššie spokojné – viď komentár pri
     EXAM_TOPIC_COUNT. Pri hodnote 2 a vyššej sa nezmení nič. */
  return topics.slice(0, EXAM_TOPIC_COUNT);
}

/* ============================================================
   KOMISIA – 3 RÔZNI talárové avatary (žiadny duplikát), mix
   chlapec/dievča, rôzne taláre, preferencia akademika (zlatý pás).
   Katalóg zatiaľ nemá samostatné pole pre "subtyp" taláru, preto sa
   pohlavie/rola odvodzujú mäkko z `id` (studentka-* = dievča, inak
   chlapec; -akademik/-prokurator/-sudca/-advokat/-talar-cierny =
   rola). AK žiadny talár neexistuje, radšej žiadny obrázok ako
   civilný avatar (zadanie: "Nie základné civilné avatary") –
   zobrazí sa dekoratívny fallback.
============================================================ */
/* Tri pevné vzhľady komisie – po jednom na persónu. Farebné plášte
   (advokát/prokurátor/sudca) sú zo skúšajúcich vyradené: dávali zmysel
   len pri právnickej verzii. Ostáva civilný vzhľad, čierny plášť
   a akademický (zlatý) – tri jasne odlíšiteľné úrovne formálnosti.

   Sú to `id` z avatars/Catalog.json. Keby sa niektoré nenašlo, renderer
   spadne na RESERVE_CANDIDATES nižšie – nikdy nezobrazí rozbitý obrázok. */
const COMMISSION_AVATAR_IDS = [
  'studentka-tmava',              // bez plášťa – civilný vzhľad (Lektor)
  'student-blond-talar-cierny',   // čierny plášť (Skúšajúci)
  'studentka-blond-akademik'      // zlatý plášť (Profesor)
];

/* Vráti katalógové položky pre tri pevné vzhľady vyššie. Poradie je
   stabilné (nie náhodné), aby komisia vyzerala pri každom spustení
   rovnako – na prezentácii je predvídateľnosť prednosť.
   ⚠️ Nehľadá sa cez getTalarAvatars(): jeden z troch je ZÁMERNE
   basic avatar (bez plášťa), ktorý filter na type==='talar' zahodí. */
async function pickCommission() {
  const catalog = await getAvatarCatalog();
  const chosen = COMMISSION_AVATAR_IDS
    .map(id => (catalog || []).find(a => a && a.id === id))
    .filter(Boolean);
  console.log('[AI SKÚŠKA] Komisia:', chosen.map(a => a && a.id));
  return chosen;
}

/* ============================================================
   REZERVNÝ ZOZNAM TALÁROVÝCH OBRÁZKOV (mimo katalógu) – posledná
   poistka, ak by sa avatars/Catalog.json nenačítal alebo filter na
   type==='talar' vrátil prázdno. Cesty overené, že reálne existujú
   v avatars/ (nahraté spolu s katalógom v tomto commite).
============================================================ */
const RESERVE_TALAR_CANDIDATES = [
  'avatars/studentka-tmava-full.png',
  'avatars/student-blond-talar-cierny-full.png',
  'avatars/studentka-blond-akademik-full.png'
];

/* Pre každú z 3 pozícií komisie postaví zoznam kandidátov na
   vyskúšanie (najprv katalógový avatar, ak existuje, potom rezervný
   zoznam pootočený tak, aby rôzne pozície neskúšali ten istý súbor
   ako prvý). Renderer nižšie cez onerror prechádza kandidátov, kým
   jeden nenačíta, alebo kým sa nevyčerpajú (vtedy sa daná pozícia
   jednoducho vynechá – žiadny rozbitý obrázok). */
function buildCommissionCandidates(commission) {
  const reserve = RESERVE_TALAR_CANDIDATES;
  return [0, 1, 2].map(i => {
    const primary = commission[i] ? avatarStateSrc(commission[i], 'full') : null;
    const rotated = reserve.length
      ? reserve.slice(i % reserve.length).concat(reserve.slice(0, i % reserve.length))
      : [];
    return primary ? [primary, ...rotated] : rotated;
  });
}

/* Vykreslí komisiu s onerror-reťazením cez kandidátov; ak sa ani
   pre jednu z 3 pozícií nepodarí nič načítať, celá sekcia sa nahradí
   dekoratívnym fallbackom (nikdy civilný avatar, nikdy prázdno/
   rozbitý obrázok). */
function renderCommission(commissionEl, commission) {
  commissionEl.innerHTML = '';
  const slots = buildCommissionCandidates(commission);

  if (slots.every(c => c.length === 0)) {
    commissionEl.innerHTML = `<div class="statnice-commission-fallback">🎓 🎓 🎓</div>`;
    return;
  }

  let successCount = 0;
  let settledCount = 0;
  const total = slots.length;

  function settle() {
    settledCount++;
    if (settledCount === total && successCount === 0) {
      commissionEl.innerHTML = `<div class="statnice-commission-fallback">🎓 🎓 🎓</div>`;
    }
  }

  slots.forEach(candidates => {
    if (!candidates.length) { settle(); return; }

    const img = document.createElement('img');
    img.className = 'statnice-commissioner';
    img.alt = 'Člen komisie';
    commissionEl.appendChild(img);

    let idx = 0;
    function tryNext() {
      if (idx >= candidates.length) { img.remove(); settle(); return; }
      img.src = candidates[idx++];
    }
    img.onload = () => { successCount++; settle(); };
    img.onerror = tryNext;
    tryNext();
  });
}

/* ============================================================
   HODNOTENIE ODPOVEDE PROTI KĽÚČOVÝM BODOM – lokálny substitút za
   "Krok B" Claude API. Vracia rovnaký tvar ako predtým + terminológiu:
   { covered, missing, incorrect, coverage, contentCoverage,
     terminologyScore, missingTerms, onTopic }

   Hodnotí sa POKRYTIE, nie doslovná zhoda: každý bod sa overuje cez
   prítomnosť JEHO VLASTNÝCH podstatných slov v odpovedi (parafráza/
   iné poradie/iná učebnica neprekáža, pokým zaznejú nosné pojmy bodu).
   `incorrect` (vecne zlé tvrdenia) lokálne spoľahlivo nevieme
   rozpoznať – ostáva vždy prázdne (poctivo priznané obmedzenie).
============================================================ */
/* POINT_COVERAGE_RATIO, TERMINOLOGY_WEIGHT, MIN_ANSWER_WORDS a
   GRADE_THRESHOLDS žijú v ECONOMY_CONFIG.STATNICE (economyConfig.js) –
   rekalibrácia 2026-07-17, dôvod tamtiež v komentári. Lokálne aliasy len
   pre čitateľnosť nižšie. */
const POINT_COVERAGE_RATIO = ECONOMY_CONFIG.STATNICE.POINT_COVERAGE_RATIO;
const TERMINOLOGY_WEIGHT = ECONOMY_CONFIG.STATNICE.TERMINOLOGY_WEIGHT;

/* Slovenčina má bohatú pádovú/číselnú deklináciu ("závislá" vs "o závislej
   práci" vs "závislých vzťahoch") – rovnaké slovo sa v odpovedi takmer
   vždy objaví v inom tvare ako v referenčnom bode. Čisté porovnanie
   celých slov by preto neprávom penalizovalo aj vecne správnu odpoveď.
   Namiesto skutočnej lematizácie (mimo rozsahu lokálneho substitútu)
   stačí zdieľaný začiatok slova (~70 % dĺžky kratšieho, min. 4 znaky) –
   pádové/číselné koncovky sú spravidla len 1-3 znaky na konci slova. */
function wordsMatch(a, b) {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  const prefixLen = Math.max(4, Math.floor(minLen * 0.7));
  if (a.slice(0, prefixLen) === b.slice(0, prefixLen)) return true;
  return a.includes(b) || b.includes(a);
}

function isPointCovered(point, userWordsSet) {
  const pointWords = significantWords(point);
  if (!pointWords.length) return true; // bod bez rozlíšiteľných slov – nedá sa vyhodnotiť, neblokuj študenta
  let matched = 0;
  pointWords.forEach(w => {
    for (const uw of userWordsSet) {
      if (wordsMatch(w, uw)) { matched++; return; }
    }
  });
  return (matched / pointWords.length) >= POINT_COVERAGE_RATIO;
}

/* Namapuje text bodu (napr. missing[0] od gradera) na jeho INDEX v
   topic.keyPoints cez rovnaké fuzzy porovnanie slov ako isPointCovered
   vyššie. Fáza 3 (2026-07-19): LLM grader nevráti text nutne byte-
   identicky ako v keyPoints (iné poradie slov/drobná parafráza pri
   opakovanom volaní) – de-dup nápovede (viď hintedPoints v
   enterHodnotenie) sa preto NESMIE spoliehať na textovú zhodu, len na
   tento index. Vráti -1, ak sa nenájde dostatočne istá zhoda – radšej
   bez de-dup pre tento jeden bod, než mylne stotožniť dva rôzne body. */
function resolveKeyPointIndex(text, keyPoints) {
  const textWords = significantWords(text);
  if (!textWords.length) return -1;
  let bestIdx = -1, bestScore = 0;
  (keyPoints || []).forEach((kp, i) => {
    const kpWords = significantWords(kp);
    if (!kpWords.length) return;
    let matched = 0;
    kpWords.forEach(w => { if (textWords.some(tw => wordsMatch(w, tw))) matched++; });
    const score = matched / kpWords.length;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestScore >= POINT_COVERAGE_RATIO ? bestIdx : -1;
}

/* Terminológia: koľko z kurátorovaných pojmov okruhu (tiles) študent
   reálne použil. Rovnaké prefixové porovnanie ako pri kľúčových bodoch,
   aby skloňované tvary pojmu neboli nespravodlivo "nepoužité". Zdieľané
   MEDZI lokálnym fallbackom (evaluateCoverage) aj LLM cestou (mapLlmResult)
   – "chýbajúce pojmy" v spätnej väzbe sú vždy lokálny výpočet nad
   answerText/glossary, bez ohľadu na to, ktorý grader určil samotné skóre. */
function computeTerminologyGaps(userText, glossary) {
  const userWords = new Set(significantWords(userText));
  const glossaryTerms = glossary || [];
  const usedTerms = [];
  const missingTerms = [];
  glossaryTerms.forEach(term => {
    const termWords = significantWords(term);
    const isUsed = userWords.size > 0 && termWords.length > 0 &&
      termWords.some(w => [...userWords].some(uw => wordsMatch(w, uw)));
    if (isUsed) usedTerms.push(term); else missingTerms.push(term);
  });
  const localTerminologyScore = glossaryTerms.length ? Math.round((usedTerms.length / glossaryTerms.length) * 100) : null;
  return { usedTerms, missingTerms, localTerminologyScore };
}

/* Dolná hranica pásma danej známky, čítaná z JEDINEJ tabuľky prahov
   (GRADE_THRESHOLDS) – žiadne duplicitné číslo, poistka nižšie sa
   automaticky posunie, ak by sa prahy niekedy prekalibrovali. */
function gradeBandMin(znamka) {
  const row = ECONOMY_CONFIG.STATNICE.GRADE_THRESHOLDS.find(t => t.znamka === znamka);
  return row ? row.min : 0;
}

/* Ak okruh nemá glosár (napr. staršie dáta bez tiles), alebo terminológia
   je null, terminológia sa nezapočítava (vypadne, nie 0 %).

   ============================================================
   TERMINOLOGICKÁ POISTKA (2026-08, spolu s V1)

   Terminológia má váhu 0,20, takže vie skóre zdvihnúť až o 20 bodov.
   Bez poistky stačilo `contentCoverage` 50 a plné použitie pojmov na
   combined 60 – téma s POLOVIČNÝM obsahovým pokrytím sa tak dostala do
   pásma dvojky a UNIKLA stropu V1 (ten stropuje len témy v pásme 3+).

   Pravidlo: terminológia smie skóre vylepšovať, ale NESMIE tému posunúť
   do pásma dvojky, ak na to nestačí samotný obsah. Preto sa pri
   contentCoverage pod hranicou dvojky výsledok zastropuje tesne pod ňou.

   Zámerne sa NEobmedzuje zdvih v rámci nižších pásiem: vzorka „krátka,
   správna, povrchná" (content 35, terminológia 60 → 40) má podľa
   kalibrácie Fázy A vyjsť na 3, nie na 4 – a tá ostáva nedotknutá.

   Anti-gaming invariant naďalej platí a je teraz dvojito krytý: holé
   vymenovanie pojmov (contentCoverage 0) dá 0×0,8 + 100×0,2 = 20, čo je
   pod prahom trojky (40) → známka 4.
   ============================================================ */
function combineCoverage(contentCoverage, terminologyScore) {
  if (terminologyScore === null) return contentCoverage;

  const combined = Math.round(
    contentCoverage * (1 - TERMINOLOGY_WEIGHT) + terminologyScore * TERMINOLOGY_WEIGHT
  );

  const grade2Min = gradeBandMin(2);
  if (contentCoverage < grade2Min) return Math.min(combined, grade2Min - 1);
  return combined;
}

function computeOnTopic(userText, coveredCount, contentCoverage) {
  const userWords = new Set(significantWords(userText));
  return userWords.size > 0 && (coveredCount >= 1 || contentCoverage >= ON_TOPIC_MIN_THRESHOLD);
}

// Anti-gaming (Fáza D rekalibrácia): odpoveď kratšia než rozumné minimum
// nemôže dostať 1 ani 2 bez ohľadu na to, čo skóre napočíta – bráni sa tým
// holému vymenovaniu pojmov naraz s ich terminologickým "bonusom". Počíta
// sa zo VŠETKÝCH slov (nie len significantWords), aby aj odpoveď zložená
// hlavne zo spojok/predložiek nedostala kredit za dĺžku.
function isTooShort(userText) {
  return normalizeWords(userText).length < ECONOMY_CONFIG.STATNICE.MIN_ANSWER_WORDS;
}

function evaluateCoverage(userText, keyPoints, glossary) {
  const userWords = new Set(significantWords(userText));
  const covered = [];
  const missing = [];

  (keyPoints || []).forEach(point => {
    if (userWords.size && isPointCovered(point, userWords)) covered.push(point);
    else missing.push(point);
  });

  const total = keyPoints ? keyPoints.length : 0;
  const contentCoverage = total ? Math.round((covered.length / total) * 100) : 0;

  const { missingTerms, localTerminologyScore } = computeTerminologyGaps(userText, glossary);
  const coverage = combineCoverage(contentCoverage, localTerminologyScore);
  const onTopic = computeOnTopic(userText, covered.length, contentCoverage);
  const tooShort = isTooShort(userText);

  return { covered, missing, incorrect: [], coverage, contentCoverage, terminologyScore: localTerminologyScore, missingTerms, onTopic, tooShort };
}

/* ============================================================
   GRADER ROZHRANIE (Fáza 1, 2026-07-18; napojené na LLM Fáza 3, 2026-07-19)
   – jednotné rozhranie okolo hodnotenia odpovede. Zvyšok statnice.js volá
   VÝHRADNE gradeAnswer(), NIKDY priamo evaluateCoverage() ani
   callGradeAnswerApi() – to umožňuje meniť backend bez zásahu kdekoľvek inde.

   Minimálny kontrakt (spoločný pre LLM aj lokálny fallback grader):
   { covered, missing, incorrect, contentCoverage, terminologyScore } +
   odvodené polia coverage/missingTerms/onTopic/tooShort, ktoré zvyšok
   súboru používa (dopočítané rovnako z oboch ciest, viď mapLlmResult
   a evaluateCoverage vyššie – zdieľajú computeTerminologyGaps/
   combineCoverage/computeOnTopic/isTooShort, takže volajúci nevie a
   nepotrebuje vedieť, ktorá cesta odpovedala).

   ⚠️ OCHRANA (2026-07-19): endpoint už NEVYŽADUJE žiadny secret/hlavičku
   z klienta – server overuje pôvod požiadavky (Origin, nastavuje ho
   prehliadač sám, JS ho nemôže sfalšovať) namiesto shared secretu (ten by
   aj tak bol len verejne viditeľný reťazec v tomto súbore – appka nemá
   build krok). Pozri api/grade-answer.js hlavičku pre plný rozbor tejto
   ochrany aj jej hraníc.
============================================================ */
const GRADE_ANSWER_ENDPOINT = '/api/grade-answer';
const GRADE_ANSWER_TIMEOUT_MS = 18000; // radšej rýchly fallback než visiaca skúška, ak LLM mlčí

function isStringArray(v) {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

/* Zavolá /api/grade-answer a validuje tvar odpovede. Pri AKOMKOĽVEK
   probléme (network/abort/HTTP chyba/neplatný JSON/neplatný tvar/neplatné
   skóre) throw-ne – volajúci (gradeAnswer nižšie) to chytí a spadne na
   lokálny fallback. Táto funkcia sama NIKDY fallback nerieši. */
async function callGradeAnswerApi({ summary, keyPoints, glossary, answerText }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRADE_ANSWER_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(GRADE_ANSWER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary, keyPoints, glossary, answerText }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) throw new Error(`/api/grade-answer HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.ok !== true) throw new Error('/api/grade-answer: ok !== true');
  if (!isStringArray(data.covered) || !isStringArray(data.missing) || !isStringArray(data.incorrect)) {
    throw new Error('/api/grade-answer: neplatný tvar covered/missing/incorrect');
  }
  if (typeof data.contentCoverage !== 'number' || typeof data.terminologyScore !== 'number') {
    throw new Error('/api/grade-answer: neplatné skóre');
  }
  return data;
}

/* Namapuje surovú odpoveď LLM endpointu na PRESNE ten istý tvar, aký vracia
   evaluateCoverage() – missingTerms je vždy lokálny dopočet (glosár nie je
   súčasťou LLM kontraktu, viď komentár pri computeTerminologyGaps), skóre
   terminológie/obsahu berie z LLM (to je celý zmysel migrácie – LLM vie
   posúdiť použitie pojmov V KONTEXTE, nielen ich holú prítomnosť). Ak okruh
   nemá glosár, terminologyScore sa ignoruje (null) rovnako ako v lokálnom
   fallbacku – LLM by inak (schéma vyžaduje integer) mohol vrátiť napr. 0,
   čo by sa nesprávne započítalo do coverage. */
function mapLlmResult(llmResult, userText, glossary) {
  const hasGlossary = (glossary || []).length > 0;
  const { missingTerms } = computeTerminologyGaps(userText, glossary);
  const terminologyScore = hasGlossary ? llmResult.terminologyScore : null;
  const coverage = combineCoverage(llmResult.contentCoverage, terminologyScore);
  const onTopic = computeOnTopic(userText, llmResult.covered.length, llmResult.contentCoverage);
  const tooShort = isTooShort(userText);
  return {
    covered: llmResult.covered,
    missing: llmResult.missing,
    incorrect: llmResult.incorrect,
    coverage,
    contentCoverage: llmResult.contentCoverage,
    terminologyScore,
    missingTerms,
    onTopic,
    tooShort
  };
}

async function gradeAnswer({ summary, keyPoints, glossary, answerText }) {
  // #17: prázdnu odpoveď negrádujeme (žiadny zbytočný POST → 400), označíme skipped
  if (!answerText || !answerText.trim()) {
    return {
      covered: [],
      missing: keyPoints || [],
      incorrect: [],
      coverage: 0,
      contentCoverage: 0,
      terminologyScore: (glossary && glossary.length) ? 0 : null,
      missingTerms: [],
      onTopic: false,
      tooShort: true,
      skipped: true
    };
  }
  try {
    const llmResult = await callGradeAnswerApi({ summary, keyPoints, glossary, answerText });
    return mapLlmResult(llmResult, answerText, glossary);
  } catch (e) {
    console.warn('[AI SKÚŠKA] LLM hodnotenie (/api/grade-answer) zlyhalo, fallback na lokálny grader:', e);
    return evaluateCoverage(answerText, keyPoints, glossary);
  }
}

/* Doplňujúca otázka cielená na KONKRÉTNY chýbajúci bod (missing[0]),
   nie opakovanie pôvodnej otázky – lokálny substitút za Claude API
   volanie "polož jednu doplňujúcu otázku smerujúcu na tento bod". */
function buildFollowUpMessage(missing, title, personaKey) {
  const p = getPersona(personaKey);
  if (!missing || !missing.length) return p.followUpGeneric(title);
  return p.followUp(missing[0]);
}

/* Známka pre JEDNU hodnotu coverage – tie isté prahy ako pre celkovú
   známku (GRADE_THRESHOLDS), zámerne ŽIADNA druhá tabuľka. */
function gradeForCoverage(coverage) {
  return ECONOMY_CONFIG.STATNICE.GRADE_THRESHOLDS.find(t => coverage >= t.min).znamka;
}

/* Záverečná spätná väzba – lokálny substitút, rovnaký tvar ako Claude API.
   Kalibrácia podľa ECONOMY_CONFIG.STATNICE.GRADE_THRESHOLDS – po zmiernení
   round 1 (2026-08): 1 = coverage ≥ 80, 2 = 60–79, 3 = 40–59, 4 = < 40.
   (Pôvodné znenie tu uvádzalo staré prahy 85/65/45 – opravené.)

   ⚠️ NEMENNÁ ZÁSADA: znamka sa počíta VÝLUČNE z `evaluations` (avg
   coverage + anyIncorrect + známka najslabšej témy) a `hintsUsed` (rovnaký
   strop pre všetky persóny, ECONOMY_CONFIG.STATNICE.HINT_GRADE_FLOOR) –
   ÚPLNE rovnako bez ohľadu na personaKey. Ten sa použije AŽ NIŽŠIE, len na
   sformulovanie textu (silne/medzery/odporucania/zaver). Rovnaká
   odpoveď + rovnaký počet nápovied => rovnaká známka u všetkých
   troch persón, vždy. */
function buildFinalFeedback(evaluations, topics, personaKey, hintsUsed = 0) {
  const avg = evaluations.reduce((s, e) => s + e.coverage, 0) / evaluations.length;
  const anyIncorrect = evaluations.some(e => e.incorrect && e.incorrect.length);
  const anyTooShort = evaluations.some(e => e.tooShort);

  // Prahy sú v ECONOMY_CONFIG.STATNICE.GRADE_THRESHOLDS (zoradené zhora),
  // prvý riadok, do ktorého avg "zapadne" (avg >= min), určuje známku.
  let znamka = ECONOMY_CONFIG.STATNICE.GRADE_THRESHOLDS.find(t => avg >= t.min).znamka;

  /* ============================================================
     V1 – STROP SLABŠOU TÉMOU (2026-08)

     Priemer dvoch tém dovolil silnej téme zamaskovať odbytú: úplná (100)
     + povrchná (40) = 70, čo je dvojka. Skúška má pripraviť na reálnu
     komisiu, kde jedna nezvládnutá téma známku ťahá dole – preto ak
     ktorákoľvek téma spadne do pásma známky 3 alebo horšie, celková
     známka už nemôže byť lepšia než 3.

     Per-téma známka sa určuje TÝMI ISTÝMI prahmi (gradeForCoverage vyššie).
     Poradie floorov nižšie nehrá rolu – všetky sú Math.max, teda výhradne
     zhoršujú a navzájom sa nemôžu prebiť.

     Preskočená/nezodpovedaná téma (gradeAnswer vracia coverage 0 a
     skipped:true) spadne do pásma 4, takže strop platí. Nezávisle od toho
     ju už dnes chytá aj floor za krátku odpoveď nižšie (skipped má
     tooShort:true) – teda dvojitá poistka, obe s rovnakým výsledkom. */
  const perTopicGrades = evaluations.map(e => gradeForCoverage(e.coverage));
  const weakestTopicGrade = Math.max(...perTopicGrades);
  // Vysvetlenie študentovi má zmysel LEN keď strop známku reálne stiahol.
  const weakTopicCapped = weakestTopicGrade >= 3 && znamka < 3;
  const weakTopicTitle = weakTopicCapped
    ? (topics[perTopicGrades.indexOf(weakestTopicGrade)]?.title || '')
    : '';
  if (weakestTopicGrade >= 3) znamka = Math.max(znamka, 3);

  // Vecná chyba (keby ju lokálny substitút niekedy vedel rozpoznať) nikdy
  // nesmie vyzerať ako "výborne" – rovnaký floor-vzor ako nižšie pri nápovedi/dĺžke.
  // Zmiernenie round 1 (2026-08): floor 3 → 2 – jedna drobnosť označená ako
  // nesprávna zrazí najviac na dvojku, nie rovno na trojku.
  if (anyIncorrect) znamka = Math.max(znamka, 2);

  // Nápoveda na žiadosť (Fáza D.2) znižuje NAJLEPŠIU dosiahnuteľnú známku –
  // nikdy ju nezlepší, len ju zdola obmedzí (Math.max = "aspoň takto zlá").
  const floorTable = ECONOMY_CONFIG.STATNICE.HINT_GRADE_FLOOR;
  const hintFloor = floorTable[Math.min(hintsUsed, floorTable.length - 1)];
  znamka = Math.max(znamka, hintFloor);

  // Rekalibrácia: príliš krátka odpoveď (aspoň na jednu tému) nemôže dostať
  // 1 ani 2 – nedokáže reálne demonštrovať zvládnutie látky, nech je
  // keyword-skóre akékoľvek. Rovnaký floor-vzor ako vyššie.
  if (anyTooShort) znamka = Math.max(znamka, 3);

  // Od tohto miesta nižšie sa persóna prejaví LEN v znení textu.
  const p = getPersona(personaKey);

  const silne = [];
  const medzery = [];
  const nespravne = [];
  const missingTermsAll = [];
  evaluations.forEach((e, i) => {
    const title = topics[i].title;
    if (e.covered.length) silne.push(p.coveredLine(title, e.covered));
    // Vecná chyba (incorrect) je ZÁMERNE samostatná od medzery (missing) –
    // "doplňte X" a "X ste povedali nesprávne" sú rôzne veci (2026-07-19
    // zadanie, bod A3). Skôr než medzery, nech vynikne ako prvá/závažnejšia.
    if (e.incorrect && e.incorrect.length) nespravne.push(p.incorrectLine(title, e.incorrect));
    if (e.missing.length) medzery.push(p.missingLine(title, e.missing, znamka));
    // Právna terminológia (Fáza D.3) – v spätnej väzbe uveď, ktoré pojmy
    // chýbali (učí to), samostatne od obsahových medzier vyššie.
    if (e.missingTerms && e.missingTerms.length) {
      missingTermsAll.push(`Téma „${title}" – vynechané pojmy: ${e.missingTerms.join(', ')}.`);
    }
  });
  if (!silne.length) silne.push(p.noCoveredFallback);

  const odporucania = medzery.length ? p.odporucaniaWithGaps : p.odporucaniaClean;

  return { znamka, silne, medzery, nespravne, odporucania, terminologyGaps: missingTermsAll, zaver: p.zaver[znamka], anyTooShort, weakTopicCapped, weakTopicTitle };
}

/* ============================================================
   ODMENA – až po dokončení CELEJ skúšky (nie pri zrušení v strede)
============================================================ */
async function awardExamResult(nick, znamka) {
  const amount = ECONOMY_CONFIG.STATNICE.EXAM_REWARD[znamka] || 0;
  if (amount > 0) {
    await econAward(nick, amount, `skúšobná skúška – známka ${znamka}`, { skipCap: true });
  }
  return amount;
}

async function saveExamResult(nick, znamka, areaName) {
  try {
    const db = getDb();
    if (!db || !nick) return;
    const { ref, push } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    await push(ref(db, `users/${nick}/examResults`), {
      znamka, area: areaName, ts: Date.now()
    });
  } catch (e) {
    console.warn('⚠️ statnice: uloženie výsledku zlyhalo', e);
  }
}

/* ============================================================
   SPEECHRECOGNITION – Zjednotené s bifľovačkou (memoryTrainer.js
   createSpeechRecognizer/isSpeechRecognitionSupported), rovnaký
   konštruktor a nastavenia. Dve vrstvy poistiek, ktoré medzi sebou
   NESMÚ kolidovať:

   1. PRVÝ .start() jednej nahrávacej relácie je VŽDY priamo vnútri
      click handlera mikrofónu (fresh user gesture) – nikdy z async
      reťazca (TTS onend / timer). Mobilné prehliadače (najmä Android
      Chrome) berú getUserMedia-viazané API ako SpeechRecognition
      seriózne (skutočne sa spýtajú/udelia povolenie) len pri priamom
      geste – to bol koreň pôvodnej mobilnej chyby ("otvorí sa, ale
      nepočúva").

   2. V RÁMCI JEDNEJ relácie (recordingSessionActive === true) sa
      prirodzené ticho (onEnd bez manuálneho zastavenia) NEberie ako
      koniec odpovede – rozpoznávanie sa potichu REŠTARTUJE (rovnaké
      povolenie, netreba nové gesto) a zbiera ĎALEJ do tej istej
      odpovede. Skúška NIKDY neprejde na ďalšiu otázku na základe
      ticha – jedine tlačidlom "Dokončiť odpoveď" alebo manuálnym
      zastavením mikrofónu. Bez tejto vrstvy by ústny výklad
      s prirodzenou pauzou na premýšľanie appka predčasne odstrihla.

   Prehrávanie otázky (TTS) sa NIKDY neprekrýva s počúvaním – mikrofón sa
   sprístupní na SKUTOČNEJ udalosti utterance.onend, vždy cez JEDNU zdieľanú
   funkciu speakThenListen() (jedna cesta pre úvodnú otázku aj každú
   doplňujúcu – žiadna druhá kópia), nikdy primárne na časovači.
   ttsFallbackDelay() je len poistka pre prípad, že onend v danom
   prehliadači vôbec nepríde – veľkorysá (odhad × 3), nech nikdy nestrieľa
   pred reálnym koncom reči. Ako druhá poistka: aj keby ju predsa spustila
   poistka priskoro, speakThenListen() aj startOrRestartRecording pred
   prechodom/pred .start() explicitne zavolajú speechSynthesis.cancel(), ak
   by TTS ešte bežalo – mikrofón sa preto nikdy nemôže spustiť do stále
   znejúcej reči komisie.
============================================================ */

/* ============================================================
   UI – FULLSCREEN OVERLAY
============================================================ */
let overlayEl = null;

/* Poistka proti dvojitému otvoreniu (mobil: ghost-click po touchende,
   netrpezlivý dvojitý ťuk kým sa čaká na econSpendEnergy/pickExamTopics/
   pickCommission bez okamžitej vizuálnej odozvy). Bez nej druhé
   prekrývajúce sa volanie openStatniceHall() môže cez closeStatniceHall()
   odstrániť overlay, ktorý práve zostavilo PRVÉ volanie – na pomalšom
   mobilnom pripojení (širšie časové okno medzi awaitmi) sa to prejaví
   ako "obrazovka preblysne a zmizne", zatiaľ čo na rýchlom PC/localhost
   je okno na kolíziu prakticky nulové. */
let statniceOpening = false;

/* Výber persóny + hlasu komisie, PRED minutím § / losovaním okruhov –
   zrušenie tu nič nestojí. Vracia Promise<{personaKey,voicePref}|null>
   (null = zatvorené bez potvrdenia). Ponúka LEN hlasy, ktoré appka
   vie reálne prehrať (žiadny sľub hlasu, ktorý zariadenie nemá) –
   ak nie je k dispozícii žiadny sk hlas, mužská/ženská voľba sa
   vôbec nezobrazí, ostane len "Bez hlasu". */
async function buildPersonaOverlay(areaName, defaultPersona, defaultVoice) {
  const el = document.createElement('div');
  el.className = 'statnice-overlay';

  const { hasSkVoice, hasMale, hasFemale } = await (async () => {
    if (!('speechSynthesis' in window)) return { hasSkVoice: false, hasMale: false, hasFemale: false };
    await ensureVoicesLoaded();
    const anySk = window.speechSynthesis.getVoices().some(v => v.lang && v.lang.toLowerCase().startsWith('sk'));
    const genders = getAvailableSkGenders();
    return { hasSkVoice: anySk, ...genders };
  })();

  /* Voľba v UI musí vždy zodpovedať tomu, čo sa reálne stane:
     - oba gendery rozlíšiteľné podľa mena hlasu → skutočná voľba Mužský/Ženský
     - žiadny SK hlas vôbec → len "Bez hlasu"
     - SK hlas JE, ale gendery sa nedajú (spoľahlivo) rozlíšiť → jeden neutrálny
       "🔊 Hlas" namiesto sľubu pohlavia, ktoré zariadenie nevie splniť */
  const canOfferBothGenders = hasMale && hasFemale;
  const voiceOptionsHtml = !hasSkVoice
    ? `<button class="btn statnice-voice-btn" data-voice="off" type="button">🔇 Bez hlasu (na tomto zariadení nie je k dispozícii slovenský hlas)</button>`
    : canOfferBothGenders
      ? `
        <button class="btn statnice-voice-btn" data-voice="m" type="button">🎙️ Mužský</button>
        <button class="btn statnice-voice-btn" data-voice="f" type="button">🎙️ Ženský</button>
        <button class="btn statnice-voice-btn" data-voice="off" type="button">🔇 Bez hlasu</button>
      `
      : `
        <button class="btn statnice-voice-btn" data-voice="voice" type="button">🔊 Hlas</button>
        <button class="btn statnice-voice-btn" data-voice="off" type="button">🔇 Bez hlasu</button>
      `;

  el.innerHTML = `
    <div class="statnice-bg"></div>
    <div class="statnice-header">
      <div class="statnice-title">🎓 AI skúška – ${areaName}</div>
      <button class="btn statnice-close-btn" id="statnicePersonaCloseBtn" type="button">✕ Zavrieť</button>
    </div>
    <div class="statnice-content">
      <h3 style="margin-top:0;text-align:center">Vyber si skúšajúceho</h3>
      <div class="statnice-persona-grid" id="statnicePersonaGrid">
        ${Object.entries(PERSONAS).map(([key, p]) => `
          <button class="btn statnice-persona-btn" data-key="${key}" type="button">
            <div class="statnice-persona-emoji">${p.emoji}</div>
            <div class="statnice-persona-label">${p.label}</div>
            <div class="small muted">${p.desc}</div>
          </button>
        `).join('')}
      </div>
      <div style="margin-top:20px">
        <div style="font-weight:600;margin-bottom:8px">Hlas komisie</div>
        <div class="statnice-voice-grid" id="statniceVoiceGrid">${voiceOptionsHtml}</div>
      </div>
      <button class="btn btn-primary statnice-ready-btn" id="statnicePersonaContinueBtn" type="button" disabled style="margin-top:24px">Pokračovať →</button>
    </div>
  `;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';

  return new Promise((resolve) => {
    let personaKey = hasOwnPersona(defaultPersona) ? defaultPersona : null;
    // Ulož. voľba z minula sa prevezme LEN ak zodpovedá tomu, čo sa TERAZ na
    // tomto zariadení reálne dá splniť – inak (napr. uložené 'f' z iného
    // zariadenia, tu je gender neistý/chýba) sa nepoužije potichu, nech si
    // študent vyberie znova z toho, čo je naozaj k dispozícii.
    const validVoicePrefs = !hasSkVoice ? ['off'] : canOfferBothGenders ? ['m', 'f', 'off'] : ['voice', 'off'];
    let voicePref = validVoicePrefs.includes(defaultVoice) ? defaultVoice : (hasSkVoice ? null : 'off');
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      el.remove();
      document.body.style.overflow = '';
      resolve(result);
    }

    function updateContinueEnabled() {
      el.querySelector('#statnicePersonaContinueBtn').disabled = !(personaKey && voicePref);
    }

    el.querySelectorAll('.statnice-persona-btn').forEach(btn => {
      if (btn.dataset.key === personaKey) btn.classList.add('active');
      btn.onclick = () => {
        personaKey = btn.dataset.key;
        el.querySelectorAll('.statnice-persona-btn').forEach(b => b.classList.toggle('active', b === btn));
        updateContinueEnabled();
      };
    });

    el.querySelectorAll('.statnice-voice-btn').forEach(btn => {
      if (btn.dataset.voice === voicePref) btn.classList.add('active');
      btn.onclick = () => {
        voicePref = btn.dataset.voice;
        el.querySelectorAll('.statnice-voice-btn').forEach(b => b.classList.toggle('active', b === btn));
        updateContinueEnabled();
      };
    });

    updateContinueEnabled();

    el.querySelector('#statnicePersonaContinueBtn').onclick = () => {
      if (!personaKey || !voicePref) return;
      finish({ personaKey, voicePref });
    };
    el.querySelector('#statnicePersonaCloseBtn').onclick = () => finish(null);
    el.onclick = (e) => { if (e.target === el) finish(null); };
  });
}

function hasOwnPersona(key) {
  return Object.prototype.hasOwnProperty.call(PERSONAS, key || '');
}

function buildOverlay(areaName) {
  const el = document.createElement('div');
  el.className = 'statnice-overlay';
  el.innerHTML = `
    <div class="statnice-bg"></div>
    <div class="statnice-header">
      <div class="statnice-title">🎓 AI skúška – ${areaName}</div>
      <button class="btn statnice-close-btn" id="statniceCloseBtn" type="button">✕ Zavrieť</button>
    </div>
    <div class="statnice-commission" id="statniceCommission"></div>
    <div class="statnice-content" id="statniceContent">
      <div id="statnicePrepPhase">
        <div class="statnice-timer" id="statniceTimer">5:00</div>
        <div class="statnice-topics" id="statniceTopics"></div>
        <textarea class="statnice-notes" id="statniceNotes" placeholder="Súkromné poznámky (len pre teba, nikde sa neukladajú)…"></textarea>
        <button class="btn btn-primary statnice-ready-btn" id="statniceReadyBtn" type="button">Som pripravený/á →</button>
      </div>
      <div id="statniceAnswerPhase" style="display:none">
        <div class="statnice-question-label" id="statniceQNum"></div>
        <div class="statnice-current-question" id="statniceCurrentQ"></div>
        <div class="statnice-followup" id="statniceCommissionMsg" style="display:none"></div>
        <div class="small muted" id="statniceMicStatus"></div>
        <div class="statnice-live-transcript" id="statniceLiveTranscript"></div>
        <textarea class="statnice-answer-input" id="statniceAnswerInput" placeholder="Odpoveď (hovor nahlas alebo píš)…"></textarea>
        <div class="statnice-answer-actions">
          <button class="btn statnice-mic-btn" id="statniceMicBtn" type="button">🎤 Mikrofón</button>
          <button class="btn btn-primary" id="statniceSubmitBtn" type="button">✅ Dokončiť odpoveď</button>
        </div>
      </div>
      <div id="statniceResultsPhase" style="display:none">
        <div class="statnice-grade" id="statniceGrade"></div>
        <div class="statnice-feedback" id="statniceFeedback"></div>
        <button class="btn btn-primary statnice-finish-btn" id="statniceFinishBtn" type="button">Zavrieť</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

export function closeStatniceHall() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  document.body.style.overflow = '';
}

export async function openStatniceHall(areaName) {
  if (statniceOpening) return; // už prebieha otváranie (ghost-click/dvojitý ťuk na mobile)
  statniceOpening = true;
  try {
  if (!isStatniceAvailable(areaName)) {
    const available = Object.keys(AREA_CONFIG).join(', ');
    showRewardToast(`🎓 AI skúška je zatiaľ dostupná len pre: ${available}.`);
    return;
  }

  // Commit 4b: štátnica už nevyberá témy sama – preberá dvojicu okruhov
  // zo zdieľaného výberu (window.__selectedOkruhPair, nastavuje
  // app.js:applyOkruhPairSelection pri výbere oblasti/módu na hlavnej
  // obrazovke). Bez platného výberu PRE TÚTO oblasť sa nespustí – over
  // PRED buildPersonaOverlay aj PRED odpočtom energie.
  const shared = window.__selectedOkruhPair;
  if (!shared || shared.area !== areaName || shared.empty === true) {
    showRewardToast('🎓 Najprv si na hlavnej obrazovke vyber oblasť a mód (🎲/📗/📕) pre súboj – skúška použije tú istú dvojicu okruhov.');
    return;
  }

  const nick = getNick();
  /* Vysvetľujúca hláška, nie príkaz: demo návštevník má vedieť PREČO
     appka nick chce a že to nie je registrácia. Výber oblasti
     (window.__selectedOkruhPair) sa pri vzniku nicku nemaže, takže po
     zadaní stačí znova ťuknúť na dlaždicu – kontext ostáva. */
  if (!nick) { showRewardToast('AI skúška sa ukladá do tvojho profilu — zadaj si nick (stačí prezývka, žiadna registrácia).'); return; }

  /* ENERGETICKÁ BRÁNA (E2) – sieň sa už neplatí §, stojí energiu.
     Kontrola je TU, teda ešte pred výberom persóny: hráč nemá prejsť
     výberovou obrazovkou, aby ho appka o dve kliknutia neskôr odmietla.
     Samotný odpočet je až po zostavení tém (nižšie) – aby sa energia
     nestrhla za skúšku, ktorá sa nikdy nespustí. */
  const energyCost = ECONOMY_CONFIG.ENERGY.GREMIUM;
  const energyLeft = await econEnergyLeft();
  if (energyLeft < Math.abs(energyCost)) {
    showRewardToast(econEnergyMissingMsg(energyCost, energyLeft));
    return;
  }

  // Výber persóny skúšajúceho + hlasu, PRED odpočtom energie – zrušenie tu je zadarmo.
  const savedPersona = localStorage.getItem(EXAM_PERSONA_KEY) || DEFAULT_PERSONA;
  const savedVoice = localStorage.getItem(EXAM_VOICE_KEY) || 'off';
  const choice = await buildPersonaOverlay(areaName, savedPersona, savedVoice);
  if (!choice) return; // zrušené na výberovej obrazovke
  const { personaKey, voicePref } = choice;
  localStorage.setItem(EXAM_PERSONA_KEY, personaKey);
  localStorage.setItem(EXAM_VOICE_KEY, voicePref);
  const persona = getPersona(personaKey);
  const examVoice = await resolveExamVoice(voicePref);

  const topics = await buildTopicsFromSharedSelection(shared, areaName);
  /* ⚠️ Táto stráž beží AŽ PO orezaní na EXAM_TOPIC_COUNT, takže sa
     porovnáva s ním, nie s pevnou dvojkou – inak by pri jednej otázke
     zablokovala každú skúšku. Stráže vnútri buildTopicsFromSharedSelection()
     (tie na `< 2`) sú pred orezaním a ostávajú nezmenené: naďalej overia,
     že sa zdieľaná dvojica okruhov naozaj načítala.
     Prázdne pole = nepodarilo sa načítať okruhy alebo neznáma oblasť.
     Refund tu NETREBA – energia sa odpočítava až nižšie. */
  if (topics.length < EXAM_TOPIC_COUNT) {
    showRewardToast('🎓 Komisia teraz nie je dostupná, skús neskôr.');
    return;
  }

  /* Odpočet energie – posledný krok pred otvorením siene. Za týmto bodom
     sa už NEVRACIA (ani pri zrušení skúšky): energia je spotreba ako pri
     každej inej aktivite, nie vratná záloha. */
  const spent = await econSpendEnergy(nick, energyCost, 'skúšobná skúška – vstup');
  if (!spent) {
    showRewardToast(econEnergyMissingMsg(energyCost, await econEnergyLeft()));
    return;
  }

  const commission = await pickCommission();

  closeStatniceHall();
  overlayEl = buildOverlay(areaName);
  document.body.style.overflow = 'hidden';

  renderCommission(overlayEl.querySelector('#statniceCommission'), commission);

  const topicsEl = overlayEl.querySelector('#statniceTopics');
  topicsEl.innerHTML = topics.map((t, i) => `
    <div class="statnice-topic-card">
      <div class="statnice-topic-num">${t.label || `Otázka ${i + 1}`}</div>
      <div class="statnice-topic-text">${t.title}</div>
      ${renderSource(t.zdroj)}
    </div>
  `).join('');

  /* ============================================================
     STAVOVÝ AUTOMAT
     PRIPRAVA → VYZVANIE → POCUVANIE → HODNOTENIE
       → (doplňujúca? → POCUVANIE : ĎALŠIA_OTÁZKA/ZÁVER)
  ============================================================ */
  let examPhase = 'PRIPRAVA';
  function setPhase(next) {
    console.log(`[AI SKÚŠKA] ${examPhase} → ${next}`);
    examPhase = next;
  }

  let answered = false; // ochrana pri zatváraní – § sa nevráti, ak už hráč odpovedal
  let rewardGranted = false;
  const answers = ['', ''];
  const evaluations = [];
  const followUpCounts = [0, 0];
  // Ktoré konkrétne body sa v tejto téme UŽ pýtali cez doplňujúcu otázku –
  // zabraňuje opakovaniu TOHO ISTÉHO bodu, aj keby ho matcher po doplnení
  // stále vyhodnotil ako nepokrytý (parafráza/skratka mimo dosahu prefix-
  // matchingu). Uchováva INDEXY do topic.keyPoints (resolveKeyPointIndex),
  // NIE text – LLM grader (Fáza 3) nevráti text bodu byte-identicky pri
  // každom volaní, takže textové porovnanie by de-dup nespoľahlivo zlyhalo.
  // Pozri enterHodnotenie/offerHint nižšie.
  const hintedPoints = [[], []];
  let currentIdx = 0;

  let recognizer = null;
  let listening = false;
  // true od prvého spustenia nahrávania (klik na mikrofón, ALEBO auto-štart
  // na desktope – viď enterPocuvanie/isLikelyDesktop nižšie) až po manuálne
  // zastavenie/odoslanie – kým je true, prirodzené ticho (onEnd) REŠTARTUJE
  // rozpoznávanie namiesto ukončenia odpovede (viď startOrRestartRecording).
  let recordingSessionActive = false;
  let restartFailCount = 0;
  const MAX_RECORDING_RESTART_FAILS = 3;
  // Rozlišuje "prvý pokus tejto otázky ešte vôbec nenabehol" (auto-štart aj
  // klik zlyhali hneď) od "bežalo to, len teraz opakovane zlyháva" – prvý
  // prípad dostane VÝSLOVNÚ výzvu kliknúť na mikrofón (2026-07-19 zadanie,
  // bod 5), druhý ostáva pri pôvodnom znení. Reset v enterPocuvanie, nastaví
  // sa v onStart v startOrRestartRecording.
  let micEverStarted = false;
  let prepTimerHandle = null;
  // JEDNA zdieľaná poistková časomiera pre CELÝ prechod "komisia dohovorila
  // → mikrofón dostupný" – používa ju výhradne speakThenListen() nižšie,
  // naprieč úvodnou otázkou aj každou doplňujúcou (žiadna druhá kópia).
  let speechTransitionTimer = null;

  const timerEl = overlayEl.querySelector('#statniceTimer');
  const qNumEl = overlayEl.querySelector('#statniceQNum');
  const qTextEl = overlayEl.querySelector('#statniceCurrentQ');
  const msgEl = overlayEl.querySelector('#statniceCommissionMsg');
  const micStatusEl = overlayEl.querySelector('#statniceMicStatus');
  const liveTranscriptEl = overlayEl.querySelector('#statniceLiveTranscript');
  const answerInput = overlayEl.querySelector('#statniceAnswerInput');
  const micBtn = overlayEl.querySelector('#statniceMicBtn');

  /* ---------- PRIPRAVA ---------- */
  let remaining = PREP_SECONDS;
  function tickPrepTimer() {
    remaining--;
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (remaining <= 0) {
      clearInterval(prepTimerHandle);
      startAnswerPhase();
    }
  }
  prepTimerHandle = setInterval(tickPrepTimer, 1000);
  overlayEl.querySelector('#statniceReadyBtn').onclick = () => {
    clearInterval(prepTimerHandle);
    startAnswerPhase();
  };

  function startAnswerPhase() {
    overlayEl.querySelector('#statnicePrepPhase').style.display = 'none';
    overlayEl.querySelector('#statniceAnswerPhase').style.display = 'block';
    enterVyzvanie(currentIdx);
  }

  function stopListening() {
    recordingSessionActive = false; // manuálne/definitívne zastavenie – onEnd nižšie nesmie reštartovať
    if (recognizer) { try { recognizer.stop(); } catch (e) {} }
    listening = false;
    micBtn.classList.remove('statnice-mic-recording');
    micBtn.textContent = '🎤 Mikrofón';
  }

  /* ============================================================
     speakThenListen() – JEDNA cesta pre "komisia hovorí → mikrofón
     dostupný", spoločná pre ÚVODNÚ otázku aj KAŽDÚ doplňujúcu (predtým dve
     štruktúrne zhodné, ale samostatne udržiavané kópie – goToListening v
     enterVyzvanie a goBack v offerHint – teraz jedna funkcia, žiadna
     možnosť, aby sa časom rozišli).

     PRAVIDLO BEZ VÝNIMKY: kým komisia hovorí, mikrofón je VŽDY zatvorený –
     recognizer sa vytvára VÝHRADNE na klik (startOrRestartRecording sa
     volá len z micBtn.onclick alebo z jeho vlastného onEnd/onError počas
     UŽ AKTÍVNEJ relácie, pozri nižšie). Táto funkcia teda nikdy nespúšťa
     nahrávanie – len prepne fázu do POCUVANIE (zobrazí tlačidlo mikrofónu),
     AŽ POTOM čo skutočne skončí reč komisie.

     SKUTOČNÝ spúšťač je vždy utterance.onend (odovzdané ako onEnd nižšie).
     ttsFallbackDelay() časovač je VÝHRADNE poistka pre prípad, že onend v
     danom prehliadači/zariadení vôbec nepríde (zdokumentovaný okrajový
     prípad Web Speech API) – nikdy primárny mechanizmus. Pred prechodom do
     POCUVANIE (nech prišiel z onend, alebo z poistky) ešte raz explicitne
     umlčí prípadne stále bežiace TTS, nech sa za žiadnych okolností
     nezachytí vlastný hlas komisie.

     ⚠️ DOLNÁ HRANICA (druhá, nezávislá poistka): aj SKUTOČNÝ onend, ktorý
     príde nápadne skoro, je nedôveryhodný – ten istý zdokumentovaný
     Chrome/Android bug (viď speakOrSkip vyššie) vie spôsobiť takmer
     okamžitý onend ešte predtým, než z reproduktora zaznie čokoľvek.
     Preto sa fáza nikdy neprepne skôr, než uplynie aspoň minElapsedMs
     (úmerné dĺžke textu) od začiatku prejavu – ak onend/poistka prídu
     skôr, počká sa do tejto hranice namiesto okamžitého prechodu. Toto
     robí chybu "mikrofón chytí hlas avatara" neopakovateľnou KONŠTRUKČNE,
     bez ohľadu na to, či je onend v danom prehliadači spoľahlivý. */
  function speakThenListen(text, afterSpeaking) {
    let advanced = false;
    let minWaitTimer = null;
    const minElapsedMs = examVoice ? Math.max(1200, Math.round(estimateSpeechMs(text) * 0.4)) : 0;
    const startedAt = Date.now();

    const proceed = () => {
      if (advanced) return;
      const remaining = minElapsedMs - (Date.now() - startedAt);
      if (remaining > 0) {
        clearTimeout(minWaitTimer);
        minWaitTimer = setTimeout(proceed, remaining);
        return;
      }
      advanced = true;
      clearTimeout(speechTransitionTimer);
      clearTimeout(minWaitTimer);
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
      afterSpeaking();
    };

    if (examVoice) {
      speakOrSkip(text, examVoice, { onEnd: proceed });
      clearTimeout(speechTransitionTimer);
      speechTransitionTimer = setTimeout(proceed, ttsFallbackDelay(text));
    } else {
      proceed(); // bez hlasu (vypnuté alebo žiadny sk hlas) – rovno ďalej, žiadne čakanie
    }
  }

  /* ---------- VYZVANIE – komisia AKTÍVNE vyzve, vždy sa vykoná ---------- */
  function enterVyzvanie(idx) {
    setPhase('VYZVANIE');
    const topic = topics[idx];

    qNumEl.textContent = topic.label || `Otázka ${idx + 1} / ${topics.length}`;
    qTextEl.textContent = topic.title;
    answerInput.value = answers[idx] || '';
    liveTranscriptEl.textContent = '';
    micStatusEl.textContent = '';

    const prompt = idx === 0 ? persona.greet(topic.title) : persona.next(topic.title);
    msgEl.style.display = 'block';
    msgEl.innerHTML = `<strong>Komisia (${persona.emoji} ${persona.label}):</strong> ${prompt}`;

    speakThenListen(prompt, enterPocuvanie);
  }

  /* ---------- POCUVANIE – nahrávanie s prirodzenými pauzami ---------- */
  function enterPocuvanie() {
    setPhase('POCUVANIE');
    recordingSessionActive = false;
    restartFailCount = 0;
    micEverStarted = false;

    if (!isSpeechRecognitionSupported()) {
      micStatusEl.textContent = '🔇 Rozpoznávanie reči nie je v tomto prehliadači dostupné – napíš odpoveď a klikni „Dokončiť odpoveď".';
      micBtn.style.display = 'none';
      return; // textarea je vždy viditeľná a funkčná – skúška beží aj bez mikrofónu
    }
    micBtn.style.display = '';

    // Auto-štart ako BONUS na pravdepodobnom desktope (návrat k správaniu
    // spred 87fd5c9) – tlačidlo NIŽŠIE ostáva vždy funkčné rovnako, či auto-
    // štart prebehol, zlyhal, alebo sa vôbec neskúsil (mobil/nesprávna detekcia).
    if (isLikelyDesktop()) {
      resetMicUI('🎤 Automaticky počúvam – môžeš hovoriť hneď. (Ak sa nerozbehlo, klikni na mikrofón.)');
      recordingSessionActive = true;
      restartFailCount = 0;
      startOrRestartRecording();
    } else {
      resetMicUI('Klikni na mikrofón a hovor – pauzy na premýšľanie nevadia, mikrofón sám pokračuje v počúvaní. Odpoveď ukonči tlačidlom „Dokončiť odpoveď", alebo píš rovno do poľa nižšie.');
    }
  }

  function resetMicUI(message) {
    micBtn.classList.remove('statnice-mic-recording');
    micBtn.textContent = '🎤 Mikrofón';
    if (message) micStatusEl.textContent = message;
  }

  /* Spustí (alebo po prirodzenom tichu AUTO-REŠTARTUJE) rozpoznávanie v rámci
     JEDNEJ nahrávacej relácie (recordingSessionActive). Volané buď:
     a) PRIAMO z klik handlera mikrofónu – VŽDY skutočné user gesto (rovnaký
        vzor ako memory-trainer.html setupMicButton – tu sa reálne prvýkrát
        pýta povolenie mikrofónu), alebo
     a') AUTOMATICKY z enterPocuvanie() na pravdepodobnom desktope
        (isLikelyDesktop) – BEZ gesta. Na desktope Web Speech API gesto na
        .start() nevyžaduje (to je mobilné/Android obmedzenie), takže toto
        je bezpečné; ak by detekcia bola nesprávna (dotykový notebook) a
        .start() by zlyhal, onError nižšie to zachytí a vyzve na manuálny
        klik – nikdy ticho, viď micEverStarted nižšie. Toto je presne
        správanie spred záznamu 87fd5c9 (mobilná oprava ho odstránila pre
        VŠETKY zariadenia – regresia na PC, teraz vrátená len tam, kde je
        bezpečná), alebo
     b) z onEnd() callbacku PO tichu, KEĎ relácia ešte beží – toto je reštart
        PO UŽ UDELENOM povolení pre tento pôvod (origin), nie nová žiadosť oň.
        Web Speech API (Chrome/Android aj desktop) vyžaduje gesto len na PRVÉ
        schválenie povolenia; ďalšie .start() v tej istej relácii bez gesta
        bežne funguje presne z tohto dôvodu. Ak by na niektorom mobile predsa
        len zlyhávalo (nedá sa to overiť bez fyzického zariadenia), onError
        nižšie po MAX_RECORDING_RESTART_FAILS pokusoch prestane skúšať a
        vráti študenta na manuálne klikanie (bezpečná záloha, nie ticho). */
  function startOrRestartRecording() {
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      // Poistka proti zachyteniu vlastného hlasu komisie – ak by TTS z
      // akéhokoľvek dôvodu ešte fyzicky dobiehalo, radšej ho rovno utíš,
      // než riskovať, že mikrofón nahrá ozvenu avatara.
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }

    // ⚠️ continuous:true na pravdepodobnom desktope (2026-07-19, C-2) – bez toho
    // Chrome sám ukončí reláciu po krátkej prirodzenej pauze medzi vetami
    // (continuous:false default), a kým sa nižšie onEnd→startOrRestartRecording
    // reštart stihne pripojiť k rozpoznávaciemu servisu, mikrofón chvíľu
    // nepočúva – presne tam sa strácali slová na začiatku ďalšej vety. Rovnaký
    // isLikelyDesktop() signál ako auto-štart vyššie – ak sa pomýli na
    // dotykovom zariadení, onEnd nižšie je RESERVE (dnešné mobilné správanie:
    // reštart pri tichu), nie tvrdá bariéra. Mobil ostáva continuous:false,
    // úplne nedotknuté. Vyžaduje opravený onresult v memoryTrainer.js
    // (iteruje resultIndex..results.length, nie natvrdo index 0), inak by
    // continuous:true po prvej vete ignoroval všetko ďalšie.
    recognizer = createSpeechRecognizer({
      onStart: () => {
        listening = true;
        restartFailCount = 0;
        micEverStarted = true;
        micBtn.classList.add('statnice-mic-recording');
        micBtn.textContent = '⏹️ Dokončiť nahrávanie';
        micStatusEl.textContent = '🔴 Počúvam… (pauzy nevadia, pokračujem)';
      },
      onEnd: () => {
        listening = false;
        if (recordingSessionActive) {
          // Prirodzené ticho, NIE manuálne zastavenie – pokračuj v TEJ ISTEJ
          // odpovedi, neposúvaj na ďalšiu otázku.
          micStatusEl.textContent = '⏳ Krátka pauza… pokračujem v počúvaní.';
          startOrRestartRecording();
          return;
        }
        resetMicUI('⏸️ Mikrofón vypnutý – klikni pre pokračovanie, alebo „Dokončiť odpoveď".');
      },
      onError: (e) => {
        listening = false;
        restartFailCount++;
        console.warn('⚠️ [AI SKÚŠKA] Rozpoznávanie hlasu zlyhalo', e, 'pokus', restartFailCount);
        const fatal = e && (e.error === 'not-allowed' || e.error === 'service-not-allowed');
        if (!recordingSessionActive) return; // už manuálne zastavené, nič nereštartuj
        if (fatal || restartFailCount > MAX_RECORDING_RESTART_FAILS) {
          // ⚠️ VYPNI auto-reštart a VYZVI študenta – NIKDY nezavolaj odtiaľto
          // enterHodnotenie()/advanceQuestion(). Doteraz nadiktovaný text v
          // answerInput.value ostáva netknutý, len prestane pribúdať; skúšku
          // dokončí výhradne explicitný klik na "Dokončiť odpoveď" nižšie.
          recordingSessionActive = false;
          // Ak toto bol prvý pokus tejto otázky a ešte NIKDY nenabehol (typicky
          // zlyhaný AUTO-ŠTART na desktope, viď enterPocuvanie) – výslovne
          // vyzvi na manuálny klik na mikrofón (2026-07-19 zadanie, bod 5),
          // nie len na písanie. Ak už predtým bežalo a zlyhalo až teraz,
          // ostáva pôvodné znenie (mikrofón dostal reálnu šancu, netreba
          // opakovane núkať klik).
          resetMicUI(micEverStarted
            ? '🔇 Mikrofón nezachytil odpoveď (povolenie zamietnuté alebo opakovaná chyba) – pokojne napíš odpoveď a klikni „Dokončiť odpoveď".'
            : '🔇 Automatické spustenie mikrofónu sa nepodarilo – klikni na mikrofón a skús to manuálne, alebo napíš odpoveď.');
          return;
        }
        // Prechodná chyba (napr. no-speech) – skús znova v tej istej relácii.
        startOrRestartRecording();
      },
      onResult: (transcript) => {
        // ⚠️ Vždy PRIPÁJA k aktuálnej hodnote textarey – tá sa naprieč reštartmi
        // (onEnd → startOrRestartRecording) NIKDE nemaže, takže doteraz
        // zozbieraný text prežije každý reštart aj v polovici vety.
        if (!transcript) return;
        const current = (answerInput.value || '').trim();
        answerInput.value = current ? `${current} ${transcript}` : transcript;
        answers[currentIdx] = answerInput.value;
        liveTranscriptEl.textContent = answerInput.value;
      }
    }, { continuous: isLikelyDesktop() });

    if (!recognizer) {
      recordingSessionActive = false;
      micStatusEl.textContent = '🔇 Rozpoznávanie reči zlyhalo – napíš odpoveď a klikni „Dokončiť odpoveď".';
      micBtn.style.display = 'none';
      return;
    }
    recognizer.start();
  }

  micBtn.onclick = () => {
    if (recordingSessionActive) {
      // Manuálne zastavenie – na rozdiel od prirodzeného ticha sa NEreštartuje.
      stopListening();
      resetMicUI('⏸️ Mikrofón vypnutý – klikni pre pokračovanie, alebo „Dokončiť odpoveď".');
      return;
    }
    if (examPhase === 'POCUVANIE') {
      recordingSessionActive = true;
      restartFailCount = 0;
      startOrRestartRecording(); // priamo v klik handleri = skutočné user gesto
    }
  };

  overlayEl.querySelector('#statniceSubmitBtn').onclick = async () => {
    // Poistka proti rýchlemu dvojkliku počas VYZVANIE/HODNOTENIE (kým komisia ešte
    // "hovorí"/vyhodnocuje) – zabraňuje pretekaniu dvoch stavových prechodov naraz.
    if (examPhase !== 'POCUVANIE') return;
    answered = true;
    stopListening();
    await enterHodnotenie(currentIdx, (answerInput.value || '').trim());
  };

  /* ---------- HODNOTENIE – Claude API kontrakt (lokálny substitút) ---------- */
  /* ⚠️ NÁPOVEDA JE NA ŽIADOSŤ ŠTUDENTA, nikdy automaticky od komisie – ak by
     komisia navádzala sama od seba, persóna by nepriamo ovplyvňovala známku
     (podporujúci pôsobí "ochotnejšie" navádzať → vyššie skóre → žiadna
     persóna by nemenila skóre rovnako), čo porušuje zásadu "persóna nemení
     známku". Študent vidí VOPRED presne o koľko si nápoveda zníži najlepšiu
     dosiahnuteľnú známku (HINT_GRADE_FLOOR), a počet/cena sú identické pre
     všetky tri persóny – len ZNENIE nápovede sa líši (buildFollowUpMessage). */
  let hintsUsed = 0;

  async function enterHodnotenie(idx, transcript) {
    setPhase('HODNOTENIE');
    answered = true;
    answers[idx] = transcript;

    const topic = topics[idx];
    // ⚠️ VŽDY prepočítané NANOVO z aktuálneho (celého, priebežne doplneného)
    // prepisu – nikdy sa neopakuje/nedrží predchádzajúci výsledok. Toto je
    // jediné miesto, kde sa `missing` počíta, a volá sa pri KAŽDOM uzavretí
    // odpovede (aj po doplňujúcej otázke), nie len pri prvom pokuse.
    // gradeAnswer() – JEDINÉ miesto, cez ktoré statnice.js hodnotenie volá
    // (nikdy priamo evaluateCoverage() – pozri komentár pri gradeAnswer()).
    const result = await gradeAnswer({
      summary: topic.summary, keyPoints: topic.keyPoints, glossary: topic.glossary, answerText: transcript
    });
    console.log('[AI SKÚŠKA] Hodnotenie:', result);
    evaluations[idx] = result;

    // Nepýtaj sa druhýkrát na TEN ISTÝ bod, na ktorý sa komisia už raz
    // pýtala doplňujúcou otázkou v tejto téme – de-dup podľa INDEXU bodu
    // v topic.keyPoints (resolveKeyPointIndex), nie podľa textu (viď
    // komentár pri hintedPoints vyššie). Ak sa index nedá spoľahlivo
    // určiť (-1), bod sa radšej ponúkne znova, než aby sa mylne stotožnil
    // s iným bodom. Známka/spätná väzba (evaluations[idx] vyššie) zostáva
    // na plnom, neupravenom výsledku – filtruje sa LEN výber ďalšej
    // doplňujúcej otázky.
    const offerable = result.missing
      .map(text => ({ text, kpIdx: resolveKeyPointIndex(text, topic.keyPoints) }))
      .filter(m => m.kpIdx === -1 || !hintedPoints[idx].includes(m.kpIdx));

    const canOfferHint = offerable.length > 0 && followUpCounts[idx] < MAX_FOLLOWUPS_PER_QUESTION;
    if (canOfferHint) {
      offerHint(idx, { ...result, missing: offerable.map(m => m.text) }, offerable[0].kpIdx);
    } else {
      advanceQuestion(idx);
    }
  }

  function offerHint(idx, result, missingKpIdx) {
    const floorTable = ECONOMY_CONFIG.STATNICE.HINT_GRADE_FLOOR;
    const nextFloor = floorTable[Math.min(hintsUsed + 1, floorTable.length - 1)];

    msgEl.style.display = 'block';
    msgEl.innerHTML = `
      <strong>Komisia (${persona.emoji} ${persona.label}):</strong> Odpoveď má medzery.
      Môžeš požiadať o nápovedu, ale KAŽDÁ nápoveda zníži najlepšiu dosiahnuteľnú
      známku (táto by ju obmedzila najviac na ${nextFloor}).
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="statniceHintBtn" type="button">💡 Chcem nápovedu (max. ${nextFloor})</button>
        <button class="btn btn-primary" id="statniceSkipHintBtn" type="button">➡️ Pokračovať bez nápovedy</button>
      </div>
    `;

    overlayEl.querySelector('#statniceHintBtn').onclick = () => {
      followUpCounts[idx]++;
      hintsUsed++;
      // presne ten bod (podľa indexu), na ktorý sa teraz spýta – nabudúce
      // sa naň už nespýta znova; -1 (nejasná zhoda) sa nezaznamenáva, nech
      // sa nabudúce neschová za falošnú zhodu s iným bodom.
      if (missingKpIdx !== -1) hintedPoints[idx].push(missingKpIdx);
      const followUpText = buildFollowUpMessage(result.missing, topics[idx].title, personaKey);
      msgEl.innerHTML = `<strong>Komisia (${persona.emoji} doplňujúca otázka):</strong> ${followUpText}`;
      liveTranscriptEl.textContent = '';

      speakThenListen(followUpText, enterPocuvanie);
    };

    overlayEl.querySelector('#statniceSkipHintBtn').onclick = () => advanceQuestion(idx);
  }

  function advanceQuestion(idx) {
    const nextIdx = idx + 1;
    if (nextIdx < topics.length) {
      currentIdx = nextIdx;
      enterVyzvanie(nextIdx);
    } else {
      enterZaver();
    }
  }

  /* ---------- ZÁVER – súhrnná spätná väzba ---------- */
  async function enterZaver() {
    setPhase('ZAVER');
    overlayEl.querySelector('#statniceAnswerPhase').style.display = 'none';
    overlayEl.querySelector('#statniceResultsPhase').style.display = 'block';

    const feedback = buildFinalFeedback(evaluations, topics, personaKey, hintsUsed);
    console.log('[AI SKÚŠKA] Záverečná spätná väzba:', feedback);

    const gradeEl = overlayEl.querySelector('#statniceGrade');
    gradeEl.textContent = `Známka: ${feedback.znamka}`;

    const rewardAmount = await awardExamResult(nick, feedback.znamka);
    rewardGranted = true;
    await saveExamResult(nick, feedback.znamka, areaName);

    const fbEl = overlayEl.querySelector('#statniceFeedback');
    fbEl.innerHTML = `
      ${hintsUsed > 0 ? `<div class="small muted">Použité nápovede: ${hintsUsed} (znížili najlepšiu dosiahnuteľnú známku).</div>` : ''}
      ${feedback.anyTooShort ? `<div class="small muted">Odpoveď na aspoň jednu tému bola príliš krátka na spoľahlivé posúdenie – obmedzilo to najlepšiu dosiahnuteľnú známku.</div>` : ''}
      ${feedback.weakTopicCapped ? `<div class="small muted">Téma „${escapeHtml(feedback.weakTopicTitle)}" vyšla na 3 – celková známka preto nemôže byť lepšia, aj keď druhá téma dopadla výrazne lepšie.</div>` : ''}
      <div class="statnice-fb-section"><strong>Silné stránky</strong><ul>${feedback.silne.map(s => `<li>${s}</li>`).join('')}</ul></div>
      ${feedback.nespravne.length ? `<div class="statnice-fb-section statnice-fb-incorrect"><strong>Vecné chyby</strong><ul>${feedback.nespravne.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
      ${feedback.medzery.length ? `<div class="statnice-fb-section"><strong>Medzery</strong><ul>${feedback.medzery.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
      ${feedback.terminologyGaps.length ? `<div class="statnice-fb-section"><strong>Odborná terminológia – chýbajúce pojmy</strong><ul>${feedback.terminologyGaps.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
      <div class="statnice-fb-section"><strong>Odporúčania</strong><ul>${feedback.odporucania.map(s => `<li>${s}</li>`).join('')}</ul></div>
      <div class="statnice-fb-zaver">${feedback.zaver}</div>
      ${rewardAmount > 0 ? `<div class="statnice-fb-reward">+${rewardAmount}🪙 za skúšku</div>` : ''}
    `;

    // --- Commit 5a: per-okruh coverage zo skúšky (BEST, izolované od examResults) ---
    try {
      const pair = window.__selectedOkruhPair;
      if (pair && Array.isArray(pair.sources)) {
        await Promise.allSettled(pair.sources.map((src, i) => {
          const ev = evaluations[i];
          if (!src || !ev) return Promise.resolve();
          if (ev.skipped === true) return Promise.resolve();          // #17: prázdna odpoveď
          const pct = Number(ev.coverage);
          if (!Number.isFinite(pct)) return Promise.resolve();
          if (topics[i] && topics[i].id && topics[i].id !== src.key) { // poistka na poradie
            console.warn('[AI SKÚŠKA] preskakujem – nesúlad poradia', src.key, topics[i].id);
            return Promise.resolve();
          }
          return recordOkruhResult(nick, src.area, src.key, PROGRESS_ACTIVITIES.STATNICA, pct)
            .then(() => console.log('[AI SKÚŠKA] progres zapísaný:', src.area, src.key, pct))
            .catch(e => console.warn('[AI SKÚŠKA] zápis zlyhal:', src.key, e));
        }));
      }
    } catch (e) {
      console.warn('[AI SKÚŠKA] per-okruh zápis zlyhal (examResults ostáva):', e);
    }
  }

  overlayEl.querySelector('#statniceFinishBtn').onclick = () => closeStatniceHall();

  overlayEl.querySelector('#statniceCloseBtn').onclick = async () => {
    const phaseBeforeClose = examPhase;
    const wasListening = listening;
    setPhase('CLOSED');
    // recordingSessionActive MUSÍ ísť na false PRED recognizer.stop() – inak by
    // onEnd() (asynchrónny, príde chvíľu po .stop()) videl reláciu stále ako
    // "aktívnu" a nečakane by ju sám reštartoval aj počas zatvárania/potvrdenia.
    recordingSessionActive = false;
    if (recognizer) { try { recognizer.stop(); } catch (e) {} }
    clearInterval(prepTimerHandle);
    clearTimeout(speechTransitionTimer);

    if (answered && !rewardGranted) {
      const ok = window.confirm('Ukončiť skúšku? Energia za vstup sa nevracia.');
      if (!ok) {
        // Návrat presne do stavu pred pokusom o zatvorenie (nie natvrdo do POCUVANIE).
        // Nahrávanie (ak bežalo) sa nerestartuje automaticky – rozpoznávač je teraz
        // jednorazový na klik (fresh gesture), nie continuous session; študent
        // jednoducho klikne mikrofón znova, ak chce pokračovať v diktovaní.
        setPhase(phaseBeforeClose);
        if (phaseBeforeClose === 'POCUVANIE' && wasListening) {
          micStatusEl.textContent = '⏸️ Nahrávanie sa zastavilo – klikni na mikrofón pre pokračovanie, alebo píš.';
        }
        return;
      }
    }
    /* E2: refund zrušený. Vstup sa už neplatí 🪙, ale energiou, a tá sa
       nevracia – je to spotreba ako pri kartičkách či prípadoch, nie
       vratná záloha. Pôvodná vetva tu vracala 15 🪙, keď hráč zavrel sieň
       pred prvou odpoveďou. */
    closeStatniceHall();
  };
  } catch (e) {
    // Bez tohto by akákoľvek chyba pred vykreslením overlaya (napr. sieťová
    // chyba pri sťahovaní okruhov na nestabilnom mobilnom pripojení) skončila
    // ako tichý "unhandled promise rejection" – klik na tlačidlo by vyzeral,
    // akoby sa nestalo vôbec nič. Radšej viditeľná hláška než ticho.
    console.error('⚠️ [AI SKÚŠKA] openStatniceHall zlyhalo', e);
    showRewardToast('🎓 AI skúšku sa nepodarilo otvoriť. Skús to prosím znova.');
  } finally {
    statniceOpening = false;
  }
}
