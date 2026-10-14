'use strict';

/* ============================================================
   scripts/deletedPlayer.js
   Náhradné meno za prezývku zmazaného hráča.

   Jedno miesto pre celú appku, aby sa text v databáze, v rebríčkoch
   a v Zásadách ochrany súkromia nemohol rozísť. Zásady (bod 8) sľubujú
   doslova: „V nástenke komunity a v nahlásených chybách prezývku
   nahradíme textom „zmazaný hráč“.“ Čo je tu, musí sedieť s tým.

   Kde sa používa:
   - prepis prezývky v už odohraných súbojoch (zostávajú – sú to
     spoločné záznamy s druhým hráčom),
   - filter v rebríčkoch a pri vyhodnocovaní odmien: zmazaný hráč
     nesmie obsadzovať riadok ani vyhrať odmenu,
   - isValidNick() ho odmieta ako prezývku, nech sa zaň nikto nevydáva.
============================================================ */

export const DELETED_PLAYER = 'zmazaný hráč';

/* Porovnáva bez ohľadu na veľkosť písmen a okrajové medzery – do
   databázy sa síce píše vždy presný tvar, ale filter má podržať aj
   staršie či ručne upravené záznamy. */
export function isDeletedPlayer(nick) {
  return String(nick ?? '').trim().toLocaleLowerCase('sk') === DELETED_PLAYER;
}

/* Prezývky, ktoré sa v agregáciách preskakujú: prázdne, reťazec
   "null" (staršie poškodené záznamy), „Unknown“ (chyba identity
   opravená 2026-10) a zmazaný hráč. */
export function jePreskocitelnaPrezyvka(nick) {
  if (!nick) return true;
  const v = String(nick).trim();
  return v === '' || v === 'null' || v === 'Unknown' || isDeletedPlayer(v);
}
