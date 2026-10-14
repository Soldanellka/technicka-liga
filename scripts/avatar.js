'use strict';

import { ref, get, update, onValue }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { showRewardToast } from '../ui.js';
import { ECONOMY_CONFIG, getRole, logTransaction, todayKey } from './economyConfig.js';
import { isAnon, getAnonEnergy, spendAnonEnergy } from './anonSession.js';

/* ============================================================
   KONFIGURÁCIA AVATARA
   Všetky energetické čísla aj ceny sa čítajú z ECONOMY_CONFIG
   (scripts/economyConfig.js) – jediný zdroj pravdy. Tento objekt
   je len pomenovaný alias, nie druhé miesto na ladenie hodnôt.
============================================================ */

const AVATAR_CONFIG = {
  // Energia – všetko z ECONOMY_CONFIG.ENERGY, žiadne číslo natvrdo
  MAX_ENERGY: ECONOMY_CONFIG.ENERGY.MAX,
  DAILY_FULL: ECONOMY_CONFIG.ENERGY.DAILY_FULL,   // denná porcia po resete
  FEED_COST: ECONOMY_CONFIG.ENERGY.FEED_COST,     // § za nakŕmenie
  FEED_ENERGY: ECONOMY_CONFIG.ENERGY.FEED_TO,     // kŕmenie doplní na túto hodnotu
  SLEEP_THRESHOLD: ECONOMY_CONFIG.ENERGY.SLEEP_AT, // pri tejto hodnote avatar zaspí

  // Denný login streak – krivka viď ECONOMY_CONFIG.STREAK v checkDailyLogin()
  // (STREAK_SHIELD_COST zaniklo spolu so štítom streaku, 2026-08)

  // Dostupné avatary (id: { name, file_awake, file_sleep, unlockCondition })
  AVATARS: {
    'student-f': {
      name: 'Študentka práva',
      awake: 'data:image/svg+xml,%3Csvg%20xmlns=%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox=%270%200%20120%20150%27%3E%0A%3Cdefs%3E%0A%3CradialGradient%20id=%27sk%27%20cx=%2745%25%27%20cy=%2735%25%27%20r=%2765%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%23fde8d0%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%23f0b88a%27%2F%3E%3C%2FradialGradient%3E%0A%3CradialGradient%20id=%27hr%27%20cx=%2750%25%27%20cy=%2710%25%27%20r=%2775%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%237a4a20%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%233a1a05%27%2F%3E%3C%2FradialGradient%3E%0A%3CradialGradient%20id=%27ir%27%20cx=%2735%25%27%20cy=%2730%25%27%20r=%2765%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%23c87830%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%236a3010%27%2F%3E%3C%2FradialGradient%3E%0A%3ClinearGradient%20id=%27su%27%20x1=%270%25%27%20y1=%270%25%27%20x2=%2710%25%27%20y2=%27100%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%231a1a2e%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%230d0d18%27%2F%3E%3C%2FlinearGradient%3E%0A%3C%2Fdefs%3E%0A%3Cellipse%20cx=%2760%27%20cy=%27118%27%20rx=%2732%27%20ry=%2730%27%20fill=%27url%28%23su%29%27%2F%3E%0A%3Cpath%20d=%27M48%2092%20Q60%20100%2072%2092%20L70%20102%20Q60%20107%2050%20102Z%27%20fill=%27%230d0d20%27%2F%3E%0A%3Cpath%20d=%27M53%2092%20Q60%2098%2067%2092%20L66%20100%20Q60%20104%2054%20100Z%27%20fill=%27%23f0f0ff%27%2F%3E%0A%3Cellipse%20cx=%2757%27%20cy=%2793%27%20rx=%274%27%20ry=%272.5%27%20fill=%27%23cc2244%27%2F%3E%0A%3Cellipse%20cx=%2763%27%20cy=%2793%27%20rx=%274%27%20ry=%272.5%27%20fill=%27%23cc2244%27%2F%3E%0A%3Ccircle%20cx=%2760%27%20cy=%2795%27%20r=%272%27%20fill=%27%23991133%27%2F%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2758%27%20rx=%2736%27%20ry=%2732%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M24%2065%20Q18%2088%2022%20108%20Q28%20104%2030%2092%20Q27%2076%2028%2065Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M96%2065%20Q102%2088%2098%20108%20Q92%20104%2090%2092%20Q93%2076%2092%2065Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2738%27%20rx=%2734%27%20ry=%2718%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M26%2060%20Q34%2038%2060%2035%20Q86%2038%2094%2060%20Q82%2052%2072%2050%20Q66%2038%2060%2040%20Q54%2038%2048%2050%20Q38%2052%2026%2060Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2762%27%20rx=%2731%27%20ry=%2733%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%2729%27%20cy=%2764%27%20rx=%276%27%20ry=%277%27%20fill=%27url%28%23sk%29%27%2F%3E%3Cellipse%20cx=%2729%27%20cy=%2764%27%20rx=%274%27%20ry=%275%27%20fill=%27%23f0c090%27%2F%3E%0A%3Cellipse%20cx=%2791%27%20cy=%2764%27%20rx=%276%27%20ry=%277%27%20fill=%27url%28%23sk%29%27%2F%3E%3Cellipse%20cx=%2791%27%20cy=%2764%27%20rx=%274%27%20ry=%275%27%20fill=%27%23f0c090%27%2F%3E%0A%3Ccircle%20cx=%2729%27%20cy=%2771%27%20r=%272.5%27%20fill=%27%23d4af37%27%2F%3E%3Ccircle%20cx=%2791%27%20cy=%2771%27%20r=%272.5%27%20fill=%27%23d4af37%27%2F%3E%0A%3Cellipse%20cx=%2747%27%20cy=%2762%27%20rx=%2710%27%20ry=%2711%27%20fill=%27white%27%2F%3E%0A%3Cellipse%20cx=%2747%27%20cy=%2763%27%20rx=%277%27%20ry=%278%27%20fill=%27url%28%23ir%29%27%2F%3E%0A%3Cellipse%20cx=%2747%27%20cy=%2764%27%20rx=%274%27%20ry=%275%27%20fill=%27%23111%27%2F%3E%0A%3Ccircle%20cx=%2750%27%20cy=%2759%27%20r=%273%27%20fill=%27white%27%2F%3E%3Ccircle%20cx=%2744%27%20cy=%2767%27%20r=%271.5%27%20fill=%27white%27%20opacity=%27.6%27%2F%3E%0A%3Cellipse%20cx=%2773%27%20cy=%2762%27%20rx=%2710%27%20ry=%2711%27%20fill=%27white%27%2F%3E%0A%3Cellipse%20cx=%2773%27%20cy=%2763%27%20rx=%277%27%20ry=%278%27%20fill=%27url%28%23ir%29%27%2F%3E%0A%3Cellipse%20cx=%2773%27%20cy=%2764%27%20rx=%274%27%20ry=%275%27%20fill=%27%23111%27%2F%3E%0A%3Ccircle%20cx=%2776%27%20cy=%2759%27%20r=%273%27%20fill=%27white%27%2F%3E%3Ccircle%20cx=%2770%27%20cy=%2767%27%20r=%271.5%27%20fill=%27white%27%20opacity=%27.6%27%2F%3E%0A%3Cpath%20d=%27M37%2050%20Q47%2044%2057%2050%27%20stroke=%27%233a1a05%27%20stroke-width=%272%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M63%2050%20Q73%2044%2083%2050%27%20stroke=%27%233a1a05%27%20stroke-width=%272%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M37%2051%20Q47%2046%2055%2051%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M65%2051%20Q73%2046%2083%2051%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M54%2076%20Q60%2080%2066%2076%27%20stroke=%27%23d06050%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M55%2076%20Q60%2080%2065%2076%20Q60%2083%2055%2076Z%27%20fill=%27%23e08878%27%20opacity=%27.4%27%2F%3E%0A%3Cellipse%20cx=%2736%27%20cy=%2774%27%20rx=%2710%27%20ry=%277%27%20fill=%27%23ffb0b0%27%20opacity=%27.4%27%2F%3E%0A%3Cellipse%20cx=%2784%27%20cy=%2774%27%20rx=%2710%27%20ry=%277%27%20fill=%27%23ffb0b0%27%20opacity=%27.4%27%2F%3E%0A%3Cpath%20d=%27M55%2072%20Q60%2075%2065%2072%27%20stroke=%27%23d09060%27%20stroke-width=%271.2%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Ctext%20x=%2786%27%20y=%2750%27%20font-size=%2710%27%20fill=%27%23d4af37%27%20opacity=%27.8%27%3E%E2%9C%A6%3C%2Ftext%3E%0A%3Crect%20x=%2728%27%20y=%27112%27%20width=%2726%27%20height=%2720%27%20rx=%273%27%20fill=%27%238B0000%27%2F%3E%0A%3Ctext%20x=%2741%27%20y=%27125%27%20text-anchor=%27middle%27%20font-family=%27serif%27%20font-size=%274%27%20fill=%27%23f0d080%27%20font-weight=%27bold%27%3ELIGA%3C%2Ftext%3E%0A%3Ctext%20x=%2772%27%20y=%27130%27%20font-family=%27serif%27%20font-size=%2722%27%20fill=%27%23d4af37%27%20font-weight=%27bold%27%3E%E2%98%85%3C%2Ftext%3E%0A%3C%2Fsvg%3E',
      sleep: 'data:image/svg+xml,%3Csvg%20xmlns=%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox=%270%200%20120%20150%27%3E%0A%3Cdefs%3E%0A%3CradialGradient%20id=%27sk%27%20cx=%2745%25%27%20cy=%2735%25%27%20r=%2765%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%23fde0c5%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%23e8a878%27%2F%3E%3C%2FradialGradient%3E%0A%3CradialGradient%20id=%27hr%27%20cx=%2750%25%27%20cy=%2710%25%27%20r=%2775%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%237a4a20%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%233a1a05%27%2F%3E%3C%2FradialGradient%3E%0A%3ClinearGradient%20id=%27su%27%20x1=%270%25%27%20y1=%270%25%27%20x2=%2710%25%27%20y2=%27100%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%231a1a2e%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%230d0d18%27%2F%3E%3C%2FlinearGradient%3E%0A%3C%2Fdefs%3E%0A%3Cg%20transform=%27rotate%2810%2C60%2C110%29%27%3E%0A%3Cellipse%20cx=%2760%27%20cy=%27118%27%20rx=%2732%27%20ry=%2728%27%20fill=%27url%28%23su%29%27%2F%3E%0A%3Cpath%20d=%27M48%2092%20Q60%20100%2072%2092%20L70%20102%20Q60%20107%2050%20102Z%27%20fill=%27%230d0d20%27%2F%3E%0A%3Cpath%20d=%27M53%2092%20Q60%2098%2067%2092%20L66%20100%20Q60%20104%2054%20100Z%27%20fill=%27%23f0f0ff%27%2F%3E%0A%3C%2Fg%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2758%27%20rx=%2736%27%20ry=%2732%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M24%2065%20Q18%2088%2022%20108%20Q28%20104%2030%2092%20Q27%2076%2028%2065Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M96%2065%20Q102%2088%2098%20108%20Q92%20104%2090%2092%20Q93%2076%2092%2065Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2738%27%20rx=%2734%27%20ry=%2718%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M26%2060%20Q34%2038%2060%2035%20Q86%2038%2094%2060%20Q82%2052%2072%2050%20Q66%2038%2060%2040%20Q54%2038%2048%2050%20Q38%2052%2026%2060Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cg%20transform=%27rotate%2814%2C60%2C62%29%27%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2762%27%20rx=%2731%27%20ry=%2733%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%2729%27%20cy=%2764%27%20rx=%276%27%20ry=%277%27%20fill=%27url%28%23sk%29%27%2F%3E%3Cellipse%20cx=%2791%27%20cy=%2764%27%20rx=%276%27%20ry=%277%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Ccircle%20cx=%2729%27%20cy=%2771%27%20r=%272.5%27%20fill=%27%23b89020%27%2F%3E%3Ccircle%20cx=%2791%27%20cy=%2771%27%20r=%272.5%27%20fill=%27%23b89020%27%2F%3E%0A%3Cpath%20d=%27M37%2062%20Q47%2072%2057%2062%27%20stroke=%27%232a1a0a%27%20stroke-width=%272.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M37%2062%20Q40%2056%2044%2059%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M46%2057%20Q50%2052%2054%2057%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M56%2059%20Q59%2055%2062%2059%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M63%2062%20Q73%2072%2083%2062%27%20stroke=%27%232a1a0a%27%20stroke-width=%272.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M63%2062%20Q66%2056%2070%2059%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M72%2057%20Q76%2052%2080%2057%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M82%2059%20Q85%2055%2088%2059%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M37%2050%20Q47%2045%2057%2050%27%20stroke=%27%233a1a05%27%20stroke-width=%271.8%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M63%2050%20Q73%2045%2083%2050%27%20stroke=%27%233a1a05%27%20stroke-width=%271.8%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cellipse%20cx=%2776%27%20cy=%2776%27%20rx=%279%27%20ry=%276%27%20fill=%27%23ffb0a0%27%20opacity=%27.5%27%2F%3E%0A%3Cellipse%20cx=%2744%27%20cy=%2776%27%20rx=%279%27%20ry=%276%27%20fill=%27%23ffb0a0%27%20opacity=%27.5%27%2F%3E%0A%3Cpath%20d=%27M55%2072%20Q60%2075%2065%2072%27%20stroke=%27%23c08060%27%20stroke-width=%271.2%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3C%2Fg%3E%0A%3Cellipse%20cx=%2725%27%20cy=%2798%27%20rx=%2714%27%20ry=%279%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%2718%27%20cy=%2792%27%20rx=%276%27%20ry=%275%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%2713%27%20cy=%2798%27%20rx=%275%27%20ry=%275%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%2744%27%20cy=%27138%27%20rx=%2748%27%20ry=%2712%27%20fill=%27white%27%20opacity=%27.88%27%2F%3E%0A%3Cellipse%20cx=%2736%27%20cy=%27142%27%20rx=%2730%27%20ry=%2710%27%20fill=%27white%27%20opacity=%27.88%27%2F%3E%0A%3Ctext%20x=%2730%27%20y=%27140%27%20font-family=%27Arial%20Black%27%20font-size=%278%27%20fill=%27%236060a8%27%20font-weight=%27900%27%3Ez%3C%2Ftext%3E%0A%3Ctext%20x=%2742%27%20y=%27132%27%20font-family=%27Arial%20Black%27%20font-size=%2711%27%20fill=%27%235050a0%27%20font-weight=%27900%27%3Ez%3C%2Ftext%3E%0A%3Ctext%20x=%2756%27%20y=%27122%27%20font-family=%27Arial%20Black%27%20font-size=%2714%27%20fill=%27%234040a0%27%20font-weight=%27900%27%3EZ%3C%2Ftext%3E%0A%3Cpath%20d=%27M10%2028%20Q16%2018%2024%2021%20Q18%2026%2017%2032%20Q14%2036%208%2034%20Q8%2031%2010%2028Z%27%20fill=%27%23f0e050%27%20opacity=%27.65%27%2F%3E%0A%3Ccircle%20cx=%2714%27%20cy=%2720%27%20r=%271.2%27%20fill=%27%23c0b0e0%27%20opacity=%27.6%27%2F%3E%0A%3Ccircle%20cx=%2722%27%20cy=%2714%27%20r=%271%27%20fill=%27%23c0b0e0%27%20opacity=%27.5%27%2F%3E%0A%3C%2Fsvg%3E',
      unlock: 'default',
      desc: 'Dostupná pre všetkých'
    },
    'student-m': {
      name: 'Študent práva',
      awake: 'data:image/svg+xml,%3Csvg%20xmlns=%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox=%270%200%20120%20150%27%3E%0A%3Cdefs%3E%0A%3CradialGradient%20id=%27sk%27%20cx=%2745%25%27%20cy=%2735%25%27%20r=%2765%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%23fde8d0%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%23f0b88a%27%2F%3E%3C%2FradialGradient%3E%0A%3CradialGradient%20id=%27hr%27%20cx=%2750%25%27%20cy=%270%25%27%20r=%2780%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%238a5020%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%233a1a05%27%2F%3E%3C%2FradialGradient%3E%0A%3CradialGradient%20id=%27ir%27%20cx=%2735%25%27%20cy=%2730%25%27%20r=%2765%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%23c87830%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%236a3010%27%2F%3E%3C%2FradialGradient%3E%0A%3ClinearGradient%20id=%27su%27%20x1=%270%25%27%20y1=%270%25%27%20x2=%2710%25%27%20y2=%27100%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%231a2a4a%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%230d1528%27%2F%3E%3C%2FlinearGradient%3E%0A%3C%2Fdefs%3E%0A%3Cellipse%20cx=%2760%27%20cy=%27118%27%20rx=%2732%27%20ry=%2730%27%20fill=%27url%28%23su%29%27%2F%3E%0A%3Cpath%20d=%27M48%2092%20Q60%20100%2072%2092%20L70%20102%20Q60%20107%2050%20102Z%27%20fill=%27%230d1e38%27%2F%3E%0A%3Cpath%20d=%27M53%2092%20Q60%2098%2067%2092%20L66%20100%20Q60%20104%2054%20100Z%27%20fill=%27%23f0f0ff%27%2F%3E%0A%3Cpath%20d=%27M58%2092%20L60%2092%20L61%20100%20L60%20118%20L59%20100Z%27%20fill=%27%23cc1122%27%2F%3E%0A%3Cpath%20d=%27M57%2092%20L60%2096%20L63%2092Z%27%20fill=%27%23cc1122%27%2F%3E%0A%3Cpath%20d=%27M24%2064%20Q18%2080%2020%20100%20Q26%2096%2028%2085%20Q26%2072%2026%2064Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M96%2064%20Q102%2080%20100%20100%20Q94%2096%2092%2085%20Q94%2072%2094%2064Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2755%27%20rx=%2734%27%20ry=%2728%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M38%2046%20Q36%2030%2042%2026%20Q44%2036%2044%2044Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M50%2042%20Q48%2024%2056%2022%20Q57%2034%2058%2042Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M62%2040%20Q62%2022%2070%2022%20Q70%2034%2070%2042Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M74%2044%20Q76%2028%2082%2030%20Q80%2040%2078%2046Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2762%27%20rx=%2731%27%20ry=%2733%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%2729%27%20cy=%2763%27%20rx=%276%27%20ry=%277%27%20fill=%27url%28%23sk%29%27%2F%3E%3Cellipse%20cx=%2729%27%20cy=%2763%27%20rx=%274%27%20ry=%275%27%20fill=%27%23f0c090%27%2F%3E%0A%3Cellipse%20cx=%2791%27%20cy=%2763%27%20rx=%276%27%20ry=%277%27%20fill=%27url%28%23sk%29%27%2F%3E%3Cellipse%20cx=%2791%27%20cy=%2763%27%20rx=%274%27%20ry=%275%27%20fill=%27%23f0c090%27%2F%3E%0A%3Cellipse%20cx=%2747%27%20cy=%2761%27%20rx=%2710%27%20ry=%2711%27%20fill=%27white%27%2F%3E%0A%3Cellipse%20cx=%2747%27%20cy=%2762%27%20rx=%277%27%20ry=%278%27%20fill=%27url%28%23ir%29%27%2F%3E%0A%3Cellipse%20cx=%2747%27%20cy=%2763%27%20rx=%274%27%20ry=%275%27%20fill=%27%23111%27%2F%3E%0A%3Ccircle%20cx=%2750%27%20cy=%2758%27%20r=%273%27%20fill=%27white%27%2F%3E%3Ccircle%20cx=%2744%27%20cy=%2766%27%20r=%271.5%27%20fill=%27white%27%20opacity=%27.6%27%2F%3E%0A%3Cellipse%20cx=%2773%27%20cy=%2761%27%20rx=%2710%27%20ry=%2711%27%20fill=%27white%27%2F%3E%0A%3Cellipse%20cx=%2773%27%20cy=%2762%27%20rx=%277%27%20ry=%278%27%20fill=%27url%28%23ir%29%27%2F%3E%0A%3Cellipse%20cx=%2773%27%20cy=%2763%27%20rx=%274%27%20ry=%275%27%20fill=%27%23111%27%2F%3E%0A%3Ccircle%20cx=%2776%27%20cy=%2758%27%20r=%273%27%20fill=%27white%27%2F%3E%3Ccircle%20cx=%2770%27%20cy=%2766%27%20r=%271.5%27%20fill=%27white%27%20opacity=%27.6%27%2F%3E%0A%3Cpath%20d=%27M37%2048%20Q47%2042%2057%2048%27%20stroke=%27%233a1a05%27%20stroke-width=%272.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M63%2048%20Q73%2042%2083%2048%27%20stroke=%27%233a1a05%27%20stroke-width=%272.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M54%2075%20Q60%2079%2066%2075%27%20stroke=%27%23d06050%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M55%2075%20Q60%2079%2065%2075%20Q60%2082%2055%2075Z%27%20fill=%27%23e08878%27%20opacity=%27.4%27%2F%3E%0A%3Cellipse%20cx=%2736%27%20cy=%2773%27%20rx=%2710%27%20ry=%277%27%20fill=%27%23ffb0a0%27%20opacity=%27.35%27%2F%3E%0A%3Cellipse%20cx=%2784%27%20cy=%2773%27%20rx=%2710%27%20ry=%277%27%20fill=%27%23ffb0a0%27%20opacity=%27.35%27%2F%3E%0A%3Cpath%20d=%27M55%2071%20Q60%2074%2065%2071%27%20stroke=%27%23d09060%27%20stroke-width=%271.2%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Ctext%20x=%278%27%20y=%2742%27%20font-size=%2710%27%20fill=%27%23d4af37%27%20opacity=%27.8%27%3E%E2%9C%A6%3C%2Ftext%3E%0A%3Ctext%20x=%2786%27%20y=%2750%27%20font-size=%2722%27%20fill=%27%23d4af37%27%20font-weight=%27bold%27%3E%E2%98%85%3C%2Ftext%3E%0A%3Cpath%20d=%27M79%2098%20Q86%20104%2088%20120%20Q84%20122%2082%20118%20Q82%20108%2076%20102Z%27%20fill=%27url%28%23su%29%27%2F%3E%0A%3Crect%20x=%2784%27%20y=%27116%27%20width=%2712%27%20height=%2710%27%20rx=%272%27%20fill=%27%238B4513%27%2F%3E%0A%3C%2Fsvg%3E',
      sleep: 'data:image/svg+xml,%3Csvg%20xmlns=%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox=%270%200%20120%20150%27%3E%0A%3Cdefs%3E%0A%3CradialGradient%20id=%27sk%27%20cx=%2745%25%27%20cy=%2735%25%27%20r=%2765%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%23fde0c5%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%23e8a878%27%2F%3E%3C%2FradialGradient%3E%0A%3CradialGradient%20id=%27hr%27%20cx=%2750%25%27%20cy=%270%25%27%20r=%2780%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%238a5020%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%233a1a05%27%2F%3E%3C%2FradialGradient%3E%0A%3ClinearGradient%20id=%27su%27%20x1=%270%25%27%20y1=%270%25%27%20x2=%2710%25%27%20y2=%27100%25%27%3E%3Cstop%20offset=%270%25%27%20stop-color=%27%231a2a4a%27%2F%3E%3Cstop%20offset=%27100%25%27%20stop-color=%27%230d1528%27%2F%3E%3C%2FlinearGradient%3E%0A%3C%2Fdefs%3E%0A%3Cg%20transform=%27rotate%28-10%2C60%2C110%29%27%3E%0A%3Cellipse%20cx=%2760%27%20cy=%27118%27%20rx=%2732%27%20ry=%2728%27%20fill=%27url%28%23su%29%27%2F%3E%0A%3Cpath%20d=%27M48%2092%20Q60%20100%2072%2092%20L70%20102%20Q60%20107%2050%20102Z%27%20fill=%27%230d1e38%27%2F%3E%0A%3Cpath%20d=%27M53%2092%20Q60%2098%2067%2092%20L66%20100%20Q60%20104%2054%20100Z%27%20fill=%27%23f0f0ff%27%2F%3E%0A%3Cpath%20d=%27M58%2092%20L60%2092%20L61%20100%20L60%20118%20L59%20100Z%27%20fill=%27%23cc1122%27%20opacity=%27.8%27%2F%3E%0A%3Cpath%20d=%27M57%2092%20L60%2096%20L63%2092Z%27%20fill=%27%23cc1122%27%20opacity=%27.8%27%2F%3E%0A%3C%2Fg%3E%0A%3Cpath%20d=%27M24%2064%20Q18%2080%2020%20100%20Q26%2096%2028%2085%20Q26%2072%2026%2064Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M96%2064%20Q102%2080%20100%20100%20Q94%2096%2092%2085%20Q94%2072%2094%2064Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2755%27%20rx=%2734%27%20ry=%2728%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M38%2046%20Q36%2030%2042%2026%20Q44%2036%2044%2044Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M50%2042%20Q48%2024%2056%2022%20Q57%2034%2058%2042Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M62%2040%20Q62%2022%2070%2022%20Q70%2034%2070%2042Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cpath%20d=%27M74%2044%20Q76%2028%2082%2030%20Q80%2040%2078%2046Z%27%20fill=%27url%28%23hr%29%27%2F%3E%0A%3Cg%20transform=%27rotate%28-14%2C60%2C62%29%27%3E%0A%3Cellipse%20cx=%2760%27%20cy=%2762%27%20rx=%2731%27%20ry=%2733%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%2729%27%20cy=%2763%27%20rx=%276%27%20ry=%277%27%20fill=%27url%28%23sk%29%27%2F%3E%3Cellipse%20cx=%2791%27%20cy=%2763%27%20rx=%276%27%20ry=%277%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cpath%20d=%27M37%2061%20Q47%2071%2057%2061%27%20stroke=%27%232a1a0a%27%20stroke-width=%272.8%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M37%2061%20Q40%2055%2044%2058%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M46%2056%20Q50%2051%2054%2056%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M56%2058%20Q59%2054%2062%2058%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M63%2061%20Q73%2071%2083%2061%27%20stroke=%27%232a1a0a%27%20stroke-width=%272.8%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M63%2061%20Q66%2055%2070%2058%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M72%2056%20Q76%2051%2080%2056%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M82%2058%20Q85%2054%2088%2058%27%20stroke=%27%231a0a05%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M37%2048%20Q47%2043%2057%2048%27%20stroke=%27%233a1a05%27%20stroke-width=%272%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cpath%20d=%27M63%2048%20Q73%2043%2083%2048%27%20stroke=%27%233a1a05%27%20stroke-width=%272%27%20fill=%27none%27%20stroke-linecap=%27round%27%2F%3E%0A%3Cellipse%20cx=%2744%27%20cy=%2775%27%20rx=%279%27%20ry=%276%27%20fill=%27%23ffb0a0%27%20opacity=%27.45%27%2F%3E%0A%3Cellipse%20cx=%2776%27%20cy=%2775%27%20rx=%279%27%20ry=%276%27%20fill=%27%23ffb0a0%27%20opacity=%27.45%27%2F%3E%0A%3C%2Fg%3E%0A%3Cellipse%20cx=%2795%27%20cy=%2798%27%20rx=%2714%27%20ry=%279%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%27102%27%20cy=%2792%27%20rx=%276%27%20ry=%275%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%27107%27%20cy=%2798%27%20rx=%275%27%20ry=%275%27%20fill=%27url%28%23sk%29%27%2F%3E%0A%3Cellipse%20cx=%2776%27%20cy=%27138%27%20rx=%2748%27%20ry=%2712%27%20fill=%27white%27%20opacity=%27.88%27%2F%3E%0A%3Cellipse%20cx=%2784%27%20cy=%27142%27%20rx=%2730%27%20ry=%2710%27%20fill=%27white%27%20opacity=%27.88%27%2F%3E%0A%3Ctext%20x=%2764%27%20y=%27140%27%20font-family=%27Arial%20Black%27%20font-size=%278%27%20fill=%27%236060a8%27%20font-weight=%27900%27%3Ez%3C%2Ftext%3E%0A%3Ctext%20x=%2776%27%20y=%27132%27%20font-family=%27Arial%20Black%27%20font-size=%2711%27%20fill=%27%235050a0%27%20font-weight=%27900%27%3Ez%3C%2Ftext%3E%0A%3Ctext%20x=%2788%27%20y=%27122%27%20font-family=%27Arial%20Black%27%20font-size=%2714%27%20fill=%27%234040a0%27%20font-weight=%27900%27%3EZ%3C%2Ftext%3E%0A%3Cpath%20d=%27M100%2028%20Q106%2018%20114%2021%20Q108%2026%20107%2032%20Q104%2036%2098%2034%20Q98%2031%20100%2028Z%27%20fill=%27%23f0e050%27%20opacity=%27.65%27%2F%3E%0A%3Ccircle%20cx=%27104%27%20cy=%2720%27%20r=%271.2%27%20fill=%27%23c0b0e0%27%20opacity=%27.6%27%2F%3E%0A%3C%2Fsvg%3E',
      unlock: 'default',
      desc: 'Dostupný pre všetkých'
    },
    /* Achievementové avatary (mačka/sova/pes) – odomykajú sa výkonom, nie
       kúpou/rolou. Migrované zo starého 2-stavového vloženého SVG
       placeholdera (awake/sleep) na reálnu grafiku v base-systéme
       (full/tired/sleep + bust), commit 4c0996f. id 'cat'/'owl' sa
       ZÁMERNE NEMENÍ – sú uložené vo Firebase u existujúcich hráčov,
       zmena id by im rozbila výber avatara. Mení sa len obsah objektu. */
    'cat': {
      name: 'Sporivá mačka',
      base: 'avatars/macka',
      unlock: 'paragraphs_100',
      unlockValue: 3000,
      desc: 'Odomkni za 3000🪙'
    },
    'owl': {
      name: 'Sova múdrosti',
      base: 'avatars/sova',
      unlock: 'reports_100',
      unlockValue: 100,
      desc: 'Za 100 uznaných nahlásení'
    },
    /* Nový achievementový avatar (commit 4c0996f, 6 PNG: pes-{full,tired,
       sleep}{,-bust}.png). Odomyká sa denným login streakom
       (data.loginStreak) – viď unlock branch 'streak_30' v selectAvatar
       nižšie. Názov "Pes vernosti" drží vzor "Sova múdrosti". */
    'dog': {
      name: 'Pes vernosti',
      base: 'avatars/pes',
      unlock: 'streak_30',
      unlockValue: 30,
      desc: 'Za 30 dní streaku'
    },

    /* ============================================================
       ZÁKLADNÁ SADA (18 PNG, avatars/) – zadarmo, 3 stavy energie
       (full/tired/sleep) namiesto starých 2 (awake/sleep).
       avatarSrc() nižšie rozlišuje podľa prítomnosti `base`.
    ============================================================ */
    'studentka-tmava':  { name: 'Študentka (tmavé vlasy)',  base: 'avatars/studentka-tmava',  unlock: 'default', isBasic: true },
    'studentka-medena': { name: 'Študentka (medené vlasy)', base: 'avatars/studentka-medena', unlock: 'default', isBasic: true },
    'studentka-blond':  { name: 'Študentka (blond vlasy)',  base: 'avatars/studentka-blond',  unlock: 'default', isBasic: true },
    'student-tmavy':    { name: 'Študent (tmavé vlasy)',    base: 'avatars/student-tmavy',    unlock: 'default', isBasic: true },
    'student-medeny':   { name: 'Študent (medené vlasy)',   base: 'avatars/student-medeny',   unlock: 'default', isBasic: true },
    'student-blond':    { name: 'Študent (blond vlasy)',    base: 'avatars/student-blond',    unlock: 'default', isBasic: true },

    /* ============================================================
       TALÁRE – čisto kozmetické kúpy za § (žiadny herný bonus).
       `talarBaseId` = ktorý zo 6 základných avatarov vyššie tento
       talár "oblieka" (kombinovaný PNG render, nie vrstvenie) – obchod
       v init.js ponúka hráčovi len taláre patriace k JEHO aktuálnemu
       základnému avataru. `talarRole` je kľúč do ECONOMY_CONFIG.TALARE
       (cena, jediný zdroj pravdy pre sumy).

       `fallbackBase` (voliteľné): DOČASNÉ požičanie obrázka od inej
       variantY, kým zadávateľka nedodá vlastnú grafiku – VÝHRADNE pre
       základný čierny talár (bez lemu) v rámci ROVNAKÉHO pohlavia,
       nikdy pre taláre s lemom a nikdy naprieč pohlaviami (na čiernej
       látke bez lemu je rozdiel vo vlasoch prakticky neviditeľný, pri
       lemoch by bol nápadný). `base` vždy ukazuje na VLASTNÚ (zatiaľ
       neexistujúcu) cestu tejto položky – avatarSrc()/renderTalarShop
       skúsia najprv ju, a až keď 404, prepnú na fallbackBase. Až
       zadávateľka nahrá skutočný súbor na `base` ceste, fallback sa už
       nikdy nepoužije – ŽIADNA zmena kódu nie je potrebná.

       `hidden` (voliteľné): položka sa v obchode nezobrazuje a nedá sa
       kúpiť (pozri buyTalar/getTalarShopEntries nižšie) – buď preto, že
       vlastný súbor má NESPRÁVNU grafiku (zlá farba lemu, zistené pri
       audite), alebo preto, že vlastná grafika ešte NIE JE nahratá v
       avatars/ (scaffold pripravený vopred). Odstráň `hidden` hneď, ako
       sa nahrá/dodá správna grafika. Existujúci vlastníci (ak nejakí sú)
       o ňu neprídu, len sa nedá znova nakúpiť/objaviť v obchode.

       Nie každý zo 6 základných avatarov má zatiaľ hotový vlastný render
       pre každú farbu taláru – chýbajúce kombinácie s lemom tu jednoducho
       NIE SÚ (žiadny fiktívny nákup niečoho, čo appka nevie zobraziť).
    ============================================================ */
    /* Grafika aktualizovaná (commit 15bba5d, 6 PNG prepísaných na rovnakých
       cestách) – modrý lem/pás na taláre, čiapke a knihe zvýraznený a
       zosýtený, pôvodne takmer splýval s čiernou. Kód sa nemení, appka
       načíta novú grafiku cez rovnaké cesty. */
    'student-blond-advokat':        { name: 'Študent – modrý plášť',              base: 'avatars/student-blond-advokat',        unlock: 'talar_purchase', talarBaseId: 'student-blond',    talarRole: 'advokat',    talarPrice: ECONOMY_CONFIG.TALARE.ADVOKAT },
    /* Vlastný render hotový a nahratý v avatars/ (commit 52a70e6, 6 PNG:
       student-blond-prokurator-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením student-blond-advokat (modrý lem/pás/čiapka/kniha →
       červená). V sleep póze ostáva kniha neutrálna tmavá (nebola modrá
       ani v zdroji). Červená farba vizuálne overená. */
    'student-blond-prokurator':     { name: 'Študent – vínový plášť',            base: 'avatars/student-blond-prokurator',     unlock: 'talar_purchase', talarBaseId: 'student-blond',    talarRole: 'prokurator', talarPrice: ECONOMY_CONFIG.TALARE.PROKURATOR },
    /* Vlastný render hotový a nahratý v avatars/ (commit 2b59541, 6 PNG:
       student-medeny-prokurator-{full,tired,sleep}{,-bust}.png). Prvý
       vínový plášť pre student-medeny (doteraz len talar-cierny). */
    'student-medeny-prokurator':    { name: 'Študent – vínový plášť',            base: 'avatars/student-medeny-prokurator',    unlock: 'talar_purchase', talarBaseId: 'student-medeny',   talarRole: 'prokurator', talarPrice: ECONOMY_CONFIG.TALARE.PROKURATOR },
    /* Vlastný render hotový a nahratý v avatars/ (commit f42ffee, 6 PNG:
       student-medeny-advokat-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením student-medeny-prokurator (vínová štóla/kniha → modrá).
       Modrá farba vizuálne overená. */
    'student-medeny-advokat':       { name: 'Študent – modrý plášť',              base: 'avatars/student-medeny-advokat',       unlock: 'talar_purchase', talarBaseId: 'student-medeny',   talarRole: 'advokat',    talarPrice: ECONOMY_CONFIG.TALARE.ADVOKAT },
    /* Vlastný render hotový a nahratý v avatars/ (commit bf9646a, 6 PNG:
       student-medeny-sudca-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením student-medeny-advokat (modrý lem → fialová). Fialová
       farba vizuálne overená. */
    'student-medeny-sudca':         { name: 'Študent – fialový plášť',               base: 'avatars/student-medeny-sudca',         unlock: 'talar_purchase', talarBaseId: 'student-medeny',   talarRole: 'sudca',      talarPrice: ECONOMY_CONFIG.TALARE.SUDCA },
    /* Vlastný render hotový a nahratý v avatars/ (commit 0dc16ba, 6 PNG:
       student-tmavy-advokat-{full,tired,sleep}{,-bust}.png). Žiadny
       fallbackBase zámerne: fallback je len pre čierny talár bez lemu,
       nikdy pre modrý lem (viď pravidlo vyššie). */
    'student-tmavy-advokat':        { name: 'Študent – modrý plášť',              base: 'avatars/student-tmavy-advokat',        unlock: 'talar_purchase', talarBaseId: 'student-tmavy',    talarRole: 'advokat',    talarPrice: ECONOMY_CONFIG.TALARE.ADVOKAT },
    /* Vlastný render hotový a nahratý v avatars/ (commit f42ffee, 6 PNG:
       student-tmavy-prokurator-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením student-tmavy-advokat (modrý lem/pás → červená). Červená
       farba vizuálne overená. */
    'student-tmavy-prokurator':     { name: 'Študent – vínový plášť',            base: 'avatars/student-tmavy-prokurator',     unlock: 'talar_purchase', talarBaseId: 'student-tmavy',    talarRole: 'prokurator', talarPrice: ECONOMY_CONFIG.TALARE.PROKURATOR },
    /* Vlastný render hotový a nahratý v avatars/ (commit bf9646a, 6 PNG:
       student-tmavy-sudca-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením student-tmavy-prokurator (červený lem → fialová). Fialová
       farba vizuálne overená. */
    'student-tmavy-sudca':          { name: 'Študent – fialový plášť',               base: 'avatars/student-tmavy-sudca',          unlock: 'talar_purchase', talarBaseId: 'student-tmavy',    talarRole: 'sudca',      talarPrice: ECONOMY_CONFIG.TALARE.SUDCA },
    'student-medeny-talar-cierny':  { name: 'Študent – slávnostný plášť',                base: 'avatars/student-medeny-talar-cierny',  unlock: 'talar_purchase', talarBaseId: 'student-medeny',   talarRole: 'talar-cierny', talarPrice: ECONOMY_CONFIG.TALARE.CIERNY },
    'student-tmavy-talar-cierny':   { name: 'Študent – slávnostný plášť',                base: 'avatars/student-tmavy-talar-cierny',   unlock: 'talar_purchase', talarBaseId: 'student-tmavy',    talarRole: 'talar-cierny', talarPrice: ECONOMY_CONFIG.TALARE.CIERNY },
    /* Vlastný render hotový a nahratý v avatars/ (commit e58df8b, 6 PNG:
       student-blond-talar-cierny-{full,tired,sleep}{,-bust}.png). Vznikla
       stmavením student-blond-advokat (jemné modré prúžky → čierna/tmavosivá,
       splýva s plášťom, bez lemu). fallbackBase už netreba. */
    'student-blond-talar-cierny':   { name: 'Študent – slávnostný plášť',                base: 'avatars/student-blond-talar-cierny',   unlock: 'talar_purchase', talarBaseId: 'student-blond', talarRole: 'talar-cierny', talarPrice: ECONOMY_CONFIG.TALARE.CIERNY },
    /* Vlastný render hotový a nahratý v avatars/ (rename commity 733c24d/
       6cbf362/53d1961, 6 PNG: student-blond-sudca-{full,tired,sleep}{,-bust}.png).
       Vznikla prefarbením student-blond-prokurator (červený lem/pás/kniha →
       fialová, rovnaký odtieň ako studentka-blond-sudca, ~302°). Fialová
       farba vizuálne overená. */
    'student-blond-sudca':          { name: 'Študent – fialový plášť',               base: 'avatars/student-blond-sudca',          unlock: 'talar_purchase', talarBaseId: 'student-blond',    talarRole: 'sudca',      talarPrice: ECONOMY_CONFIG.TALARE.SUDCA },
    /* Vlastný render hotový a nahratý v avatars/ (commit 4edf72b, 6 PNG:
       studentka-blond-advokat-{full,tired,sleep}{,-bust}.png). Modrý lem
       vizuálne overený (2026-07-31). */
    'studentka-blond-advokat':      { name: 'Študentka – modrý plášť',            base: 'avatars/studentka-blond-advokat',      unlock: 'talar_purchase', talarBaseId: 'studentka-blond',  talarRole: 'advokat',    talarPrice: ECONOMY_CONFIG.TALARE.ADVOKAT },
    'studentka-blond-prokurator':   { name: 'Študentka – vínový plášť',         base: 'avatars/studentka-blond-prokurator',   unlock: 'talar_purchase', talarBaseId: 'studentka-blond',  talarRole: 'prokurator', talarPrice: ECONOMY_CONFIG.TALARE.PROKURATOR },
    /* Overené (audit 2026-07-31): vlastný súbor má správny fialový pás a
       NIE JE identický s prokurátorom (odlišná veľkosť aj hash) – pôvodný
       „duplikát" bol medzitým opravený, preto zobrazené v obchode. */
    'studentka-blond-sudca':        { name: 'Študentka – fialový plášť',             base: 'avatars/studentka-blond-sudca',        unlock: 'talar_purchase', talarBaseId: 'studentka-blond',  talarRole: 'sudca',      talarPrice: ECONOMY_CONFIG.TALARE.SUDCA },
    'studentka-medena-talar-cierny':{ name: 'Študentka – slávnostný plášť',              base: 'avatars/studentka-medena-talar-cierny',unlock: 'talar_purchase', talarBaseId: 'studentka-medena', talarRole: 'talar-cierny', talarPrice: ECONOMY_CONFIG.TALARE.CIERNY },
    /* Vlastný render hotový a nahratý v avatars/ (commit d7e2af8, 6 PNG:
       studentka-medena-prokurator-{full,tired,sleep}{,-bust}.png). Vínová
       štóla/strapec/kniha, olemovanie štýlovo podľa studentka-blond-
       prokurator. Prvý zakúpiteľný talár pre studentka-medena (doteraz len
       talar-cierny). Vínová farba vizuálne overená. */
    'studentka-medena-prokurator':  { name: 'Študentka – vínový plášť',         base: 'avatars/studentka-medena-prokurator',  unlock: 'talar_purchase', talarBaseId: 'studentka-medena', talarRole: 'prokurator', talarPrice: ECONOMY_CONFIG.TALARE.PROKURATOR },
    /* Vlastný render hotový a nahratý v avatars/ (commit ea9abc3, 6 PNG:
       studentka-medena-sudca-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením studentka-medena-akademik (zlatý lem/štóla → fialová,
       rovnaký odtieň ako studentka-blond-sudca). Kniha fialová len vo full
       póze, v tired/sleep póze podľa rovnakej konvencie ako blond/tmava
       sudca. Fialová farba vizuálne overená. */
    'studentka-medena-sudca':       { name: 'Študentka – fialový plášť',             base: 'avatars/studentka-medena-sudca',       unlock: 'talar_purchase', talarBaseId: 'studentka-medena', talarRole: 'sudca',      talarPrice: ECONOMY_CONFIG.TALARE.SUDCA },
    /* Vlastný render hotový a nahratý v avatars/ (commit 09a4f12, 6 PNG:
       studentka-medena-advokat-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením studentka-medena-sudca (fialový lem/štóla/kniha → modrá,
       rovnaký odtieň ako studentka-blond-advokat/studentka-tmava-advokat).
       Modrá farba vizuálne overená. */
    'studentka-medena-advokat':     { name: 'Študentka – modrý plášť',            base: 'avatars/studentka-medena-advokat',     unlock: 'talar_purchase', talarBaseId: 'studentka-medena', talarRole: 'advokat',    talarPrice: ECONOMY_CONFIG.TALARE.ADVOKAT },
    /* Vlastný render hotový a nahratý v avatars/ (commit 9d51d37, 6 PNG:
       studentka-tmava-advokat-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením studentka-tmava-prokurator (červený lem/štóla/kniha →
       modrá, rovnaký odtieň ako studentka-blond-advokat). */
    'studentka-tmava-advokat':      { name: 'Študentka – modrý plášť',            base: 'avatars/studentka-tmava-advokat',      unlock: 'talar_purchase', talarBaseId: 'studentka-tmava',  talarRole: 'advokat',    talarPrice: ECONOMY_CONFIG.TALARE.ADVOKAT },
    'studentka-tmava-prokurator':   { name: 'Študentka – vínový plášť',         base: 'avatars/studentka-tmava-prokurator',   unlock: 'talar_purchase', talarBaseId: 'studentka-tmava',  talarRole: 'prokurator', talarPrice: ECONOMY_CONFIG.TALARE.PROKURATOR },
    'studentka-tmava-sudca':        { name: 'Študentka – fialový plášť',             base: 'avatars/studentka-tmava-sudca',        unlock: 'talar_purchase', talarBaseId: 'studentka-tmava',  talarRole: 'sudca',      talarPrice: ECONOMY_CONFIG.TALARE.SUDCA },
    /* Vlastný render hotový a nahratý v avatars/ (commit 2418ebc, 6 PNG:
       studentka-tmava-talar-cierny-{full,tired,sleep}{,-bust}.png). Vznikla
       prefarbením studentka-tmava-sudca (fialová štóla/kniha → čierna,
       splýva s plášťom, bez lemu). fallbackBase už netreba. */
    'studentka-tmava-talar-cierny': { name: 'Študentka – slávnostný plášť',              base: 'avatars/studentka-tmava-talar-cierny', unlock: 'talar_purchase', talarBaseId: 'studentka-tmava', talarRole: 'talar-cierny', talarPrice: ECONOMY_CONFIG.TALARE.CIERNY },
    'studentka-blond-talar-cierny': { name: 'Študentka – slávnostný plášť',              base: 'avatars/studentka-blond-talar-cierny', unlock: 'talar_purchase', talarBaseId: 'studentka-blond', talarRole: 'talar-cierny', talarPrice: ECONOMY_CONFIG.TALARE.CIERNY },

    /* Akademický talár – NIKDY na predaj. Priradený výhradne podľa
       aktuálnej (živej) Firebase roly, nie kúpou ani jednorazovým
       udelením – selectAvatar() nižšie ho preto vždy overuje voči
       getRole(), nie voči uloženému vlastníctvu. Vizuálne odlíšený
       zlatým pásom priamo v PNG renderi (obsah assetu, nie CSS). */
    'studentka-blond-akademik': { name: 'Študentka – zlatý plášť', base: 'avatars/studentka-blond-akademik', talarBaseId: 'studentka-blond', unlock: 'talar_role', talarRole: 'akademik', desc: 'Automaticky pridelené garantom a adminom – nedá sa kúpiť.' },
    'studentka-tmava-akademik': { name: 'Študentka (tmavé vlasy) – zlatý plášť', base: 'avatars/studentka-tmava-akademik', talarBaseId: 'studentka-tmava', unlock: 'talar_role', talarRole: 'akademik', desc: 'Automaticky pridelené garantom a adminom – nedá sa kúpiť.' },
    'studentka-medena-akademik': { name: 'Študentka (medené vlasy) – zlatý plášť', base: 'avatars/studentka-medena-akademik', talarBaseId: 'studentka-medena', unlock: 'talar_role', talarRole: 'akademik', desc: 'Automaticky pridelené garantom a adminom – nedá sa kúpiť.' },
    /* Vlastný render hotový a nahratý v avatars/ (commit 74646c4, 6 PNG:
       student-blond-akademik-{full,tired,sleep}{,-bust}.png). Vznikla
       prenesením zlatého štýlu (lem/pás/kniha/čiapka/strapec) na
       student-blond-talar-cierny, doladená používateľkou pre sýtejšiu
       zlatú. Prvý mužský zlatý plášť v kóde (doteraz len studentka-*). */
    'student-blond-akademik':  { name: 'Študent – zlatý plášť', base: 'avatars/student-blond-akademik', talarBaseId: 'student-blond', unlock: 'talar_role', talarRole: 'akademik', desc: 'Automaticky pridelené garantom a adminom – nedá sa kúpiť.' },
    /* Vlastný render hotový a nahratý v avatars/ (commity e233ba1 + d84b8bb,
       6 PNG: student-medeny-akademik-{full,tired,sleep}{,-bust}.png). Ručne
       dotiahnutá zlatá "kolieskovaná" textúra na páse/čiapke/knihe (vlastná
       grafika používateľky, nie skriptové prefarbenie). Zlatá vizuálne overená. */
    'student-medeny-akademik': { name: 'Študent (medené vlasy) – zlatý plášť', base: 'avatars/student-medeny-akademik', talarBaseId: 'student-medeny', unlock: 'talar_role', talarRole: 'akademik', desc: 'Automaticky pridelené garantom a adminom – nedá sa kúpiť.' },
    /* Vlastný render hotový a nahratý v avatars/ (commity 5ff6767 + 6b0b219,
       6 PNG: student-tmavy-akademik-{full,tired,sleep}{,-bust}.png). Ručne
       dotiahnutá zlatá "kolieskovaná" textúra na páse/čiapke/knihe (vlastná
       grafika používateľky, nie skriptové prefarbenie, rovnaký štýl ako
       student-medeny-akademik). Zlatá vizuálne overená. */
    'student-tmavy-akademik': { name: 'Študent (tmavé vlasy) – zlatý plášť', base: 'avatars/student-tmavy-akademik', talarBaseId: 'student-tmavy', unlock: 'talar_role', talarRole: 'akademik', desc: 'Automaticky pridelené garantom a adminom – nedá sa kúpiť.' }
  }
};

/* Avatar, ktorý vidí anonym. Zámerne ten istý default, aký dostane nový
   nick pri prvom prihlásení (loadAvatarState) – po vytvorení nicku sa mu
   teda postavička nezmení pod rukami. Anonym si ho nemôže prezliekať;
   výber avatara aj taláre sú viazané na účet. */
const ANON_AVATAR_TYPE = 'student-f';

/* Nick, pre ktorý už beží plná (Firebase) vetva initAvatarSystem –
   poistka proti dvojitej registrácii watcherov, viď initAvatarSystem. */
let avatarSystemStarted = null;

/* ============================================================
   HELPER: prístup k DB a nick
============================================================ */
function getDb() { return window.db || null; }
function getNick() { return localStorage.getItem('playerNick') || null; }

/* ============================================================
   § EKONOMIKA – centralizované prideľovanie
============================================================ */
export async function awardParagrafy(amount, reason = '') {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick || !amount) return;

  const userRef = ref(db, `users/${nick}`);
  const snap = await get(userRef);
  const data = snap.exists() ? snap.val() : {};
  const current = data.paragrafy || 0;
  const newTotal = current + amount;

  await update(userRef, {
    paragrafy: newTotal,
    totalParagraphsEarned: (data.totalParagraphsEarned || 0) + amount,
    lastParUpdate: Date.now()
  });

  // Aktualizuj UI
  const el = document.getElementById('parCount') || document.getElementById('paragrafValue');
  if (el) el.textContent = newTotal;

  if (reason) {
    showRewardToast(`+${amount}🪙 ${reason}`);
  }

  console.log(`💰 ${amount}🪙 pridelených (${reason}). Celkom: ${newTotal}`);
  return newTotal;
}

export async function spendParagrafy(amount, reason = '') {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return false;

  const userRef = ref(db, `users/${nick}`);
  const snap = await get(userRef);
  const data = snap.exists() ? snap.val() : {};
  const current = data.paragrafy || 0;

  if (current < amount) {
    showRewardToast(`Nemáš dostatok 🪙. Potrebuješ ${amount}🪙, máš ${current}🪙.`);
    return false;
  }

  const newTotal = current - amount;
  await update(userRef, { paragrafy: newTotal, lastParUpdate: Date.now() });

  const el = document.getElementById('parCount') || document.getElementById('paragrafValue');
  if (el) el.textContent = newTotal;

  console.log(`💸 ${amount}🪙 minutých (${reason}). Celkom: ${newTotal}`);
  return true;
}

/* ============================================================
   AVATAR – načítanie a uloženie stavu
============================================================ */
async function loadAvatarState(nick) {
  const db = getDb();
  if (!db || !nick) return null;

  const snap = await get(ref(db, `users/${nick}/avatar`));
  if (!snap.exists()) {
    // Defaultný stav pri prvom prihlásení – rovno s dnešnou porciou
    const defaultState = {
      type: 'student-f',
      energy: AVATAR_CONFIG.DAILY_FULL,
      energyDay: todayKey(),
      lastEnergyUpdate: Date.now()
    };
    await update(ref(db, `users/${nick}/avatar`), defaultState);
    return defaultState;
  }
  return await applyDailyEnergyReset(nick, snap.val());
}

/* ============================================================
   DENNÝ RESET ENERGIE (model v2)
   Lazy, bez cronu a bez servera: pri prvom čítaní stavu v novom dni
   sa energia obnoví na dennú porciu. Deň = todayKey() z economyConfig
   (ten istý, aký používa denný strop §).

   Nikdy neznižuje: berie sa max(aktuálna, DAILY_FULL). Dnes sa to nemôže
   prejaviť (FEED_TO === DAILY_FULL), je to poistka pre prípad, že by
   kŕmenie/prémium raz dopĺňalo nad dennú porciu – reset by hráčovi
   nemal nič zobrať.

   Nedotýka sa § ani progresu – zapisuje výhradne do users/{nick}/avatar
   polia energy/energyDay/lastEnergyUpdate.

   Poznámka k anonymom: tí Firebase identitu nemajú, ich energia bude žiť
   v localStorage – rieši sa v E4 spolu s anon session, nie tu.
============================================================ */
async function applyDailyEnergyReset(nick, state) {
  if (!state) return state;

  const today = todayKey();
  if (state.energyDay === today) return state;

  const refreshed = {
    ...state,
    energy: Math.max(Number(state.energy) || 0, AVATAR_CONFIG.DAILY_FULL),
    energyDay: today,
    lastEnergyUpdate: Date.now()
  };

  await update(ref(getDb(), `users/${nick}/avatar`), {
    energy: refreshed.energy,
    energyDay: refreshed.energyDay,
    lastEnergyUpdate: refreshed.lastEnergyUpdate
  });

  return refreshed;
}

async function saveAvatarState(nick, state) {
  const db = getDb();
  if (!db || !nick) return;
  await update(ref(db, `users/${nick}/avatar`), state);
}

/* ============================================================
   ENERGIA – spotreba
   Energia sa časom sama nedopĺňa ani nemíňa; míňa ju hranie a raz
   denne ju obnoví applyDailyEnergyReset() pri načítaní stavu.
============================================================ */
export async function deductEnergy(amount) {
  const nick = getNick();

  /* ANONYM (A1): energia žije v localStorage, nie vo Firebase. Model je
     inak rovnaký – rovnaká denná porcia, rovnaký deň, rovnaký reset.
     Predtým sa tu vracala plná porcia bez zápisu, takže anonym mal
     energiu nekonečnú a nikdy nezaspal. */
  if (!nick) {
    const newEnergy = spendAnonEnergy(amount);
    updateAvatarUI(newEnergy, ANON_AVATAR_TYPE);
    return newEnergy;
  }

  const state = await loadAvatarState(nick);
  if (!state) return AVATAR_CONFIG.DAILY_FULL;

  const newEnergy = Math.max(0, (state.energy ?? AVATAR_CONFIG.DAILY_FULL) - amount);
  await saveAvatarState(nick, {
    ...state,
    energy: newEnergy,
    energyDay: todayKey(),
    lastEnergyUpdate: Date.now()
  });

  updateAvatarUI(newEnergy, state.type);
  return newEnergy;
}

/* Aktuálna energia hráča, BEZ zápisu. Pre gate-y drahých aktivít
   (Štátnicová sieň, Nočný výcuc), ktoré potrebujú vedieť, či náklad
   vôbec pokryje. Číta cez loadAvatarState(), takže po polnoci vráti
   už obnovenú dennú porciu.
   Bez nicku (anonym, A1) číta getAnonEnergy() – tá si denný reset
   uplatní rovnako, len nad localStorage. */
export async function getEnergy() {
  const nick = getNick();
  if (!nick) return getAnonEnergy();     // anonym – localStorage (A1)
  const state = await loadAvatarState(nick);
  return state ? (state.energy ?? AVATAR_CONFIG.DAILY_FULL) : AVATAR_CONFIG.DAILY_FULL;
}

/* ============================================================
   KŔMENIE AVATARA
============================================================ */
export async function feedAvatar() {
  const nick = getNick();
  if (!nick) return;

  /* Kŕmiť sa dá KEDYKOĽVEK, kým energia nie je plná – nielen pri spiacom
     avatarovi. Nick so 40 % tak doplní na plnú porciu a stihne aj drahú
     aktivitu. Stav sa načíta PRED platbou, aby sa § nestrhli za nič. */
  const state = await loadAvatarState(nick);
  const current = state ? (state.energy ?? AVATAR_CONFIG.DAILY_FULL) : AVATAR_CONFIG.DAILY_FULL;
  if (current >= AVATAR_CONFIG.FEED_ENERGY) {
    showRewardToast('🍖 Avatar je najedený – energia je plná.');
    return;
  }

  const isAdmin = (await getRole(nick)) === 'admin';
  const spent = isAdmin ? true : await spendParagrafy(AVATAR_CONFIG.FEED_COST, 'za kŕmenie avatara');
  if (!spent) return;

  const newEnergy = AVATAR_CONFIG.FEED_ENERGY;

  await saveAvatarState(nick, {
    ...state,
    energy: newEnergy,
    energyDay: todayKey(),
    lastEnergyUpdate: Date.now()
  });

  updateAvatarUI(newEnergy, state && state.type);
  await logTransaction(nick, {
    type: 'spend',
    amount: isAdmin ? 0 : AVATAR_CONFIG.FEED_COST,
    reason: isAdmin ? 'za kŕmenie avatara (admin zadarmo)' : 'za kŕmenie avatara',
    balanceAfter: null
  });
  showRewardToast(isAdmin ? '🍖 Avatar nakŕmený (admin zadarmo)! Energia 100%' : '🍖 Avatar nakŕmený! Energia 100%');
}

/* ============================================================
   KONTROLA – môže hráč hrať duelový kvíz?
============================================================ */
export async function canPlayDuel() {
  const nick = getNick();

  /* ANONYM (A1): platí preň rovnaký spánok ako pre nick – dovtedy sa mu
     tu vracalo true a hral donekonečna. Hláška je iná: kŕmenie stojí §,
     ktoré anonym nemá, takže mu neponúkame niečo, čo nemôže spraviť.
     Plnohodnotnú výzvu na nick prinesie prompt #1 v A5. */
  if (!nick) {
    if (getAnonEnergy() <= AVATAR_CONFIG.SLEEP_THRESHOLD) {
      showRewardToast('😴 Tvoj avatar zaspal – dnešná energia je preč. Vráť sa zajtra, energia sa obnoví.');
      return false;
    }
    return true;
  }

  const state = await loadAvatarState(nick);
  if (!state) return true;

  if ((state.energy ?? AVATAR_CONFIG.DAILY_FULL) <= AVATAR_CONFIG.SLEEP_THRESHOLD) {
    showRewardToast(`😴 Avatar zaspal – dnešná energia je preč. Nakŕm ho za ${AVATAR_CONFIG.FEED_COST}🪙, alebo sa vráť zajtra.`);
    return false;
  }
  return true;
}

/* ============================================================
   DENNÝ LOGIN + STREAK
============================================================ */
export async function checkDailyLogin() {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return;

  const userRef = ref(db, `users/${nick}`);
  const snap = await get(userRef);
  const data = snap.exists() ? snap.val() : {};

  const now = Date.now();
  const lastLogin = data.lastLogin || 0;
  const streak = data.loginStreak || 0;

  const hoursSinceLast = (now - lastLogin) / (1000 * 60 * 60);

  // Ak prišiel v ten istý deň, nič
  if (hoursSinceLast < 24) return;

  let newStreak = streak;
  let streakBroken = false;

  if (hoursSinceLast < 48) {
    // Prišiel v ďalší deň — streak pokračuje (bez stropu, kvôli míľnikom napr. deň 30)
    newStreak = streak + 1;
  } else {
    /* Vynechal deň → streak sa reštartuje.
       Štít streaku (poistka za 15 §, ktorá odpúšťala jeden vynechaný deň)
       bol ZRUŠENÝ (2026-08) – § sa po E2/E3 dajú minúť už len na krmivo
       a kozmetiku, aby pravidlo platilo bez výnimky. Prípadné staré
       users/{nick}/streakShield sa už nikde nečíta ani nezapisuje;
       osirený kľúč je neškodný, migrácia netreba. */
    newStreak = 1;
    streakBroken = streak > 1;
  }

  // Odmena – krivka so stropom: deň 1-7 podľa BASE, deň 8+ = AFTER, + prípadný míľnikový bonus
  const { BASE, AFTER, MILESTONES } = ECONOMY_CONFIG.STREAK;
  const base = newStreak <= BASE.length ? BASE[newStreak - 1] : AFTER;
  const milestone = MILESTONES[newStreak] || 0;
  const reward = base + milestone;

  await update(userRef, {
    lastLogin: now,
    loginStreak: newStreak
  });

  await awardParagrafy(reward, `za prihlásenie (deň ${newStreak})`);
  await logTransaction(nick, { type: 'award', amount: reward, reason: `streak deň ${newStreak}`, balanceAfter: null });

  // Zobraz streak info
  if (streakBroken) {
    showRewardToast(`💔 Streak prerušený. Začínaš odznova. +${reward}🪙`);
  } else if (milestone > 0) {
    showRewardToast(`🔥 Streak ${newStreak} dní! +${base}🪙 +${milestone}🪙 bonus!`);
  } else if (newStreak > 1) {
    showRewardToast(`🔥 Streak ${newStreak} dní! +${reward}🪙`);
  }

  // Aktualizuj UI streak
  updateStreakUI(newStreak);
}

/* ============================================================
   ANON AVATAR – vykreslenie bez Firebase (A1)
   Zámerne minimálne: obrázok + energia. Žiadny streak (je za nickom),
   žiadny § panel, žiadne kŕmenie, žiadny live watcher. getAnonEnergy()
   pritom sám uplatní denný reset, takže po polnoci vidí anonym plnú
   porciu rovnako ako nick.
============================================================ */
function initAnonAvatarUI() {
  const def = AVATAR_CONFIG.AVATARS[ANON_AVATAR_TYPE];
  updateAvatarUI(getAnonEnergy(), ANON_AVATAR_TYPE);
  if (def) preloadAvatarStates(def);
  console.log('🐾 Avatar systém inicializovaný (anonym – energia z localStorage)');
}

/* ⛔ buyStreakShield() ZRUŠENÉ (2026-08). Poistka streaku za 15 § bola
   posledný § výdavok mimo krmiva a kozmetiky; po E2/E3 platí pravidlo
   „§ len na kŕmenie avatara a kozmetiku“ bez výnimky. Tlačidlo
   #buyStreakShieldBtn v HTML nikdy neexistovalo (overené grepom), takže
   funkcia bola v praxi nedosiahnuteľná – zaniká aj s wiring-om v
   initAvatarSystem. Nepridávať späť. */

/* ============================================================
   VÝBER AVATARA
============================================================ */
export async function selectAvatar(avatarType) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return;

  const avatarDef = AVATAR_CONFIG.AVATARS[avatarType];
  if (!avatarDef) return;

  // Aktuálny stav – načítaný RAZ a zdieľaný: použije sa na kontrolu
  // talarBaseId nižšie aj na samotný zápis nového typu (žiadny druhý
  // Firebase read). loadAvatarState defaultuje type na 'student-f', takže
  // state.type je vždy definovaný.
  const state = await loadAvatarState(nick);

  // Talár musí patriť k AKTUÁLNEMU základnému avatarovi hráča – tá istá
  // podmienka, akou shop (getTalarShopEntries) filtruje ponuku. Bráni
  // priamemu volaniu selectAvatar() mimo shop UI (napr. z konzoly), ktoré
  // by inak nasadilo napr. studentka-tmava-akademik na studentka-blond.
  // Platí pre OBE talárové vetvy (talar_purchase aj talar_role); základné
  // avatary talarBaseId nemajú, takže sa ich táto kontrola netýka.
  if (avatarDef.talarBaseId && avatarDef.talarBaseId !== getBaseIdFor(state.type)) {
    showRewardToast('🔒 Tento talár nepatrí k tvojmu základnému avatarovi.');
    return;
  }

  // Kontrola odomknutia
  if (avatarDef.unlock !== 'default') {
    const snap = await get(ref(db, `users/${nick}`));
    const data = snap.exists() ? snap.val() : {};

    if (avatarDef.unlock === 'paragraphs_100') {
      // Použi totalParagraphsEarned, ak neexistuje, fallback na aktuálny zostatok
      const totalEarned = data.totalParagraphsEarned || data.paragrafy || 0;
      if (totalEarned < avatarDef.unlockValue) {
        const chyba = avatarDef.unlockValue - totalEarned;
        showRewardToast(`🔒 Mačka je zamknutá. Chýba ti ešte ${chyba}🪙 (celkovo nazbieraných).`);
        return;
      }
    }
    if (avatarDef.unlock === 'reports_100') {
      const acceptedReports = data.acceptedReports || 0;
      if (acceptedReports < avatarDef.unlockValue) {
        const chyba = avatarDef.unlockValue - acceptedReports;
        showRewardToast(`🔒 Sova je zamknutá. Chýba ti ešte ${chyba} uznaných nahlásení.`);
        return;
      }
    }
    if (avatarDef.unlock === 'streak_30') {
      const loginStreak = data.loginStreak || 0;
      if (loginStreak < avatarDef.unlockValue) {
        const chyba = avatarDef.unlockValue - loginStreak;
        showRewardToast(`🔒 Pes je zamknutý. Chýba ti ešte ${chyba} dní streaku.`);
        return;
      }
    }
    if (avatarDef.unlock === 'talar_purchase') {
      const owned = data.ownedTalars && data.ownedTalars[avatarType] === true;
      if (!owned) {
        showRewardToast(`🔒 Tento talár si ešte nekúpil/a (${avatarDef.talarPrice}🪙 v obchode).`);
        return;
      }
    }
    if (avatarDef.unlock === 'talar_role') {
      // Vždy živá kontrola skutočnej Firebase roly – NIKDY uložené
      // vlastníctvo. Akademický talár sa nedá "kúpiť" ani raz získať
      // natrvalo – ak rola prestane byť garant/admin, prestane platiť aj tu.
      const role = await getRole(nick);
      if (role !== 'garant' && role !== 'admin') {
        showRewardToast('🔒 Akademický talár je vyhradený pre garantov a adminov.');
        return;
      }
    }
  }

  await saveAvatarState(nick, { ...state, type: avatarType });
  preloadAvatarStates(avatarDef);
  updateAvatarUI(state.energy ?? AVATAR_CONFIG.DAILY_FULL, avatarType);
  showRewardToast(`Avatar zmenený na: ${avatarDef.name}`);
}

/* ============================================================
   TALÁRE – OBCHOD (čisto kozmetika, žiadny herný bonus)
============================================================ */
/* Kúpi talár za § (jednorazovo, natrvalo). Cena sa číta VÝLUČNE z
   AVATAR_CONFIG.AVATARS[avatarId].talarPrice (odvodené z
   ECONOMY_CONFIG.TALARE) – nikdy natvrdo tu. Akademický talár
   (unlock !== 'talar_purchase') sa týmto spôsobom kúpiť nedá vôbec –
   štrukturálna poistka navyše k tomu, že v obchode sa mu nezobrazí
   žiadne tlačidlo "Kúpiť". */
export async function buyTalar(avatarId) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return { ok: false, message: 'Musíš byť prihlásený.' };

  const avatarDef = AVATAR_CONFIG.AVATARS[avatarId];
  if (!avatarDef || avatarDef.unlock !== 'talar_purchase' || !avatarDef.talarPrice || avatarDef.hidden) {
    return { ok: false, message: 'Tento talár sa nedá kúpiť.' };
  }

  const ownedSnap = await get(ref(db, `users/${nick}/ownedTalars/${avatarId}`));
  if (ownedSnap.exists() && ownedSnap.val() === true) {
    return { ok: false, message: 'Tento talár už vlastníš.' };
  }

  const paid = await spendParagrafy(avatarDef.talarPrice, `plášť – ${avatarDef.name}`);
  if (!paid) return { ok: false, message: `Nemáš dosť 🪙 (${avatarDef.talarPrice}🪙).` };

  await update(ref(db, `users/${nick}/ownedTalars`), { [avatarId]: true });

  /* E2: kúpa talára po novom zanecháva stopu v transakčnom logu. Predtým
     jediný § výdavok v celej appke, ktorý sa nikam nezapísal – talár za
     1000 § v users/{nick}/transactions chýbal úplne.
     Prečo nie econSpend: avatar.js NESMIE importovať economy.js (economy.js
     importuje avatar.js – vznikol by cyklus, presne preto existuje
     samostatný economyConfig.js). logTransaction je z konfiguračného
     listu, takže je dostupný bez cyklu. Rovnaký dôvod má feedAvatar(). */
  await logTransaction(nick, {
    type: 'spend',
    amount: avatarDef.talarPrice,
    reason: `plášť – ${avatarDef.name}`,
    balanceAfter: null
  });

  return { ok: true, price: avatarDef.talarPrice };
}

/* Ak je avatarType talár, vráti jeho základný avatar (pre zistenie,
   ktoré ďalšie taláre patria k tej istej postave); inak vráti nezmenené. */
export function getBaseIdFor(avatarType) {
  const def = AVATAR_CONFIG.AVATARS[avatarType];
  return (def && def.talarBaseId) || avatarType;
}

/* Taláre relevantné pre AKTUÁLNY základný avatar hráča (talarBaseId),
   plus akademický (ak naň má rolu) – pre vykreslenie obchodu v init.js.
   Vlastníctvo sa číta jedným čítaním users/{nick}/ownedTalars, nie
   opakovane per položka. Chýbajúce kombinácie (žiadny render pre daný
   pár základ+farba) sa sem vôbec nedostanú – nie sú v AVATAR_CONFIG. */
export async function getTalarShopEntries(currentBaseId) {
  const db = getDb();
  const nick = getNick();
  if (!db || !nick) return [];

  const [ownedSnap, role] = await Promise.all([
    get(ref(db, `users/${nick}/ownedTalars`)),
    getRole(nick)
  ]);
  const owned = ownedSnap.exists() ? ownedSnap.val() : {};

  const entries = Object.entries(AVATAR_CONFIG.AVATARS)
    .filter(([id, def]) => {
      if (def.hidden) return false; // čaká na opravenú grafiku, pozri komentár pri definícii
      if (def.unlock === 'talar_purchase') return def.talarBaseId === currentBaseId;
      if (def.unlock === 'talar_role') return (role === 'garant' || role === 'admin') && def.talarBaseId === currentBaseId;
      return false;
    })
    .map(([id, def]) => ({
      id,
      name: def.name,
      base: def.base,
      fallbackBase: def.fallbackBase || null,
      price: def.talarPrice || null,
      academic: def.unlock === 'talar_role',
      owned: def.unlock === 'talar_role' ? true : !!owned[id]
    }));

  return entries;
}

/* ============================================================
   UI – aktualizácia avatara na stránke
============================================================ */
/* Zdroj obrázka avatara podľa energie.
   - Základná sada (def.base): 3 stavy full/tired/sleep. variant 'bust' vráti
     portrét (hlavička, rebríček – malý kruh, celá postava by bola nečitateľná
     s odseknutou hlavou), variant 'full' celú postavu (výberový modal, avatar
     sekcia).
   - Staré/obchodné avatary (def.awake/def.sleep): pôvodné 2 stavy, bust
     nemajú – variant sa ignoruje, bez zmeny správania. */
function avatarSrcFromBase(base, energy, variant = 'full') {
  const state = energy <= 0 ? 'sleep' : energy <= 50 ? 'tired' : 'full';
  const suffix = variant === 'bust' ? '-bust' : '';
  return `${base}-${state}${suffix}.png`;
}
function avatarSrc(def, energy, variant = 'full') {
  if (def.base) return avatarSrcFromBase(def.base, energy, variant);
  return energy <= AVATAR_CONFIG.SLEEP_THRESHOLD ? def.sleep : def.awake;
}
/* Nastaví <img>.src na def.base a zapojí onerror na def.fallbackBase (ak
   existuje) – DOČASNÉ požičanie obrázka, kým zadávateľka nedodá vlastnú
   grafiku (pozri komentár pri fallbackBase v AVATAR_CONFIG.AVATARS vyššie).
   Len jeden pokus o fallback, potom sa onerror odpojí, aby nekonečne
   necyklovalo, ak by aj fallback chýbal.

   ⚠️ Poistka (2026-07-19): ak zlyhá AJ fallbackBase (alebo žiadny nie je),
   posledný onerror krok skryje <img> a ukáže dekoratívne emoji namiesto
   rozbitej ikonky prehliadača – nech budúce premenovanie avatarov v
   avatars/ appku v hlavičke ticho nerozbije. */
function showAvatarImgFallback(imgEl) {
  imgEl.onerror = null;
  imgEl.style.display = 'none';
  const existing = imgEl.parentElement && imgEl.parentElement.querySelector('.avatar-img-fallback');
  if (existing) return;
  const fallback = document.createElement('span');
  fallback.className = 'avatar-img-fallback';
  fallback.textContent = '🧑‍🎓';
  fallback.style.fontSize = '28px';
  imgEl.after(fallback);
}
function setAvatarImgSrc(imgEl, def, energy, variant = 'full') {
  // Self-heal: ak predchádzajúce volanie skončilo fallbackom (skrytý <img> +
  // emoji vedľa), nová snaha o načítanie ho musí vrátiť do pôvodného stavu.
  imgEl.style.display = '';
  const staleFallback = imgEl.parentElement && imgEl.parentElement.querySelector('.avatar-img-fallback');
  if (staleFallback) staleFallback.remove();

  imgEl.src = avatarSrc(def, energy, variant);
  imgEl.onerror = def.fallbackBase
    ? () => {
        imgEl.onerror = () => showAvatarImgFallback(imgEl);
        imgEl.src = avatarSrcFromBase(def.fallbackBase, energy, variant);
      }
    : () => showAvatarImgFallback(imgEl);
}

/* Pre iné moduly (napr. scripts/leaderboard.js), ktoré potrebujú bust cestu
   pre avatar ĽUBOVOĽNÉHO hráča, nielen aktuálne prihláseného. Vráti null pre
   staré/obchodné avatary bez bust verzie – volajúci použije vlastný fallback. */
export function getAvatarBustSrc(avatarType, energy) {
  const def = AVATAR_CONFIG.AVATARS[avatarType];
  if (!def || !def.base) return null;
  return avatarSrc(def, energy, 'bust');
}

/* Bust cesta pre KONKRÉTNY stav ('full'|'tired'|'sleep'), nie odvodený z
   energie – pre moduly s VLASTNÝMI prahmi (napr. scripts/dashboardUI.js:
   spiaci/unavený/čerstvý podľa % témy, iné hranice než energia hlavného
   avatara). avatarType je state.type hráča (users/{nick}/avatar/type) –
   ak má hráč obliekky talár, JE to jeho type (viď selectAvatar vyššie),
   takže táto funkcia automaticky vráti bust s talárom bez ďalšej vrstvy. */
export function getAvatarBustSrcForState(avatarType, state) {
  const def = AVATAR_CONFIG.AVATARS[avatarType];
  if (!def || !def.base) return null;
  return `${def.base}-${state}-bust.png`;
}

/* Pre iné moduly – aktuálny typ avatara hráča BEZ zápisu default stavu
   (na rozdiel od loadAvatarState, ktoré pri prvom volaní zapisuje default –
   tu chceme len číst, napr. pre dashboard). */
export async function getAvatarType(nick) {
  const db = getDb();
  if (!db || !nick) return 'student-f';
  const snap = await get(ref(db, `users/${nick}/avatar/type`));
  return snap.exists() ? snap.val() : 'student-f';
}

/* Preloadne všetky 3 stavy základnej sady (celá postava aj bust), nech
   full→tired→sleep neblikne ani v hlavičke, ani v obchode/sekcii avatara. */
function preloadAvatarStates(def) {
  if (!def || !def.base) return;
  ['full', 'tired', 'sleep'].forEach(state => {
    new Image().src = `${def.base}-${state}.png`;
    new Image().src = `${def.base}-${state}-bust.png`;
  });
  // Ak vlastný render zatiaľ chýba, predhraj rovno požičaný obrázok tiež.
  if (def.fallbackBase) {
    ['full', 'tired', 'sleep'].forEach(state => {
      new Image().src = `${def.fallbackBase}-${state}.png`;
      new Image().src = `${def.fallbackBase}-${state}-bust.png`;
    });
  }
}

export function updateAvatarUI(energy, avatarType) {
  const avatarDef = AVATAR_CONFIG.AVATARS[avatarType] || AVATAR_CONFIG.AVATARS['student-f'];
  const isSleeping = energy <= AVATAR_CONFIG.SLEEP_THRESHOLD;

  // Obrázok avatara – hlavička VŽDY bust (portrét), aj pre základnú sadu
  const imgEl = document.getElementById('userAvatar');
  if (imgEl) {
    setAvatarImgSrc(imgEl, avatarDef, energy, 'bust');
    imgEl.alt = avatarDef.name;
    // Animácia pri spánku – len staré avatary (2 stavy); nová sada má vlastný spiaci render
    imgEl.style.filter = (!avatarDef.base && isSleeping) ? 'saturate(0.5) brightness(0.8)' : '';
  }

  // Energy bar (ak existuje) – šírka ako podiel z hornej hranice, nie „energy %“
  const energyBar = document.getElementById('avatarEnergyBar');
  if (energyBar) {
    const pct = Math.max(0, Math.min(100, Math.round((energy / AVATAR_CONFIG.MAX_ENERGY) * 100)));
    energyBar.style.width = `${pct}%`;
    energyBar.style.background = energy > 30
      ? 'linear-gradient(90deg, #48bb78, #38a169)'
      : energy > 10
        ? 'linear-gradient(90deg, #ed8936, #dd6b20)'
        : 'linear-gradient(90deg, #fc8181, #e53e3e)';
  }

  const energyText = document.getElementById('avatarEnergyText');
  if (energyText) {
    energyText.textContent = isSleeping ? '😴 Spí' : `⚡ ${energy}%`;
  }

  /* Feed button – ukáže sa vždy, keď energia NIE JE plná (nielen pri
     spánku). Popisok aj title berú cenu z configu, aby sa nemohli rozísť
     s ECONOMY_CONFIG.ENERGY.FEED_COST (predtým bolo „12§“ natvrdo v HTML).
     ANONYMOVI sa NEZOBRAZUJE (A1): kŕmenie stojí §, ktoré sa dajú získať
     len s nickom – ponúkať mu tlačidlo, ktoré nemôže použiť, by bolo
     len frustrujúce. Jeho cesta z prázdnej energie je nick (prompt #1,
     A5) alebo zajtrajšia porcia. */
  const feedBtn = document.getElementById('feedAvatarBtn');
  if (feedBtn) {
    const cost = AVATAR_CONFIG.FEED_COST;
    const canFeed = !isAnon() && energy < AVATAR_CONFIG.FEED_ENERGY;
    feedBtn.style.display = canFeed ? 'inline-flex' : 'none';
    feedBtn.textContent = `🍖 Nakŕmiť (${cost}🪙)`;
    feedBtn.title = `Nakŕm avatara za ${cost}🪙`;
  }

  /* Duel button blokovanie. Dlaždicu Výzvy (#openDuelBankTile) sem ZÁMERNE
     nepridávaj – register je len zoznam, hru nespúšťa; samotné prijatie výzvy
     si energiu overí cez econCanPlay v scripts/duels.js. */
  const startDuelBtn = document.getElementById('startQuizBtn');
  if (startDuelBtn && isSleeping) {
    startDuelBtn.disabled = true;
    startDuelBtn.title = 'Avatar spí – nakŕm ho!';
  }

  window.__currentAvatarEnergy = energy;
  window.__currentAvatarType = avatarType;
}

export function updateStreakUI(streak) {
  const el = document.getElementById('loginStreakDisplay');
  if (!el) return;
  const flames = streak >= 7 ? '🔥🔥🔥' : streak >= 4 ? '🔥🔥' : streak >= 2 ? '🔥' : '';
  el.textContent = `${flames} Streak: ${streak} ${streak === 7 ? '(MAX!)' : `dní`}`;
}

/* ============================================================
   VRSTVENIE – taláre a zvieratká (príprava, BEZ UI)
   TODO: assety avatars/talar-{farba}.png a avatars/pet-{typ}.png
   ešte neexistujú; admin udeľovanie (kto dostane čo) bude
   samostatné zadanie. Tu len nastavíme src ak dáta existujú,
   s bezpečným zlyhaním (onerror → skryť), nech chýbajúci súbor
   nič nerozbije.
============================================================ */
export async function applyAccessories(nick) {
  const db = getDb();
  if (!db || !nick) return;

  const snap = await get(ref(db, `users/${nick}/accessories`));
  const acc = snap.exists() ? snap.val() : {};

  // POZOR: #avatarWrap img { display:block !important } (existujúce pravidlo pre
  // #userAvatar) by inak prebilo skrytie týchto vrstiev – preto setProperty(...,'important').
  const talarEl = document.getElementById('avatarTalar');
  if (talarEl) {
    if (acc.talar) {
      talarEl.onerror = () => { talarEl.style.setProperty('display', 'none', 'important'); };
      talarEl.src = `avatars/talar-${acc.talar}.png`;
      talarEl.style.setProperty('display', 'block', 'important');
    } else {
      talarEl.style.setProperty('display', 'none', 'important');
    }
  }

  const petEl = document.getElementById('avatarPet');
  if (petEl) {
    if (acc.pet) {
      petEl.onerror = () => { petEl.style.setProperty('display', 'none', 'important'); };
      petEl.src = `avatars/pet-${acc.pet}.png`;
      petEl.style.setProperty('display', 'block', 'important');
    } else {
      petEl.style.setProperty('display', 'none', 'important');
    }
  }
}

/* ============================================================
   INIT – spustenie celého systému
============================================================ */
export async function initAvatarSystem() {
  const nick = getNick();

  /* ANONYM (A1): dostane základného avatara a vidí svoju dennú energiu –
     bez toho by mu porcia ticho ubúdala a on by netušil, prečo mu zrazu
     prestali fungovať žolíky a hry. Firebase sa nedotýkame vôbec:
     žiadny checkDailyLogin (streak je za nickom), žiadne onValue
     watchery, žiadny § panel. Len vykreslíme stav z localStorage.
     Anon vetva sa smie spustiť opakovane – nič neregistruje. */
  if (!nick) {
    initAnonAvatarUI();
    return;
  }

  /* ⚠️ IDEMPOTENCIA (A2a). Nick vetva registruje DVA onValue watchery
     a jeden click listener. Kým bol jediným vstupom reload, druhé
     spustenie nehrozilo. Po zavedení claimNickInline() sa sem dá dostať
     aj bez reloadu (a teoreticky dvakrát – dvojklik, dva prompty za
     sebou), takže bez tejto poistky by na tej istej ceste viseli dva
     watchery a UI by sa prekresľovalo duplicitne. */
  if (avatarSystemStarted === nick) return;
  avatarSystemStarted = nick;

  const db = getDb();
  if (!db) return;

  // Denný login
  await checkDailyLogin();

  // Načítaj stav
  let state = await loadAvatarState(nick);
  if (state) {
    // Poistka: zlatý plášť je viazaný na ŽIVÚ rolu, nikdy na
    // uložené vlastníctvo. Ak niekto medzičasom prestal byť garant/admin
    // (a stále ho má nasadený z minula), vráť ho na základný avatar –
    // pečať 🎓 nesmie zostať visieť na niekom, kto už rolu nemá.
    const wornDef = AVATAR_CONFIG.AVATARS[state.type];
    if (wornDef && wornDef.unlock === 'talar_role') {
      const role = await getRole(nick);
      if (role !== 'garant' && role !== 'admin') {
        state = { ...state, type: 'studentka-tmava' };
        await saveAvatarState(nick, state);
      }
    }

    const avatarDef = AVATAR_CONFIG.AVATARS[state.type];
    updateAvatarUI(state.energy ?? AVATAR_CONFIG.DAILY_FULL, state.type || 'student-f');
    preloadAvatarStates(avatarDef);

    // Nový nick (loadAvatarState ho práve defaultol) alebo starý typ pred
    // zavedením základnej sady – jednorazovo ponúkni výber zo 6 nových avatarov.
    if ((state.type === 'student-f' || state.type === 'student-m') &&
        typeof window.openAvatarPickerModal === 'function') {
      window.openAvatarPickerModal(true);
    }
  }

  // Taláre/zvieratká (príprava bez UI)
  applyAccessories(nick);

  // Live sledovanie zmien avatara
  onValue(ref(db, `users/${nick}/avatar`), (snap) => {
    if (snap.exists()) {
      const s = snap.val();
      updateAvatarUI(s.energy ?? AVATAR_CONFIG.DAILY_FULL, s.type || 'student-f');
    }
  });

  // Live sledovanie paragrafov
  onValue(ref(db, `users/${nick}`), (snap) => {
    if (snap.exists()) {
      const data = snap.val();
      const el = document.getElementById('parCount') || document.getElementById('paragrafValue');
      if (el && data.paragrafy !== undefined) el.textContent = data.paragrafy;
      updateStreakUI(data.loginStreak || 0);
    }
  });

  // Feed button
  const feedBtn = document.getElementById('feedAvatarBtn');
  if (feedBtn) {
    feedBtn.addEventListener('click', feedAvatar);
  }

  console.log('🐾 Avatar systém inicializovaný');
}

// Exporty pre globálne použitie
window.feedAvatar = feedAvatar;
window.canPlayDuel = canPlayDuel;
window.awardParagrafy = awardParagrafy;
window.deductEnergy = deductEnergy;
window.selectAvatar = selectAvatar;
window.initAvatarSystem = initAvatarSystem;
