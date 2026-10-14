'use strict';

/* ============================================================
   scripts/contentNormalize.js
   Jediné miesto, kde sa rôzne existujúce tvary JSON okruhov (EÚ,
   pracovné, trestné, občianske) prevádzajú na jeden vnútorný tvar.
   Súbory sa NEPREPISUJÚ – všetka normalizácia sa deje tu, pri
   načítaní. Používaj vo VŠETKÝCH loaderoch (data.js,
   memoryDefinitions.js, scripts/statnice.js, pravo-app/engine.js),
   nech jedna oprava tu opraví zobrazenie všade naraz.
============================================================ */

/* TEXT OKRUHU: `summary` (reťazec), inak `theory` (pole {heading,text})
   spojené na jeden súvislý text. Chýba oboje → ''. */
export function normalizeOkruhText(raw) {
  if (raw && typeof raw.summary === 'string' && raw.summary.trim()) return raw.summary;
  if (raw && Array.isArray(raw.theory)) {
    return raw.theory
      .map(t => {
        if (!t) return '';
        const heading = t.heading ? `${t.heading}: ` : '';
        return (heading + (t.text || '')).trim();
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

/* OTÁZKA (quiz item aj case step): `question`, ak chýba tak `q`. */
export function normalizeQuestionText(item) {
  if (!item) return '';
  return item.question || item.q || '';
}

/* VYSVETLENIE → vždy { correct, wrong } alebo null (nič sa nevykreslí). */
export function normalizeExplanation(item) {
  if (!item) return null;
  if (item.explanation && typeof item.explanation === 'object') {
    const { correct, wrong } = item.explanation;
    if (correct || wrong) return { correct: correct || '', wrong: wrong || '' };
  }
  if (typeof item.explanation === 'string' && item.explanation.trim()) {
    return { correct: item.explanation, wrong: item.explanation };
  }
  if (item.explanation_correct || item.explanation_incorrect) {
    return { correct: item.explanation_correct || '', wrong: item.explanation_incorrect || '' };
  }
  return null;
}

/* ZDROJ: vlastný `zdroj` objekt {type,citation,url,accessed}, inak
   vlastný `source` reťazec (napr. ECLI citácia) normalizovaný na ten
   istý zobraziteľný tvar. Nič = null – volajúci rozhodne, či zavolá
   renderSource() s jej vlastným fallbackom "Zdroj: doplní sa"
   (vhodné pre okruh/otázku/prípad, kde sa má vždy niečo ukázať), alebo
   radšej nevykreslí nič (vhodné pre per-step zdroj v cases.js – "chýba
   → nevykresli nič", nie placeholder pod každým krokom bez citácie). */
export function normalizeZdroj(item) {
  if (!item) return null;
  if (item.zdroj && typeof item.zdroj === 'object' && item.zdroj.citation) return item.zdroj;
  if (typeof item.source === 'string' && item.source.trim()) {
    return { type: 'judikat', citation: item.source.trim() };
  }
  return null;
}

/* Normalizuje jednu otázku kvízu ALEBO krok prípadu do kanonického tvaru. */
export function normalizeQuizItem(raw) {
  if (!raw) return raw;
  return {
    ...raw,
    question: normalizeQuestionText(raw),
    options: Array.isArray(raw.options) ? raw.options : [],
    correct: typeof raw.correct === 'number' ? raw.correct : 0,
    explanation: normalizeExplanation(raw),
    zdroj: normalizeZdroj(raw)
  };
}

/* Normalizuje celý okruh (jeden A*.json) na kanonický tvar:
   { ...raw, summary, quiz: [...normalizované...], cases: [...normalizované...] }.
   `tiles` necháva bez zmeny (term/definition/zdroj sú už jednotné). */
export function normalizeOkruh(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const summary = normalizeOkruhText(raw);
  const quiz = Array.isArray(raw.quiz) ? raw.quiz.map(normalizeQuizItem) : [];
  const cases = Array.isArray(raw.cases)
    ? raw.cases.map(c => ({
        ...c,
        zdroj: normalizeZdroj(c),
        steps: Array.isArray(c.steps) ? c.steps.map(normalizeQuizItem) : []
      }))
    : [];

  return { ...raw, summary, quiz, cases };
}
