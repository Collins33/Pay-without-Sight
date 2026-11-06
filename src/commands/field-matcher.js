// Pure helpers: match a spoken label to controls, and pick the next field that needs attention.

const STOPWORDS = new Set(['the', 'a', 'an', 'field', 'box', 'input', 'button', 'my', 'please', 'of', 'to']);

function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));
}

function norm(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Tiered score: exact 100, prefix 80, every query word present 60, at least half present 30, else 0. */
export function scoreName(name, query) {
  const n = norm(name);
  const q = norm(query);
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  const qt = tokens(query);
  if (!qt.length) return 0;
  const nt = tokens(name);
  const hits = qt.filter((t) => nt.some((x) => x === t || x.startsWith(t))).length;
  if (hits === qt.length) return 60;
  if (hits * 2 >= qt.length && hits > 0) return 30;
  return 0;
}

/**
 * @returns {{status:'none'}|{status:'match', kind:'field'|'action', item:object}|{status:'ambiguous', options:object[]}}
 */
export function matchControls(fields, actions, query) {
  const candidates = [
    ...fields.map((item) => ({ kind: 'field', item })),
    ...actions.map((item) => ({ kind: 'action', item })),
  ].map((c) => ({ ...c, score: scoreName(c.item.name, query) })).filter((c) => c.score > 0);
  if (!candidates.length) return { status: 'none' };
  const top = Math.max(...candidates.map((c) => c.score));
  const best = candidates.filter((c) => c.score === top);
  if (best.length === 1) return { status: 'match', kind: best[0].kind, item: best[0].item };
  return { status: 'ambiguous', options: best.slice(0, 5).map((c) => c.item) };
}

/**
 * The next field after the focused one that needs attention, wrapping around.
 * Order of priority: empty required fields, then fields with errors, then required sensitive fields
 * (which cannot be checked, so the user is asked to look at them).
 */
export function pickNextField(fields, focusedId) {
  if (!fields.length) return null;
  const start = Math.max(fields.findIndex((f) => f.id === focusedId), -1);
  const ordered = [...fields.slice(start + 1), ...fields.slice(0, start + 1)];
  const tiers = [
    ['empty-required', (f) => f.required && f.filled === false && !f.disabled],
    ['invalid', (f) => f.invalid && !f.sensitive],
    ['sensitive-required', (f) => f.required && f.sensitive],
  ];
  for (const [reason, test] of tiers) {
    const field = ordered.find(test);
    if (field) return { field, reason };
  }
  return null;
}
