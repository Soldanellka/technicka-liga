'use strict';

/* ============================================================
   PEČATE ZA SCHVÁLENÉ NAHLÁSENIA – jediný zdroj pravdy pre prahy.

   Prahy boli predtým zadrôtované na dvoch miestach naraz: v logike
   (index.html, konštanta SEALS) a v texte návodu (tabuľka „Súdna sieň
   a pečate"). Pri zmene 1/5/15 → 1/10/25 by sa nevyhnutne rozišli, preto
   sú tu v samostatnom module: logika ich importuje a návod sa nimi
   VYPĹŇA za behu (data-seal, viď fillGuideSealValues v init.js).

   `max` je len pre čitateľnosť/popisky – rozhoduje výhradne `min`
   v getSealType() nižšie (porovnáva sa zhora nadol).

   Pozor na inú, NESÚVISIACU sadu pečatí: bifľovačka (memoryTrainer.js,
   memory-trainer.html) má vlastné bronze/silver/gold podľa presnosti
   odpovedí. S týmito prahmi nemá nič spoločné a nemení sa s nimi.
============================================================ */

export const SEALS = {
  bronze:   { label: '🥉 Bronzová pečať',   min: 1,  max: 9 },
  silver:   { label: '🥈 Strieborná pečať', min: 10, max: 24 },
  gold:     { label: '🥇 Zlatá pečať',      min: 25, max: Infinity },
  academic: { label: '🎓 Akademická pečať' } // garant/admin automaticky, bez počítania
};

export const SEAL_EMOJI = { bronze: '🥉', silver: '🥈', gold: '🥇', academic: '🎓' };

/* Udeľuje sa DOPREDNE: volá sa v okamihu schválenia nahlásenia s novým
   počtom (cnt), nikdy sa neprepočítava spätne. Zmena prahov preto nikomu
   neodoberie už udelenú pečať – staré pečate sú zapísané vo Firebase
   (users/{nick}/seals, reports/{id}/seal) a tento kód sa ich nedotýka. */
export function getSealType(approvedCount, role) {
  if (role === 'garant' || role === 'admin') return 'academic';
  if (approvedCount >= SEALS.gold.min) return 'gold';
  if (approvedCount >= SEALS.silver.min) return 'silver';
  if (approvedCount >= SEALS.bronze.min) return 'bronze';
  return null;
}
