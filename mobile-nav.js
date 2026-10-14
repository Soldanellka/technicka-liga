'use strict';

/* ============================================================
   MOBILNÁ ARCHITEKTÚRA – spodná navigácia + zbaliteľné sekcie
   Platí vizuálne len na mobile (media queries v styles.css);
   tento modul len pripája správanie, nerozhoduje o zobrazení.
============================================================ */

/* ── SPODNÁ NAVIGÁCIA ──
   Pozn.: `body { overflow-x: hidden }` (styles.css) spôsobuje, že podľa
   CSS špecifikácie sa overflow-y prepočíta na 'auto' a stránka reálne
   scrolluje cez <body>, nie cez window/<html>. Preto scrollTo() voláme
   na všetkých kandidátoch naraz (na tom, kto nie je scroller, je to no-op). */
function getScrollTop() {
  return document.body.scrollTop || document.documentElement.scrollTop || window.scrollY || 0;
}

/* export: iné moduly (napr. init.js – uvítacie okno, tlačidlo "Otvoriť
   nástenku") znovupoužívajú TENTO scroll, nie vlastnú kópiu. */
export function scrollToTarget(target) {
  if (target === 'top') {
    const opts = { top: 0, behavior: 'smooth' };
    window.scrollTo(opts);
    document.documentElement.scrollTo(opts);
    document.body.scrollTo(opts);
    return;
  }
  if (target === 'profile') {
    const avatarWrap = document.getElementById('avatarWrap');
    if (avatarWrap) avatarWrap.click();
    return;
  }
  const el = document.getElementById(target);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initBottomNav() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;

  const buttons = Array.from(nav.querySelectorAll('button[data-target]'));
  buttons.forEach(btn => {
    btn.addEventListener('click', () => scrollToTarget(btn.dataset.target));
  });

  const setActive = (target) => {
    buttons.forEach(b => b.classList.toggle('active', b.dataset.target === target));
  };

  // Zvýraznenie aktívnej položky podľa toho, ktorá sekcia je práve vo výreze
  /* #gamesSection je po zlúčení vnútri #quizCard, takže by sa ako samostatná
     sekcia prekrývala s ním – nesleduje sa. Bifľovačka tu bola druhá, ale je
     dnes dlaždicou v #quizCard, nie samostatnou sekciou. */
  const sectionIds = ['quizCard', 'leaderboardSection'];
  const sections = sectionIds.map(id => document.getElementById(id)).filter(Boolean);

  if (sections.length && typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: '-35% 0px -50% 0px', threshold: 0 });

    sections.forEach(sec => observer.observe(sec));
  }

  window.addEventListener('scroll', () => {
    if (getScrollTop() < 80) setActive('top');
  }, { passive: true, capture: true });
}

/* ── ZBALITEĽNÉ SEKCIE ──
   Stav v localStorage (mColl:{key} = '1' zbalené / '0' rozbalené).
   Default: zbalené, okrem rebríčka (hráči ho chcú vidieť hneď). */
const COLLAPSIBLE_SECTIONS = [
  { selector: '.highlight-noticeboard', key: 'noticeboard', defaultCollapsed: true },
  { selector: '.highlight-feedback',    key: 'feedback',    defaultCollapsed: true },
  { selector: '.highlight-video',       key: 'videos',      defaultCollapsed: true },
  { selector: '#leaderboardSection',    key: 'leaderboard', defaultCollapsed: false },
  { selector: '.highlight-bank',        key: 'duelbank',    defaultCollapsed: true },
  { selector: '.highlight-senaty',      key: 'senaty',      defaultCollapsed: true },
  { selector: '.highlight-nightrecap',  key: 'nightrecap',  defaultCollapsed: true }
];

/* export: pripojí zbaľovacie správanie na ĽUBOVOĽNÝ card+header pár, nielen
   COLLAPSIBLE_SECTIONS zo statickej stránky (initCollapsibleSections nižšie
   je len jej najbežnejší volajúci). Používa aj scripts/dashboardUI.js pre
   sekcie VNÚTRI dashboard modálu – tie sa generujú dynamicky (existujú až
   po renderBody()/renderStatnice(), nie pri DOMContentLoaded), takže ich
   nemožno pridať do statického poľa COLLAPSIBLE_SECTIONS nižšie; volajúci
   preto volá túto funkciu priamo, nie initCollapsibleSections(). */
export function makeCollapsible(card, header, storageKey, defaultCollapsed) {
  if (!card || !header) return;
  card.classList.add('m-collapsible');

  const stored = localStorage.getItem(storageKey);
  const collapsed = stored !== null ? stored === '1' : defaultCollapsed;
  card.classList.toggle('m-collapsed', collapsed);

  header.addEventListener('click', () => {
    const nowCollapsed = !card.classList.contains('m-collapsed');
    card.classList.toggle('m-collapsed', nowCollapsed);
    localStorage.setItem(storageKey, nowCollapsed ? '1' : '0');
  });
}

function initCollapsibleSections() {
  COLLAPSIBLE_SECTIONS.forEach(({ selector, key, defaultCollapsed }) => {
    const card = document.querySelector(selector);
    if (!card) return;
    const header = card.querySelector('h3');
    if (!header) return;
    makeCollapsible(card, header, `mColl:${key}`, defaultCollapsed);
  });
}

/* export: rozbalí danú sekciu (key z COLLAPSIBLE_SECTIONS vyššie), ak je
   zbalená – rovnaký stav/trieda ako klik na hlavičku. Na desktope je
   .m-collapsed vizuálne bez efektu (viď styles.css media query), takže
   toto je bezpečné volať bez ohľadu na zariadenie. */
export function uncollapseSection(key) {
  const entry = COLLAPSIBLE_SECTIONS.find(s => s.key === key);
  if (!entry) return;
  const card = document.querySelector(entry.selector);
  if (!card) return;
  card.classList.remove('m-collapsed');
  localStorage.setItem(`mColl:${entry.key}`, '0');
}

function initMobileArchitecture() {
  initBottomNav();
  initCollapsibleSections();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileArchitecture);
} else {
  initMobileArchitecture();
}
