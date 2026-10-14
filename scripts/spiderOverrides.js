'use strict';

/* ============================================================
   scripts/spiderOverrides.js  (Etapa 2 – admin editácia pavúkov)

   Firebase override vrstva NAD statickým json.spider ({center, branches[]})
   – rovnaký vzor ako scripts/contentOverrides.js (summary/quiz/case), len pre
   pavúčiu štruktúru. Ukladá sa do TEJ ISTEJ kolekcie:

     contentOverrides/{app}/{okruh}/spider = {
       app, okruh, cast:'spider', novyObsah:{ spider:{center, branches[]} },
       autor, rola, pecat, timestamp
     }

   - app: slug oblasti – AREA_SLUGS sa IMPORTUJE z contentOverrides.js
     (žiadny duplikát mappingu; vykázané v Správe A).
   - okruh: `A${okruhCislo}` (rovnaký tvar ako "okruh" v contentOverrides).

   Traja čitatelia spider dát (spider.js, spiderGames.js, spiderMap.js) si
   volajú applySpiderOverride sami – žiadny spoločný fetch, žiadna cache tu
   (jednoduchosť > optimalizácia). Fail-soft: každá chyba → originál json.

   Code (Claude) NEZAPISUJE do Firebase – saveSpiderOverride volá výhradne
   Babu cez UI editor (spiderEditor.js).
============================================================ */

import { AREA_SLUGS, sealMeta } from './contentOverrides.js';

let fbApiPromise = null;
function fbApi() {
  if (!fbApiPromise) {
    fbApiPromise = import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  }
  return fbApiPromise;
}

/* Validný tvar overridu: center (voliteľný string) + branches pole
   { label:string, leaves:string[] }. Nič iné sa neaplikuje. */
function isValidSpider(sp) {
  return !!sp && typeof sp === 'object'
    && (sp.center === undefined || sp.center === null || typeof sp.center === 'string')
    && Array.isArray(sp.branches)
    && sp.branches.every(b =>
        b && typeof b.label === 'string'
        && Array.isArray(b.leaves)
        && b.leaves.every(l => typeof l === 'string'));
}

/* Navrství spider override na okruhový json. Nemutuje vstup – vracia NOVÝ
   objekt s nahradeným json.spider, alebo pôvodný json (chýbajúca DB/override/
   nevalidný tvar/akákoľvek chyba). */
export async function applySpiderOverride(json, areaTitle, okruhCislo) {
  try {
    const db = window.db;
    const app = AREA_SLUGS[areaTitle];
    if (!db || !app || okruhCislo == null || !json) return json;
    const okruh = `A${okruhCislo}`;
    const { ref, get } = await fbApi();
    const snap = await get(ref(db, `contentOverrides/${app}/${okruh}/spider`));
    if (!snap.exists()) return json;
    const ov = snap.val() || {};
    const sp = ov.novyObsah && ov.novyObsah.spider;
    if (!isValidSpider(sp)) return json;
    /* _seal = stopa poslednej úpravy (rovnaký tvar ako pri summary/quiz/case,
       cez zdieľané sealMeta). Čitatelia spider dát (spider.js buildBranches,
       spiderGames branchesOf, spiderMap center) mapujú polia explicitne, takže
       im pole navyše neprekáža. */
    return { ...json, spider: { ...sp, _seal: sealMeta(ov) } };
  } catch (e) {
    console.warn(`[spiderOverrides] applySpiderOverride zlyhalo (${areaTitle}/A${okruhCislo}) – originál`, e);
    return json;
  }
}

/* Uloží spider override (admin/garant). `rola` musí byť SKUTOČNÁ Firebase rola
   volajúceho – editor ju overuje pred zobrazením tlačidla (rovnako ako summary
   edit). Zápis vo vzore saveContentOverride. */
export async function saveSpiderOverride({ areaTitle, okruhCislo, spider, autor, rola }) {
  const db = window.db;
  if (!db) throw new Error('Firebase nie je dostupná – zmena sa neuložila.');
  const app = AREA_SLUGS[areaTitle];
  if (!app || okruhCislo == null) throw new Error('Neznáma oblasť/okruh pre uloženie pavúka.');
  if (!isValidSpider(spider)) throw new Error('Neplatný tvar pavúka (center/branches).');

  const okruh = `A${okruhCislo}`;
  const { ref, update } = await fbApi();
  /* committed/committedAt/committedHash/commitSha sa zhadzujú explicitne –
     dôvod je rovnaký ako v saveContentOverride() v contentOverrides.js:
     update() merguje, takže stará vlajka prežije novú verziu pavúka. */
  const payload = {
    app, okruh, cast: 'spider',
    novyObsah: { spider },
    autor: autor || 'Anonymous',
    rola: rola === 'garant' ? 'garant' : 'admin',
    pecat: rola === 'garant',
    timestamp: Date.now(),
    committed: false,
    committedAt: null,
    committedHash: null,
    commitSha: null
  };
  await update(ref(db, `contentOverrides/${app}/${okruh}/spider`), payload);
  return payload;
}
