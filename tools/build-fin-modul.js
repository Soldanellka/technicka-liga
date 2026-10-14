'use strict';
/* Generátor finančných študijných modulov.

   Spustenie:  node tools/build-fin-modul.js

   Prepíše moduly/osobne-peniaze-a-uver.html a
   moduly/osobne-sporenie-a-investovanie.html. Kapitoly sú v rozložení
   modulu Číselné sústavy, ktorý slúži ako šablóna (hlavička, CSS aj
   motor sa z neho preberajú, aby sa rozloženie nemohlo rozísť).
   Stránky sa GENERUJÚ, aby text nemohol vzniknúť inde než v data/A1.json
   a data/A2.json – každá veta sa pred zápisom overí proti zdroju. */
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const SABLONA = path.join(REPO, 'moduly/ciselne-sustavy.html');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const js = s => JSON.stringify(String(s));
const lit = s => esc(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/* ---------- špecifikácia kapitol ----------
   vety = doslovné vety zo summary v JSON (skript ich overí)
   pojmy = termíny z tiles, pripad = index v cases, kviz = indexy v quiz */
const SPEC = [
  {
    data: 'A1', out: 'moduly/osobne-peniaze-a-uver.html', key: 'fin-a1-modul-v1',
    nazov: 'Peniaze a úver', ikona: '💶', oblast: 'Osobné financie',
    kapitoly: [
      { id: 'k1', short: '1. Čo stojí úver', title: 'Kapitola 1: Čo stojí úver',
        vety: [
          'RPMN zahŕňa úrok aj poplatky, preto je na porovnávanie úverov lepšia než samotný úrok. Pri výbere úveru sa preto porovnáva RPMN, nie reklamný úrok.',
          'Čím kratšie je požičané, tým menej úrokov sa zaplatí; pri predčasnom splatení si over poplatok za predčasné splatenie.'
        ],
        pojmy: ['RPMN', 'Predčasné splatenie úveru'], pripad: 1, kviz: [0, 2, 5] },
      { id: 'k2', short: '2. Karty a odložená platba', title: 'Kapitola 2: Karty a odložená platba',
        vety: [
          'Kreditná karta je úver; neskoré splatenie znamená úrok. Debetná karta oproti tomu čerpá tvoje vlastné peniaze. Rovnako aj odložená platba „Kúp teraz, zaplať neskôr“ je úverový produkt so sankciami pri omeškaní.'
        ],
        pojmy: ['Debetná karta', 'Kreditná karta', 'BNPL – kúp teraz, zaplať neskôr'], pripad: 2, kviz: [1, 7] },
      { id: 'k3', short: '3. Ručenie za cudzí úver', title: 'Kapitola 3: Ručenie za cudzí úver',
        vety: [
          'Ručenie je reálny záväzok, nie formalita – ručiteľ spláca úver, ak dlžník prestane.'
        ],
        pojmy: ['Ručiteľ'], pripad: null, kviz: [6] },
      { id: 'k4', short: '4. Bezpečnosť a príjem', title: 'Kapitola 4: Bezpečnosť a príjem',
        vety: [
          'Banka nikdy nepýta údaje cez odkaz v SMS; takáto správa je phishing a údaje si treba overiť priamo v banke alebo v jej aplikácii.',
          'Hrubá mzda mínus odvody a preddavok na daň = čistá mzda, teda suma, ktorá príde na účet.'
        ],
        pojmy: ['Phishing', 'Čistá mzda'], pripad: 0, kviz: [3, 4] }
    ]
  },
  {
    data: 'A2', out: 'moduly/osobne-sporenie-a-investovanie.html', key: 'fin-a2-modul-v1',
    nazov: 'Sporenie a investovanie', ikona: '🏦', oblast: 'Osobné financie',
    kapitoly: [
      { id: 'k1', short: '1. Ako peniaze rastú a strácajú hodnotu', title: 'Kapitola 1: Ako peniaze rastú a strácajú hodnotu',
        vety: [
          'Úroky sa pripisujú aj z úrokov, preto vklad rastie čoraz rýchlejšie – to je zložené úročenie. Proti nemu stojí inflácia, ktorá znižuje kúpnu silu peňazí: pri 5 % ročne za rovnaké peniaze kúpiš o približne 5 % menej.'
        ],
        pojmy: ['Zložené úročenie', 'Inflácia'], pripad: null, kviz: [0, 1] },
      { id: 'k2', short: '2. Finančná rezerva', title: 'Kapitola 2: Finančná rezerva',
        vety: [
          'Základom je finančná rezerva vo výške aspoň 3–6 mesiacov výdavkov. Rezerva kryje výpadok príjmu či nečakané výdavky bez pôžičky, a musí byť dostupná a bez rizika prudkej straty hodnoty – teda na sporiacom alebo bežnom účte s rýchlym prístupom.',
          'Najspoľahlivejší návyk je automatické sporenie pred míňaním, teda princíp „najprv zaplať sebe“.'
        ],
        pojmy: ['Finančná rezerva', 'Kde držať rezervu', '„Najprv zaplať sebe“'], pripad: 0, kviz: [2, 5, 7] },
      { id: 'k3', short: '3. Riziko a rozloženie', title: 'Kapitola 3: Riziko a rozloženie',
        vety: [
          'Pri investovaní znižuje riziko veľkej straty naraz rozloženie peňazí do rôznych investícií, teda diverzifikácia. Historicky majú najvyšší očakávaný výnos a zároveň najvyššie kolísanie akcie: vyšší výnos = vyššie riziko kolísania, preto akcie na dlhý horizont.'
        ],
        pojmy: ['Diverzifikácia', 'Akcie'], pripad: null, kviz: [3, 6] },
      { id: 'k4', short: '4. Poistenie a spoluúčasť', title: 'Kapitola 4: Poistenie a spoluúčasť',
        vety: [
          'Pri poistení sa na škode podieľaš dohodnutou spoluúčasťou – poisťovňa platí škodu nad túto sumu.'
        ],
        pojmy: ['Spoluúčasť'], pripad: null, kviz: [4] }
    ]
  }
];

/* ---------- šablóna: hlavička + motor z modulu Číselné sústavy ---------- */
const sablona = fs.readFileSync(SABLONA, 'utf8');
const NL = /\r\n/.test(sablona) ? '\r\n' : '\n';
const L = sablona.split(/\r?\n/);

const iCH = L.findIndex(r => r.trim() === 'var CH = [');
const iALL = L.findIndex(r => r.trim() === 'var ALL = CH.concat(EXTRA);');
if (iCH < 0 || iALL < 0) throw new Error('sablona: nenasiel som hranice obsahu');

let PREFIX = L.slice(0, iCH).join('\n');
let SUFFIX = L.slice(iALL).join('\n');

/* prepínače bitov sú len pre Číselné sústavy */
PREFIX = PREFIX.replace(/\.bits\{background[\s\S]*?\.bits-out \.sum\{[^}]*\}\n/, '');
PREFIX = PREFIX.replace('  .bit .v{font-size:1.25rem} .bits-row{gap:4px} .bits{padding:12px}\n', '');
SUFFIX = SUFFIX.replace(/\/\* ---------- bit switches ---------- \*\/[\s\S]*?\n(?=var okruhyList)/, '');
SUFFIX = SUFFIX.replace(/\n *initBits\(\);\n/, '\n');
if (/initBits|bitsRow/.test(PREFIX + SUFFIX)) throw new Error('motor: zvysky prepinacov bitov');

/* Kvíz sa po novom kreslí aj bez riešeného prípadu. V Číselných sústavách
   mala každá kapitola prípad, takže celý blok prípad + kvíz visel na
   ch.steps. Vo financiách sú prípady len pri troch kapitolách z ôsmich
   (viac ich v dátach nie je), preto sa podmienky rozdelili – inak by
   kapitola bez prípadu prišla aj o kvíz. */
const ANCHOR = '    var hq = document.createElement("h3"); hq.textContent = "Kvíz"; detail.appendChild(hq);';
if (!SUFFIX.includes(ANCHOR)) throw new Error('motor: nenasiel som blok kvizu');
SUFFIX = SUFFIX.replace(ANCHOR, '  }\n\n  if (ch.quiz && ch.quiz.length){\n' + ANCHOR);

/* nadpis „Výklad“ sa ukazoval len pri kapitole s prípadom */
SUFFIX = SUFFIX.replace('  if (ch.steps){\n    var h3 = document',
  '  if (ch.steps || (ch.quiz && ch.quiz.length)){\n    var h3 = document');

/* Prepis staršieho tvaru uloženého postupu je špecifický pre Číselné
   sústavy – nové moduly začínajú s čistým kľúčom, takže migrácia padá. */
SUFFIX = SUFFIX.replace(`/* ---------- uloženie postupu ----------
   Kľúč ostáva cs-modul-v1, len tvar sa rozšíril z { k2: 1 } na
   { k2: { done:1, good:2, total:3 } }, aby sa dalo spočítať percento
   správnych. Staršia jednotka sa zapisovala VÝHRADNE pri kvíze na
   100 %, takže sa dá verne dopočítať na plný počet otázok.
   Všetko v try/catch – localStorage v súkromnom režime Safari hádže
   výnimku už pri čítaní a modul musí fungovať aj bez ukladania. */`,
`/* ---------- uloženie postupu ----------
   Tvar { k2: { done:1, good:2, total:3 } }, aby sa dalo spočítať
   percento správnych odpovedí. Všetko v try/catch – localStorage
   v súkromnom režime Safari hádže výnimku už pri čítaní a modul musí
   fungovať aj bez ukladania. */`);
SUFFIX = SUFFIX.replace(`CH.forEach(function(ch){
  if (typeof store[ch.id] === "number") {
    store[ch.id] = { done: 1, good: ch.quiz.length, total: ch.quiz.length };
  }
});
`, '');

/* ---------- generovanie ---------- */
function vybudujKapitolu(k, zdroj) {
  const cely = JSON.stringify(zdroj);
  k.vety.forEach(v => {
    if (!cely.includes(JSON.stringify(v).slice(1, -1)))
      throw new Error('veta nie je v zdroji: ' + v.slice(0, 60));
  });
  const pojmy = k.pojmy.map(t => {
    const tile = (zdroj.tiles || []).find(x => x.term === t);
    if (!tile) throw new Error('pojem nie je v zdroji: ' + t);
    return tile;
  });

  let html = k.vety.map(v => "'<p>" + lit(v) + "</p>'").join('+\n  ');
  pojmy.forEach(p => {
    html += "+\n  '<div class=\"note\"><b>" + lit(p.term) + '</b>' + lit(p.definition) + "</div>'";
  });

  const kviz = k.kviz.map(i => {
    const q = zdroj.quiz[i];
    if (!q) throw new Error('otazka ' + i + ' nie je v zdroji');
    return '  {q:' + js(q.question) + ',o:' + JSON.stringify(q.options)
      + ',c:' + q.correct + ',ex:' + js(q.explanation.correct) + '}';
  }).join(',\n');

  let out = '{\n id:' + js(k.id) + ', short:' + js(k.short) + ', title:' + js(k.title)
    + ',\n html:\n  ' + html + ',\n';

  if (k.pripad !== null) {
    const c = zdroj.cases[k.pripad];
    if (!c) throw new Error('pripad ' + k.pripad + ' nie je v zdroji');
    const kroky = c.steps.filter(s => s.options && s.options.length);
    const intro = c.steps.find(s => !s.options || !s.options.length);
    out += ' caseIntro:' + js(intro ? intro.question : c.title) + ',\n steps:[\n'
      + kroky.map(s => '  {q:' + js(s.question) + ',o:' + JSON.stringify(s.options)
        + ',c:' + s.correct + ',ex:' + js(s.explanation.correct) + '}').join(',\n')
      + '\n ],\n';
  }

  return out + ' quiz:[\n' + kviz + '\n ]\n}';
}

SPEC.forEach(spec => {
  const zdroj = JSON.parse(fs.readFileSync(path.join(REPO, 'data', spec.data + '.json'), 'utf8'));

  const CH = 'var CH = [\n' + spec.kapitoly.map(k => vybudujKapitolu(k, zdroj)).join(',\n') + '\n];\n';

  const pojmyHtml = (zdroj.tiles || []).map(t =>
    "  '<div class=\"note\"><b>" + lit(t.term) + '</b>' + lit(t.definition) + "</div>'").join('+\n');

  const citacia = (zdroj.zdroj && zdroj.zdroj.citation) || '';
  const EXTRA = '\nvar EXTRA = [\n'
    + ' {id:"pojmy", short:"Pojmy v skratke", title:"Pojmy v skratke",\n'
    + '  html:\n'
    + "  '<p>Zhrnutie všetkých pojmov z kapitol – na rýchle zopakovanie pred kvízom alebo pojednávaním.</p>'+\n"
    + pojmyHtml
    + (citacia
      ? "+\n  '<p class=\"case-intro\">Zdroj: " + lit(citacia)
        + '. Celý modul je poskladaný výhradne z otázok, vysvetlení a pojmov v <code>data/'
        + spec.data + ".json</code>.</p>'"
      : '')
    + '}\n];\n';

  let s = PREFIX + CH + EXTRA + '\n' + SUFFIX;

  const nahrad = [
    ['<title>Číselné sústavy – študijný modul</title>',
      '<title>' + esc(spec.nazov) + ' – študijný modul</title>'],
    ['<div class="header-title"><span class="logo-dot"></span><span class="t">Číselné sústavy</span></div>',
      '<div class="header-title"><span class="logo-dot"></span><span class="t">' + esc(spec.nazov) + '</span></div>'],
    ['      <h2>Okruhy</h2>', '      <h2>Kapitoly</h2>'],
    ['backLabel.textContent = (v === "detail" && jeMobil()) ? "Okruhy" : "Finančná liga";',
      'backLabel.textContent = (v === "detail" && jeMobil()) ? "Kapitoly" : "Finančná liga";'],
    ['      <div class="welcome-icon">🔢</div>', '      <div class="welcome-icon">' + spec.ikona + '</div>'],
    ['      <h1 class="welcome-title">Číselné sústavy</h1>',
      '      <h1 class="welcome-title">' + esc(spec.nazov) + '</h1>'],
    ['      <p class="welcome-sub">Vyber okruh zo zoznamu a začni študovať.</p>',
      '      <p class="welcome-sub">' + esc(spec.oblast) + ' · vyber kapitolu zo zoznamu a začni študovať.</p>'],
    ['          <div class="stat-label">okruhov</div>', '          <div class="stat-label">kapitoly</div>'],
    ['var KEY = "cs-modul-v1", store = {};', 'var KEY = "' + spec.key + '", store = {};']
  ];
  nahrad.forEach(([a, b]) => {
    if (!s.includes(a)) throw new Error(spec.out + ': nenasiel som ' + a.slice(0, 50));
    s = s.split(a).join(b);
  });

  /* kódy v zozname: kapitoly sa číslujú 1…n, kód A1/A2 patrí okruhu v dátach */
  s = s.replace('    kod: i < CH.length ? "A" + (i + 1) : "",',
    '    kod: i < CH.length ? String(i + 1) : "",');
  s = s.replace('   Kódy A1–A6 dostane šesť kapitol, „Časté chyby" a „Cvičenia" sú bez kódu.\n'
    + '   Z krátkeho názvu sa odreže úvodné poradové číslo – to už nesie kód.',
    '   Kapitoly sa číslujú 1…n, „Pojmy v skratke" sú bez čísla. Kód A1/A2\n'
    + '   zámerne nepoužívame – ten patrí okruhu v dátach, nie kapitole.\n'
    + '   Z krátkeho názvu sa odreže úvodné poradové číslo – to už nesie kód.');

  if (/Číselné sústavy|cs-modul-v1/.test(s)) throw new Error(spec.out + ': zvysny text z Ciselnych sustav');

  fs.writeFileSync(path.join(REPO, spec.out), s.replace(/\r?\n/g, NL), 'utf8');
  console.log('OK ' + spec.out + ' (' + spec.kapitoly.length + ' kapitol + pojmy, '
    + spec.kapitoly.reduce((a, k) => a + k.kviz.length, 0) + ' otazok, '
    + spec.kapitoly.filter(k => k.pripad !== null).length + ' pripadov)');
});
