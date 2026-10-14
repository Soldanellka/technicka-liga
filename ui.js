'use strict';

/* =========================
   Reward toast

   Viac toastov naraz (napr. odmena z econAward + výsledok hry pri 100 %
   pexese) sa predtým vykresľovalo na to isté miesto – každý bol vlastný
   `position: fixed; right:20px; bottom:20px` element, takže sa doslova
   prekrývali. Riešené STACKOM: jeden spoločný fixed kontajner s
   `flex-direction: column-reverse` – nový toast pribudne nad predchádzajúci
   a po jeho zmiznutí flexbox sám dorovná zvyšné (žiadne ručné prepočítavanie
   odsadenia ani repozicionovanie pri odstránení).

   Trvanie ani animácia jedného toastu sa NEMENÍ (260 ms nábeh, 2200 ms
   zobrazenie, 260 ms odchod). API ostáva showRewardToast(text) – volajúcich
   netreba meniť.
   ========================= */

let toastHost = null;

function ensureToastHost(){
  if (toastHost && toastHost.isConnected) return toastHost;
  toastHost = document.createElement('div');
  toastHost.id = 'rewardToastHost';
  toastHost.style.position = 'fixed';
  toastHost.style.right = '20px';
  toastHost.style.bottom = '20px';
  toastHost.style.zIndex = 9999;
  toastHost.style.display = 'flex';
  toastHost.style.flexDirection = 'column-reverse';
  toastHost.style.alignItems = 'flex-end';
  toastHost.style.gap = '8px';
  /* Kontajner je trvalý (na rozdiel od pôvodných jednorazových elementov),
     preto pointer-events: none – aby ani prázdny nezachytával kliky v pravom
     dolnom rohu. Toasty nie sú interaktívne. */
  toastHost.style.pointerEvents = 'none';
  document.body.appendChild(toastHost);
  return toastHost;
}

export function showRewardToast(text){
  const host = ensureToastHost();

  const t = document.createElement('div');
  t.textContent = text;
  t.style.padding = '12px 16px';
  t.style.background = 'linear-gradient(90deg,#bfe3dc,#0f6ea8)';
  t.style.color = '#fff';
  t.style.borderRadius = '10px';
  t.style.boxShadow = '0 10px 30px rgba(47,158,143,0.12)';
  t.style.opacity = '0';
  t.style.transform = 'translateY(8px)';
  host.appendChild(t);

  requestAnimationFrame(()=>{
    t.style.transition = 'all 260ms ease';
    t.style.opacity = '1';
    t.style.transform = 'translateY(0)';
  });

  setTimeout(()=>{
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(()=> t.remove(), 260);
  }, 2200);
}
