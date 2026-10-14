'use strict';

/* ============================================================
   scripts/fillZdroj.mjs
   Jednorazový migračný skript: doplní pole `zdroj` do každého
   A*.json v data/ priečinkoch (pracovné, trestné hmotné/procesné,
   občianske hmotné/procesné), AK ešte chýba. Existujúci `zdroj`
   nechá bez zmeny. Európske právo (eu-pravo-app/data) sa
   NEMENÍ – má vlastný `zdroj` po okruhoch.

   Spustenie:  node scripts/fillZdroj.mjs
============================================================ */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');

const AREAS = [
  {
    dir: 'LuluLaw duel Pracovné právo/data',
    zdroj: {
      type: 'zakon',
      citation: 'zákon č. 311/2001 Z. z. (Zákonník práce)',
      url: 'https://www.slov-lex.sk/',
      accessed: '2026-01'
    }
  },
  {
    dir: 'ob-pravo-app/data/hmotne',
    zdroj: {
      type: 'zakon',
      citation: 'zákon č. 40/1964 Zb. (Občiansky zákonník)',
      url: 'https://www.slov-lex.sk/',
      accessed: '2026-01'
    }
  },
  {
    dir: 'ob-pravo-app/data/procesne',
    zdroj: {
      type: 'zakon',
      citation: 'zákon č. 40/1964 Zb. (Občiansky zákonník)',
      url: 'https://www.slov-lex.sk/',
      accessed: '2026-01'
    }
  },
  {
    dir: 'Trestné právo hmotné/data',
    zdroj: {
      type: 'zakon',
      citation: 'zákon č. 300/2005 Z. z. (Trestný zákon)',
      url: 'https://www.slov-lex.sk/',
      accessed: '2026-01'
    }
  },
  {
    dir: 'Trestné právo procesné/data',
    zdroj: {
      type: 'zakon',
      citation: 'zákon č. 300/2005 Z. z. (Trestný zákon)',
      url: 'https://www.slov-lex.sk/',
      accessed: '2026-01'
    }
  }
  /* eu-pravo-app/data zámerne vynechané – EÚ okruhy majú vlastný,
     individuálne priradený `zdroj` (ECLI citácie a pod.), ktorý
     sa tu nemá prepisovať jednotným default zákonom. */
];

let filled = 0;
let skipped = 0;

for (const area of AREAS) {
  const dirPath = join(REPO_ROOT, area.dir);
  let files;
  try {
    files = readdirSync(dirPath).filter(f => /^A.*\.json$/i.test(f));
  } catch (e) {
    console.warn(`⚠️ Preskakujem neexistujúci priečinok: ${area.dir}`);
    continue;
  }

  for (const file of files) {
    const filePath = join(dirPath, file);
    const raw = readFileSync(filePath, 'utf8');

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn(`⚠️ Preskakujem neplatný JSON: ${area.dir}/${file}`);
      continue;
    }

    if (data.zdroj) {
      skipped++;
      continue;
    }

    data.zdroj = area.zdroj;

    const usesCRLF = raw.includes('\r\n');
    let out = JSON.stringify(data, null, 2);
    if (usesCRLF) out = out.replace(/\n/g, '\r\n');
    if (raw.endsWith('\n') && !out.endsWith('\n')) out += usesCRLF ? '\r\n' : '\n';

    writeFileSync(filePath, out, 'utf8');
    filled++;
    console.log(`✅ ${area.dir}/${file}`);
  }
}

console.log('\n============================================');
console.log(`Doplnené:   ${filled}`);
console.log(`Preskočené (už mali zdroj): ${skipped}`);
console.log('============================================');
