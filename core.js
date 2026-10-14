'use strict';

/* =========================
   Konštanty a perzistencia
   ========================= */
export const LS = {
  PAR: 'lex_paragrafy',
  THEME: 'lex_theme',
  AVATAR: 'lex_avatar',
  GAMES: 'lex_games_played',
  MEMORY_STATE: 'lex_memory_state',
  LEADERBOARD: 'lex_memory_leaderboard',
  ANSWERED_CASES_PREFIX: 'lex_answered_cases_',
  REPORTS: 'lex_reports'
};

/* =========================
   Helper funkcie
   ========================= */
export function $(id){
  return document.getElementById(id);
}

export function qsa(sel){
  return Array.from(document.querySelectorAll(sel));
}

/* saveParagrafy/loadParagrafy zrušené (Etapa 1, bod 1.1): § menu spravuje
   výhradne Firebase cez scripts/economy.js. Kľúč LS.PAR ('lex_paragrafy') sa
   už z appky nečíta ani nezapisuje; ostáva len v transferAccount() nižšie
   (demo export účtu) a v zozname kľúčov na vyčistenie (init.js). */

export function escapeHtml(s){
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

export function shuffleArray(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* Zamieša poradie `options` danej otázky/kroku a dopočíta novú pozíciu
   `correct` podľa PÔVODNÉHO textu správnej odpovede (rovnaký vzor ako
   quiz.js startQuiz() / scripts/duels.js shuffleQuestionOptions()).
   Vracia NOVÝ objekt (nemutuje vstup), aby kanonické dáta z A*.json
   ostali nedotknuté a každé volanie dostalo čerstvé poradie. Report/
   nahlasovanie a admin/garant panel pracujú len s textom otázky a
   zdrojom (nikdy s indexom možnosti), takže mapovanie späť na originál
   netreba – nič v appke index možnosti neukladá ani nezobrazuje. */
export function shuffleOptions(item){
  if (!item || !Array.isArray(item.options)) return item;
  const correctText = typeof item.correct === 'number' ? item.options[item.correct] : null;
  const options = shuffleArray([...item.options]);
  let correct = correctText != null ? options.findIndex(opt => opt === correctText) : (typeof item.correct === 'number' ? item.correct : 0);
  if (correct < 0) correct = 0;
  return { ...item, options, correct };
}

export function safeId(s){
  return String(s || '').replace(/[^\w\-]/g, '_');
}

/* =========================
   Modal helpers
   ========================= */
export function openModal(modalEl){
  if(!modalEl) return;
  modalEl.classList.add('open');
  modalEl.setAttribute('aria-hidden','false');

  const focusable = modalEl.querySelector('button, [tabindex], input, select, textarea');
  if(focusable) focusable.focus();
}

export function closeModal(modalEl){
  if(!modalEl) return;
  modalEl.classList.remove('open');
  modalEl.setAttribute('aria-hidden','true');
}
/* =========================
   PIN login + transfer účtu
   ========================= */

// jednoduchý PIN login (demo verzia)
export function loginWithPin(pin) {
  try {
    const saved = localStorage.getItem("lex_pin");
    if (!saved) {
      alert("PIN ešte nie je nastavený.");
      return false;
    }

    if (String(pin) === String(saved)) {
      alert("Prihlásenie úspešné!");
      return true;
    } else {
      alert("Nesprávny PIN.");
      return false;
    }
  } catch (e) {
    console.error("loginWithPin error:", e);
    return false;
  }
}

// jednoduchý prenos účtu (demo verzia)
export function transferAccount() {
  try {
    const data = {
      paragrafy: localStorage.getItem("lex_paragrafy") || 0,
      avatar: localStorage.getItem("lex_avatar") || null,
      theme: localStorage.getItem("lex_theme") || "light"
    };

    alert("Účet exportovaný (demo). Dáta v konzole.");
    console.log("TRANSFER DATA:", data);

    return data;
  } catch (e) {
    console.error("transferAccount error:", e);
    return null;
  }
}
