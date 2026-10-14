async function loadInto(id, url) {
  const el = document.getElementById(id);
  if (!el) return;

  const html = await fetch(url, { cache: 'no-store' }).then(r => r.text());
  el.innerHTML = html;

  // počkáme, kým sa HTML vloží do DOMu
  await new Promise(requestAnimationFrame);
}

async function init() {
  const app = document.getElementById('app');
  if (!app) return;

  const layoutHtml = await fetch('/components/layout.html', { cache: 'no-store' }).then(r => r.text());
  app.innerHTML = layoutHtml;

  // čakáme na NAOZAJ kompletné načítanie komponentov
  await Promise.all([
    loadInto('header', '/components/header.html'),
    loadInto('leftColumn', '/components/left-column.html'),
    loadInto('rightColumn', '/components/right-column.html'),
    loadInto('modals', '/components/modals.html'),
    loadInto('scripts', '/components/scripts.html'),
    loadInto('quizCard', '/components/quiz.html')
  ]);

  // ⭐ NAČÍTANIE LEGAL REPORT FUNKCIE
  import("/scripts/legal-report.js");

  // teraz už topicList a facultyList existujú
  document.dispatchEvent(new Event("componentsLoaded"));
}

init();
