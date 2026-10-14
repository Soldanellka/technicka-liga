'use strict';

import { LS } from './core.js';
import {
  currentAvatarId,
  gamesPlayed,
  isPremium,
  setAvatar,
  setGamesPlayed
} from './state.js';
import { showRewardToast } from './ui.js';
import { $ } from './core.js';

/* =========================
   Avatar katalóg
   ========================= */
export const avatarCatalog = [
  { id: 'young',  title: 'Nováčik',     file: 'assets/avatars/young-lawyer.svg',  unlockAt: 0,  premium: false },
  { id: 'senior', title: 'Skúsený hráč',   file: 'assets/avatars/senior-lawyer.svg', unlockAt: 10, premium: false },
  { id: 'judge',  title: 'Majster',             file: 'assets/avatars/judge.svg',         unlockAt: 30, premium: false },
  { id: 'cat',    title: 'Mačka',     file: 'assets/avatars/cat-avatar.svg',    unlockAt: 0,  premium: true },
  { id: 'owl',    title: 'Sova múdrosti',     file: 'assets/avatars/owl-avatar.svg',    unlockAt: 0,  premium: true }
];

/* =========================
   Render avatar v hlavičke
   ========================= */
export function renderHeaderAvatar(){
  const img = $('userAvatar');
  const badge = $('premiumBadge');
  if(!img) return;

  const avatar = avatarCatalog.find(a => a.id === currentAvatarId) || avatarCatalog[0];

  img.src = avatar.file;
  img.alt = avatar.title;

  if(badge){
    if(avatar.premium){
      badge.innerHTML = 'PREMIUM <span class="badge-premium-small">VIP</span>';
    } else {
      badge.textContent = isPremium ? 'PREMIUM' : 'FREE';
    }
  }
}

/* =========================
   Otvorenie modalu
   ========================= */
export function openAvatarModal(){
  const existing = $('avatarModal');
  if(existing){
    existing.classList.add('open');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'avatarModal';
  modal.className = 'avatar-modal open';

  const panel = document.createElement('div');
  panel.className = 'avatar-panel';
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','true');

  /* Header */
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';

  const left = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = 'Vyber avatar';
  const small = document.createElement('div');
  small.className = 'small';
  small.textContent = 'Odomknuté podľa odohraných hier. Prémiové avatary sú len pre PREMIUM.';
  left.appendChild(h3);
  left.appendChild(small);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn';
  closeBtn.id = 'closeAvatarModal';
  closeBtn.textContent = 'Zavrieť';

  header.appendChild(left);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  /* Grid */
  const grid = document.createElement('div');
  grid.className = 'avatar-grid';
  grid.id = 'avatarGrid';
  panel.appendChild(grid);

  modal.appendChild(panel);
  document.body.appendChild(modal);

  closeBtn.addEventListener('click', closeAvatarModal);

  renderAvatarGrid();
}

/* =========================
   Zatvorenie modalu
   ========================= */
export function closeAvatarModal(){
  const m = $('avatarModal');
  if(m) m.classList.remove('open');
}

/* =========================
   Render gridu avatarov
   ========================= */
export function renderAvatarGrid(){
  const grid = $('avatarGrid');
  if(!grid) return;

  grid.innerHTML = '';

  avatarCatalog.forEach(av => {
    const unlocked = (gamesPlayed >= av.unlockAt) && (!av.premium || isPremium);

    const card = document.createElement('div');
    card.className = 'avatar-card' + (unlocked ? '' : ' locked');

    const img = document.createElement('img');
    img.src = av.file;
    img.alt = av.title;
    card.appendChild(img);

    const title = document.createElement('div');
    title.className = 'avatar-title';
    title.textContent = av.title;
    card.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'avatar-sub';
    sub.textContent = av.premium ? 'Prémiový' : `Odomknúť po ${av.unlockAt} hrách`;
    card.appendChild(sub);

    /* Kliknutie na avatar */
    card.addEventListener('click', () => {
      if(!unlocked){
        if(av.premium && !isPremium){
          alert('Tento avatar je dostupný len v PREMIUM verzii.');
          return;
        }
        alert('Tento avatar ešte nie je odomknutý.');
        return;
      }

      setAvatar(av.id);
      try { localStorage.setItem(LS.AVATAR, av.id); } catch(e){}

      renderHeaderAvatar();

      try {
        card.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
          { duration: 260 }
        );
      } catch(e){}

      showRewardToast(`Avatar zmenený na: ${av.title}`);
      closeAvatarModal();
    });

    grid.appendChild(card);
  });
}

/* =========================
   Počet odohraných hier
   ========================= */
export function incrementGamesPlayed(){
  const newVal = gamesPlayed + 1;
  setGamesPlayed(newVal);

  try { localStorage.setItem(LS.GAMES, String(newVal)); } catch(e){}

  avatarCatalog.forEach(av => {
    if(!av.premium && av.unlockAt > 0 && newVal === av.unlockAt){
      showRewardToast(`Odomkol si avatar: ${av.title}`);
    }
  });

  const modal = $('avatarModal');
  if(modal && modal.classList.contains('open')){
    renderAvatarGrid();
  }
}
