'use strict';

/* =========================
   Utility: play sound
   ========================= */
export function playSound(audio){
  if(!audio) return;
  try {
    audio.currentTime = 0;
    audio.play().catch(()=>{});
  } catch(e){}
}
