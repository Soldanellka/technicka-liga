'use strict';

/* ============================================================
   JUDIKATURA_CONFIG
   Kurátorovaný zoznam štátnicových inštitútov pre rešerš judikatúry
   NS SR (open-data API, cez api/nsud-proxy.js). Reťazce sú výsledok
   ručnej diagnostiky (vzorkové volania + overenie presnosti cez
   getDecision) – NEDERIVUJ ich znova, sú tu presne také, aké prešli
   testom.

   Schéma:
   queryGroups: [[term, term, ...], [term], ...]
     - vnútri skupiny (AND): výsledné ID musia obsahovať VŠETKY
       termíny skupiny (prienik)
     - medzi skupinami (OR): výsledky sa spájajú (zjednotenie)
   Pokrýva všetky vzory z diagnostiky: samostatný kmeň (1 skupina,
   1 term), prienik kmeňov (1 skupina, 2 termy), zjednotenie fráz
   v rôznych pádoch (2 skupiny, po 1 terme).

   Vynechané zámerne (vrátime sa neskôr):
   - Náhrada škody – presné, ale KAŽDÁ formulácia naráža na strop
     ~1000 (skutočný počet je vyšší, nedá sa plne pokryť).
   - Premlčanie trestného stíhania – presná fráza dáva len 2
     výsledky (nízky recall), širší prienik kmeňov je zašumený.
   Úplne nedostupné (do MVP nejdú vôbec):
   - Nutná obrana, Krajná núdza, Prípustnosť dovolania – 0 výsledkov
     alebo procesná "vata" bez rozlišovacej schopnosti.
============================================================ */

export const JUDIKATURA_CONFIG = {
  instituty: [
    {
      id: 'ohrozenie-navykova-latka',
      nazov: 'Ohrozenie pod vplyvom návykovej látky',
      oblast: 'trestné',
      queryGroups: [['ohrozen', 'návykov']]
    },
    {
      id: 'podmienecne-prepustenie',
      nazov: 'Podmienečné prepustenie',
      oblast: 'trestné',
      queryGroups: [['podmienečn', 'prepusten']]
    },
    {
      id: 'bezdovodne-obohatenie',
      nazov: 'Bezdôvodné obohatenie',
      oblast: 'občianske hmotné',
      queryGroups: [['obohat']]
    },
    {
      id: 'vydrzanie',
      nazov: 'Vydržanie',
      oblast: 'občianske hmotné',
      queryGroups: [['vydržan']]
    },
    {
      id: 'neplatnost-pravneho-ukonu',
      nazov: 'Neplatnosť právneho úkonu',
      oblast: 'občianske hmotné',
      queryGroups: [['neplatnosti právneho úkonu'], ['neplatnosť právneho úkonu']]
    },
    {
      id: 'neodkladne-opatrenie',
      nazov: 'Neodkladné opatrenie',
      oblast: 'občianske procesné',
      queryGroups: [['neodkladn']]
    },
    {
      id: 'skoncenie-pracovneho-pomeru',
      nazov: 'Skončenie pracovného pomeru',
      oblast: 'pracovné',
      queryGroups: [['skončenia pracovného pomeru']]
    },
    {
      id: 'okamzite-skoncenie-pp',
      nazov: 'Okamžité skončenie pracovného pomeru',
      oblast: 'pracovné',
      queryGroups: [['okamžitého skončenia pracovného pomeru']]
    }
  ]
};
