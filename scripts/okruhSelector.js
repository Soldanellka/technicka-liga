'use strict';

/* ============================================================
   scripts/okruhSelector.js
   Zdieľaná logika triedenia okruhov podľa progresu (percentMap):
   klasifikácia slabé/nedotknuté/silné, výber "na precvičenie" a
   "zmiešaný" okruh, párové/jednotlivé poistky pri nedostatku dát.

   Vyňaté zo scripts/statnice.js (čistý refaktor, žiadna zmena správania,
   2026-07-23) – pripravené na opätovné použitie v pojednávaniach,
   kartičkách, prípadoch a bifľovačke.

   Funkcie tu NEČÍTAJÚ obsah okruhu samé – dostávajú `fetchTopic(n)`
   (async funkciu, ktorá pre dané číslo okruhu vráti buď dáta okruhu,
   alebo null/undefined ak okruh neexistuje/je neplatný) od volajúceho.
   Volajúci (napr. scripts/statnice.js) si drží vlastný tvar dát (napr.
   {id, title, summary, keyPoints, glossary, zdroj} pre hodnotenie) – tento
   modul o tvare nič nevie a nemá k nemu žiadnu väzbu.
============================================================ */
import { getOkruhPercentMap } from './dashboardStats.js';

/* Bezpečné načítanie percentMap – ak zlyhá/timeoutne Firebase, vráti null
   namiesto toho, aby nechalo výnimku zhodiť celé losovanie; null ďalej
   spúšťa rovnakú vetvu ako poistka nováčika (čisto náhodný výber).

   Tretí argument prijíma ČÍSLO alebo POLE:
   - číslo n  → kľúče sa odvodia ako A1..An (pôvodné správanie, používa
     štátnica – tam sú okruhy vždy súvislé A1..count, žiadna zmena).
   - pole keys → použije sa priamo. Nutné pre volajúcich (pojednávania),
     kde `keys` môže byť podmnožina/nesúvislý zoznam a odvodenie z dĺžky
     poľa by pri medzere v číslovaní posunulo mapovanie kľúč↔percento.

   logLabel ide do console.warn prefixu – volajúci sa tak identifikuje
   v logu (predtým natvrdo "[ŠTÁTNICE]", zavádzajúce odkedy funkciu volajú
   aj pojednávania). */
export async function fetchPercentMapSafe(nick, areaTitle, countOrKeys, logLabel = 'okruhSelector') {
  if (!nick || !areaTitle) return null;
  const keys = Array.isArray(countOrKeys)
    ? countOrKeys
    : Array.from({ length: countOrKeys }, (_, i) => `A${i + 1}`);
  try {
    const map = await getOkruhPercentMap(nick, areaTitle, keys);
    return (map && typeof map === 'object') ? map : null;
  } catch (e) {
    console.warn(`[${logLabel}] getOkruhPercentMap zlyhalo – fallback na dnešný náhodný výber`, e);
    return null;
  }
}

export function classifyOkruhPercent(percentMap, n) {
  const pct = percentMap[`A${n}`] || 0;
  if (pct >= 80) return 'silne';
  if (pct > 0) return 'slabe';
  return 'nedotknute';
}

export function bucketizeByPercent(percentMap, count) {
  const slabe = [], silne = [], nedotknute = [];
  for (let n = 1; n <= count; n++) {
    const bucket = classifyOkruhPercent(percentMap, n);
    (bucket === 'slabe' ? slabe : bucket === 'silne' ? silne : nedotknute).push(n);
  }
  return { slabe, silne, nedotknute };
}

/* Rovnaké triedenie ako bucketizeByPercent, ale nad ĽUBOVOĽNÝM polom
   kľúčov namiesto súvislého 1..count rozsahu – bezpečné aj pri medzere
   v číslovaní. Vracia "A{n}" kľúče priamo (nie čísla), lebo volajúci
   (duels.js) pracuje s kľúčmi, nie s indexmi. */
export function bucketizeKeysByPercent(percentMap, keys) {
  const slabe = [], silne = [], nedotknute = [];
  keys.forEach(k => {
    const n = Number(String(k).replace(/^A/, ''));
    const bucket = classifyOkruhPercent(percentMap, n);
    (bucket === 'slabe' ? slabe : bucket === 'silne' ? silne : nedotknute).push(k);
  });
  return { slabe, silne, nedotknute };
}

export function countStudied(percentMap, count) {
  let n = 0;
  for (let i = 1; i <= count; i++) if ((percentMap[`A${i}`] || 0) > 0) n++;
  return n;
}

/* Náhodné poradie 1..count (Fisher-Yates) – použité na VYČERPÁVAJÚCE
   hľadanie jedného platného okruhu v bazéne (skúša každý index nanajvýš
   raz, kým nenájde okruh s neprázdnym summary, alebo kým bazén
   nevyčerpá). Zaručuje, že "bazén je prázdny" hlásime len vtedy, keď
   naozaj ŽIADEN okruh v ňom nemá použiteľné summary. */
export function shuffledIndices(count) {
  const arr = Array.from({ length: count }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* Zamieša kandidátov, vráti prvý s validným obsahom (fetchTopic vracia
   null/undefined pre neplatný/chýbajúci okruh) – vyčerpávajúce hľadanie
   v rámci koša. */
export async function pickValidFromCandidates(candidates, fetchTopic) {
  const order = [...candidates];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const n of order) {
    const t = await fetchTopic(n);
    if (t) return t;
  }
  return null;
}

/* Okruh "na precvičenie": slabé → nedotknuté → silné (presné poradie fallbacku). */
export async function pickWeakTopic(buckets, fetchTopic) {
  for (const bucket of [buckets.slabe, buckets.nedotknute, buckets.silne]) {
    if (!bucket.length) continue;
    const t = await pickValidFromCandidates(bucket, fetchTopic);
    if (t) return t;
  }
  return null;
}

/* Okruh "zmiešaný": ~70 % silné / ~30 % nedotknuté, s fallbackom na
   opačný z tejto dvojice a napokon na slabé. */
export async function pickMixedTopic(buckets, fetchTopic) {
  const preferSilne = Math.random() < 0.7;
  const primary = preferSilne ? buckets.silne : buckets.nedotknute;
  const secondary = preferSilne ? buckets.nedotknute : buckets.silne;
  for (const bucket of [primary, secondary, buckets.slabe]) {
    if (!bucket.length) continue;
    const t = await pickValidFromCandidates(bucket, fetchTopic);
    if (t) return t;
  }
  return null;
}

/* Poistka bez (dostatočného) progresu – čisto náhodný pár A(2k-1)+A(2k),
   vyčerpávajúco skúša páry kým nenájde jeden s obidvoma platnými okruhmi. */
export async function pickPairTopics(count, fetchTopic) {
  const pairCount = Math.floor(count / 2); // 25 dvojíc: (A1,A2)…(A49,A50)
  const triedPairs = new Set();
  const maxAttempts = Math.min(6, pairCount);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let pairIdx;
    do { pairIdx = Math.floor(Math.random() * pairCount); }
    while (triedPairs.has(pairIdx) && triedPairs.size < pairCount);
    triedPairs.add(pairIdx);

    const n1 = pairIdx * 2 + 1;
    const n2 = pairIdx * 2 + 2;
    const [t1, t2] = await Promise.all([fetchTopic(n1), fetchTopic(n2)]);
    if (t1 && t2) return [t1, t2];
  }
  return [];
}

/* Poistka bez (dostatočného) progresu – čisto náhodný jeden okruh
   z bazéna (vyčerpávajúco, cez shuffledIndices). */
export async function pickSingleFromPool(count, fetchTopic) {
  const order = shuffledIndices(count);
  for (const n of order) {
    const t = await fetchTopic(n);
    if (t) return t;
  }
  return null;
}

/* PRE mode 'pair': páry sú PEVNÁ štruktúra A(2k-1)+A(2k) (nezávisle voliteľné
   okruhy tu neexistujú, na rozdiel od dual-pool) – "topic1 na precvičenie"
   preto znamená: nájdi pár, KTORÉHO JEDEN člen padne do cieľového koša
   (slabé→nedotknuté→silné fallback), ten člen polož ako topic1, druhý
   člen páru (nevyhnutne "čokoľvek to je" – páry sa nedajú rozpojiť) ako
   topic2. Presnú 70/30 váhu na topic2 tu preto NEVIEME zaručiť (štruktúra
   páru ju neumožňuje) – zdokumentované, nie obídené. */
export async function pickPairMixedTopics(count, percentMap, fetchTopic) {
  const pairCount = Math.floor(count / 2);
  const pairs = [];
  for (let k = 0; k < pairCount; k++) {
    const n1 = k * 2 + 1, n2 = k * 2 + 2;
    pairs.push({ n1, n2, b1: classifyOkruhPercent(percentMap, n1), b2: classifyOkruhPercent(percentMap, n2) });
  }

  let candidatePairs = null;
  let matchedBucket = null;
  for (const bucket of ['slabe', 'nedotknute', 'silne']) {
    const found = pairs.filter(p => p.b1 === bucket || p.b2 === bucket);
    if (found.length) { candidatePairs = found; matchedBucket = bucket; break; }
  }
  if (!candidatePairs) return [];

  const order = [...candidatePairs];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const maxAttempts = Math.min(6, order.length);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const p = order[attempt];
    const weakN = p.b1 === matchedBucket ? p.n1 : p.n2;
    const otherN = weakN === p.n1 ? p.n2 : p.n1;
    const [t1, t2] = await Promise.all([fetchTopic(weakN), fetchTopic(otherN)]);
    if (t1 && t2) return [t1, t2]; // t1 = "na precvičenie", vždy prvý
  }
  return [];
}
