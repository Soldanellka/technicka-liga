'use strict';

import { $, escapeHtml } from './core.js';
import { isValidPin, isValidNick, isPinHashingAvailable, setPin, getPinStatus, claimNick }
from './scripts/pinAuth.js';
import { showRewardToast } from './ui.js';
import { renderAreas, updateNickUI, fillModulesPanel,
         modulesForArea, openModuleItem, biflovackaSlugForArea } from './app.js';
import { renderHeaderAvatar } from './avatars.js';
import { loadReports, openReportModal, makeQuestionKey, initSealCache } from './reports.js';
import { loadAnsweredCases } from './cases.js';
import { applyTheme } from './theme.js';
import { nextQ, prevQ } from './quiz.js';
import { initDuelLeaderboard } from './scripts/leaderboard.js';
import { watchDuelBankBadge, announceOwnDuelResults } from './scripts/duels.js';
import { initAvatarSystem, selectAvatar, getTalarShopEntries, buyTalar, getBaseIdFor } from './scripts/avatar.js';
import { scrollToTarget, uncollapseSection } from './mobile-nav.js';
import { SEALS } from './scripts/seals.js';
import {
  econSettleLeaderboards, econVideoReward, econIsVideoClaimed, econCanPlay, ECONOMY_CONFIG,
  econAdStatus, econAdComplete, econRedeemCode
} from './scripts/economy.js';
import { MEMORY_AREAS } from './memoryDefinitions.js';
import {
  createSenat, joinSenat, getMojeSenaty, getSenat, buildInviteMessage, getInviteLink,
  renameSenat, kickMember, leaveSenat, disbandSenat,
  getSporyForSenat, challengeSenat, startSenatSporPlay, settlePendingSenatSpory,
  getSenatLeaderboard, settleSenatLeaderboards
} from './scripts/senaty.js';
import {
  getFacultyList, getPlayerFaculty, setPlayerFaculty,
  getFacultyLeaderboard, settleFacultyLeaderboard, getFacultyBadgeInfo, getFacultyBadge
} from './scripts/faculties.js';
import {
  createGroup, getMyGarantGroups, getMyMemberGroups, getGroup,
  renameGroup, deleteGroup, joinGroupByCode, leaveGroup
} from './scripts/groups.js';
import {
  createAssignment, deleteAssignment, getAssignment,
  getAssignmentsForGroup, getAssignmentsForGroupIds,
  listOkruhy, listAreaTitles, assignmentStatus, getMyResult,
  submitAssignment, getAssignmentResults
} from './scripts/assignments.js';

/* =====================================================
   ČAKANIE NA DATA.JS + AREAS.JS + CATALOG
   ===================================================== */
function waitForAllData(callback) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    const areasReady =
      typeof window.areas !== 'undefined' &&
      Object.keys(window.areas).length > 0;
    const catalogReady =
      typeof window.catalog !== 'undefined' &&
      Object.keys(window.catalog).length > 0;
    const externalReady =
      typeof window.catalog !== 'undefined' &&
      typeof window.catalog.openExternal === 'function';

    if (areasReady && catalogReady && externalReady) {
      clearInterval(timer);
      console.log("🔥 ALL DATA READY → spúšťam INIT");
      callback();
    }
    if (attempts > 80) {
      clearInterval(timer);
      console.error("❌ Nepodarilo sa načítať areas alebo catalog.");
    }
  }, 100);
}

/* =====================================================
   MODAL VÝBERU AVATARA
   ===================================================== */
async function openAvatarSelectModal() {
  const existing = document.getElementById('avatarSelectModal');
  if (existing) {
    existing.style.display = 'flex';
    initFaculty();
    initGroupsProfile();
    return;
  }

  const nick = localStorage.getItem('playerNick');
  const db = window.db;

  // Načítaj stav hráča pre kontrolu odomknutia
  let totalEarned = 0;
  let acceptedReports = 0;
  let loginStreak = 0;
  if (db && nick) {
    try {
      const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const snap = await get(ref(db, `users/${nick}`));
      if (snap.exists()) {
        const d = snap.val();
        // Fallback: ak totalParagraphsEarned neexistuje, použi aktuálny zostatok
        totalEarned = d.totalParagraphsEarned || d.paragrafy || 0;
        acceptedReports = d.acceptedReports || 0;
        loginStreak = d.loginStreak || 0;
      }
    } catch(e) {}
  }

  /* Základná sada = tých istých 6 ilustrovaných postáv ako v pickeri
     (BASIC_AVATARS nižšie, unlock:'default' v AVATAR_CONFIG.AVATARS).
     Predtým tu boli len dve emoji dlaždice s legacy id 'student-f' /
     'student-m' (staré vložené SVG) – hráč tak v prvom výbere nikdy
     nevidel skutočnú grafiku appky. Obidva modály zapisujú cez tú istú
     selectAvatar(), takže id sú z jedného priestoru (kľúče
     AVATAR_CONFIG.AVATARS) a presun je bezpečný.
     'student-f'/'student-m' sa ZÁMERNE NEMAŽÚ z AVATAR_CONFIG – hráči,
     ktorí ich majú uložené vo Firebase, sa naďalej vykreslia; len sa už
     nedajú novo zvoliť. */
  const BASIC_TILES = [
    { id: 'studentka-tmava',  name: 'Študentka<br>tmavé vlasy',  base: 'avatars/studentka-tmava',  locked: false },
    { id: 'studentka-medena', name: 'Študentka<br>medené vlasy', base: 'avatars/studentka-medena', locked: false },
    { id: 'studentka-blond',  name: 'Študentka<br>blond vlasy',  base: 'avatars/studentka-blond',  locked: false },
    { id: 'student-tmavy',    name: 'Študent<br>tmavé vlasy',    base: 'avatars/student-tmavy',    locked: false },
    { id: 'student-medeny',   name: 'Študent<br>medené vlasy',   base: 'avatars/student-medeny',   locked: false },
    { id: 'student-blond',    name: 'Študent<br>blond vlasy',    base: 'avatars/student-blond',    locked: false },
  ];

  const UNLOCK_TILES = [
    { id: 'cat',       name: 'Sporivá mačka', emoji: '🐱', base: 'avatars/macka', desc: `Za 3000🪙 celkovo (máš ${totalEarned}🪙)`, locked: totalEarned < 3000 },
    { id: 'owl',       name: 'Sova múdrosti',   emoji: '🦉', base: 'avatars/sova',  desc: `Za 100 nahlásení (máš ${acceptedReports})`, locked: acceptedReports < 100 },
    { id: 'dog',       name: 'Pes vernosti',    emoji: '🐶', base: 'avatars/pes',   desc: `Za 30 dní streaku (máš ${loginStreak})`, locked: loginStreak < 30 },
    /* Prestige rad má v ekonomike v1 štyri cenové tiery (SINKS.PRESTIGE_AVATARS
       = 300/600/1000/2000§). Grafika zatiaľ neexistuje ani pre prvý tier, takže
       dlaždica ostáva jedna a „čoskoro“; rozpätie sa berie z configu, nech sa
       popis nerozíde s cenami. */
    { id: 'prestige',  name: 'Prestige avatary',  emoji: '✨',   desc: `Čoskoro – ${ECONOMY_CONFIG.SINKS.PRESTIGE_AVATARS[0]}–${ECONOMY_CONFIG.SINKS.PRESTIGE_AVATARS[ECONOMY_CONFIG.SINKS.PRESTIGE_AVATARS.length - 1]}🪙`, locked: true, comingSoon: true },
  ];

  // Spoločný zoznam pre klik handler (comingSoon check) – renderujú sa v dvoch mriežkach.
  const AVATARS = [...BASIC_TILES, ...UNLOCK_TILES];

  const modal = document.createElement('div');
  modal.id = 'avatarSelectModal';
  modal.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.5);
    display:flex; align-items:center; justify-content:center;
    z-index:9999;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    background:var(--surface,#fff); border-radius:20px;
    padding:28px; max-width:400px; width:90%;
    max-height:90vh; overflow-y:auto;
    box-shadow:0 20px 60px rgba(0,0,0,0.25);
  `;

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <h3 style="margin:0;font-size:18px">Vyber avatar</h3>
        <div class="small" style="color:var(--muted)">Klikni na avatar ktorý chceš používať</div>
      </div>
      <button id="closeAvatarSelectModal" class="btn" style="padding:6px 12px">✕</button>
    </div>
    <!-- Základná sada: 3 stĺpce (6 variantov dvoch postáv, menšie dlaždice
         bez popisu – "Dostupné pre všetkých" 6× by bol len šum). -->
    <div style="font-weight:600;font-size:12px;color:var(--muted);margin-bottom:8px">Základná sada</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${BASIC_TILES.map(av => `
        <div class="avatar-select-card" data-id="${av.id}" style="
          border:2px solid var(--border,#eee); border-radius:14px;
          padding:10px 6px; text-align:center; cursor:pointer;
          transition:all .2s; position:relative;
        ">
          <img src="${av.base}-full-bust.png" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:50%;margin-bottom:6px" />
          <div style="font-weight:600;font-size:11px;line-height:1.25">${av.name}</div>
        </div>
      `).join('')}
    </div>
    <div style="font-weight:600;font-size:12px;color:var(--muted);margin:16px 0 8px">Odomykateľné</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${UNLOCK_TILES.map(av => `
        <div class="avatar-select-card" data-id="${av.id}" style="
          border:2px solid ${av.locked ? 'var(--border,#eee)' : 'var(--border,#eee)'}; border-radius:14px;
          padding:16px; text-align:center; cursor:pointer;
          transition:all .2s; opacity:${av.locked ? '0.55' : '1'};
          position:relative;
        ">
          ${av.locked ? '<div style="position:absolute;top:8px;right:8px;font-size:14px">🔒</div>' : ''}
          ${av.base
            ? `<img src="${av.base}-full-bust.png" alt="${av.name}" style="width:56px;height:56px;object-fit:cover;border-radius:50%;margin-bottom:8px" />`
            : `<div style="font-size:42px;margin-bottom:8px">${av.emoji}</div>`
          }
          <div style="font-weight:600;font-size:13px">${av.name}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${av.desc}</div>
        </div>
      `).join('')}
    </div>
    <!-- Vstup do pickera. Základná sada je už hore v tomto modáli, takže
         picker tu ostáva JEDINE kvôli talár shopu – a je jeho jediným
         živým vstupom (#changeAvatarBtn v markupe nie je, viď init.js
         nižšie), preto tlačidlo nesmie zmiznúť; len sa premenovalo z
         "🎨 Zmeniť vzhľad" na taláre, aby nevyzeralo ako duplicita
         výberu postavy. -->
    <div style="margin-top:16px">
      <button id="openAvatarPickerFromSelect" class="btn" style="width:100%">🎭 Plášte a doplnky</button>
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border,#eee)">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px">🏛️ Tvoja škola</div>
      <div style="display:flex;gap:8px">
        <select id="facultySelect" class="form-input" style="flex:1"></select>
        <button id="saveFacultyBtn" class="btn">Uložiť</button>
      </div>
      <div class="small muted" id="facultyStatusLine" style="margin-top:4px"></div>
      <div id="facultyLeaderboardBox" class="small muted" style="margin-top:6px"></div>
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border,#eee)">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px">👥 Moje skupiny</div>
      <div style="display:flex;gap:8px">
        <input id="joinGroupCodeInput" class="form-input" type="text" maxlength="6"
          placeholder="Pripojovací kód (napr. AB12CD)" style="flex:1;text-transform:uppercase"/>
        <button id="joinGroupBtn" class="btn">Pripojiť sa</button>
      </div>
      <div class="small muted" id="joinGroupStatusLine" style="margin-top:4px"></div>
      <div id="myGroupsList" class="small muted" style="margin-top:8px">Načítavam…</div>
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border,#eee)">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px">📝 Moje testy</div>
      <div id="myAssignmentsList" class="small muted">Načítavam…</div>
    </div>
  `;

  modal.appendChild(panel);
  document.body.appendChild(modal);

  // Zatvorenie
  document.getElementById('closeAvatarSelectModal').onclick = () => {
    modal.style.display = 'none';
  };
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };

  /* "Taláre a doplnky" – nahrádza pôvodnú paletu 🎨 z lišty. Otvára ten istý
     openAvatarPickerModal(false) ako predtým; picker si rieši vlastný
     modal navrchu, preto sa tento zámerne NEZATVÁRA (rovnaké správanie
     ako pri pôvodnej ikone, kde profilový modal ostával otvorený pod ňou). */
  const pickerBtn = document.getElementById('openAvatarPickerFromSelect');
  if (pickerBtn) pickerBtn.onclick = () => openAvatarPickerModal(false);

  // Výber avatara
  panel.querySelectorAll('.avatar-select-card').forEach(card => {
    card.onmouseenter = () => {
      card.style.borderColor = 'var(--accent-3,#17806f)';
      card.style.transform = 'scale(1.04)';
    };
    card.onmouseleave = () => {
      card.style.borderColor = 'var(--border,#eee)';
      card.style.transform = 'scale(1)';
    };
    card.onclick = async () => {
      const avatarId = card.dataset.id;
      const avatarDef = AVATARS.find(av => av.id === avatarId);
      if (avatarDef && avatarDef.comingSoon) {
        showRewardToast('✨ Prestige avatary čoskoro!');
        return;
      }
      await selectAvatar(avatarId);
      modal.style.display = 'none';
    };
  });

  initFaculty();
  initGroupsProfile();
}

/* =====================================================
   ZÁKLADNÁ SADA AVATAROV – prvý výber / zmena
   6 zadarmo dostupných postáv (2 postavy × 3 farby vlasov),
   3 stavy energie riešené v scripts/avatar.js (avatarSrc()).
   Táto mriežka vždy zobrazuje -full.png náhľady na výber.
   ===================================================== */
const BASIC_AVATARS = [
  { id: 'studentka-tmava',  name: 'Študentka (tmavé vlasy)' },
  { id: 'studentka-medena', name: 'Študentka (medené vlasy)' },
  { id: 'studentka-blond',  name: 'Študentka (blond vlasy)' },
  { id: 'student-tmavy',    name: 'Študent (tmavé vlasy)' },
  { id: 'student-medeny',   name: 'Študent (medené vlasy)' },
  { id: 'student-blond',    name: 'Študent (blond vlasy)' }
];

function openAvatarPickerModal(mandatory = false) {
  let modal = document.getElementById('avatarPickerModal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'avatarPickerModal';
    modal.className = 'avatar-modal';
    modal.innerHTML = `
      <div class="avatar-panel" style="max-width:460px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0">🎨 Vyber si svojho avatara</h3>
          <button class="btn" id="closeAvatarPickerModal">✕</button>
        </div>
        <div class="small muted" style="margin-bottom:14px">Zadarmo, kedykoľvek zmeníš neskôr.</div>
        <div id="avatarPickerGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
          ${BASIC_AVATARS.map(av => `
            <div class="avatar-picker-card" data-id="${av.id}" style="cursor:pointer;border:2px solid var(--card-border,#eee);border-radius:12px;padding:8px;text-align:center;transition:border-color .15s ease">
              <img src="avatars/${av.id}-full.png" alt="${av.name}" style="width:100%;aspect-ratio:600/800;object-fit:contain;border-radius:8px"
                onerror="this.replaceWith(Object.assign(document.createElement('div'), {textContent:'🧑‍🎓', style:'font-size:48px;line-height:1.4'}))" />
              <div class="small" style="margin-top:6px;font-weight:600">${av.name}</div>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-primary" id="avatarPickerConfirmBtn" style="width:100%;margin-bottom:16px" disabled>Potvrdiť</button>

        <div style="border-top:1px solid var(--card-border,#eee);padding-top:14px">
          <div style="font-weight:600;margin-bottom:4px">🎽 Plášte</div>
          <div class="small muted" style="margin-bottom:10px">Čisto kozmetické – žiadny herný bonus. Kúpené ostávajú natrvalo.</div>
          <div id="talarShopGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
            <div class="small muted">Načítavam…</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    let selected = null;
    const grid = modal.querySelector('#avatarPickerGrid');
    const confirmBtn = modal.querySelector('#avatarPickerConfirmBtn');

    grid.querySelectorAll('.avatar-picker-card').forEach(card => {
      card.onclick = () => {
        grid.querySelectorAll('.avatar-picker-card').forEach(c => c.style.borderColor = 'var(--card-border, #eee)');
        card.style.borderColor = '#17806f';
        selected = card.dataset.id;
        confirmBtn.disabled = false;
        renderTalarShop(selected);
      };
    });

    confirmBtn.onclick = async () => {
      if (!selected) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Ukladám...';
      await selectAvatar(selected);
      modal.style.display = 'none';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Potvrdiť';
    };

    modal.querySelector('#closeAvatarPickerModal').onclick = () => {
      if (modal.dataset.mandatory === '1') return; // prvé prihlásenie – nedá sa preskočiť
      modal.style.display = 'none';
    };
    modal.onclick = (e) => {
      if (e.target === modal && modal.dataset.mandatory !== '1') modal.style.display = 'none';
    };
  }

  modal.dataset.mandatory = mandatory ? '1' : '0';
  const closeBtn = modal.querySelector('#closeAvatarPickerModal');
  if (closeBtn) closeBtn.style.display = mandatory ? 'none' : 'inline-flex';

  modal.style.display = 'flex';
  renderTalarShop(getBaseIdFor(window.__currentAvatarType || 'studentka-tmava'));
}

/* Vykreslí taláre patriace k danému základnému avataru (+ akademický,
   ak naň má hráč rolu) – jedno čítanie vlastníctva na render, nie na
   položku. Kúpa aj nasadenie idú cez existujúci selectAvatar()/buyTalar()
   v scripts/avatar.js – žiadny paralelný mechanizmus. */
async function renderTalarShop(baseId) {
  const grid = document.getElementById('talarShopGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="small muted">Načítavam…</div>';

  const entries = await getTalarShopEntries(baseId);
  if (!entries.length) {
    grid.innerHTML = '<div class="small muted">Pre tohto avatara zatiaľ nie sú dostupné žiadne plášte.</div>';
    return;
  }

  grid.innerHTML = entries.map(e => `
    <div class="talar-shop-card ${e.academic ? 'talar-academic' : ''}" data-id="${e.id}" style="
      border:2px solid ${e.academic ? '#d4af37' : 'var(--card-border,#eee)'}; border-radius:12px; padding:8px; text-align:center;
    ">
      <img class="talar-shop-img" data-fallback="${e.fallbackBase ? `${e.fallbackBase}-full.png` : ''}"
        src="${e.base}-full.png" alt="${escapeHtml(e.name)}" style="width:100%;aspect-ratio:600/800;object-fit:contain;border-radius:8px"/>
      <div class="small" style="margin-top:4px;font-weight:600">${escapeHtml(e.name)}</div>
      ${e.academic
        ? `<div class="small" style="color:#b8860b;font-weight:600">🎓 automaticky (garant/admin)</div>`
        : e.owned
          ? `<button class="btn talar-equip-btn" data-id="${e.id}" style="width:100%;margin-top:6px">Nasadiť</button>`
          : `<button class="btn btn-primary talar-buy-btn" data-id="${e.id}" style="width:100%;margin-top:6px">Kúpiť za ${e.price}🪙</button>`
      }
    </div>
  `).join('');

  // Vlastný obrázok najprv; ak 404 (grafika ešte nedodaná), skús požičaný
  // (data-fallback), a ak zlyhá aj ten, kartu skry (nikdy nenechaj rozbitú ikonu).
  grid.querySelectorAll('.talar-shop-img').forEach(img => {
    img.onerror = () => {
      if (img.dataset.fallback && !img.dataset.triedFallback) {
        img.dataset.triedFallback = '1';
        img.src = img.dataset.fallback;
      } else {
        img.style.display = 'none';
      }
    };
  });

  grid.querySelectorAll('.talar-equip-btn').forEach(btn => {
    btn.onclick = async () => {
      await selectAvatar(btn.dataset.id);
      const modal = document.getElementById('avatarPickerModal');
      if (modal) modal.style.display = 'none';
    };
  });

  grid.querySelectorAll('.talar-buy-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Kupujem...';
      const result = await buyTalar(btn.dataset.id);
      if (!result.ok) {
        showRewardToast(`❌ ${result.message}`);
        btn.disabled = false;
        renderTalarShop(baseId);
        return;
      }
      showRewardToast(`✅ Plášť kúpený za ${result.price}🪙!`);
      renderTalarShop(baseId);
    };
  });
}
window.openAvatarPickerModal = openAvatarPickerModal;

/* =====================================================
   HLAVNÁ INIT FUNKCIA
   ===================================================== */
export function init() {
  waitForAllData(() => {
    /* 🔹 Paragrafy – zostatok § sa už NEseeduje z localStorage. Hodnotu do
       #parCount doplní Firebase cesta (scripts/avatar.js po načítaní hráča). */

    /* 🔹 Získaj § – tlačidlo viditeľné len prihlásenému hráčovi */
    /* § badge je zároveň vstup do okna „Získaj §“ (samostatné tlačidlo
       #earnBtn zaniklo). Bez nicku sa nedá nikam pripísať, preto je vtedy
       vypnutý – rovnaké pravidlo, aké malo predtým tlačidlo. */
    const parBadge = $('parBadge');
    const initNick = localStorage.getItem('playerNick');
    if (parBadge) {
      parBadge.disabled = !initNick;
      parBadge.title = initNick
        ? 'Tvoje mince – klikni pre získanie ďalších'
        : 'Tvoje mince (najprv si zadaj nick)';
    }

    /* 🔹 Počet otvorení aplikácie za deň – agregovane, bez akéhokoľvek
       identifikátora v zariadení. Zámerne NIE JE pod if (initNick):
       počíta sa otvorenie, nie hráč, takže beží aj pre anonyma. */
    import('./scripts/visits.js')
      .then(({ zapocitajOtvorenie }) => zapocitajOtvorenie())
      .catch(e => console.warn('⚠️ visits: import zlyhal', e));

    /* 🔹 Dátum vzniku prezývky a poslednej aktivity – beží na pozadí,
       nič neblokuje. Píše sa VÝHRADNE pod zvolenú prezývku
       (viď scripts/playerDates.js). */
    if (initNick) {
      import('./scripts/playerDates.js')
        .then(({ touchPlayerDates }) => touchPlayerDates(initNick))
        .catch(e => console.warn('⚠️ playerDates: import zlyhal', e));
    }

    /* 🔹 Téma */
    applyTheme(localStorage.getItem('theme') || 'light');

    /* 🔹 UI */
    renderHeaderAvatar();
    renderAreas();
    /* renderModules() sa pri starte NEvolá – moduly sú po novom pod
       dlaždicou 🏦 Pokladňa vedomostí a plnia sa až pri jej otvorení,
       vždy pre práve vybranú oblasť. */

    /* 🔹 Reporty a prípady */
    loadReports();
    loadAnsweredCases('TPH-A1');

    /* 🔹 Rebríček pojednávaní + senátov (prepínač) */
    initDuelLeaderboard();
    setupLeaderboardModeToggle();

    /* 🔹 Rola systém */
    initRoleSystem();

    /* 🔹 Garančná pečať */
    initGuarantorSeal();

    /* 🔹 Udalosti */
    attachEvents();

    /* 🔹 Pulzujúci odznak na "Uložené výzvy" */
    watchDuelBankBadge();

    /* 🔹 Výzva na duel cez zdieľateľný link (?duel=ID) */
    checkDuelChallengeLink();

    /* 🔹 Výsledky vlastných odoslaných výziev – tvorca dohral skôr, než
       výzvu niekto prijal, takže sa víťaza dozvie až tu. */
    announceOwnDuelResults();

    /* 🔹 Nahlásenie z inej stránky (Bifľovačka, ob-pravo-app) cez ?report=1&area=&src=&qtext= */
    checkReportLink();

    /* 🔹 Senáty – skupinová súťaž */
    initSenaty();
    checkSenatInviteLink();

    /* 🔹 Fakulty – tretia úroveň súťaže (výber žije v avatar/profil paneli,
       tu len lazy vyhodnotenie mesačného rebríčka + krátky odznak pri nicku) */
    settleFacultyLeaderboard();
    updateFacultyBadge();

    /* 🔹 Avatar systém */
    initAvatarSystem();

    /* 🔹 Pečate na otázkach – jedno načítanie reports/ (bez N čítaní per otázka) */
    initSealCache();

    /* 🔹 Lazy vyhodnotenie týždenného/mesačného rebríčka (bez servera/cronu) */
    econSettleLeaderboards();

    /* 🔹 Video systém */
    initVideoSystem();

    /* 🔹 Feedback systém */
    initFeedbackSystem();
    renderPublishedFeedback();
  });
}

/* =====================================================
   💬 FEEDBACK SYSTÉM
   ===================================================== */
function initFeedbackSystem() {
  const textarea = document.getElementById('feedbackText');
  const charCount = document.getElementById('feedbackCharCount');
  const sendBtn = document.getElementById('sendFeedbackBtn');
  const form = document.getElementById('feedbackForm');
  const success = document.getElementById('feedbackSuccess');
  const againBtn = document.getElementById('feedbackAgainBtn');
  const typeBtns = document.querySelectorAll('.feedback-type-btn');

  if (!textarea) return;

  let selectedType = 'napad';

  // Výber typu
  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
    });
  });

  // Počítadlo znakov
  textarea.addEventListener('input', () => {
    charCount.textContent = `${textarea.value.length} / 500`;
  });

  // Odoslanie
  sendBtn && sendBtn.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) {
      textarea.focus();
      textarea.style.borderColor = 'var(--accent-3)';
      setTimeout(() => textarea.style.borderColor = '', 1500);
      return;
    }

    const db = window.db;
    const nick = localStorage.getItem('playerNick') || 'Anonymous';

    sendBtn.disabled = true;
    sendBtn.textContent = 'Odosielam...';

    try {
      if (!db) throw new Error('Firebase nie je pripojená');
      const { ref, push } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
      );
      await push(ref(db, 'feedback'), {
        nick,
        type: selectedType,
        text,
        createdAt: Date.now(),
        status: 'pending',
        read: false
      });
      console.log('✅ Feedback odoslaný do Firebase');

      // Zobraz úspech
      form.style.display = 'none';
      success.style.display = 'block';
      textarea.value = '';
      charCount.textContent = '0 / 500';

    } catch (e) {
      console.error('Feedback chyba:', e);
      sendBtn.textContent = 'Chyba – skús znova';
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Odoslať';
    }
  });

  // Ďalšia pripomienka
  againBtn && againBtn.addEventListener('click', () => {
    success.style.display = 'none';
    form.style.display = 'block';
    // Reset na prvý typ
    typeBtns.forEach(b => b.classList.remove('active'));
    typeBtns[0] && typeBtns[0].classList.add('active');
    selectedType = 'napad';
  });
}

/* =====================================================
   💰 ZÍSKAJ § – reklamy (placeholder videami) + promo kódy
   ===================================================== */
async function openEarnModal() {
  let modal = document.getElementById('earnModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'earnModal';
    modal.className = 'avatar-modal';
    modal.innerHTML = `
      <div class="avatar-panel" style="max-width:440px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0">💰 Získaj 🪙</h3>
          <button class="btn" id="closeEarnModal">✕</button>
        </div>

        <div class="earn-card" id="earnAdCard" style="border:1px solid var(--card-border,#eee);border-radius:14px;padding:16px;margin-bottom:12px">
          <div style="font-weight:700;margin-bottom:4px">📺 Pozri reklamu</div>
          <div class="small muted" style="margin-bottom:10px">Pozri si krátke video a získaj +${ECONOMY_CONFIG.ADS.REWARD}🪙</div>
          <div class="small" id="earnAdStatus" style="margin-bottom:10px"></div>
          <button class="btn btn-primary" id="earnAdPlayBtn" style="width:100%">▶️ Prehrať</button>
        </div>

        <div class="earn-card" id="earnCodeCard" style="border:1px solid var(--card-border,#eee);border-radius:14px;padding:16px">
          <div style="font-weight:700;margin-bottom:4px">🎟️ Zadaj kód</div>
          <div class="small muted" style="margin-bottom:10px">Promo kód od influencera alebo z akcie</div>
          <div style="display:flex;gap:8px">
            <input id="earnCodeInput" class="form-input" type="text" placeholder="napr. FINANČNÁ LIGA25" maxlength="30" style="text-transform:uppercase">
            <button class="btn btn-primary" id="earnCodeSubmitBtn">Uplatniť</button>
          </div>
          <div class="small" id="earnCodeResult" style="margin-top:8px"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#closeEarnModal').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    modal.querySelector('#earnAdPlayBtn').onclick = async () => {
      const status = await econAdStatus();
      if (!status.enabled || status.remaining <= 0) {
        await refreshEarnAdCard();
        return;
      }
      modal.style.display = 'none';
      window.openAdVideoModal();
    };

    modal.querySelector('#earnCodeSubmitBtn').onclick = async () => {
      const input = modal.querySelector('#earnCodeInput');
      const resultEl = modal.querySelector('#earnCodeResult');
      const code = input.value.trim().toUpperCase();
      if (!code) return;

      const btn = modal.querySelector('#earnCodeSubmitBtn');
      btn.disabled = true;
      const res = await econRedeemCode(code);
      btn.disabled = false;

      resultEl.textContent = res.message;
      resultEl.style.color = res.ok ? '#16a34a' : '#dc2626';
      if (res.ok) input.value = '';
    };

    modal.querySelector('#earnCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') modal.querySelector('#earnCodeSubmitBtn').click();
    });
  }

  modal.querySelector('#earnCodeResult').textContent = '';
  modal.querySelector('#earnCodeInput').value = '';
  await refreshEarnAdCard();
  modal.style.display = 'flex';
}

async function refreshEarnAdCard() {
  const modal = document.getElementById('earnModal');
  if (!modal) return;

  const status = await econAdStatus();
  const statusEl = modal.querySelector('#earnAdStatus');
  const btn = modal.querySelector('#earnAdPlayBtn');
  if (!statusEl || !btn) return;

  if (!status.enabled) {
    statusEl.textContent = 'Reklamy zatiaľ nie sú dostupné.';
    btn.disabled = true;
    btn.textContent = '▶️ Prehrať';
    return;
  }

  statusEl.textContent = `Dnes ešte ${status.remaining}/${ECONOMY_CONFIG.ADS.DAILY_MAX}`;
  if (status.remaining <= 0) {
    btn.disabled = true;
    btn.textContent = 'Dnešný limit vyčerpaný, vráť sa zajtra ✅';
  } else {
    btn.disabled = false;
    btn.textContent = '▶️ Prehrať';
  }
}

/* =====================================================
   📖 NÁVOD „Ako funguje LexArena"
   ===================================================== */
const LEX_GUIDE_SEEN_KEY = 'lexGuideSeen';

/* Doplní § sumy do #guideModal z ECONOMY_CONFIG (jediný zdroj pravdy), aby sa
   čísla v návode nemuseli udržiavať ručne a nikdy sa nerozišli so správaním
   appky. Element nesie cestu v atribúte data-econ (napr. "REWARDS.DUEL_WIN",
   "STREAK.BASE.0", "STATNICE.EXAM_REWARD.1"); cesta sa rozloží po bodkách aj
   cez polia/číselné kľúče. Neznáma cesta → console.warn + pomlčka (NIE 0, aby
   sa hráčovi neukázala nepravdivá nula). Beží pri každom otvorení návodu. */
function fillEconomyValues(root) {
  if (!root) return;
  root.querySelectorAll('[data-econ]').forEach(el => {
    const path = el.getAttribute('data-econ');
    const val = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ECONOMY_CONFIG);
    if (typeof val === 'number') {
      /* Znamienko je AUTORSKÉ v HTML (+/− pred spanom), z configu berieme len
         veľkosť. Platí rovnako pre § aj pre energiu, ktorá má v ENERGY.*
         záporné hodnoty – inak by sa vypísalo ASCII "-" namiesto typografického
         "−" použitého v tabuľke. Jedno pravidlo pre všetky data-econ miesta. */
      el.textContent = String(Math.abs(val));
    } else {
      console.warn(`data-econ: neznáma cesta "${path}" – ponechávam pomlčku`);
      el.textContent = '—';
    }
  });
}

/* Návod – beží pri každom otvorení. */
function fillGuideEconomyValues() {
  fillEconomyValues($('guideModal'));
}

/* Statické miesta MIMO návodu – celá herná sekcia (dlaždica Štátnice aj
   vysvetľujúci odstavec pod mriežkou). Raz po načítaní DOM, rovnaký zdroj
   pravdy, žiadna § suma v HTML natvrdo. */
function fillStaticEconomyValues() {
  fillEconomyValues($('gamesSection'));
  /* Nočný výcuc – cena odomknutia na statickej karte (mimo #gamesSection,
     preto samostatné volanie; viď komentár pri fillEconomyValues). */
  fillEconomyValues($('nightRecapCard'));
}

/* To isté pre prahy pečatí (data-seal="bronze.min"), len zo scripts/seals.js
   namiesto ECONOMY_CONFIG – pečate nie sú § ani energia, majú vlastný zdroj.
   Oddelená funkcia, nie ďalšia vetva vo fillEconomyValues(), aby bolo
   z volajúceho aj z warningu vidieť, ktorý config zlyhal. */
function fillGuideSealValues() {
  const modal = $('guideModal');
  if (!modal) return;
  modal.querySelectorAll('[data-seal]').forEach(el => {
    const path = el.getAttribute('data-seal');
    const val = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), SEALS);
    if (typeof val === 'number') {
      el.textContent = String(val);
    } else {
      console.warn(`guideModal: neznáma data-seal cesta "${path}" – ponechávam pomlčku`);
      el.textContent = '—';
    }
  });
}

function openGuideModal() {
  const modal = $('guideModal');
  if (!modal) return;
  fillGuideEconomyValues();
  fillGuideSealValues();
  modal.style.display = 'flex';

  if (!localStorage.getItem(LEX_GUIDE_SEEN_KEY)) {
    localStorage.setItem(LEX_GUIDE_SEEN_KEY, '1');
    const dot = $('infoHintDot');
    if (dot) dot.style.display = 'none';
  }
}

function initGuideSystem() {
  const dot = $('infoHintDot');
  if (dot) dot.style.display = localStorage.getItem(LEX_GUIDE_SEEN_KEY) ? 'none' : '';

  const infoBtn = $('infoBtn');
  if (infoBtn) infoBtn.addEventListener('click', openGuideModal);

  const closeBtn = $('closeGuide');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const modal = $('guideModal');
      if (modal) modal.style.display = 'none';
    });
  }

  const modal = $('guideModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  const guideLink = $('openGuideLink');
  if (guideLink) {
    guideLink.addEventListener('click', (e) => {
      e.preventDefault();
      openGuideModal();
    });
  }
}

/* =====================================================
   👋 UVÍTACIE OKNO – nový návštevník
   Vlastný flag lexWelcomeSeen (LEX_WELCOME_SEEN_KEY), oddelený od
   LEX_GUIDE_SEEN_KEY vyššie – rôzne okná, rôzne správanie (toto sa pri
   prvej návšteve otvorí AUTOMATICKY, návod nikdy). Čisto informačné,
   nezasahuje do registrácie/identity – jediný vstup je klik na tlačidlo.
   ===================================================== */
const LEX_WELCOME_SEEN_KEY = 'lexWelcomeSeen';

function openWelcomeModal() {
  const modal = $('welcomeModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const dot = $('welcomeHintDot');
  if (dot) dot.style.display = 'none';
}

function closeWelcomeModal() {
  const modal = $('welcomeModal');
  if (modal) modal.style.display = 'none';
}

function initWelcomeSystem() {
  const dot = $('welcomeHintDot');
  if (dot) dot.style.display = localStorage.getItem(LEX_WELCOME_SEEN_KEY) ? 'none' : '';

  /* Ikona 👋 v lište zanikla (zlúčená s ℹ️ do jedného vstupu „Pomoc“),
     uvítacie okno sa teraz otvára z návodu. Väzba na #welcomeBtn ostáva
     ako poistka, keby sa ikona niekedy vrátila. */
  const welcomeBtn = $('welcomeBtn');
  if (welcomeBtn) welcomeBtn.addEventListener('click', openWelcomeModal);

  const welcomeFromGuide = $('openWelcomeFromGuide');
  if (welcomeFromGuide) {
    welcomeFromGuide.addEventListener('click', () => {
      const guide = $('guideModal');
      if (guide) guide.style.display = 'none';
      openWelcomeModal();
    });
  }

  /* "Rozumiem" – JEDINÉ miesto, ktoré nastavuje flag (na rozdiel od
     zavretia cez pozadie/"Otvoriť nástenku" nižšie, ktoré okno len
     zavrú bez potvrdenia – nabudúce sa preto uvítacie okno zobrazí znova). */
  const understoodBtn = $('welcomeUnderstoodBtn');
  if (understoodBtn) {
    understoodBtn.addEventListener('click', () => {
      localStorage.setItem(LEX_WELCOME_SEEN_KEY, '1');
      closeWelcomeModal();
      /* CTA je „Začni hrať“, tak nováčika aj naozaj pošli k výberu oblasti –
         odtiaľ vedie všetko ostatné. Rovnaké zvýraznenie ako pri štátnici. */
      const picker = $('areasInQuiz');
      if (picker) {
        picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
        picker.classList.add('duel-highlight');
        setTimeout(() => picker.classList.remove('duel-highlight'), 2000);
      }
    });
  }

  /* "Otvoriť nástenku" – znovupoužije scrollToTarget/uncollapseSection
     z mobile-nav.js (žiadna vlastná kópia scroll/rozbaľovacej logiky). */
  const noticeboardBtn = $('welcomeNoticeboardBtn');
  if (noticeboardBtn) {
    noticeboardBtn.addEventListener('click', () => {
      uncollapseSection('noticeboard');
      scrollToTarget('publishedFeedbackBox');
      closeWelcomeModal();
    });
  }

  const modal = $('welcomeModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeWelcomeModal();
    });
  }

  // Automaticky LEN pri prvej návšteve (flag ešte neexistuje).
  if (!localStorage.getItem(LEX_WELCOME_SEEN_KEY)) {
    openWelcomeModal();
  }
}

/* =====================================================
   📺 VIDEO SYSTÉM
   ===================================================== */

// Konfigurácia videí — URL zmeň keď budeš mať skutočné videá
// Formát: YouTube embed URL alebo priamy MP4 link
const VIDEO_CONFIG = {
  v1: {
    title: 'Ako funguje Finančná liga?',
    url: 'https://www.youtube.com/embed/PHkX6DmuLic?autoplay=1&rel=0',
    duration: 30
  },
  v2: {
    title: 'Ako hrať súboj vo Finančnej lige?',
    url: 'https://www.youtube.com/embed/OjzYMtixyJ8?autoplay=1&rel=0',
    duration: 30
  },
  v3: {
    title: 'Ako nahlásiť chybu vo Finančnej lige',
    url: 'https://www.youtube.com/embed/AiutHAdqF4E?autoplay=1&rel=0',
    duration: 30
  }
};

let videoRewardTimer = null;
let currentVideoId = null;
let currentVideoMode = 'learning'; // 'learning' (náuková, +12§ raz na video) | 'ad' (reklama, +3§, 3×/deň)
let lastAdVideoId = null;

function pickRandomVideoId() {
  const ids = Object.keys(VIDEO_CONFIG);
  const pool = ids.length > 1 && lastAdVideoId ? ids.filter(id => id !== lastAdVideoId) : ids;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  lastAdVideoId = picked;
  return picked;
}

async function showVideoModal(videoId, mode) {
  const cfg = VIDEO_CONFIG[videoId];
  if (!cfg) return;

  currentVideoId = videoId;
  currentVideoMode = mode;

  const modal = document.getElementById('videoModal');
  const title = document.getElementById('videoModalTitle');
  const player = document.getElementById('videoPlayer');
  const claimBtn = document.getElementById('claimVideoRewardBtn');
  const alreadyClaimed = document.getElementById('videoAlreadyClaimed');
  const rewardInfo = document.getElementById('videoRewardInfo');

  if (!modal) return;

  title.textContent = cfg.title;
  player.src = cfg.url;

  if (videoRewardTimer) clearTimeout(videoRewardTimer);
  claimBtn.style.display = 'none';
  alreadyClaimed.style.display = 'none';

  if (mode === 'ad') {
    const reward = ECONOMY_CONFIG.ADS.REWARD;
    if (rewardInfo) rewardInfo.querySelector('span:last-child').textContent = `+${reward}🪙`;
    claimBtn.textContent = `🎉 Prevziať odmenu (+${reward}🪙)`;
    // Odmena sa pripíše až po 20 s prehrávania (econAdComplete overí denný limit transakčne)
    videoRewardTimer = setTimeout(() => {
      claimBtn.style.display = 'block';
      claimBtn.style.animation = 'duelBadgePop .4s ease';
    }, 20000);
  } else {
    const reward = ECONOMY_CONFIG.REWARDS.VIDEO;
    if (rewardInfo) rewardInfo.querySelector('span:last-child').textContent = `+${reward}🪙`;
    claimBtn.textContent = `🎉 Prevziať odmenu (+${reward}🪙)`;

    // Odmena je viazaná na nick vo Firebase (users/{nick}/videoRewards/{videoId}),
    // nie na toto zariadenie – funguje aj po zmazaní localStorage/inom prehliadači.
    const claimed = await econIsVideoClaimed(videoId);
    if (claimed) {
      claimBtn.style.display = 'none';
      alreadyClaimed.style.display = 'block';
    } else {
      videoRewardTimer = setTimeout(() => {
        claimBtn.style.display = 'block';
        claimBtn.style.animation = 'duelBadgePop .4s ease';
      }, 5000);
    }
  }

  modal.style.display = 'flex';
}

window.openVideo = function(videoId) {
  showVideoModal(videoId, 'learning');
};

// Reklama (placeholder existujúcimi náukovými videami) – náhodné video z
// VIDEO_CONFIG, nech sa neopakuje stále to isté. Odmena ide cez econAdComplete
// (ADS.REWARD × ADS.DAILY_MAX denne, obe v economyConfig.js – sem ich nepíš),
// nezávisle od jednorazovej náukovej odmeny REWARDS.VIDEO vyššie.
window.openAdVideoModal = function() {
  showVideoModal(pickRandomVideoId(), 'ad');
};

function initVideoSystem() {
  // Zatvoriť modal
  const closeBtn = document.getElementById('closeVideoModal');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const modal = document.getElementById('videoModal');
      const player = document.getElementById('videoPlayer');
      if (modal) modal.style.display = 'none';
      if (player) player.src = ''; // zastaví video – zavretie pred limitom = bez odmeny
      if (videoRewardTimer) clearTimeout(videoRewardTimer);
      currentVideoId = null;
    });
  }

  // Prevziať odmenu
  const claimBtn = document.getElementById('claimVideoRewardBtn');
  if (claimBtn) {
    claimBtn.addEventListener('click', async () => {
      if (!currentVideoId) return;

      if (currentVideoMode === 'ad') {
        const result = await econAdComplete();
        if (!result.success) return; // toast (limit vyčerpaný) zobrazil economy.js

        claimBtn.style.display = 'none';
        refreshEarnAdCard();

        setTimeout(() => {
          const modal = document.getElementById('videoModal');
          const player = document.getElementById('videoPlayer');
          if (modal) modal.style.display = 'none';
          if (player) player.src = '';
          currentVideoId = null;
        }, 1200);
        return;
      }

      const awarded = await econVideoReward(currentVideoId);
      if (!awarded) return; // už vyzdvihnuté (toast zobrazil economy.js)

      // Aktualizuj UI
      claimBtn.style.display = 'none';
      document.getElementById('videoAlreadyClaimed').style.display = 'block';

      // Označ video ako vyzdvihnuté v zozname
      const badge = document.getElementById(`reward-${currentVideoId}`);
      if (badge) badge.classList.add('claimed');

      // Zatvoriť modal po 2 sekundách
      setTimeout(() => {
        const modal = document.getElementById('videoModal');
        const player = document.getElementById('videoPlayer');
        if (modal) modal.style.display = 'none';
        if (player) player.src = '';
        currentVideoId = null;
      }, 2000);
    });
  }

  /* Rozbaľovač ĎALŠÍCH videí – prvé je vždy viditeľné (nováčik má vidieť,
     že sa tu dá zarobiť), zvyšné dve sú zbalené. Zoznam ostáva v DOM (len
     skrytý), takže väzby vyššie aj obnova odznakov nižšie fungujú bez
     ohľadu na rozbalenie. Rovnaký vzor ako „Ďalšie oblasti“ v Bifľovačke. */
  const moreVideosBtn = $('moreVideosBtn');
  const videoListBox = $('videoList');
  if (moreVideosBtn && videoListBox) {
    const pocet = videoListBox.querySelectorAll('.video-item').length;
    const label = (open) => `${open ? '▾ Skryť' : '▸ Ďalšie'} videá (${pocet})`;
    moreVideosBtn.textContent = label(false);
    moreVideosBtn.addEventListener('click', () => {
      const open = videoListBox.style.display === 'none';
      videoListBox.style.display = open ? '' : 'none';
      moreVideosBtn.textContent = label(open);
      moreVideosBtn.setAttribute('aria-expanded', String(open));
    });
  }

  // Obnov stav vyzdvihnutých videí (Firebase = zdroj pravdy)
  Object.keys(VIDEO_CONFIG).forEach(async videoId => {
    if (await econIsVideoClaimed(videoId)) {
      const badge = document.getElementById(`reward-${videoId}`);
      if (badge) badge.classList.add('claimed');
    }
  });
}




/* =====================================================
   ADMIN FEEDBACK MANAGEMENT
   ===================================================== */
async function loadAdminFeedback(listEl) {
  listEl.innerHTML = '<div class="small muted" style="padding:8px">Načítavam...</div>';

  const db = window.db;
  if (!db) {
    listEl.innerHTML = '<div class="small muted" style="padding:8px">❌ Firebase nie je pripojená.</div>';
    return;
  }
  const { ref, get, update } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
  );

  const snap = await get(ref(db, 'feedback'));
  const data = snap.val() || {};
  const items = Object.entries(data)
    .sort(([,a],[,b]) => b.createdAt - a.createdAt);

  if (!items.length) {
    listEl.innerHTML = '<div class="small muted" style="padding:8px">Žiadne príspevky.</div>';
    return;
  }

  const typeEmoji = { napad: '💡', chyba: '🐛', pochvala: '⭐' };
  const fmtDate = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getDate()+'.'+(d.getMonth()+1)+'. '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
  };
  const statusLabel = { pending: '⏳ Čaká', published: '✅ Zverejnené', hidden: '🚫 Skryté' };

  listEl.innerHTML = items.map(([id, f]) => `
    <div class="admin-feedback-item" data-id="${id}" style="
      padding:10px 12px;border-bottom:1px solid var(--card-border);font-size:13px;
      background:${f.status==='published'?'rgba(34,197,94,0.04)':f.status==='hidden'?'rgba(239,68,68,0.04)':'inherit'}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span>${typeEmoji[f.type]||'📝'} <strong>${f.nick}</strong></span>
        <div style="display:flex;gap:4px;align-items:center">
          <span class="small" style="color:var(--muted)">${statusLabel[f.status||'pending']}</span>
          <span class="small muted">${fmtDate(f.createdAt)}</span>
        </div>
      </div>
      <div style="margin-bottom:8px">${f.text}</div>
      ${f.adminReply ? `
        <div style="background:rgba(47,158,143,0.08);border-left:3px solid var(--accent-3);
          padding:6px 10px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:12px">
          💬 <strong>Admin:</strong> ${f.adminReply.text}
          <span class="small muted" style="margin-left:6px">${fmtDate(f.adminReply.createdAt)}</span>
        </div>` : ''}
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${f.status !== 'published' ? `<button class="btn fb-publish" data-id="${id}" style="font-size:11px;padding:3px 8px">✅ Zverejniť</button>` : ''}
        ${f.status !== 'hidden' ? `<button class="btn fb-hide" data-id="${id}" style="font-size:11px;padding:3px 8px">🚫 Skryť</button>` : ''}
        <button class="btn fb-reply" data-id="${id}" style="font-size:11px;padding:3px 8px">💬 Odpovedať</button>
      </div>
      <div class="fb-reply-form" data-id="${id}" style="display:none;margin-top:8px">
        <textarea class="feedback-textarea fb-reply-text" rows="2"
          placeholder="Napíš odpoveď..." maxlength="500"
          style="font-size:12px">${f.adminReply?.text||''}</textarea>
        <button class="btn btn-primary fb-reply-send" data-id="${id}"
          style="font-size:11px;padding:4px 10px;margin-top:4px">Odoslať odpoveď</button>
      </div>
    </div>
  `).join('');

  // Event listenery
  listEl.querySelectorAll('.fb-publish').forEach(btn => {
    btn.onclick = async () => {
      await update(ref(db, `feedback/${btn.dataset.id}`), { status: 'published' });
      await loadAdminFeedback(listEl);
      renderPublishedFeedback();
    };
  });

  listEl.querySelectorAll('.fb-hide').forEach(btn => {
    btn.onclick = async () => {
      await update(ref(db, `feedback/${btn.dataset.id}`), { status: 'hidden' });
      await loadAdminFeedback(listEl);
      renderPublishedFeedback();
    };
  });

  listEl.querySelectorAll('.fb-reply').forEach(btn => {
    btn.onclick = () => {
      const form = listEl.querySelector(`.fb-reply-form[data-id="${btn.dataset.id}"]`);
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    };
  });

  listEl.querySelectorAll('.fb-reply-send').forEach(btn => {
    btn.onclick = async () => {
      const form = listEl.querySelector(`.fb-reply-form[data-id="${btn.dataset.id}"]`);
      const text = form?.querySelector('.fb-reply-text')?.value?.trim();
      if (!text) return;
      await update(ref(db, `feedback/${btn.dataset.id}`), {
        adminReply: { text, createdAt: Date.now() }
      });
      await loadAdminFeedback(listEl);
      renderPublishedFeedback();
    };
  });
}

/* =====================================================
   VEREJNÁ NÁSTENKA – zverejnené príspevky
   ===================================================== */
async function renderPublishedFeedback() {
  const box = document.getElementById('publishedFeedbackBox');
  if (!box) return;

  const db = window.db;
  if (!db) return;

  const { ref, get } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
  );

  const snap = await get(ref(db, 'feedback'));
  const data = snap.val() || {};
  const published = Object.values(data)
    .filter(f => f.status === 'published')
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!published.length) {
    box.innerHTML = '<div class="small muted">Zatiaľ žiadne zverejnené príspevky.</div>';
    return;
  }

  const typeEmoji = { napad: '💡', chyba: '🐛', pochvala: '⭐' };
  const fmtDate = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getDate()+'.'+(d.getMonth()+1)+'.';
  };

  box.innerHTML = published.slice(0, 10).map(f => `
    <div style="padding:10px 0;border-bottom:1px solid var(--card-border)">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span class="small">${typeEmoji[f.type]||'📝'} <strong>${f.nick}</strong></span>
        <span class="small muted">${fmtDate(f.createdAt)}</span>
      </div>
      <div style="font-size:13px;margin-bottom:${f.adminReply?'6px':'0'}">${f.text}</div>
      ${f.adminReply ? `
        <div style="background:rgba(47,158,143,0.08);border-left:3px solid var(--accent-3);
          padding:5px 8px;border-radius:0 6px 6px 0;font-size:12px">
          💬 <em>${f.adminReply.text}</em>
        </div>` : ''}
    </div>
  `).join('');
}

/* =====================================================
   ROLA SYSTÉM – admin panel, garant, role management
   ===================================================== */

async function initRoleSystem() {
  console.log('🔑 initRoleSystem štart');
  const db = window.db;
  const nick = localStorage.getItem('playerNick');
  console.log('🔑 db:', !!db, 'nick:', nick);
  if (!db || !nick) {
    console.warn('🔑 chýba db alebo nick');
    return;
  }

  try {
    const { ref, get, update, remove } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");

    // Načítaj rolu z Firebase - skontroluj obe miesta
    const snapUsers = await get(ref(db, `users/${nick}/role`));
    const snapLeader = await get(ref(db, `leaderboard/${nick}/role`));
    console.log('🔑 users role:', snapUsers.val(), '| leaderboard role:', snapLeader.val());
    
    const role = snapUsers.exists()
      ? snapUsers.val()
      : snapLeader.exists()
      ? snapLeader.val()
      : 'student';
    
    console.log('🔑 Načítaná rola:', role);

    // Synchronizuj rolu do users/ ak tam nie je
    if (!snapUsers.exists() && role !== 'student') {
      await update(ref(db, `users/${nick}`), { role });
    }

  // Ulož Firebase rolu (skutočná rola) aj view rolu zvlášť
  localStorage.setItem('playerFirebaseRole', role);
  // Nastav view rolu len ak ešte nie je nastavená
  if (!localStorage.getItem('playerRole')) {
    localStorage.setItem('playerRole', role);
  }

  const viewRole = localStorage.getItem('playerRole') || role;

  // Aktualizuj badge
  initRoleBadge();

    // Zobraz admin panel podľa view roly
    if (viewRole === 'admin' || viewRole === 'garant') {
      renderAdminPanel(viewRole, db, ref, get, update, null, remove);
    } else {
      const panel = document.getElementById('adminPanel');
      if (panel) panel.innerHTML = '<span class="small muted">Pre zobrazenie prepni rolu na garant.</span>';
    }
  } catch(e) {
    console.error('❌ initRoleSystem chyba:', e);
  }
}

function renderAdminPanel(role, db, ref, get, update, onValue, remove) {
  const panel = document.getElementById('adminPanel');
  if (!panel) return;

  panel.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:4px">
        ${role === 'admin' ? '👑 Admin panel' : '🔏 Garant panel'}
      </div>

      <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--card-border)">
        <div style="font-weight:600;margin-bottom:6px">👥 Moje skupiny</div>
        <input id="groupNameInput" class="form-input" type="text"
          placeholder="Názov skupiny (napr. Pracovné právo 2026 – skupina B)" style="margin-bottom:6px"/>
        <button class="btn btn-primary" id="groupCreateBtn" style="width:100%;margin-bottom:6px">➕ Vytvoriť skupinu</button>
        <div id="groupMsg" class="small" style="margin-bottom:8px;color:var(--muted)"></div>
        <div id="groupList" class="small muted">Načítavam…</div>
      </div>
      ${role === 'admin' ? `
        <div style="margin-bottom:10px">
          <input id="adminNickInput" class="form-input" type="text"
            placeholder="Nick hráča..." style="margin-bottom:6px"/>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-primary" id="setGarantBtn">🔏 Nastaviť garanta</button>
            <button class="btn" id="setStudentBtn">👤 Odobrať garanta</button>
          </div>
          <div id="adminMsg" class="small" style="margin-top:6px;color:var(--muted)"></div>
        </div>
        <button class="btn" id="listUsersBtn" style="width:100%;margin-bottom:6px">
          👥 Zobraziť hráčov
        </button>
        <div id="usersList" style="display:none;max-height:200px;overflow-y:auto;margin-bottom:8px"></div>
        <button class="btn" id="listFeedbackBtn" style="width:100%;margin-bottom:6px">
          💬 Zobraziť pripomienky
        </button>
        <div id="feedbackList" style="display:none;max-height:250px;overflow-y:auto"></div>

        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--card-border)">
          <div style="font-weight:600;margin-bottom:8px">🎟️ Promo kódy</div>
          <input id="promoCodeInput" class="form-input" type="text"
            placeholder="KÓD (napr. FINANČNÁ LIGA25)" style="margin-bottom:6px;text-transform:uppercase" maxlength="30"/>
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <input id="promoAmountInput" class="form-input" type="number" min="10" max="50" value="25" placeholder="🪙 (10–50)"/>
            <input id="promoMaxUsesInput" class="form-input" type="number" min="1" placeholder="Max použití (prázdne = ∞)"/>
          </div>
          <input id="promoExpiresInput" class="form-input" type="date" style="margin-bottom:6px"/>
          <button class="btn btn-primary" id="promoCreateBtn" style="width:100%;margin-bottom:6px">Vytvoriť</button>
          <div id="promoMsg" class="small" style="margin-bottom:8px;color:var(--muted)"></div>
          <button class="btn" id="listPromoBtn" style="width:100%;margin-bottom:6px">🎟️ Zobraziť kódy</button>
          <div id="promoList" style="display:none;max-height:220px;overflow-y:auto"></div>
        </div>

        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--card-border)">
          <div style="font-weight:600;margin-bottom:8px">🧠 Bifľovačka – opravy garanta</div>
          <button class="btn" id="exportBiflovackaBtn" style="width:100%">📥 Export opráv bifľovačky</button>
          <div id="exportBiflovackaMsg" class="small" style="margin-top:6px;color:var(--muted)"></div>
        </div>

        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--card-border)">
          <div style="font-weight:600;margin-bottom:8px">🎬 Videá k definíciám</div>
          <select id="bfVideoAreaSelect" class="form-input" style="margin-bottom:6px">
            <option value="">Vyber oblasť...</option>
            ${MEMORY_AREAS.map(a => `<option value="${a.slug}">${escapeHtml(a.name)}</option>`).join('')}
          </select>
          <input id="bfVideoDefKeyInput" class="form-input" type="text"
            placeholder="defKey (napr. 2_1 = okruh 2, definícia 1)" style="margin-bottom:6px"/>
          <input id="bfVideoUrlInput" class="form-input" type="text"
            placeholder="YouTube ID alebo URL" style="margin-bottom:6px"/>
          <input id="bfVideoTitleInput" class="form-input" type="text"
            placeholder="Názov videa" style="margin-bottom:6px"/>
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <button class="btn btn-primary" id="bfVideoAssignBtn" style="flex:1">Priradiť</button>
            <button class="btn" id="bfVideoRemoveBtn" style="flex:1">Odstrániť</button>
          </div>
          <div id="bfVideoMsg" class="small" style="margin-bottom:8px;color:var(--muted)"></div>
          <button class="btn" id="bfVideoListBtn" style="width:100%;margin-bottom:6px">🎬 Zobraziť priradenia oblasti</button>
          <div id="bfVideoList" style="display:none;max-height:220px;overflow-y:auto"></div>
          <div class="small muted" style="margin-top:8px">Odporúčaný formát: 9:16 alebo 1:1, 1080p, do 60 s.</div>
        </div>

        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--card-border)">
          <div style="font-weight:600;margin-bottom:8px">📊 Otvorenia aplikácie</div>
          <div class="small muted" style="margin-bottom:8px">
            Koľkokrát sa appka za deň otvorila. Bez identifikátora návštevníka –
            nevieme, koľko ľudí to bolo, ani kto sa vrátil.
          </div>
          <button class="btn" id="visitsLoadBtn" style="width:100%;margin-bottom:8px">📊 Načítať prehľad</button>
          <div id="visitsBox" style="display:none"></div>
        </div>

        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--card-border);display:none"
             data-demo-hidden="synchronizácia do GitHubu – demo nemá ADMIN_SYNC_SECRET ani GITHUB_* env; odkrytie viď README">
          <div style="font-weight:600;margin-bottom:8px">🔄 Synchronizácia obsahu do GitHubu</div>
          <div class="small muted" style="margin-bottom:6px">
            Zapečie schválené úpravy (Úloha 2 overridy) späť do data/*.json v repe. Manuálne, nikdy automaticky.
          </div>
          <input id="syncSecretInput" class="form-input" type="password"
            placeholder="Admin heslo pre synchronizáciu" style="margin-bottom:6px"
            autocomplete="off"/>
          <button class="btn" id="syncPreviewBtn" style="width:100%;margin-bottom:6px">👁️ Zobraziť náhľad</button>
          <div id="syncPreviewBox" style="display:none;margin-bottom:8px"></div>
          <button class="btn btn-primary" id="syncConfirmBtn" style="width:100%;display:none">✅ Potvrdiť a synchronizovať</button>
          <div id="syncMsg" class="small" style="margin-top:6px;color:var(--muted)"></div>
        </div>
      ` : ''}
      <div style="margin:10px 0;padding-top:10px;border-top:1px solid var(--card-border, rgba(0,0,0,0.08))">
        <div style="font-weight:600;margin-bottom:6px">💰 Poslať 🪙 hráčovi</div>
        <input id="grantNickInput" class="form-input" type="text"
          placeholder="Nick hráča..." style="margin-bottom:6px"/>
        <div style="display:flex;gap:6px">
          <input id="grantAmountInput" class="form-input" type="number" min="1"
            placeholder="Suma 🪙" style="width:100px"/>
          <button class="btn btn-primary" id="grantSendBtn">Poslať</button>
        </div>
        <div id="grantMsg" class="small" style="margin-top:6px;color:var(--muted)">
          ${role === 'garant' ? 'Denný limit garanta: 50🪙.' : 'Admin – bez limitu.'}
        </div>
      </div>
      <div class="small muted" style="margin-top:8px">
        ${role === 'admin'
          ? 'Ako admin môžeš udeľovať rolu garanta hráčom.'
          : 'Ako garant môžeš pridávať garančnú pečať na otázky v kvíze.'}
      </div>
    </div>
  `;

  // 👥 Moje skupiny (garant aj admin)
  const myNick = localStorage.getItem('playerNick');
  const groupMsg = panel.querySelector('#groupMsg');
  const groupListEl = panel.querySelector('#groupList');

  async function renderGroupList() {
    if (!myNick) { groupListEl.textContent = ''; return; }
    const myGroups = await getMyGarantGroups(myNick);
    if (!myGroups.length) {
      groupListEl.textContent = 'Zatiaľ nemáš žiadne skupiny.';
      return;
    }
    groupListEl.innerHTML = myGroups.map(g => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--card-border)">
        <div>
          <div style="font-weight:600">${escapeHtml(g.name)}</div>
          <div class="small muted">Kód: <strong>${escapeHtml(g.code)}</strong> · ${Object.keys(g.members || {}).length} členov</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn group-tests-btn" data-id="${g.id}" data-name="${escapeHtml(g.name)}" style="padding:4px 8px;font-size:12px">📝</button>
          <button class="btn group-rename-btn" data-id="${g.id}" data-name="${escapeHtml(g.name)}" style="padding:4px 8px;font-size:12px">✏️</button>
          <button class="btn group-delete-btn" data-id="${g.id}" data-name="${escapeHtml(g.name)}" style="padding:4px 8px;font-size:12px">🗑️</button>
        </div>
      </div>
    `).join('');

    groupListEl.querySelectorAll('.group-tests-btn').forEach(btn => {
      btn.onclick = () => openGroupTestsModal(btn.dataset.id, btn.dataset.name, myNick);
    });
    groupListEl.querySelectorAll('.group-rename-btn').forEach(btn => {
      btn.onclick = async () => {
        const newName = prompt('Nový názov skupiny:', btn.dataset.name);
        if (newName === null) return;
        const result = await renameGroup(btn.dataset.id, newName, myNick);
        if (!result.ok) { groupMsg.textContent = `❌ ${result.message}`; groupMsg.style.color = '#b91c1c'; return; }
        renderGroupList();
      };
    });
    groupListEl.querySelectorAll('.group-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`Naozaj zmazať skupinu "${btn.dataset.name}"? (Tréningové dáta študentov ostanú nedotknuté, zmaže sa len členstvo.)`)) return;
        const result = await deleteGroup(btn.dataset.id, myNick);
        if (!result.ok) { groupMsg.textContent = `❌ ${result.message}`; groupMsg.style.color = '#b91c1c'; return; }
        renderGroupList();
      };
    });
  }

  panel.querySelector('#groupCreateBtn').onclick = async () => {
    const input = panel.querySelector('#groupNameInput');
    const name = input.value.trim();
    if (!name) { groupMsg.textContent = 'Zadaj názov skupiny.'; groupMsg.style.color = '#b91c1c'; return; }

    const result = await createGroup(name);
    if (!result.ok) {
      groupMsg.textContent = `❌ ${result.message}`;
      groupMsg.style.color = '#b91c1c';
      return;
    }
    groupMsg.textContent = `✅ Skupina vytvorená. Pripojovací kód: ${result.code}`;
    groupMsg.style.color = 'var(--accent-3)';
    input.value = '';
    renderGroupList();
  };

  renderGroupList();

  // 💰 Poslať § – admin aj garant (limit garanta rieši econGrant)
  const grantBtn = panel.querySelector('#grantSendBtn');
  if (grantBtn) {
    grantBtn.onclick = async () => {
      const toNick = panel.querySelector('#grantNickInput').value.trim();
      const amount = parseInt(panel.querySelector('#grantAmountInput').value, 10);
      const msg = panel.querySelector('#grantMsg');
      if (!toNick) { msg.textContent = 'Zadaj nick hráča.'; return; }
      if (!amount || amount < 1) { msg.textContent = 'Zadaj platnú sumu.'; return; }

      const me = localStorage.getItem('playerNick');
      // Over, že hráč existuje – preklepy by vytvorili § "do vzduchu"
      try {
        const { ref: r2, get: g2 } = await import(
          "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
        );
        const snap = await g2(r2(window.db, `users/${toNick}`));
        if (!snap.exists()) { msg.textContent = `❌ Hráč "${toNick}" neexistuje.`; return; }
      } catch (e) { msg.textContent = 'Chyba pripojenia.'; return; }

      grantBtn.disabled = true;
      const ok = await window.econGrant(me, toNick, amount);
      grantBtn.disabled = false;
      if (ok) {
        msg.textContent = `✅ Poslané ${amount}🪙 hráčovi ${toNick}.`;
        msg.style.color = 'var(--accent-3, #15803d)';
        panel.querySelector('#grantAmountInput').value = '';
      } else {
        msg.textContent = '❌ Nepodarilo sa poslať (limit alebo chyba).';
        msg.style.color = '#b91c1c';
      }
    };
  }

  if (role === 'admin') {
    // Nastaviť garanta
    panel.querySelector('#setGarantBtn').onclick = async () => {
      const targetNick = panel.querySelector('#adminNickInput').value.trim();
      const msg = panel.querySelector('#adminMsg');
      if (!targetNick) { msg.textContent = 'Zadaj nick hráča.'; return; }
      await update(ref(db, `users/${targetNick}`), { role: 'garant' });
      msg.textContent = `✅ ${targetNick} je teraz garant.`;
      msg.style.color = 'var(--accent-3)';
    };

    // Odobrať garanta
    panel.querySelector('#setStudentBtn').onclick = async () => {
      const targetNick = panel.querySelector('#adminNickInput').value.trim();
      const msg = panel.querySelector('#adminMsg');
      if (!targetNick) { msg.textContent = 'Zadaj nick hráča.'; return; }
      await update(ref(db, `users/${targetNick}`), { role: 'student' });
      msg.textContent = `✅ ${targetNick} je teraz student.`;
      msg.style.color = 'var(--muted)';
    };

    // Zoznam pripomienok s admin akciami
    panel.querySelector('#listFeedbackBtn').onclick = async () => {
      const listEl = panel.querySelector('#feedbackList');
      const isHidden = listEl.style.display === 'none';
      if (!isHidden) { listEl.style.display = 'none'; return; }
      listEl.style.display = 'block';
      await loadAdminFeedback(listEl);
    };

    // Zoznam hráčov
    panel.querySelector('#listUsersBtn').onclick = async () => {
      const listEl = panel.querySelector('#usersList');
      const isHidden = listEl.style.display === 'none';
      if (!isHidden) { listEl.style.display = 'none'; return; }

      listEl.innerHTML = '<div class="small muted">Načítavam...</div>';
      listEl.style.display = 'block';

      const snap = await get(ref(db, 'users'));
      const users = snap.val() || {};

      listEl.innerHTML = Object.entries(users).map(([n, u]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:6px 8px;border-bottom:1px solid var(--card-border);font-size:13px">
          <div>
            <strong>${n}</strong>
            <span class="small muted" style="margin-left:6px">${u.role || 'student'}</span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn" style="font-size:11px;padding:3px 8px"
              onclick="(async()=>{
                const {ref,update}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
                await update(ref(window.db,'users/${n}'),{role:'garant'});
                this.closest('div').querySelector('span').textContent='garant';
              })()">🔏 Garant</button>
            <button class="btn" style="font-size:11px;padding:3px 8px"
              onclick="(async()=>{
                const {ref,update}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
                await update(ref(window.db,'users/${n}'),{role:'student'});
                this.closest('div').querySelector('span').textContent='student';
              })()">👤 Student</button>
          </div>
        </div>
      `).join('');
    };

    // Vytvoriť promo kód
    panel.querySelector('#promoCreateBtn').onclick = async () => {
      const codeInput = panel.querySelector('#promoCodeInput');
      const amountInput = panel.querySelector('#promoAmountInput');
      const maxUsesInput = panel.querySelector('#promoMaxUsesInput');
      const expiresInput = panel.querySelector('#promoExpiresInput');
      const msg = panel.querySelector('#promoMsg');

      const code = codeInput.value.trim().toUpperCase();
      if (!code) { msg.textContent = 'Zadaj kód.'; msg.style.color = '#dc2626'; return; }

      let amount = parseInt(amountInput.value, 10);
      if (!Number.isFinite(amount)) amount = 25;
      amount = Math.min(50, Math.max(10, amount));

      const maxUsesRaw = maxUsesInput.value.trim();
      const maxUses = maxUsesRaw ? Math.max(1, parseInt(maxUsesRaw, 10)) : null;

      const expiresRaw = expiresInput.value;
      const expiresAt = expiresRaw ? new Date(`${expiresRaw}T23:59:59`).getTime() : null;

      const codeRef = ref(db, `promoCodes/${code}`);
      const existing = await get(codeRef);
      if (existing.exists()) {
        msg.textContent = `❌ Kód ${code} už existuje.`;
        msg.style.color = '#dc2626';
        return;
      }

      await update(codeRef, {
        amount, active: true, maxUses, usedCount: 0, expiresAt,
        createdBy: localStorage.getItem('playerNick') || 'admin',
        createdAt: Date.now(), redeemed: {}
      });

      msg.textContent = `✅ Kód ${code} vytvorený (${amount}🪙).`;
      msg.style.color = 'var(--accent-3)';
      codeInput.value = ''; amountInput.value = 25; maxUsesInput.value = ''; expiresInput.value = '';

      const listEl = panel.querySelector('#promoList');
      if (listEl.style.display !== 'none') await loadPromoList(panel, db, ref, get, update);
    };

    // Zoznam promo kódov
    panel.querySelector('#listPromoBtn').onclick = async () => {
      const listEl = panel.querySelector('#promoList');
      const isHidden = listEl.style.display === 'none';
      if (!isHidden) { listEl.style.display = 'none'; return; }
      listEl.style.display = 'block';
      await loadPromoList(panel, db, ref, get, update);
    };

    // Export opráv bifľovačky (biflovackaOverrides) – JSON na neskoršie
    // ručné zapracovanie do biflovacka/{slug}.json cez Code.
    panel.querySelector('#exportBiflovackaBtn').onclick = async () => {
      const msg = panel.querySelector('#exportBiflovackaMsg');
      msg.textContent = 'Načítavam...';
      try {
        const snap = await get(ref(db, 'biflovackaOverrides'));
        const data = snap.exists() ? snap.val() : {};
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `biflovacka-overrides-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        msg.textContent = `✅ Stiahnuté (${Object.keys(data).length} oblastí).`;
        msg.style.color = 'var(--accent-3)';
      } catch (e) {
        console.error('Export opráv bifľovačky zlyhal:', e);
        msg.textContent = '❌ Export zlyhal.';
        msg.style.color = '#dc2626';
      }
    };

    // 🎬 Videá k definíciám (biflovackaVideos/{slug}/{defKey}) – Koľaj B
    panel.querySelector('#bfVideoAssignBtn').onclick = async () => {
      const areaSelect = panel.querySelector('#bfVideoAreaSelect');
      const defKeyInput = panel.querySelector('#bfVideoDefKeyInput');
      const urlInput = panel.querySelector('#bfVideoUrlInput');
      const titleInput = panel.querySelector('#bfVideoTitleInput');
      const msg = panel.querySelector('#bfVideoMsg');

      const slug = areaSelect.value;
      const defKey = defKeyInput.value.trim();
      const youtubeId = extractYoutubeId(urlInput.value.trim());
      const title = titleInput.value.trim();

      if (!slug) { msg.textContent = '❌ Vyber oblasť.'; msg.style.color = '#dc2626'; return; }
      if (!defKey) { msg.textContent = '❌ Zadaj defKey.'; msg.style.color = '#dc2626'; return; }
      if (!youtubeId) { msg.textContent = '❌ Neplatné YouTube ID/URL (očakáva sa 11-znakové ID).'; msg.style.color = '#dc2626'; return; }

      await update(ref(db, `biflovackaVideos/${slug}/${defKey}`), {
        youtubeId, title: title || '', addedBy: localStorage.getItem('playerNick') || 'admin', ts: Date.now()
      });

      msg.innerHTML = `✅ Priradené (${defKey} → ${youtubeId}). Náhľad: <a href="https://youtu.be/${youtubeId}" target="_blank" rel="noopener">youtu.be/${youtubeId}</a>`;
      msg.style.color = 'var(--accent-3)';
      defKeyInput.value = ''; urlInput.value = ''; titleInput.value = '';

      const listEl = panel.querySelector('#bfVideoList');
      if (listEl.style.display !== 'none') await loadBiflovackaVideoList(panel, db, ref, get, update, remove);
    };

    panel.querySelector('#bfVideoRemoveBtn').onclick = async () => {
      const areaSelect = panel.querySelector('#bfVideoAreaSelect');
      const defKeyInput = panel.querySelector('#bfVideoDefKeyInput');
      const msg = panel.querySelector('#bfVideoMsg');

      const slug = areaSelect.value;
      const defKey = defKeyInput.value.trim();
      if (!slug || !defKey) { msg.textContent = '❌ Vyber oblasť a zadaj defKey.'; msg.style.color = '#dc2626'; return; }

      await remove(ref(db, `biflovackaVideos/${slug}/${defKey}`));
      msg.textContent = `✅ Priradenie ${defKey} odstránené.`;
      msg.style.color = 'var(--muted)';

      const listEl = panel.querySelector('#bfVideoList');
      if (listEl.style.display !== 'none') await loadBiflovackaVideoList(panel, db, ref, get, update, remove);
    };

    panel.querySelector('#bfVideoListBtn').onclick = async () => {
      const listEl = panel.querySelector('#bfVideoList');
      const isHidden = listEl.style.display === 'none';
      if (!isHidden) { listEl.style.display = 'none'; return; }
      listEl.style.display = 'block';
      await loadBiflovackaVideoList(panel, db, ref, get, update, remove);
    };

    panel.querySelector('#visitsLoadBtn').onclick = async () => {
      const box = panel.querySelector('#visitsBox');
      const isHidden = box.style.display === 'none';
      if (!isHidden) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      box.innerHTML = '<div class="small muted">Načítavam…</div>';
      const { nacitajPrehladNavstev } = await import('./scripts/visits.js');
      renderVisitsBox(box, await nacitajPrehladNavstev(30));
    };

    // 🔄 Synchronizácia obsahu do GitHubu (Úloha 3) – náhľad, potom
    // explicitné potvrdenie, potom skutočné volanie servera.
    let syncPreviewData = null;
    panel.querySelector('#syncPreviewBtn').onclick = async () => {
      const secretInput = panel.querySelector('#syncSecretInput');
      const box = panel.querySelector('#syncPreviewBox');
      const confirmBtn = panel.querySelector('#syncConfirmBtn');
      const msg = panel.querySelector('#syncMsg');
      const secret = secretInput.value.trim();
      if (!secret) { msg.textContent = 'Zadaj admin heslo.'; msg.style.color = '#b91c1c'; return; }

      msg.textContent = '';
      box.style.display = 'block';
      box.innerHTML = '<div class="small muted">Načítavam náhľad…</div>';
      confirmBtn.style.display = 'none';

      try {
        const resp = await fetch('/api/sync-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ preview: true })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          box.innerHTML = `<div class="small" style="color:#b91c1c">❌ ${escapeHtml(data.error || 'Neznáma chyba.')}</div>`;
          return;
        }
        syncPreviewData = data;
        if (!data.affected.length) {
          box.innerHTML = '<div class="small muted">Žiadne nevybavené zmeny na zapečenie.</div>';
          return;
        }
        box.innerHTML = `
          <div class="small" style="margin-bottom:6px"><strong>${data.totalOverrides}</strong> zmien v <strong>${data.affected.length}</strong> okruhoch:</div>
          <ul style="margin:0 0 6px 18px;padding:0;font-size:13px">
            ${data.affected.map(a => `<li>${escapeHtml(a.path)} (${a.overridesCount})</li>`).join('')}
          </ul>`;
        confirmBtn.style.display = 'block';
      } catch (e) {
        box.innerHTML = `<div class="small" style="color:#b91c1c">❌ Chyba spojenia: ${escapeHtml(e.message)}</div>`;
      }
    };

    panel.querySelector('#syncConfirmBtn').onclick = async () => {
      const secret = panel.querySelector('#syncSecretInput').value.trim();
      const confirmBtn = panel.querySelector('#syncConfirmBtn');
      const msg = panel.querySelector('#syncMsg');
      if (!secret || !syncPreviewData) return;
      if (!confirm(`Naozaj zapísať ${syncPreviewData.totalOverrides} zmien do ${syncPreviewData.affected.length} súborov v GitHub repe?`)) return;

      confirmBtn.disabled = true;
      msg.style.color = 'var(--muted)';
      msg.textContent = 'Synchronizujem…';

      try {
        const resp = await fetch('/api/sync-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ preview: false })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          msg.textContent = `❌ ${data.error || 'Neznáma chyba.'}`;
          msg.style.color = '#b91c1c';
          return;
        }
        msg.textContent = `✅ Hotovo: ${data.overridesBaked} zmien zapečených do ${data.files.length} súborov (commit ${(data.commitSha || '').slice(0, 7)}).`;
        msg.style.color = 'var(--accent-3)';
        confirmBtn.style.display = 'none';
        syncPreviewData = null;
      } catch (e) {
        msg.textContent = `❌ Chyba spojenia: ${e.message}`;
        msg.style.color = '#b91c1c';
      } finally {
        confirmBtn.disabled = false;
      }
    };
  }
}

/* ============================================================
   AKADEMICKÁ VRSTVA – KROK 2: Testy pre skupinu (garant pohľad)
   ============================================================ */
function formatAssignmentDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString('sk-SK', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function assignmentStatusBadge(assignment) {
  const status = assignmentStatus(assignment);
  if (status === 'upcoming') return `<span class="small" style="color:var(--muted)">🕓 Otvorí sa ${formatAssignmentDate(assignment.opensAt)}</span>`;
  if (status === 'open') return `<span class="small" style="color:var(--accent-3, #15803d)">🟢 Aktívny do ${formatAssignmentDate(assignment.closesAt)}</span>`;
  return `<span class="small muted">⚪ Uzavretý ${formatAssignmentDate(assignment.closesAt)}</span>`;
}

function openGroupTestsModal(groupId, groupName, myNick) {
  const old = document.getElementById('groupTestsModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'groupTestsModal';
  modal.className = 'avatar-modal';
  modal.innerHTML = `
    <div class="avatar-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0">📝 Testy – ${escapeHtml(groupName)}</h3>
        <button class="btn" id="closeGroupTestsModal">✕</button>
      </div>
      <button class="btn btn-primary" id="newTestBtn" style="width:100%;margin-bottom:12px">➕ Nový test</button>
      <div id="groupTestsList" class="small muted">Načítavam…</div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.getElementById('closeGroupTestsModal').onclick = () => modal.remove();

  async function renderList() {
    const listEl = document.getElementById('groupTestsList');
    if (!listEl) return;
    const tests = await getAssignmentsForGroup(groupId);
    if (!tests.length) { listEl.textContent = 'Zatiaľ žiadne testy v tejto skupine.'; return; }
    listEl.innerHTML = tests.map(a => `
      <div style="padding:8px 0;border-bottom:1px solid var(--card-border)">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
          <div>
            <div style="font-weight:600;color:var(--text,inherit)">${escapeHtml(a.title)}</div>
            <div class="small muted">${a.questions.length} otázok · ${escapeHtml(a.areaTitle)}</div>
            <div style="margin-top:2px">${assignmentStatusBadge(a)}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn test-results-btn" data-id="${a.id}" style="padding:4px 8px;font-size:12px">📊</button>
            <button class="btn test-delete-btn" data-id="${a.id}" data-title="${escapeHtml(a.title)}" style="padding:4px 8px;font-size:12px">🗑️</button>
          </div>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.test-results-btn').forEach(btn => {
      btn.onclick = () => openTestResultsModal(btn.dataset.id);
    });
    listEl.querySelectorAll('.test-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`Naozaj zmazať test "${btn.dataset.title}"? Zmažú sa aj výsledky.`)) return;
        await deleteAssignment(btn.dataset.id, myNick);
        renderList();
      };
    });
  }

  document.getElementById('newTestBtn').onclick = () => openTestBuilderModal(groupId, groupName, renderList);

  renderList();
}

function openTestBuilderModal(groupId, groupName, onCreated) {
  const old = document.getElementById('testBuilderModal');
  if (old) old.remove();

  const areas = listAreaTitles();
  const modal = document.createElement('div');
  modal.id = 'testBuilderModal';
  modal.className = 'avatar-modal';
  modal.style.zIndex = '10000';
  modal.innerHTML = `
    <div class="avatar-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0">➕ Nový test – ${escapeHtml(groupName)}</h3>
        <button class="btn" id="closeTestBuilderModal">✕</button>
      </div>
      <input id="tbTitleInput" class="form-input" type="text" maxlength="80"
        placeholder="Názov testu (napr. Test č. 1 – Pracovné právo)" style="margin-bottom:8px"/>
      <select id="tbAreaSelect" class="form-input" style="margin-bottom:8px">
        <option value="">Vyber oblasť...</option>
        ${areas.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('')}
      </select>
      <div style="display:flex;gap:12px;margin-bottom:8px">
        <label class="small"><input type="radio" name="tbMode" value="okruhy" checked/> podľa okruhov</label>
        <label class="small"><input type="radio" name="tbMode" value="oblast"/> celá oblasť</label>
      </div>
      <div id="tbOkruhyBox" class="small muted" style="max-height:140px;overflow-y:auto;border:1px solid var(--card-border);border-radius:8px;padding:6px;margin-bottom:8px">
        Najprv vyber oblasť.
      </div>
      <input id="tbCountInput" class="form-input" type="number" min="1" max="100" value="10"
        placeholder="Počet otázok" style="margin-bottom:8px"/>
      <label class="small muted">Otvorenie testu</label>
      <input id="tbOpensInput" class="form-input" type="datetime-local" style="margin-bottom:8px"/>
      <label class="small muted">Uzavretie testu</label>
      <input id="tbClosesInput" class="form-input" type="datetime-local" style="margin-bottom:8px"/>
      <div id="tbMsg" class="small" style="min-height:16px;margin-bottom:8px;color:var(--muted)"></div>
      <button class="btn btn-primary" id="tbSubmitBtn" style="width:100%">Vytvoriť test</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.getElementById('closeTestBuilderModal').onclick = () => modal.remove();

  const areaSelect = document.getElementById('tbAreaSelect');
  const okruhyBox = document.getElementById('tbOkruhyBox');

  function renderOkruhyBox() {
    const areaTitle = areaSelect.value;
    if (!areaTitle) { okruhyBox.innerHTML = 'Najprv vyber oblasť.'; return; }
    const okruhy = listOkruhy(areaTitle);
    if (!okruhy.length) { okruhyBox.innerHTML = 'Pre túto oblasť nie sú okruhy.'; return; }
    okruhyBox.innerHTML = okruhy.map(o => `
      <label class="small" style="display:block;padding:2px 0">
        <input type="checkbox" class="tb-okruh-check" value="${escapeHtml(o.source)}"/> ${escapeHtml(o.title)} (${o.count})
      </label>
    `).join('');
  }
  areaSelect.onchange = renderOkruhyBox;

  function updateModeUI() {
    const mode = modal.querySelector('input[name="tbMode"]:checked').value;
    okruhyBox.style.display = mode === 'okruhy' ? 'block' : 'none';
  }
  modal.querySelectorAll('input[name="tbMode"]').forEach(r => { r.onchange = updateModeUI; });

  document.getElementById('tbSubmitBtn').onclick = async () => {
    const msg = document.getElementById('tbMsg');
    const title = document.getElementById('tbTitleInput').value;
    const areaTitle = areaSelect.value;
    const mode = modal.querySelector('input[name="tbMode"]:checked').value;
    const count = document.getElementById('tbCountInput').value;
    const opensRaw = document.getElementById('tbOpensInput').value;
    const closesRaw = document.getElementById('tbClosesInput').value;
    const opensAt = opensRaw ? new Date(opensRaw).getTime() : null;
    const closesAt = closesRaw ? new Date(closesRaw).getTime() : null;
    const okruhIds = Array.from(modal.querySelectorAll('.tb-okruh-check:checked')).map(c => c.value);

    msg.textContent = 'Vytváram...';
    msg.style.color = 'var(--muted)';
    const result = await createAssignment({ title, groupId, mode, areaTitle, okruhIds, count, opensAt, closesAt });
    if (!result.ok) {
      msg.textContent = `❌ ${result.message}`;
      msg.style.color = '#b91c1c';
      return;
    }
    msg.textContent = `✅ Test vytvorený (${result.count} otázok).`;
    msg.style.color = 'var(--accent-3, #15803d)';
    setTimeout(() => { modal.remove(); if (onCreated) onCreated(); }, 700);
  };
}

async function openTestResultsModal(assignmentId) {
  const old = document.getElementById('testResultsModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'testResultsModal';
  modal.className = 'avatar-modal';
  modal.style.zIndex = '10000';
  modal.innerHTML = `
    <div class="avatar-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0" id="trTitle">📊 Výsledky</h3>
        <button class="btn" id="closeTestResultsModal">✕</button>
      </div>
      <div id="trBody" class="small muted">Načítavam…</div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.getElementById('closeTestResultsModal').onclick = () => modal.remove();

  const assignment = await getAssignment(assignmentId);
  if (!assignment) { document.getElementById('trBody').textContent = 'Test neexistuje.'; return; }
  document.getElementById('trTitle').textContent = `📊 Výsledky – ${assignment.title}`;

  const [group, results] = await Promise.all([
    getGroup(assignment.groupId),
    getAssignmentResults(assignmentId)
  ]);
  const members = Object.keys((group && group.members) || {});
  const body = document.getElementById('trBody');

  if (!members.length) {
    body.textContent = 'Skupina nemá žiadnych členov.';
    return;
  }

  body.innerHTML = members.map(nick => {
    const r = results[nick];
    if (!r) {
      return `
        <div style="padding:8px 0;border-bottom:1px solid var(--card-border)">
          <strong>${escapeHtml(nick)}</strong> <span class="small muted">– nenapísal/a</span>
        </div>`;
    }
    const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
    const wrongList = (r.wrongIdx || []).map(i => {
      const q = assignment.questions[i];
      return q ? `<li>${escapeHtml(q.question)}</li>` : '';
    }).join('');
    return `
      <div style="padding:8px 0;border-bottom:1px solid var(--card-border)">
        <div style="display:flex;justify-content:space-between">
          <strong>${escapeHtml(nick)}</strong>
          <span>${r.score}/${r.total} (${pct}%)</span>
        </div>
        ${wrongList ? `<details style="margin-top:4px"><summary class="small muted" style="cursor:pointer">Zlé otázky (${r.wrongIdx.length})</summary><ul class="small" style="margin:4px 0 0 18px">${wrongList}</ul></details>` : '<div class="small muted" style="margin-top:2px">Bez chyby 🎉</div>'}
      </div>`;
  }).join('');
}

/* Prehľad otvorení aplikácie v admin paneli. Zámerne ukazuje JEDEN
   stĺpec – počet otvorení za deň. Pôvodný prehľad mal aj „nových“
   a „vracajúcich sa“, čo vyžadovalo identifikátor v zariadení; ten
   appka nemá a mať nebude bez súhlasovej lišty. */
/* Slovenské skloňovanie: 1 otvorenie, 2–4 otvorenia, 0 a 5+ otvorení. */
function otvoreniaSlovo(n) {
  if (n === 1) return 'otvorenie';
  if (n >= 2 && n <= 4) return 'otvorenia';
  return 'otvorení';
}

function renderVisitsBox(box, prehlad) {
  if (!prehlad) { box.innerHTML = '<div class="small muted">Firebase nedostupná.</div>'; return; }

  const { rad, spolu, dnes, poslednych7, dni } = prehlad;
  const max = Math.max(1, ...rad.map(d => d.otvorenia));

  box.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="small"><strong>${dnes}</strong> ${otvoreniaSlovo(dnes)} dnes</div>
      <div class="small"><strong>${poslednych7}</strong> ${otvoreniaSlovo(poslednych7)} za 7 dní</div>
      <div class="small"><strong>${spolu}</strong> ${otvoreniaSlovo(spolu)} za ${dni} dní</div>
      <div class="small muted">bez identifikátora</div>
    </div>
    <canvas id="visitsChart" width="300" height="100" style="width:100%;height:100px;margin-bottom:10px"></canvas>
    <table style="width:100%;font-size:11px;border-collapse:collapse">
      <thead>
        <tr style="text-align:left;color:var(--muted)">
          <th style="padding:2px 4px">Dátum</th><th style="padding:2px 4px">Otvorenia</th>
        </tr>
      </thead>
      <tbody>
        ${rad.slice().reverse().filter(d => d.otvorenia > 0).map(d => `
          <tr style="border-top:1px solid var(--card-border, rgba(0,0,0,0.06))">
            <td style="padding:2px 4px">${d.den.slice(5)}</td>
            <td style="padding:2px 4px">${d.otvorenia}</td>
          </tr>
        `).join('') || '<tr><td colspan="2" style="padding:6px 4px;color:var(--muted)">Zatiaľ žiadne otvorenia.</td></tr>'}
      </tbody>
    </table>`;

  const canvas = box.querySelector('#visitsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const barW = w / rad.length;
  ctx.clearRect(0, 0, w, h);
  rad.forEach((d, i) => {
    const barH = Math.round((d.otvorenia / max) * (h - 16));
    ctx.fillStyle = '#17806f';
    ctx.fillRect(i * barW + 1, h - barH - 12, Math.max(1, barW - 2), barH);
  });
}

/* Vyparsuje YouTube video ID z URL (v=... alebo youtu.be/...) alebo
   overí surové 11-znakové ID. Vráti null pri neplatnom vstupe. */
function extractYoutubeId(raw) {
  if (!raw) return null;
  const idPattern = /^[a-zA-Z0-9_-]{11}$/;
  if (idPattern.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const vParam = url.searchParams.get('v');
    if (vParam && idPattern.test(vParam)) return vParam;
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.replace('/', '');
      if (idPattern.test(id)) return id;
    }
  } catch (e) {
    // nie je platná URL – skús vytiahnuť ID regexom priamo z textu
    const m = raw.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

async function loadBiflovackaVideoList(panel, db, ref, get, update, remove) {
  const listEl = panel.querySelector('#bfVideoList');
  const slug = panel.querySelector('#bfVideoAreaSelect').value;
  if (!slug) {
    listEl.innerHTML = '<div class="small muted">Vyber oblasť.</div>';
    return;
  }

  listEl.innerHTML = '<div class="small muted">Načítavam...</div>';
  const snap = await get(ref(db, `biflovackaVideos/${slug}`));
  const videos = snap.val() || {};
  const entries = Object.entries(videos).sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) {
    listEl.innerHTML = '<div class="small muted">Zatiaľ žiadne priradenia v tejto oblasti.</div>';
    return;
  }

  listEl.innerHTML = entries.map(([defKey, v]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:6px 8px;border-bottom:1px solid var(--card-border);font-size:13px">
      <div>
        <strong>${escapeHtml(defKey)}</strong>
        <span class="small muted" style="margin-left:6px">${escapeHtml(v.title || '')} · ${escapeHtml(v.youtubeId)}</span>
      </div>
      <button class="btn bf-video-remove-btn" data-defkey="${escapeHtml(defKey)}" style="font-size:11px;padding:3px 8px">Odstrániť</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.bf-video-remove-btn').forEach(btn => {
    btn.onclick = async () => {
      await remove(ref(db, `biflovackaVideos/${slug}/${btn.dataset.defkey}`));
      await loadBiflovackaVideoList(panel, db, ref, get, update, remove);
    };
  });
}

async function loadPromoList(panel, db, ref, get, update) {
  const listEl = panel.querySelector('#promoList');
  listEl.innerHTML = '<div class="small muted">Načítavam...</div>';

  const snap = await get(ref(db, 'promoCodes'));
  const codes = snap.val() || {};
  const entries = Object.entries(codes).sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) {
    listEl.innerHTML = '<div class="small muted">Zatiaľ žiadne kódy.</div>';
    return;
  }

  listEl.innerHTML = entries.map(([code, c]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:6px 8px;border-bottom:1px solid var(--card-border);font-size:13px">
      <div>
        <strong>${code}</strong>
        <span class="small muted" style="margin-left:6px">${c.amount}🪙 · ${c.usedCount || 0}/${c.maxUses ?? '∞'} · ${c.active ? '🟢' : '🔴'}</span>
      </div>
      <button class="btn promo-toggle-btn" data-code="${code}" data-active="${c.active ? '1' : '0'}" style="font-size:11px;padding:3px 8px">
        ${c.active ? 'Deaktivovať' : 'Aktivovať'}
      </button>
    </div>
  `).join('');

  listEl.querySelectorAll('.promo-toggle-btn').forEach(btn => {
    btn.onclick = async () => {
      const code = btn.dataset.code;
      const nowActive = btn.dataset.active === '1';
      await update(ref(db, `promoCodes/${code}`), { active: !nowActive });
      await loadPromoList(panel, db, ref, get, update);
    };
  });
}

/* =====================================================
   ⚖️ SENÁTY – skupinová súťaž
   ===================================================== */
let senatyMineCache = [];

async function initSenaty() {
  const nick = localStorage.getItem('playerNick');
  if (!nick) return;
  await settlePendingSenatSpory();
  await settleSenatLeaderboards();
  await renderSenatyCard(nick);
  setupSenatyButtons(nick);
  renderSenatyMiniLeaderboard();
}

async function renderSenatyCard(nick) {
  const noneBox = document.getElementById('senatyNoneBox');
  const mineBox = document.getElementById('senatyMineBox');
  if (!noneBox || !mineBox) return;

  senatyMineCache = await getMojeSenaty(nick);

  if (!senatyMineCache.length) {
    noneBox.style.display = 'block';
    mineBox.innerHTML = '';
    return;
  }

  noneBox.style.display = 'none';

  const items = await Promise.all(senatyMineCache.map(async (s) => {
    const count = Object.keys(s.members || {}).length;
    const iamPredseda = s.members && s.members[nick] && s.members[nick].role === 'predseda';
    const statusLabel = s.status === 'active' ? '🟢 Súťažný' : `🟡 Zostavuje sa (${count}/3)`;

    let pendingHtml = '';
    const spory = await getSporyForSenat(s.id);
    const myPending = spory.find(sp => {
      if (sp.status !== 'running') return false;
      const mine = (sp.scores && sp.scores[s.id] && typeof sp.scores[s.id][nick] === 'number');
      return !mine && sp.deadline > Date.now();
    });
    if (myPending) {
      const otherSenatId = myPending.challenger === s.id ? myPending.opponent : myPending.challenger;
      const otherSenat = await getSenat(otherSenatId);
      const hoursLeft = Math.max(0, Math.round((myPending.deadline - Date.now()) / (60 * 60 * 1000)));
      pendingHtml = `
        <div class="small" style="margin-top:6px;padding:8px 10px;background:rgba(47,158,143,0.1);border-radius:8px">
          ⚖️ Máš odohrať zápas proti <strong>${escapeHtml(otherSenat ? otherSenat.name : 'neznáma trieda')}</strong>!
          Zostáva ${hoursLeft} h.
          <button class="btn btn-primary senat-play-spor-btn" data-spor-id="${myPending.id}" data-senat-id="${s.id}" style="margin-top:6px;width:100%;font-size:12px;padding:4px 10px">▶️ Odohrať</button>
        </div>
      `;
    }

    return `
      <div class="senat-item" style="border:1px solid var(--card-border, rgba(0,0,0,0.08));border-radius:10px;padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${escapeHtml(s.name)}</strong>
          <span class="small muted">${statusLabel}</span>
        </div>
        <div class="small muted" style="margin-top:4px">${count} členov · V/R/P ${s.wins || 0}/${s.draws || 0}/${s.losses || 0} · ${s.points || 0} b.</div>
        <button class="btn senat-manage-btn" data-senat-id="${s.id}" style="margin-top:8px;font-size:12px;padding:4px 10px">
          ${iamPredseda ? 'Spravovať' : 'Zobraziť'}
        </button>
        ${pendingHtml}
      </div>
    `;
  }));

  mineBox.innerHTML = items.join('');

  mineBox.querySelectorAll('.senat-manage-btn').forEach(btn => {
    btn.onclick = () => openSenatDetailModal(btn.dataset.senatId, nick);
  });

  mineBox.querySelectorAll('.senat-play-spor-btn').forEach(btn => {
    btn.onclick = async () => {
      const result = await startSenatSporPlay(btn.dataset.sporId, btn.dataset.senatId);
      if (!result.ok) alert(result.message || 'Nepodarilo sa spustiť zápas.');
    };
  });

  // Ak ešte nie je uložená explicitná localStorage preferencia zbalenia,
  // rozbal kartu (hráč je v senáte -> default rozbalená).
  const card = document.querySelector('.highlight-senaty');
  if (card && localStorage.getItem('mColl:senaty') === null) {
    card.classList.remove('m-collapsed');
  }
}

function setupSenatyButtons(nick) {
  const foundBtn = document.getElementById('foundSenatBtn');
  if (foundBtn) foundBtn.onclick = () => openFoundSenatModal(nick);

  const inviteBtn = document.getElementById('haveInviteBtn');
  if (inviteBtn) inviteBtn.onclick = () => openHaveInviteModal(nick);
}

function openFoundSenatModal(nick) {
  const old = document.getElementById('foundSenatModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'foundSenatModal';
  modal.className = 'avatar-modal';
  modal.innerHTML = `
    <div class="avatar-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0">⚖️ Založiť triedu</h3>
        <button class="btn" id="closeFoundSenatModal">✕</button>
      </div>
      <input type="text" id="foundSenatNameInput" class="form-input" placeholder="Názov triedy (napr. 3.B Gymnázium Ružinov)" maxlength="30" style="margin-bottom:8px"/>
      <div id="foundSenatMsg" class="small" style="min-height:16px;margin-bottom:8px;color:var(--muted)"></div>
      <button class="btn btn-primary" id="foundSenatSubmitBtn" style="width:100%">Založiť</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('closeFoundSenatModal').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  document.getElementById('foundSenatSubmitBtn').onclick = async () => {
    const name = document.getElementById('foundSenatNameInput').value;
    const msg = document.getElementById('foundSenatMsg');
    msg.textContent = 'Zakladám...';
    const result = await createSenat(name);
    if (!result.ok) {
      msg.textContent = `❌ ${result.message}`;
      msg.style.color = '#dc2626';
      return;
    }
    modal.remove();
    showRewardToast(`⚖️ Trieda ${result.name} založená!`);
    await renderSenatyCard(nick);
    openSenatDetailModal(result.senatId, nick);
  };
}

function openHaveInviteModal(nick) {
  const raw = window.prompt('Vlož pozývací link alebo ID triedy:');
  if (!raw) return;
  let senatId = raw.trim();
  try {
    const url = new URL(raw);
    const param = url.searchParams.get('senat');
    if (param) senatId = param;
  } catch (e) {
    // nie je URL – berieme ako priame ID
  }
  handleSenatJoin(senatId, nick);
}

async function handleSenatJoin(senatId, nick) {
  const result = await joinSenat(senatId, nick);
  if (!result.ok) {
    alert(result.message || 'Nepodarilo sa pridať do triedy.');
    return;
  }
  showRewardToast(`⚖️ Pridal/a si sa do triedy ${result.senatName}!`);
  await renderSenatyCard(nick);
}

/* ?senat=ID – otvorenie pozývacieho linku (rovnaký vzor ako ?duel=ID) */
async function checkSenatInviteLink() {
  const params = new URLSearchParams(window.location.search);
  const senatId = params.get('senat');
  if (!senatId) return;

  const senat = await getSenat(senatId);
  const nick = localStorage.getItem('playerNick');

  const modal = document.createElement('div');
  modal.id = 'senatInviteModal';
  modal.className = 'avatar-modal';

  if (!senat) {
    modal.innerHTML = `
      <div class="avatar-panel">
        <h3>⚖️ Trieda neexistuje</h3>
        <p class="small muted">Pozývací link už nie je platný.</p>
        <button class="btn btn-primary" id="closeSenatInviteModal" style="width:100%">Zavrieť</button>
      </div>`;
  } else {
    const count = Object.keys(senat.members || {}).length;
    modal.innerHTML = `
      <div class="avatar-panel">
        <h3>⚖️ Trieda ${escapeHtml(senat.name)} ťa pozýva!</h3>
        <p class="small muted">${count}/5 členov · ${senat.status === 'active' ? 'súťažná trieda' : 'zostavuje sa'}</p>
        <div id="senatInviteMsg" class="small" style="min-height:16px;margin:8px 0;color:var(--muted)"></div>
        <button class="btn btn-primary" id="senatInviteJoinBtn" style="width:100%;margin-bottom:8px">Pridať sa</button>
        <button class="btn" id="closeSenatInviteModal" style="width:100%">Zavrieť</button>
      </div>`;
  }

  document.body.appendChild(modal);

  function closeSenatInvite() {
    modal.remove();
    const url = new URL(window.location.href);
    url.searchParams.delete('senat');
    window.history.replaceState({}, '', url);
  }

  modal.onclick = e => { if (e.target === modal) closeSenatInvite(); };
  document.getElementById('closeSenatInviteModal').onclick = closeSenatInvite;

  const joinBtn = document.getElementById('senatInviteJoinBtn');
  if (joinBtn) {
    joinBtn.onclick = async () => {
      if (!nick) {
        document.getElementById('senatInviteMsg').textContent = 'Zadaj najprv nick v hlavičke.';
        return;
      }
      const result = await joinSenat(senatId, nick);
      if (!result.ok) {
        document.getElementById('senatInviteMsg').textContent = `❌ ${result.message}`;
        return;
      }
      closeSenatInvite();
      showRewardToast(`⚖️ Pridal/a si sa do triedy ${result.senatName}!`);
      await renderSenatyCard(nick);
    };
  }
}

/* Detail/správa senátu (predseda: premenovať/pozvať/vyhodiť/zrušiť;
   člen: zobraziť/odísť) */
function openSenatDetailModal(senatId, nick) {
  const senat = senatyMineCache.find(s => s.id === senatId);
  if (!senat) return;
  const iamPredseda = senat.members && senat.members[nick] && senat.members[nick].role === 'predseda';

  const old = document.getElementById('senatDetailModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'senatDetailModal';
  modal.className = 'avatar-modal';

  const membersHtml = Object.entries(senat.members || {}).map(([mNick, m]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0">
      <span>${escapeHtml(mNick)} ${m.role === 'predseda' ? '👑' : ''}</span>
      ${iamPredseda && mNick !== nick ? `<button class="btn senat-kick-btn" data-nick="${escapeHtml(mNick)}" style="font-size:11px;padding:2px 8px">Vyhodiť</button>` : ''}
    </div>
  `).join('');

  const inviteLink = getInviteLink(senatId);

  modal.innerHTML = `
    <div class="avatar-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">⚖️ ${escapeHtml(senat.name)}</h3>
        <button class="btn" id="closeSenatDetailModal">✕</button>
      </div>
      <div class="small muted" style="margin-bottom:10px">${senat.status === 'active' ? '🟢 Súťažná trieda' : '🟡 Zostavuje sa'} · V/R/P ${senat.wins || 0}/${senat.draws || 0}/${senat.losses || 0} · ${senat.points || 0} b.</div>
      <div style="margin-bottom:12px">${membersHtml}</div>
      ${iamPredseda ? `
        <button class="btn btn-primary" id="senatInviteShareBtn" style="width:100%;margin-bottom:8px">📤 Pozvať</button>
        ${senat.status === 'active' ? `<button class="btn" id="senatChallengeBtn" style="width:100%;margin-bottom:8px">⚔️ Vyzvať inú triedu</button>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <input type="text" id="senatRenameInput" class="form-input" placeholder="Nový názov" value="${escapeHtml(senat.name)}"/>
          <button class="btn" id="senatRenameBtn">Premenovať</button>
        </div>
        <button class="btn" id="senatDisbandBtn" style="width:100%;color:#dc2626">🗑️ Zrušiť triedu</button>
      ` : `
        <button class="btn" id="senatLeaveBtn" style="width:100%">Odísť zo triedy</button>
      `}
      <div id="senatDetailMsg" class="small" style="margin-top:8px;color:var(--muted)"></div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.getElementById('closeSenatDetailModal').onclick = () => modal.remove();

  const msgEl = () => document.getElementById('senatDetailMsg');

  const shareBtn = document.getElementById('senatInviteShareBtn');
  if (shareBtn) {
    shareBtn.onclick = async () => {
      const message = buildInviteMessage(nick, senat.name, senatId);
      try {
        await navigator.clipboard.writeText(message);
        msgEl().textContent = '✅ Pozvánka skopírovaná – stačí vložiť.';
      } catch (e) {
        window.prompt('Skopíruj správu manuálne:', message);
      }
      if (navigator.share) {
        navigator.share({ title: 'Pozvánka do triedy – Finančná liga', text: message, url: inviteLink }).catch(() => {});
      }
    };
  }

  const challengeBtn = document.getElementById('senatChallengeBtn');
  if (challengeBtn) {
    challengeBtn.onclick = () => openChallengeSenatModal(senatId, nick);
  }

  const renameBtn = document.getElementById('senatRenameBtn');
  if (renameBtn) {
    renameBtn.onclick = async () => {
      const newName = document.getElementById('senatRenameInput').value;
      const result = await renameSenat(senatId, newName, nick);
      if (!result.ok) { msgEl().textContent = `❌ ${result.message}`; return; }
      msgEl().textContent = '✅ Premenované.';
      await renderSenatyCard(nick);
      modal.remove();
    };
  }

  const disbandBtn = document.getElementById('senatDisbandBtn');
  if (disbandBtn) {
    disbandBtn.onclick = async () => {
      if (!confirm(`Naozaj zrušiť triedu ${senat.name}?`)) return;
      const result = await disbandSenat(senatId, nick);
      if (!result.ok) { msgEl().textContent = `❌ ${result.message}`; return; }
      modal.remove();
      await renderSenatyCard(nick);
    };
  }

  const leaveBtn = document.getElementById('senatLeaveBtn');
  if (leaveBtn) {
    leaveBtn.onclick = async () => {
      if (!confirm(`Naozaj odísť zo triedy ${senat.name}?`)) return;
      const result = await leaveSenat(senatId, nick);
      if (!result.ok) { msgEl().textContent = `❌ ${result.message}`; return; }
      modal.remove();
      await renderSenatyCard(nick);
    };
  }

  modal.querySelectorAll('.senat-kick-btn').forEach(btn => {
    btn.onclick = async () => {
      const targetNick = btn.dataset.nick;
      if (!confirm(`Naozaj vyhodiť ${targetNick} zo triedy?`)) return;
      const result = await kickMember(senatId, targetNick, nick);
      if (!result.ok) { msgEl().textContent = `❌ ${result.message}`; return; }
      modal.remove();
      await renderSenatyCard(nick);
    };
  });
}

/* Výber súperovho senátu (aktívny, bez spoločného člena) + oblasť sporu. */
async function openChallengeSenatModal(challengerSenatId, nick) {
  const leaderboard = await getSenatLeaderboard();
  const challenger = senatyMineCache.find(s => s.id === challengerSenatId);
  const challengerMembers = new Set(Object.keys((challenger && challenger.members) || {}));
  const candidates = leaderboard.filter(s =>
    s.id !== challengerSenatId &&
    !Object.keys(s.members || {}).some(m => challengerMembers.has(m))
  );

  const old = document.getElementById('challengeSenatModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'challengeSenatModal';
  modal.className = 'avatar-modal';

  const areaNames = (typeof window.areas !== 'undefined') ? Object.keys(window.areas) : [];

  modal.innerHTML = `
    <div class="avatar-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">⚔️ Vyzvať triedu</h3>
        <button class="btn" id="closeChallengeSenatModal">✕</button>
      </div>
      ${candidates.length ? `
        <select id="challengeSenatSelect" class="form-input" style="margin-bottom:8px">
          ${candidates.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${s.points || 0} b.)</option>`).join('')}
        </select>
        <select id="challengeAreaSelect" class="form-input" style="margin-bottom:8px">
          ${areaNames.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('')}
        </select>
        <div id="challengeSenatMsg" class="small" style="min-height:16px;margin-bottom:8px;color:var(--muted)"></div>
        <button class="btn btn-primary" id="challengeSenatSubmitBtn" style="width:100%">Vyzvať</button>
      ` : `<p class="small muted">Zatiaľ niet iného súťažného triedy bez spoločného člena.</p>`}
    </div>
  `;

  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.getElementById('closeChallengeSenatModal').onclick = () => modal.remove();

  const submitBtn = document.getElementById('challengeSenatSubmitBtn');
  if (submitBtn) {
    submitBtn.onclick = async () => {
      const opponentSenatId = document.getElementById('challengeSenatSelect').value;
      const areaName = document.getElementById('challengeAreaSelect').value;
      const msg = document.getElementById('challengeSenatMsg');
      msg.textContent = 'Vyzývam...';
      const result = await challengeSenat(challengerSenatId, opponentSenatId, areaName, nick);
      if (!result.ok) { msg.textContent = `❌ ${result.message}`; return; }
      modal.remove();
      showRewardToast('⚔️ Zápas tried bol vytvorený!');
      await renderSenatyCard(nick);
    };
  }
}

/* =====================================================
   🏛️ FAKULTY – tretia úroveň súťaže
   ===================================================== */
/* Krátky odznak fakulty pri nicku v hlavičke (napr. "UK") namiesto
   plného názvu – výber/zmena fakulty žije v avatar/profil paneli.
   Kým hráč fakultu nezvolí, odznak sa NESKRÝVA, ale zobrazí výzvu
   "Vyber školu" – inak by výber fakulty nemal v hlavičke žiadnu
   viditeľnú stopu a hráč by netušil, že klik na avatara ho otvorí. */
async function updateFacultyBadge() {
  const nick = localStorage.getItem('playerNick');
  const badge = document.getElementById('facultyBadge');
  if (!nick || !badge) return;

  const info = await getFacultyBadge(nick);
  if (!info) {
    badge.textContent = '🏛️ Vyber školu';
    badge.title = 'Klikni a vyber si školu/vysokú školu';
    badge.style.display = 'inline-flex';
    return;
  }
  badge.textContent = info.abbrev;
  badge.title = info.name;
  badge.style.display = 'inline-flex';
}

async function initFaculty() {
  const nick = localStorage.getItem('playerNick');
  if (!nick) return;

  const select = document.getElementById('facultySelect');
  const statusLine = document.getElementById('facultyStatusLine');
  if (!select) return;

  select.innerHTML = getFacultyList().map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');

  const current = await getPlayerFaculty(nick);
  if (current) select.value = current;

  renderFacultyMiniLeaderboard();

  const saveBtn = document.getElementById('saveFacultyBtn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const facultyId = select.value;
      statusLine.textContent = 'Ukladám...';
      const result = await setPlayerFaculty(nick, facultyId);
      if (!result.ok) {
        statusLine.textContent = `❌ ${result.message}`;
        return;
      }
      statusLine.textContent = '✅ Škola uložená.';
      renderFacultyMiniLeaderboard();
      updateFacultyBadge();
    };
  }
}

/* =====================================================
   👥 SKUPINY (akademická vrstva) – študentský pohľad v profile
   modáli: pripojenie kódom + zoznam vlastných členstiev s odpojením.
   ===================================================== */
async function renderMyGroupsList(nick) {
  const box = document.getElementById('myGroupsList');
  if (!box) return;
  const myGroups = await getMyMemberGroups(nick);
  if (!myGroups.length) {
    box.textContent = 'Zatiaľ nie si členom žiadnej skupiny.';
    return;
  }
  box.innerHTML = myGroups.map(g => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:4px 0">
      <span>${escapeHtml(g.name)}</span>
      <button class="btn leave-group-btn" data-id="${g.id}" data-name="${escapeHtml(g.name)}" style="padding:2px 8px;font-size:12px">Odpojiť sa</button>
    </div>
  `).join('');

  box.querySelectorAll('.leave-group-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`Naozaj sa odpojiť zo skupiny "${btn.dataset.name}"?`)) return;
      const result = await leaveGroup(btn.dataset.id, nick);
      if (!result.ok) { alert(result.message); return; }
      renderMyGroupsList(nick);
    };
  });
}

async function initGroupsProfile() {
  const nick = localStorage.getItem('playerNick');
  if (!nick) return;

  const joinBtn = document.getElementById('joinGroupBtn');
  const codeInput = document.getElementById('joinGroupCodeInput');
  const statusLine = document.getElementById('joinGroupStatusLine');
  if (!joinBtn) return;

  joinBtn.onclick = async () => {
    statusLine.textContent = 'Pripájam...';
    const result = await joinGroupByCode(codeInput.value, nick);
    if (!result.ok) {
      statusLine.textContent = `❌ ${result.message}`;
      return;
    }
    statusLine.textContent = `✅ Pripojil/a si sa do skupiny "${result.groupName}".`;
    codeInput.value = '';
    renderMyGroupsList(nick);
    renderMyAssignmentsList(nick);
  };

  renderMyGroupsList(nick);
  renderMyAssignmentsList(nick);
}

/* =====================================================
   📝 MOJE TESTY (akademická vrstva KROK 2) – študentský pohľad
   v profile modáli: zoznam testov naprieč vlastnými skupinami,
   stav (nadchádzajúci/aktívny/uzavretý), spustenie a odovzdanie.
   ===================================================== */
async function renderMyAssignmentsList(nick) {
  const box = document.getElementById('myAssignmentsList');
  if (!box) return;

  const myGroups = await getMyMemberGroups(nick);
  const groupIds = myGroups.map(g => g.id);
  const groupNameById = {};
  myGroups.forEach(g => { groupNameById[g.id] = g.name; });

  const tests = await getAssignmentsForGroupIds(groupIds);
  if (!tests.length) {
    box.textContent = 'Zatiaľ nemáš žiadne priradené testy.';
    return;
  }

  const rows = await Promise.all(tests.map(async a => ({
    a, status: assignmentStatus(a), myResult: await getMyResult(a.id, nick)
  })));

  box.innerHTML = rows.map(({ a, status, myResult }) => {
    let right;
    if (myResult) {
      const pct = myResult.total ? Math.round((myResult.score / myResult.total) * 100) : 0;
      right = `<span style="color:var(--accent-3,#15803d)">✅ ${myResult.score}/${myResult.total} (${pct}%)</span>`;
    } else if (status === 'upcoming') {
      right = `<span class="small muted">🕓 Otvorí sa ${formatAssignmentDate(a.opensAt)}</span>`;
    } else if (status === 'closed') {
      right = `<span class="small muted">⚪ Uzavretý, nenapísal/a si</span>`;
    } else {
      right = `<button class="btn take-assignment-btn" data-id="${a.id}" style="padding:2px 10px;font-size:12px">▶️ Spustiť</button>`;
    }
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--card-border)">
        <div>
          <div style="font-weight:600">${escapeHtml(a.title)}</div>
          <div class="small muted">${escapeHtml(groupNameById[a.groupId] || '')} · ${a.questions.length} otázok</div>
        </div>
        <div style="flex-shrink:0">${right}</div>
      </div>`;
  }).join('');

  box.querySelectorAll('.take-assignment-btn').forEach(btn => {
    btn.onclick = () => openTakeAssignmentModal(btn.dataset.id, nick);
  });
}

function shuffleArrayCopy(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function openTakeAssignmentModal(assignmentId, nick) {
  const old = document.getElementById('takeAssignmentModal');
  if (old) old.remove();

  const assignment = await getAssignment(assignmentId);
  if (!assignment) { alert('Test neexistuje.'); return; }

  const status = assignmentStatus(assignment);
  if (status !== 'open') { alert('Tento test momentálne nie je možné spustiť.'); return; }

  const modal = document.createElement('div');
  modal.id = 'takeAssignmentModal';
  modal.className = 'avatar-modal';
  modal.style.zIndex = '10000';
  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  function renderIntro() {
    modal.innerHTML = `
      <div class="avatar-panel">
        <h3 style="margin-top:0">📝 ${escapeHtml(assignment.title)}</h3>
        <p class="small muted">${assignment.questions.length} otázok · garant tvojej skupiny uvidí tvoje meno, skóre a chybné otázky z tohto testu. Máš len JEDEN pokus.</p>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn" id="taCancelBtn" style="flex:1">Zrušiť</button>
          <button class="btn btn-primary" id="taStartBtn" style="flex:1">Spustiť test</button>
        </div>
      </div>
    `;
    document.getElementById('taCancelBtn').onclick = () => modal.remove();
    document.getElementById('taStartBtn').onclick = renderForm;
  }

  function renderForm() {
    const shuffledQuestions = assignment.questions.map(q => ({
      question: q.question,
      options: shuffleArrayCopy(q.options)
    }));

    modal.innerHTML = `
      <div class="avatar-panel">
        <h3 style="margin-top:0">📝 ${escapeHtml(assignment.title)}</h3>
        <form id="taForm">
          ${shuffledQuestions.map((q, i) => `
            <div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--card-border)">
              <div style="font-weight:600;margin-bottom:6px">${i + 1}. ${escapeHtml(q.question)}</div>
              ${q.options.map(opt => `
                <label class="small" style="display:block;padding:3px 0">
                  <input type="radio" name="ta-q${i}" value="${escapeHtml(opt)}"/> ${escapeHtml(opt)}
                </label>
              `).join('')}
            </div>
          `).join('')}
          <div id="taMsg" class="small" style="min-height:16px;margin-bottom:8px;color:var(--muted)"></div>
          <button type="submit" class="btn btn-primary" style="width:100%">Odovzdať test</button>
        </form>
      </div>
    `;

    document.getElementById('taForm').onsubmit = async (e) => {
      e.preventDefault();
      const submitBtn = modal.querySelector('button[type="submit"]');
      const msg = document.getElementById('taMsg');
      const answers = {};
      shuffledQuestions.forEach((q, i) => {
        const checked = modal.querySelector(`input[name="ta-q${i}"]:checked`);
        if (checked) answers[i] = checked.value;
      });
      submitBtn.disabled = true;
      msg.textContent = 'Odovzdávam...';
      const result = await submitAssignment(assignmentId, answers);
      if (!result.ok) {
        submitBtn.disabled = false;
        msg.textContent = `❌ ${result.message}`;
        msg.style.color = '#b91c1c';
        return;
      }
      renderResult(result);
    };
  }

  function renderResult(result) {
    modal.innerHTML = `
      <div class="avatar-panel">
        <h3 style="margin-top:0">✅ Test odovzdaný</h3>
        <p>Skóre: <strong>${result.score}/${result.total}</strong> (${result.pct}%)</p>
        ${result.reward > 0 ? `<p class="small" style="color:var(--accent-3,#15803d)">+${result.reward}🪙</p>` : ''}
        <button class="btn btn-primary" id="taCloseBtn" style="width:100%;margin-top:8px">Zavrieť</button>
      </div>
    `;
    document.getElementById('taCloseBtn').onclick = () => {
      modal.remove();
      renderMyAssignmentsList(nick);
    };
    if (result.reward > 0) showRewardToast(`+${result.reward}🪙 za test!`);
  }

  renderIntro();
}

async function renderFacultyMiniLeaderboard() {
  const box = document.getElementById('facultyLeaderboardBox');
  if (!box) return;
  const list = await getFacultyLeaderboard();
  if (!list.length) {
    box.innerHTML = '<div class="small muted">Zatiaľ žiadne aktívne školy.</div>';
    return;
  }
  box.innerHTML = list.map((f, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:8px 0;border-bottom:1px solid var(--card-border, rgba(0,0,0,0.06))">
      <div><strong>${i + 1}.</strong> ${escapeHtml(f.name)}
        <span class="small muted">(${f.activePlayers} aktívnych)</span></div>
      <div>${f.average.toFixed(1)} b./hráč <span class="small muted">(spolu ${f.points})</span></div>
    </div>
  `).join('');
}

/* Prepínač Jednotlivci/Senáty/Fakulty pri #leaderboardSection. */
function setupLeaderboardModeToggle() {
  const chips = document.querySelectorAll('.lb-mode-chip');
  const individualBox = document.getElementById('individualLeaderboardBox');
  const senatBox = document.getElementById('senatLeaderboardBox');
  const facultyBox = document.getElementById('facultyFullLeaderboardBox');
  const title = document.getElementById('leaderboardTitle');
  const subtitle = document.getElementById('leaderboardSubtitle');
  if (!chips.length) return;

  const boxesByMode = {
    individual: individualBox,
    senaty: senatBox,
    školy: facultyBox
  };
  const titlesByMode = {
    individual: ['Rebríček súbojov', 'Najlepší hráči súbojov'],
    senaty: ['Rebríček tried', 'Najlepšie triedy podľa bodov'],
    školy: ['Rebríček fakúlt', 'Priemer bodov na aktívneho hráča']
  };

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const mode = chip.dataset.lbMode;

      Object.entries(boxesByMode).forEach(([m, box]) => {
        if (box) box.style.display = m === mode ? 'block' : 'none';
      });
      const [t, s] = titlesByMode[mode] || titlesByMode.individual;
      title.textContent = t;
      subtitle.textContent = s;

      if (mode === 'senaty') renderSenatLeaderboardFull();
      else if (mode === 'školy') renderFacultyLeaderboardFull();
    });
  });
}

async function renderFacultyLeaderboardFull() {
  const box = document.getElementById('facultyFullLeaderboard');
  if (!box) return;
  const list = await getFacultyLeaderboard();
  if (!list.length) {
    box.innerHTML = '<div class="small muted">Zatiaľ žiadne aktívne školy.</div>';
    return;
  }
  box.innerHTML = list.map((f, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:8px 0;border-bottom:1px solid var(--card-border, rgba(0,0,0,0.06))">
      <div><strong>${i + 1}.</strong> ${escapeHtml(f.name)}
        <span class="small muted">(${f.activePlayers} aktívnych)</span></div>
      <div>${f.average.toFixed(1)} b./hráč <span class="small muted">(spolu ${f.points})</span></div>
    </div>
  `).join('');
}

async function renderSenatLeaderboardFull() {
  const box = document.getElementById('senatLeaderboard');
  if (!box) return;
  const list = await getSenatLeaderboard();
  if (!list.length) {
    box.innerHTML = '<div class="small muted">Zatiaľ žiadne súťažné triedy.</div>';
    return;
  }
  box.innerHTML = list.map((s, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:8px 0;border-bottom:1px solid var(--card-border, rgba(0,0,0,0.06))">
      <div><strong>${i + 1}.</strong> ${escapeHtml(s.name)}
        <span class="small muted">(${Object.keys(s.members || {}).length} členov)</span></div>
      <div>${s.points || 0} b. <span class="small muted">(${s.wins || 0}/${s.draws || 0}/${s.losses || 0})</span></div>
    </div>
  `).join('');
}

/* Mini rebríček TOP 3 senátov (plný prepínateľný rebríček je samostatná úloha) */
async function renderSenatyMiniLeaderboard() {
  const box = document.getElementById('senatyMiniLeaderboard');
  if (!box || !window.db) return;
  try {
    const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const snap = await get(ref(window.db, 'senaty'));
    const all = snap.exists() ? Object.values(snap.val()) : [];
    const top3 = all.filter(s => s.status === 'active').sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 3);
    if (!top3.length) {
      box.textContent = 'Zatiaľ žiadne súťažné triedy.';
      return;
    }
    box.innerHTML = top3.map((s, i) => `${i + 1}. ${escapeHtml(s.name)} – ${s.points || 0} b.`).join('<br>');
  } catch (e) {
    box.textContent = 'Rebríček sa nepodarilo načítať.';
  }
}

/* =====================================================
   GARANČNÁ PEČAŤ NA OTÁZKACH
   ===================================================== */

// Zobraz tlačidlo "Pridať pečať" pre garanta počas kvízu
export function initGuarantorSeal() {
  const role = localStorage.getItem('playerRole');
  if (role !== 'garant' && role !== 'admin') return;

  // Sleduj zmeny otázky a pridaj tlačidlo
  const observer = new MutationObserver(() => {
    const qBox = document.querySelector('.question-box');
    if (!qBox || document.getElementById('sealBtn')) return;

    const sealBtn = document.createElement('button');
    sealBtn.id = 'sealBtn';
    sealBtn.className = 'btn';
    sealBtn.style.cssText = 'margin-top:10px;font-size:12px;';
    sealBtn.textContent = '🔏 Pridať garančnú pečať';
    sealBtn.onclick = addGuarantorSeal;
    qBox.appendChild(sealBtn);

    // Zobraz existujúcu pečať
    showExistingSeal(qBox);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

async function addGuarantorSeal() {
  const nick = localStorage.getItem('playerNick');
  const area = document.getElementById('areaTitle')?.textContent?.trim();
  const qText = document.getElementById('qText')?.textContent?.trim();

  if (!nick || !area || !qText) return;

  const db = window.db;
  if (!db) return;

  const { ref, set } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");

  // Vytvor bezpečný kľúč z textu otázky
  const qKey = btoa(encodeURIComponent(qText.substring(0, 50))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 30);

  await set(ref(db, `seals/questions/${area}/${qKey}`), {
    nick,
    timestamp: Date.now(),
    questionText: qText.substring(0, 100)
  });

  const btn = document.getElementById('sealBtn');
  if (btn) {
    btn.textContent = '✅ Pečať pridaná';
    btn.disabled = true;
    btn.style.color = 'var(--accent-3)';
  }

  // Zobraz pečať
  showSealBadge(nick);
}

async function showExistingSeal(container) {
  const area = document.getElementById('areaTitle')?.textContent?.trim();
  const qText = document.getElementById('qText')?.textContent?.trim();
  if (!area || !qText || !window.db) return;

  const { ref, get } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");

  const qKey = btoa(encodeURIComponent(qText.substring(0, 50))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 30);
  const snap = await get(ref(window.db, `seals/questions/${area}/${qKey}`));

  if (snap.exists()) {
    showSealBadge(snap.val().nick);
  }
}

function showSealBadge(garantNick) {
  const qBox = document.querySelector('.question-box');
  if (!qBox || document.getElementById('sealBadgeOnQ')) return;

  const badge = document.createElement('div');
  badge.id = 'sealBadgeOnQ';
  badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;border-radius:999px;padding:3px 10px;margin-top:8px;border:1px solid rgba(214,158,46,0.4);background:rgba(214,158,46,0.08);color:#b45309;';
  badge.innerHTML = `🔏 Overené garantom <strong>${garantNick}</strong>`;
  qBox.insertBefore(badge, qBox.firstChild);
}


/* =====================================================
   PEČATE HRÁČA V DLAŽDICI
   ===================================================== */
async function displayPlayerSeals() {
  const db = window.db;
  const nick = localStorage.getItem('playerNick');
  if (!db || !nick) return;

  try {
    const { ref, get } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
    );
    const snap = await get(ref(db, `users/${nick}`));
    if (!snap.exists()) return;

    const data = snap.val();
    const seals = data.seals || {};
    const approved = data.approvedReports || 0;
    const role = data.role || 'student';
    const isAcademic = role === 'garant' || role === 'admin';

    const display = document.getElementById('sealDisplay');
    const badges = document.getElementById('sealBadges');
    if (!display || !badges) return;

    const facultyBadge = await getFacultyBadgeInfo(nick);

    if (approved > 0 || isAcademic || facultyBadge) {
      display.style.display = 'block';
      badges.innerHTML = [
        isAcademic   ? `<span class="seal-badge academic">🎓 Akademická pečať</span>` : '',
        seals.gold   ? `<span class="seal-badge gold">🥇 Zlatá ×${seals.gold}</span>` : '',
        seals.silver ? `<span class="seal-badge silver">🥈 Strieborná ×${seals.silver}</span>` : '',
        seals.bronze ? `<span class="seal-badge bronze">🥉 Bronzová ×${seals.bronze}</span>` : '',
        facultyBadge ? `<span class="seal-badge faculty">🏛️ Putovná pečať školy</span>` : '',
        `<span class="small muted">Uznaných: ${approved}</span>`
      ].join('');
    }
  } catch(e) {}
}

/* =====================================================
   ROLA BADGE
   ===================================================== */
function initRoleBadge() {
  const badge = document.getElementById('roleBadge');
  const label = document.getElementById('roleLabel');
  if (!badge || !label) return;

  const firebaseRole = localStorage.getItem('playerFirebaseRole') || 'student';
  const currentView = localStorage.getItem('playerRole') || firebaseRole;

  label.textContent = currentView;
  badge.setAttribute('data-role', currentView);
  badge.style.cursor = 'pointer';
  badge.title = 'Klikni pre prepnutie roly';

  // Čítaj rolu v čase kliknutia (nie pri init - vtedy ešte Firebase nenačítaná)
  badge.onclick = () => {
    const fr = localStorage.getItem('playerFirebaseRole') || 'student';
    openRoleSwitcher(fr);
  };
}

function openRoleSwitcher(firebaseRole) {
  // Vždy vymaž starý modal a vytvor nový s aktuálnymi rolami
  const old = document.getElementById('roleSwitchModal');
  if (old) old.remove();
  let modal;

  // Dostupné roly podľa Firebase roly
  const available = firebaseRole === 'admin'
    ? ['admin', 'garant', 'student']
    : firebaseRole === 'garant'
    ? ['garant', 'student']
    : ['student'];

  const roleLabels = {
    admin: '👑 Admin',
    garant: '🔏 Garant',
    student: '👤 Študent'
  };

  modal = document.createElement('div');
  modal.id = 'roleSwitchModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';

  modal.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:16px;padding:24px;min-width:280px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <h3 style="margin:0 0 16px 0">Prepnúť zobrazenie</h3>
      <div style="display:flex;flex-direction:column;gap:8px" id="roleOptions">
        ${available.map(r => `
          <button class="btn role-switch-btn ${localStorage.getItem('playerRole')===r?'btn-primary':''}"
            data-role="${r}" style="text-align:left;padding:10px 14px;font-size:14px">
            ${roleLabels[r]}
            ${localStorage.getItem('playerRole')===r ? ' ✓' : ''}
          </button>
        `).join('')}
      </div>
      <button class="btn" id="closeRoleSwitch" style="width:100%;margin-top:12px">Zavrieť</button>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#closeRoleSwitch').onclick = () => { modal.style.display = 'none'; };
  modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };

  modal.querySelectorAll('.role-switch-btn').forEach(btn => {
    btn.onclick = () => {
      const newRole = btn.dataset.role;
      localStorage.setItem('playerRole', newRole);

      const label = document.getElementById('roleLabel');
      const badge = document.getElementById('roleBadge');
      if (label) label.textContent = newRole;
      if (badge) badge.setAttribute('data-role', newRole);

      modal.style.display = 'none';

      // Obnov admin panel
      const db = window.db;
      if (db) renderAdminPanel(newRole, db, null, null, null, null, null);
      initRoleSystem();
    };
  });
}

/* =====================================================
   MODAL PRÍSTUPOVÉHO KÓDU
   ===================================================== */
/* ⚠️ Veľký, VÝRAZNÝ (nie drobný text) blok – zabudnutý PIN znamená
   trvalú stratu prístupu k účtu z iného zariadenia (appka nemá e-mail
   ani inú cestu na reset), viď pinAuth.js. */
const PIN_WARNING_HTML = `
  <div style="background:rgba(239,68,68,0.12);border:2px solid rgba(239,68,68,0.5);
       border-radius:12px;padding:14px 16px;margin-bottom:16px">
    <div style="font-weight:800;font-size:15px;color:#dc2626;margin-bottom:4px">⚠️ PIN sa NEDÁ obnoviť</div>
    <div class="small" style="line-height:1.5">
      Appka nemá e-mail ani iný spôsob obnovy. Ak PIN zabudneš, o prístup
      k účtu z iného zariadenia prídeš natrvalo. <strong>Zapíš si ho hneď teraz.</strong>
    </div>
  </div>`;

/* Sekcia PIN-u, pripojená pod existujúci obsah "kódu" v oboch vetvách
   nižšie (Fáza 1 – zatiaľ POPRI starom kóde, nie namiesto neho;
   vyčistenie starého kódu je až Fáza 4). */
function renderPinSection(hasPin) {
  return `
    <div style="border-top:1px solid var(--card-border,#eee);margin-top:16px;padding-top:16px">
      <div style="font-weight:600;margin-bottom:6px">🔒 PIN pre prenos účtu</div>
      ${hasPin
        ? `<p class="small muted" style="margin-bottom:10px">PIN je nastavený ✓ – použi ho spolu s nickom na inom zariadení.</p>
           <button class="btn" id="pinSetupBtn" style="width:100%">Zmeniť PIN</button>`
        : `<p class="small muted" style="margin-bottom:10px">Zatiaľ nenastavený – bez PIN-u ťa na inom zariadení pustí už len samotný nick (menej bezpečné, ale nič sa nezamyká).</p>
           <button class="btn btn-primary" id="pinSetupBtn" style="width:100%">Nastaviť PIN</button>`}
    </div>`;
}

/* Odhlásenie = LEN lokálne vyčistenie identity na TOMTO zariadení.
   Firebase (users/{nick}/...) sa NIKDY nemaže – progres ostáva na
   serveri a po opätovnom zadaní rovnakého nicku (+ PIN-u, ak je
   nastavený) sa načíta späť cez claimNick() (pinAuth.js). */
function renderLogoutSection() {
  return `
    <div style="border-top:1px solid var(--card-border,#eee);margin-top:16px;padding-top:16px">
      <button class="btn" id="logoutBtn" style="width:100%;color:#dc2626;border-color:rgba(220,38,38,0.4)">🚪 Odhlásiť sa (prepnúť účet)</button>
    </div>`;
}

/* Kľúče, ktoré na tomto zariadení tvoria "identitu"/lokálnu cache
   nick-viazaných dát. NEMAZAŤ: čisto UI preferencie, ktoré s nickom
   nesúvisia (lex_theme/theme, lexWelcomeSeen, lexGuideSeen, mColl:*
   zbalené sekcie, lexExamPersona/lexExamVoice) – tie majú ostať
   zachované aj po prepnutí účtu. */
function clearIdentityLocalStorage() {
  const keys = [
    'playerNick',
    'playerFirebaseRole',
    'playerRole',
    'financna-liga_code',
    'financna-liga_nick',
    'lex_paragrafy',
    'lex_avatar',
    'lex_games_played',
    'lex_memory_state',
    'lex_memory_leaderboard',
    'lex_reports'
  ];
  keys.forEach(k => localStorage.removeItem(k));

  // Viaceré cache typy sú PREFIXY (jeden kľúč na tému/oblasť), nie jeden
  // pevný kľúč – lex_answered_cases_ (cases.js), lex_memory_progress_ a
  // lex_memory_meta_ (memoryTrainer.js, bifľovačka – tieto sú lokálny
  // fallback keď Firebase nie je dostupné, takže bez nick-namespace v
  // kľúči samotnom; bez vyčistenia by po prepnutí nicku na tomto
  // zariadení mohli krátkodobo presvitať bifľovačka-dáta PREDCHÁDZAJÚCEHO
  // hráča, kým sa nenačíta Firebase).
  const prefixes = ['lex_answered_cases_', 'lex_memory_progress_', 'lex_memory_meta_'];
  const prefixed = Object.keys(localStorage).filter(k => prefixes.some(p => k.startsWith(p)));
  prefixed.forEach(k => localStorage.removeItem(k));

  return [...keys, ...prefixed];
}

function handleLogout(nick, hasPin) {
  const pinNote = hasPin
    ? '\n\n🔒 Máš nastavený PIN – budeš ho potrebovať pri návrate na tento účet.'
    : '';
  const ok = confirm(
    `Naozaj sa odhlásiť?\n\nProgres pod nickom „${nick}" zostáva bezpečne uložený na serveri – nič sa nezmaže. ` +
    `Späť sa dostaneš zadaním rovnakého nicku.${pinNote}`
  );
  if (!ok) return;

  const cleared = clearIdentityLocalStorage();
  console.log('🚪 Odhlásenie – vyčistené localStorage kľúče:', cleared);
  updateNickUI(null);
  window.location.reload();
}

/* Prepne obsah modalu na zadanie/zmenu PIN-u. NEPÝTA starý PIN – na
   tomto zariadení je nick už v localStorage, čo je jediný dôkaz
   identity, ktorý appka má (pozri hlavičku pinAuth.js). */
function showPinEntryView(nick, hasPin) {
  const content = document.getElementById('loginModalContent');
  if (!content) return;

  content.innerHTML = `
    <p class="small" style="margin-bottom:12px">${hasPin ? 'Nový PIN pre' : 'Nastav PIN pre'} nick <strong>${escapeHtml(nick)}</strong>:</p>
    ${PIN_WARNING_HTML}
    <input type="text" inputmode="numeric" pattern="[0-9]*" id="pinInput1" placeholder="PIN (4-6 číslic)"
      style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid var(--card-border,#ccc);margin-bottom:8px;font-size:16px;letter-spacing:2px;text-align:center" />
    <input type="text" inputmode="numeric" pattern="[0-9]*" id="pinInput2" placeholder="Zopakuj PIN"
      style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid var(--card-border,#ccc);margin-bottom:12px;font-size:16px;letter-spacing:2px;text-align:center" />
    <div id="pinEntryError" class="small" style="color:#dc2626;margin-bottom:8px;display:none"></div>
    <button class="btn btn-primary" id="pinSaveBtn" style="width:100%;margin-bottom:8px">Uložiť PIN</button>
    <button class="btn" id="pinCancelBtn" style="width:100%">Zrušiť</button>`;

  const errEl = document.getElementById('pinEntryError');
  const showErr = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };

  document.getElementById('pinCancelBtn').onclick = () => openLoginCodeModal();

  document.getElementById('pinSaveBtn').onclick = async () => {
    const p1 = document.getElementById('pinInput1').value.trim();
    const p2 = document.getElementById('pinInput2').value.trim();
    if (!isValidPin(p1)) { showErr('PIN musí mať 4 až 6 číslic.'); return; }
    if (p1 !== p2) { showErr('PIN-y sa nezhodujú.'); return; }

    const saveBtn = document.getElementById('pinSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukladám...';
    try {
      await setPin(nick, p1);
      alert('PIN uložený. Zapamätaj/zapíš si ho – nedá sa obnoviť.');
      openLoginCodeModal();
    } catch (e) {
      console.warn('⚠️ pinAuth: setPin zlyhalo', e);
      showErr(e.message || 'Uloženie PIN-u zlyhalo, skús to znova.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Uložiť PIN';
    }
  };
}

async function openLoginCodeModal() {
  const modal = document.getElementById('loginCodeModal');
  const content = document.getElementById('loginModalContent');
  if (!modal || !content) return;

  const nick = localStorage.getItem('playerNick');

  if (!nick) {
    content.innerHTML = `
      <p class="small" style="margin-bottom:16px">
        Zadaj najprv nick v hlavičke.
      </p>`;
    modal.style.display = 'flex';
    return;
  }

  // ⚠️ Zobraz modal HNEĎ so stavom "Načítavam...", nech nečaká na Firebase
  // predtým, než sa vôbec niečo ukáže (getPinStatus je async).
  modal.style.display = 'flex';

  const pinStatusPromise = getPinStatus(nick);

  // Cross-device prihlásenie rieši hlavné pole nicku (claimNick, Fáza 2) –
  // stačí zadať rovnaký nick (+ PIN, ak je nastavený) na inom zariadení.
  content.innerHTML = `
    <p class="small" style="margin-bottom:12px">
      Prihlásený/-á ako <strong>${nick}</strong>. Na inom zariadení sa k tomuto
      účtu dostaneš zadaním rovnakého nicku (+ PIN-u, ak ho máš nastavený).
    </p>
    <div id="pinSectionSlot">${renderPinSection(false)}</div>
    ${renderLogoutSection()}`;

  // Dorenderuj PIN sekciu, keď dôjde Firebase odpoveď (bez blokovania
  // zvyšku modalu vyššie).
  const { hasPin } = await pinStatusPromise;
  const slot = document.getElementById('pinSectionSlot');
  if (slot) slot.innerHTML = renderPinSection(hasPin);
  const pinBtn = document.getElementById('pinSetupBtn');
  if (pinBtn) pinBtn.onclick = () => showPinEntryView(nick, hasPin);
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = () => handleLogout(nick, hasPin);
}

/* =====================================================
   VÝZVA NA DUEL CEZ ZDIEĽATEĽNÝ LINK (?duel=ID)
   ===================================================== */
/* ============================================================
   NAHLÁSENIE Z INEJ STRÁNKY (Bifľovačka, ob-pravo-app)
   Tieto stránky nemajú vlastný reportModal, preto pri kliknutí na
   ich tlačidlo nahlásenia otvoria hlavnú stránku s parametrami
   ?report=1&area=...&src=...&qtext=... – tu ich spracujeme
   a z URL vyčistíme.
============================================================ */
function checkReportLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('report') !== '1') return;

  const area = params.get('area') || '';
  const src = params.get('src') || '';
  const qtext = params.get('qtext') || '';

  openReportModal({
    area,
    questionId: makeQuestionKey(src, qtext),
    questionText: qtext
  });

  params.delete('report');
  params.delete('area');
  params.delete('src');
  params.delete('qtext');
  const rest = params.toString();
  const cleanUrl = window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash;
  history.replaceState(null, '', cleanUrl);
}

/* ============================================================
   VZNIK NICKU BEZ RELOADU (A2a, 2026-08)

   Dovtedy sa nick ukladal na dvoch miestach a KAŽDÉ končilo inak:
     – pole v hlavičke (app.js) → setItem + window.location.reload(),
     – modál duel-linku (nižšie) → setItem + inline pokračovanie, ale
       BEZ dobehnutia zvyšku (hráč mal rozbehnutý duel, no avatar,
       § panel ani rola mu naskočili až pri ďalšom načítaní stránky).

   Reload bol jediné, čo zaručilo, že init() prebehne znova UŽ S NICKOM.
   Pre progresívny nick (A2b, A4, A5) je ale neprijateľný: prompt
   uprostred hry by stránku obnovil a hráč by prišiel o rozohranú
   aktivitu. Táto funkcia preto dobehne presne tie kroky, ktoré anon
   vetva vynechala – nič viac (inak by sa registrovali dvakrát).

   Zoznam vychádza z diagnostiky A2 Fázy 0; kroky, ktoré nick
   nepotrebujú (renderAreas, initDuelLeaderboard,
   initSealCache, initVideoSystem, initFeedbackSystem, …) sa ZÁMERNE
   nespúšťajú znova – bežali už pri štarte a sú na nicku nezávislé.

   ⚠️ NEVALIDUJE tvar nicku. Volajúci ho už overil (isValidNick +
   claimNick); táto funkcia rieši len nadviazanie stavu. Uložený nick
   z localStorage sa cez ňu nikdy nepúšťa – load cesta ostáva bez zmeny.

   Fail-soft: každý krok má vlastný try/catch. Keby jeden zlyhal (napr.
   Firebase výpadok pri načítaní roly), hráč má nick uložený a zvyšok
   appky beží ďalej – nepadne mu celá registrácia kvôli jednému modulu.
============================================================ */
async function claimNickInline(nick) {
  if (!nick) return;

  localStorage.setItem('playerNick', nick);
  updateNickUI(nick);

  const nickInput = $('nickname');
  if (nickInput) nickInput.value = nick;

  const step = async (label, fn) => {
    try { await fn(); }
    catch (e) { console.warn(`⚠️ claimNickInline: krok "${label}" zlyhal`, e); }
  };

  /* Avatar ako prvý – prináša § panel (onValue users/{nick}) aj streak,
     takže hráč vidí zmenu okamžite. Idempotenciu rieši initAvatarSystem
     sám (avatarSystemStarted). */
  await step('avatar', () => initAvatarSystem());
  await step('rola', () => initRoleSystem());
  await step('triedy', () => initSenaty());
  await step('výsledky vlastných výziev', () => announceOwnDuelResults());
  await step('školy – rebríček', () => settleFacultyLeaderboard());
  await step('školy – odznak', () => updateFacultyBadge());

  /* Dátumy bežia na pozadí a nikdy nesmú blokovať – rovnaký vzor
     ako pri štarte v init(). */
  import('./scripts/playerDates.js')
    .then(({ touchPlayerDates }) => touchPlayerDates(nick))
    .catch(e => console.warn('⚠️ playerDates: import zlyhal', e));

  console.log(`✅ Nick „${nick}" nadviazaný bez reloadu`);
}

/* app.js (pole v hlavičke) nemôže init.js importovať – init.js už
   importuje z app.js a vznikol by cyklus. Rovnaký vzor ako window.saveDuel
   či window.econAward. app.js má fallback na pôvodný reload, keby sa
   init.js nenačítal. */
window.claimNickInline = claimNickInline;

async function checkDuelChallengeLink() {
  const params = new URLSearchParams(window.location.search);
  const duelId = params.get('duel');
  if (!duelId) return;

  const db = window.db;
  if (!db) return;

  try {
    const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const snap = await get(ref(db, `duels/${duelId}`));
    const duel = snap.exists() ? snap.val() : null;

    if (!duel || duel.status !== 'pending') {
      showDuelChallengeModal(null, duelId);
      return;
    }
    showDuelChallengeModal(duel, duelId);
  } catch (e) {
    console.error('❌ checkDuelChallengeLink chyba:', e);
    showDuelChallengeModal(null, duelId);
  }
}

function closeDuelChallengeModal() {
  const modal = document.getElementById('duelChallengeModal');
  if (modal) modal.remove();

  // Odstráň ?duel= z URL bez znovunačítania stránky
  const url = new URL(window.location.href);
  url.searchParams.delete('duel');
  window.history.replaceState({}, '', url);
}

function showDuelChallengeModal(duel, duelId) {
  const old = document.getElementById('duelChallengeModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'duelChallengeModal';
  modal.className = 'duel-challenge-modal-overlay';

  if (!duel) {
    modal.innerHTML = `
      <div class="duel-challenge-modal">
        <div class="duel-challenge-title">⚔️ Výzva na súboj</div>
        <p class="small" style="margin:12px 0">Táto výzva už nie je aktívna.</p>
        <button class="btn btn-primary" id="closeDuelChallengeModal" style="width:100%">Zavrieť</button>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('closeDuelChallengeModal').onclick = closeDuelChallengeModal;
    modal.onclick = e => { if (e.target === modal) closeDuelChallengeModal(); };
    return;
  }

  const existingNick = localStorage.getItem('playerNick') || '';

  modal.innerHTML = `
    <div class="duel-challenge-modal">
      <div class="duel-challenge-title">⚔️ ${escapeHtml(duel.from)} ťa vyzýva na súboj z oblasti ${escapeHtml(duel.areaTitle)}!</div>
      <input type="text" id="duelChallengeNick" class="form-input" placeholder="Zadaj svoj nick..." value="${escapeHtml(existingNick)}" style="margin:14px 0" />
      <div id="duelChallengeMsg" class="small" style="min-height:16px;margin-bottom:8px"></div>
      <button class="btn btn-primary" id="acceptChallengeBtn" style="width:100%">Prijať výzvu</button>
    </div>`;

  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) closeDuelChallengeModal(); };

  document.getElementById('acceptChallengeBtn').onclick = async () => {
    const input = document.getElementById('duelChallengeNick');
    const msg = document.getElementById('duelChallengeMsg');
    const nick = input.value.trim();

    /* Validácia tvaru (A2a) – rovnaká ako v hlavičke, ale ZÁMERNE sa
       preskočí, keď hráč nechal predvyplnený vlastný uložený nick.
       Pole je totiž predvyplnené z localStorage (existingNick vyššie),
       takže vracajúci sa hráč s nickom z čias bez validácie (dlhý,
       s bodkou) by inak nemohol prijať výzvu vôbec – a to je práve
       najsilnejší virálny kanál. Validuje sa len naozaj NOVÝ nick. */
    if (nick !== localStorage.getItem('playerNick')) {
      const check = isValidNick(nick);
      if (!check.ok) {
        msg.textContent = check.reason;
        msg.style.color = 'var(--accent-3)';
        return;
      }
    }
    await acceptDuelChallenge(duel, duelId, nick, msg);
  };
}

async function acceptDuelChallenge(duel, duelId, nick, msgEl) {
  const db = window.db;
  if (!db) return;

  const { ref, get, update } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");

  // Over, že výzva ešte nebola medzičasom prijatá niekým iným
  const freshSnap = await get(ref(db, `duels/${duelId}`));
  const freshDuel = freshSnap.exists() ? freshSnap.val() : null;
  if (!freshDuel || freshDuel.status !== 'pending') {
    if (msgEl) { msgEl.textContent = 'Táto výzva už nie je aktívna.'; msgEl.style.color = 'var(--accent-3)'; }
    return;
  }

  // Rovnaká ochrana ako hlavné pole nicku (Fáza 2, app.js) – duel-link
  // NESMIE obísť PIN. Nový hráč (vetva A) aj legacy účet bez PIN-u
  // (vetva B) prejdú bez promptu; len chránený nick (vetva C) si PIN
  // vypýta – presne tak, ako pri ručnom zadaní nicku v hlavičke.
  let claim = await claimNick(nick, null);
  if (!claim.ok && claim.reason === 'pin-required') {
    const pinAttempt = prompt(`Nick „${nick}" existuje a je chránený PIN-om.\nZadaj PIN:`);
    if (!pinAttempt) return;
    claim = await claimNick(nick, pinAttempt);
  }
  if (!claim.ok) {
    if (msgEl) {
      msgEl.textContent = 'Nesprávny PIN pre tento nick. Skús znova, alebo si over, či si nick nezadal preklepom.';
      msgEl.style.color = 'var(--accent-3)';
    }
    return;
  }
  const isNewPlayer = claim.isNew;

  /* Bežný flow registrácie nicku – po novom cez spoločnú claimNickInline(),
     ktorá okrem uloženia nicku dobehne aj avatar, § panel, rolu, senáty
     a fakulty. Predtým sa tu robil len setItem + updateNickUI, takže hráč,
     ktorý prišiel cez duel-link, mal až do ďalšieho načítania stránky
     rozbehnutý duel bez avatara a bez § počítadla. */
  await claimNickInline(nick);

  window.currentUser = nick;
  window.currentDuelId = duelId;
  window.currentDuelMeta = freshDuel;
  window.currentDuel = freshDuel;
  window.duelQuestions = freshDuel.questions;
  window.currentOpponent = freshDuel.from;
  window.__pendingChallengeReward = { duelId, nick, isNewPlayer };

  await update(ref(db, `duels/${duelId}`), { status: 'accepted', acceptedBy: nick });

  closeDuelChallengeModal();

  if (typeof window.startDuelQuiz === 'function') {
    // Scroll na kvíz + zvýraznenie rieši priamo startDuelQuiz (quiz.js),
    // aby platili pre všetky vstupy, nielen pre prijatie výzvy linkom.
    window.startDuelQuiz(freshDuel.questions);
  } else {
    console.error('❌ startDuelQuiz() neexistuje!');
  }
}

/* =====================================================
   UDALOSTI
   ===================================================== */
function attachEvents() {
  const nextBtn = $('nextBtn');
  if (nextBtn) nextBtn.addEventListener('click', nextQ);

  const prevBtn = $('prevBtn');
  if (prevBtn) prevBtn.addEventListener('click', prevQ);

  const themeToggle = $('themeToggleBtn');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current =
        document.documentElement.getAttribute('data-theme') === 'dark'
          ? 'light' : 'dark';
      applyTheme(current);
    });
  }

  /* 🔥 Klik na avatar → modal výberu */
  const avatarWrap = $('avatarWrap');
  if (avatarWrap) {
    avatarWrap.addEventListener('click', openAvatarSelectModal);
    avatarWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openAvatarSelectModal();
    });
  }

  /* 🔥 Zmeniť avatara (základná sada – vždy dá zavrieť).
     Ikona palety už v lište nie je (zlúčená s avatarom) – vstup je teraz
     tlačidlo #openAvatarPickerFromSelect vnútri avatarového modálu, viď
     openAvatarSelectModal(). Táto vetva ostáva ako poistka, keby sa
     #changeAvatarBtn niekedy vrátil; bez neho je to no-op. */
  const changeAvatarBtn = $('changeAvatarBtn');
  if (changeAvatarBtn) {
    changeAvatarBtn.addEventListener('click', () => openAvatarPickerModal(false));
  }

  /* 🏛️ Odznak fakulty (aj výzva "Vyber školu") → ten istý panel ako klik na avatara */
  const facultyBadgeEl = $('facultyBadge');
  if (facultyBadgeEl) {
    facultyBadgeEl.addEventListener('click', openAvatarSelectModal);
  }

  /* 🔥 Rola badge */
  initRoleBadge();

  /* 🔥 Nahlasovanie + Súdna sieň */
  const reportBtn = document.getElementById('reportIssueBtn');
  if (reportBtn) reportBtn.addEventListener('click', () => {
    if (typeof window.openReportModal === 'function') window.openReportModal();
  });
  const courtroomBtn = document.getElementById('openCourtroomBtn');
  if (courtroomBtn) courtroomBtn.addEventListener('click', () => {
    if (typeof window.openCourtroomModal === 'function') window.openCourtroomModal();
  });

  /* 🔥 Zobraz pečate hráča */
  displayPlayerSeals();

  /* 🔥 Získaj § (reklamy + promo kódy) */
  /* Klik na § badge otvorí „Získaj §“ – badge nahradil samostatné tlačidlo
     #earnBtn, ktoré v lište zaniklo pri konsolidácii. */
  const parBadge = $('parBadge');
  if (parBadge) {
    parBadge.addEventListener('click', openEarnModal);
  }

  /* 🔥 Návod „Ako funguje LexArena" */
  initGuideSystem();

  /* 🔥 Uvítacie okno pre nového návštevníka */
  initWelcomeSystem();

  /* 🔥 Modal prístupového kódu */
  const loginDeviceBtn = $('loginDeviceBtn');
  if (loginDeviceBtn) {
    loginDeviceBtn.addEventListener('click', openLoginCodeModal);
  }
  const closeLoginModal = $('closeLoginModal');
  if (closeLoginModal) {
    closeLoginModal.addEventListener('click', () => {
      const m = $('loginCodeModal');
      if (m) m.style.display = 'none';
    });
  }

  /* 🔥 Kartičky Memory */
  const openMemoryBtn = $('openMemoryBtn');
  if (openMemoryBtn) {
    openMemoryBtn.addEventListener('click', async () => {
      const canPlay = await econCanPlay('memory');
      if (!canPlay) return;

      const modal = $('memoryModal');
      if (modal) { modal.style.display = 'flex'; modal.classList.add('open'); }

      const areaTiles = window.__areaTilesForGames;
      const areaQs = window.__areaQuestionsForGames;
      if (areaTiles && areaTiles.length && typeof window.buildMemoryFromTiles === 'function') {
        // 🃏 Dlaždice z JSON (pojem ↔ definícia)
        window.buildMemoryFromTiles(areaTiles);
      } else if (areaQs && areaQs.length && typeof window.buildMemoryFromQuestions === 'function') {
        // Fallback: otázka ↔ správna odpoveď
        window.buildMemoryFromQuestions(areaQs);
      } else if (window.__selectedAreaName) {
        // Vybraná oblasť je zatiaľ bez obsahu (napr. čiastočne naplnené dáta) –
        // nikdy nenahrádzať tichou náhradou z inej oblasti (mätúce).
        if (modal) { modal.style.display = 'none'; modal.classList.remove('open'); }
        showRewardToast(`🃏 Pre oblasť "${window.__selectedAreaName}" zatiaľ nie sú kartičky.`);
      } else if (typeof window.buildMemory === 'function') {
        window.buildMemory('TPH-A1');
      }
    });
  }

  const restartMemoryBtn = $('restartMemory');
  if (restartMemoryBtn) {
    restartMemoryBtn.addEventListener('click', async () => {
      const canPlay = await econCanPlay('memory');
      if (!canPlay) return;

      const areaTiles = window.__areaTilesForGames;
      const areaQs = window.__areaQuestionsForGames;
      if (areaTiles && areaTiles.length && typeof window.buildMemoryFromTiles === 'function') {
        window.buildMemoryFromTiles(areaTiles);
      } else if (areaQs && areaQs.length && typeof window.buildMemoryFromQuestions === 'function') {
        window.buildMemoryFromQuestions(areaQs);
      } else if (!window.__selectedAreaName && typeof window.buildMemory === 'function') {
        window.buildMemory('TPH-A1');
      }
    });
  }

  const closeMemoryBtn = $('closeMemory');
  if (closeMemoryBtn) {
    closeMemoryBtn.addEventListener('click', () => {
      const modal = $('memoryModal');
      if (modal) { modal.style.display = 'none'; modal.classList.remove('open'); }
    });
  }

  /* 🔥 Prípady z praxe */
  const openCasesBtn = $('openCasesBtn');
  if (openCasesBtn) {
    openCasesBtn.addEventListener('click', async () => {
      const canPlay = await econCanPlay('cases');
      if (!canPlay) return;

      const modal = $('casesModal');
      if (modal) { modal.style.display = 'flex'; modal.classList.add('open'); }

      const areaCases = window.__areaCasesForGames;
      const areaQs = window.__areaQuestionsForGames;
      const areaName = window.__selectedAreaName || '';
      if (areaCases && areaCases.length && typeof window.loadCasesFromJson === 'function') {
        // 📋 Skutočné prípady z JSON (viackrokové)
        window.loadCasesFromJson(areaCases, areaName);
      } else if (areaQs && areaQs.length && typeof window.loadCasesFromQuestions === 'function') {
        // Fallback: otázky ako jednoduché prípady
        window.loadCasesFromQuestions(areaQs, areaName);
      } else if (areaName) {
        if (modal) { modal.style.display = 'none'; modal.classList.remove('open'); }
        showRewardToast(`📋 Pre oblasť "${areaName}" zatiaľ nie sú prípady z praxe.`);
      }
    });
  }

  const closeCasesBtn = $('closeCases');
  if (closeCasesBtn) {
    closeCasesBtn.addEventListener('click', () => {
      const modal = $('casesModal');
      if (modal) { modal.style.display = 'none'; modal.classList.remove('open'); }
    });
  }

  /* ⚖️ Štátnicová sieň – ťahúň na vrchu množiny Tréning.

     Štátnica čerpá z tej istej dvojice okruhov ako pojednávanie
     (window.__selectedOkruhPair, plní ju applyOkruhPairSelection po výbere
     oblasti). Ako ťahúň stojí NAD kartou pojednávania, takže hráč naň môže
     kliknúť skôr, než si oblasť vôbec vybral – vtedy ho pošleme k výberu
     namiesto strohého toastu „najprv si vyber oblasť“.

     Výber oblasti sa ZÁMERNE nezdvojuje: chipy ostávajú jediné, v
     #quizCard. Tu sa naň len zroluje a na 2 s zvýrazní (rovnaká trieda
     .duel-highlight ako pri kvíze), takže zviazaný celok ostáva jeden. */
  const openStatniceBtn = $('openStatniceBtn');
  if (openStatniceBtn) {
    openStatniceBtn.addEventListener('click', async () => {
      const areaName = window.__selectedAreaName || '';
      const pair = window.__selectedOkruhPair;

      if (!areaName || !pair || pair.area !== areaName || pair.empty === true) {
        const picker = $('areasInQuiz');
        if (picker) {
          picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
          picker.classList.add('duel-highlight');
          setTimeout(() => picker.classList.remove('duel-highlight'), 2000);
        }
        showRewardToast('⚖️ Najprv si vyber oblasť – skúška použije tú istú dvojicu okruhov ako súboj.');
        return;
      }

      const { openStatniceHall } = await import('./scripts/statnice.js');
      openStatniceHall(areaName);
    });
  }

  /* 🕸️ Pamäťový pavúk – globálna dlaždica, vlastný oblasť→okruh výber
     (spider.js nešiel cez node --check, preto lazy import v try/catch –
     pád modulu = len rozbité tlačidlo, nie zhodený init.js). */
  const openSpiderBtn = $('openSpiderBtn');
  if (openSpiderBtn) {
    openSpiderBtn.addEventListener('click', async () => {
      try {
        const m = await import('./scripts/spiderMap.js');
        m.openStructureBrowser();
      } catch (e) { console.error('spider load failed', e); }
    });
  }

  /* 🏦 Pokladňa vedomostí – otvára modul vybranej oblasti.

     Jediný modul sa otvorí PRIAMO, bez medzikroku: rozbaľovať zoznam
     s jednou položkou je klik navyše za nič. Panel sa použije len tam,
     kde je naozaj čo vyberať (Osobné financie majú dva moduly) alebo
     kde treba niečo povedať (oblasť bez modulu, nevybraná oblasť).

     Oblasť nepotrebuje vybranú dvojicu okruhov – modul je čítanie,
     nie hra, takže stačí window.__selectedAreaName. */
  const openModulesBtn = $('openModulesBtn');
  const modulesPanel = $('modulesPanel');
  if (openModulesBtn && modulesPanel) {
    openModulesBtn.setAttribute('aria-expanded', 'false');
    openModulesBtn.addEventListener('click', () => {
      const areaName = window.__selectedAreaName || '';
      const moduly = modulesForArea(areaName);

      if (moduly.length === 1) {
        modulesPanel.style.display = 'none';
        openModulesBtn.setAttribute('aria-expanded', 'false');
        openModuleItem(moduly[0][1]);
        return;
      }

      const open = modulesPanel.style.display === 'none';
      modulesPanel.style.display = open ? 'block' : 'none';
      openModulesBtn.setAttribute('aria-expanded', String(open));
      if (!open) return;

      fillModulesPanel(areaName);
      modulesPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  /* 🧠 Bifľovačka – otvorí rovno oblasť, ktorú má hráč vybranú.

     Dlaždica sa SKRÝVA len pri oblasti, pre ktorú bifľovačka neexistuje
     (školské oblasti) – tam by klik viedol do prázdna. Kým si hráč oblasť
     nevybral, dlaždica STOJÍ: inak by o bifľovačke pri prvom príchode
     vôbec nevedel. Klik ho vtedy pošle k výberu oblasti rovnako ako pri
     AI skúške (zroluje + zvýrazní chipy), nie do ticha. */
  const openBiflovackaBtn = $('openBiflovackaBtn');
  if (openBiflovackaBtn) {
    openBiflovackaBtn.addEventListener('click', () => {
      const slug = openBiflovackaBtn.dataset.slug
        || biflovackaSlugForArea(window.__selectedAreaName || '');

      if (!slug) {
        const picker = $('areasInQuiz');
        if (picker) {
          picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
          picker.classList.add('duel-highlight');
          setTimeout(() => picker.classList.remove('duel-highlight'), 2000);
        }
        showRewardToast('🧠 Najprv si vyber oblasť – bifľovačka sa otvorí priamo v nej.');
        return;
      }

      window.location.href = 'memory-trainer.html?area=' + encodeURIComponent(slug);
    });
  }

  /* 🔥 Banka duelov */
  const toggleDuelBankBtn = $('toggleDuelBankBtn');
  const duelBankBox = $('duelBank');
  if (toggleDuelBankBtn && duelBankBox) {
    toggleDuelBankBtn.addEventListener('click', () => {
      const isHidden = duelBankBox.style.display === 'none';
      duelBankBox.style.display = isHidden ? 'block' : 'none';
      if (isHidden && typeof window.renderDuelBank === 'function') {
        window.renderDuelBank();
      }
    });
  } else {
    console.warn('⚠️ toggleDuelBankBtn alebo duelBank element sa nenašiel v DOM.');
  }

  // Cena štátnice na dlaždici – z ECONOMY_CONFIG, nie natvrdo v HTML.
  fillStaticEconomyValues();

  /* Pútací pulz hlavných dlaždíc sa po PRVEJ interakcii vypína natrvalo –
     hráč už vie, že tam sú, ďalej by to bolo len rušenie. Stačí jediný
     poslucháč na kontajneri (once), samotné vypnutie rieši CSS trieda. */
  const gameTiles = document.querySelector('.game-tiles');
  if (gameTiles) {
    gameTiles.addEventListener('pointerdown', () => {
      gameTiles.classList.add('tiles-interacted');
    }, { once: true });
  }

  /* ⚔️ Dlaždica Výzvy → register pojednávaní.
     Register je karta v TEJ ISTEJ množine (pod hernou dlaždicou), takže stačí
     naň zroloval a rozbaliť zoznam. Zoznam sa rozbaľuje VŽDY (nie prepínačom),
     lebo hráč sem prišiel práve preň – zbalený zoznam by pôsobil, že klik
     nespravil nič. uncollapseSection rieši mobilný zbalený stav karty. */
  const openDuelBankTile = $('openDuelBankTile');
  if (openDuelBankTile && duelBankBox) {
    openDuelBankTile.addEventListener('click', () => {
      uncollapseSection('duelbank');
      if (duelBankBox.style.display === 'none') {
        duelBankBox.style.display = 'block';
        if (typeof window.renderDuelBank === 'function') window.renderDuelBank();
      }
      const card = $('duelBankCard');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

/* =====================================================
   SPUSTENIE PO NAČÍTANÍ DOM
   ===================================================== */
document.addEventListener('DOMContentLoaded', init);
