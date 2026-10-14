'use strict';

/* ============================================================
   AVATAR CATALOG
   Jediný zdroj pravdy pre "celé postavy" avatarov (základná sada
   + budúce taláre), používané ako moderátori vo video režime
   Bifľovačky (a neskôr v obchode). Pridanie nového taláru =
   nová položka v Firebase config/avatarCatalog + nahranie PNG
   súborov ({base}-full/-tired/-sleep(-bust).png) – ŽIADNA zmena
   kódu.

   Položka: { id, name, type: 'basic'|'talar', base, price,
   grantedBy, active, gender: 'f'|'m' }. `base` je cesta bez prípony,
   presne ako AVATAR_CONFIG.AVATARS[...].base v scripts/avatar.js.
   `gender` volí hlas TTS moderátora vo video režime – pri pridávaní
   nového taláru ho vyplň (bez neho sa háda z id, viď getAvatarGender).
============================================================ */

import { ref, get, set }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const BASIC_SEED = [
  { id: 'studentka-tmava',  name: 'Študentka (tmavé vlasy)',  type: 'basic', base: 'avatars/studentka-tmava',  price: 0, grantedBy: null, active: true, gender: 'f' },
  { id: 'studentka-medena', name: 'Študentka (medené vlasy)', type: 'basic', base: 'avatars/studentka-medena', price: 0, grantedBy: null, active: true, gender: 'f' },
  { id: 'studentka-blond',  name: 'Študentka (blond vlasy)',  type: 'basic', base: 'avatars/studentka-blond',  price: 0, grantedBy: null, active: true, gender: 'f' },
  { id: 'student-tmavy',    name: 'Študent (tmavé vlasy)',    type: 'basic', base: 'avatars/student-tmavy',    price: 0, grantedBy: null, active: true, gender: 'm' },
  { id: 'student-medeny',   name: 'Študent (medené vlasy)',   type: 'basic', base: 'avatars/student-medeny',   price: 0, grantedBy: null, active: true, gender: 'm' },
  { id: 'student-blond',    name: 'Študent (blond vlasy)',    type: 'basic', base: 'avatars/student-blond',    price: 0, grantedBy: null, active: true, gender: 'm' }
];

let cachedCatalog = null;

/* Jedno čítanie za reláciu (modul-level cache). Jediný zdroj pravdy
   je statický avatars/Catalog.json (presne toto meno – veľké C, Vercel
   je case-sensitive; deploynutý s appkou spolu s PNG súbormi – pridanie
   nového taláru = pridať položku + nahrať súbory, žiadna zmena kódu).
   Súbor môže mať tvar buď holého poľa [...], alebo { avatars: [...] }
   (obe podporené). Ak sa súbor nenačíta (chýba/poškodený JSON), spadne
   na Firebase config/avatarCatalog ako záložný zdroj a napokon na
   vstavanú základnú sadu, nech appka nikdy nezostane bez avatarov. */
export async function getAvatarCatalog() {
  if (cachedCatalog) return cachedCatalog;

  try {
    const res = await fetch('avatars/Catalog.json');
    if (res.ok) {
      const raw = await res.json();
      const val = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.avatars) ? raw.avatars : null);
      if (val && val.length) {
        cachedCatalog = val.filter(Boolean);
        return cachedCatalog;
      }
    }
  } catch (e) {
    console.warn('avatarCatalog: avatars/Catalog.json sa nepodarilo načítať, skúšam Firebase', e);
  }

  const db = window.db;
  if (!db) return BASIC_SEED;

  try {
    const snap = await get(ref(db, 'config/avatarCatalog'));
    if (snap.exists()) {
      const val = snap.val();
      cachedCatalog = Array.isArray(val) ? val.filter(Boolean) : Object.values(val);
      return cachedCatalog;
    }

    await set(ref(db, 'config/avatarCatalog'), BASIC_SEED);
    cachedCatalog = BASIC_SEED;
    return cachedCatalog;
  } catch (e) {
    console.warn('avatarCatalog: čítanie zlyhalo, používam základnú sadu', e);
    return BASIC_SEED;
  }
}

export function getTalarAvatars(catalog) {
  return (catalog || []).filter(a => a && a.type === 'talar' && a.active);
}

/* Moderátor pre danú definíciu: rotuje naprieč talárovými avatarmi.
   Kým žiadny talár neexistuje (nová repo bez nahratých súborov),
   spadne na základnú sadu, aby video režim fungoval hneď. */
export function getModeratorForIndex(catalog, index) {
  const talars = getTalarAvatars(catalog);
  const pool = talars.length ? talars : (catalog || []).filter(a => a && a.active);
  if (!pool.length) return null;
  const i = ((index % pool.length) + pool.length) % pool.length;
  return pool[i];
}

/* Náhodný talárový avatar (na striedačku pri každom spustení videa).
   Kým žiadny talár neexistuje, spadne na základnú sadu. */
export function getRandomTalarAvatar(catalog) {
  const talars = getTalarAvatars(catalog);
  const pool = talars.length ? talars : (catalog || []).filter(a => a && a.active);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* Cesta k PNG pre daný stav ('full'|'tired'|'sleep'), voliteľne bust. */
export function avatarStateSrc(avatarEntry, state, bust = false) {
  if (!avatarEntry || !avatarEntry.base) return '';
  const suffix = bust ? '-bust' : '';
  return `${avatarEntry.base}-${state}${suffix}.png`;
}

/* 'f'|'m' pre výber hlasu TTS. Katalógy zapísané pred pridaním
   gender poľa (staršie config/avatarCatalog vo Firebase) nemajú
   toto pole – vtedy sa háda z id (studentka-* = f, inak m). */
export function getAvatarGender(avatarEntry) {
  if (!avatarEntry) return 'f';
  if (avatarEntry.gender === 'f' || avatarEntry.gender === 'm') return avatarEntry.gender;
  return avatarEntry.id && avatarEntry.id.startsWith('studentka') ? 'f' : 'm';
}
