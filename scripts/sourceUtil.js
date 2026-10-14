'use strict';

/* ============================================================
   sourceUtil.js
   Zjednotené zobrazenie zdroja (paragraf zákona / web / judikát /
   učebnica) pod definíciou, otázkou aj prípadom. Pole `zdroj` je
   voliteľné – staré záznamy bez neho zobrazia "Zdroj: doplní sa".
   Schéma:
   { type: "zakon"|"web"|"judikat"|"ucebnica", citation, url?, accessed? }
============================================================ */

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url || '';
  }
}

export function renderSource(zdroj) {
  const wrapOpen = '<div class="small" style="font-size:11px;color:var(--muted,#888);margin-top:6px;font-style:italic">';
  const wrapClose = '</div>';

  if (!zdroj || !zdroj.citation) {
    return `${wrapOpen}Zdroj: doplní sa${wrapClose}`;
  }

  const { type, citation, url, accessed } = zdroj;
  const citationHtml = escapeHtml(citation);

  if (type === 'web') {
    const domain = url ? domainOf(url) : '';
    const link = url
      ? ` <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(domain)}</a>`
      : '';
    const accessedTxt = accessed ? ` (cit. ${escapeHtml(accessed)})` : '';
    return `${wrapOpen}Zdroj: ${citationHtml}${url ? ' –' + link : ''}${accessedTxt}${wrapClose}`;
  }

  return `${wrapOpen}Zdroj: ${citationHtml}${wrapClose}`;
}
