'use strict';

import { LS } from './core.js';

/* =========================
   Stav aplikácie
   ========================= */

export let selectedFaculty = null;
export let selectedArea = null;

export let quiz = {
  questions: [],
  index: 0,
  correct: 0,
  wrong: 0
};

export let isPremium = false;
export let role = 'student';

export let gamesPlayed = Number(localStorage.getItem(LS.GAMES) || 0);
export let currentAvatarId = localStorage.getItem(LS.AVATAR) || 'young';
export let theme = localStorage.getItem(LS.THEME) || 'light';

/* answeredCases: per-set perzistencia vyriešených prípadov */
export let answeredCases = new Set();

/* reports: právne nezrovnalosti */
export let reports = [];

/* placeholder pre cases / memory */
export let currentCaseSet = 'TPH-A1';

/* =========================
   Setter funkcie (aby moduly
   mohli meniť stav bezpečne)
   ========================= */

export function setSelectedFaculty(v){ selectedFaculty = v; }
export function setSelectedArea(v){ selectedArea = v; }

export function setQuizState(obj){
  quiz = { ...quiz, ...obj };
}

export function setPremium(v){
  isPremium = v;
}

export function setRole(v){
  role = v;
}

export function setGamesPlayed(v){
  gamesPlayed = v;
}

export function setAvatar(id){
  currentAvatarId = id;
}

export function setTheme(v){
  theme = v;
}

export function setAnsweredCases(set){
  answeredCases = set;
}

export function addReport(r){
  reports.push(r);
}

export function updateReports(arr){
  reports = arr;
}
