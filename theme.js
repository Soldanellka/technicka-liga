'use strict';

import { LS } from './core.js';
import { theme, setTheme } from './state.js';

/* =========================
   Apply theme
   ========================= */
export function applyTheme(t){
  setTheme(t);

  if(t === 'dark'){
    document.documentElement.setAttribute('data-theme','dark');
    const icon = document.getElementById('themeIcon');
    if(icon) icon.src = 'assets/icons/sun.svg';
  } else {
    document.documentElement.removeAttribute('data-theme');
    const icon = document.getElementById('themeIcon');
    if(icon) icon.src = 'assets/icons/moon.svg';
  }

  try {
    localStorage.setItem(LS.THEME, t);
  } catch(e){}
}

/* =========================
   Toggle theme
   ========================= */
export function toggleTheme(){
  applyTheme(theme === 'dark' ? 'light' : 'dark');
}
