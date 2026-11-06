// Ordinary user-directed interactions only: focus, scroll, gated click, and explicit read-back.
import { classifyActionText } from './action-classifier.js';
import { extractMetadata, accessibleName } from './form-discovery.js';
import { classifySensitivity } from '../safety/sensitive-data-policy.js';
import { isWellFormedGrant } from '../communication/message-contracts.js';

/** Scrolls a control into view and focuses it. */
export function focusElement(el) {
  if (!el || typeof el.focus !== 'function') return { ok: false, reason: 'not_focusable' };
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'auto' });
  el.focus({ preventScroll: true });
  return { ok: el.ownerDocument.activeElement === el };
}

/** Classifies a live button element from its own label and type. */
export function classifyElement(el) {
  const { name } = accessibleName(el, el.ownerDocument);
  const label = name || el.getAttribute('value') || el.textContent || '';
  return classifyActionText({ text: label, type: el.getAttribute('type') });
}

/**
 * Clicks a control. Any control classified as consequential is refused unless the service worker
 * supplied a well-formed, unexpired grant of the matching kind. (The service worker's confirmation
 * gate is the real authority; this is a second, independent check inside the page context.)
 */
export function clickAction(el, { grant, now = () => Date.now() } = {}) {
  if (!el || typeof el.click !== 'function') return { ok: false, reason: 'not_clickable' };
  if (el.disabled === true) return { ok: false, reason: 'disabled' };
  const kind = classifyElement(el);
  if (kind) {
    if (!isWellFormedGrant(grant)) return { ok: false, reason: 'consequential_requires_confirmation', kind };
    if (grant.kind !== kind) return { ok: false, reason: 'confirmation_is_for_a_different_action', kind };
    if (now() >= grant.expiresAt) return { ok: false, reason: 'confirmation_expired', kind };
  }
  el.click();
  return { ok: true, kind };
}

/**
 * Explicit read-back of one ordinary field. Refuses sensitive fields (re-checked from metadata before
 * touching any value) and does nothing unless read-back was enabled in preferences.
 */
export function readBackValue(el, { enabled } = {}) {
  if (!enabled) return { ok: false, reason: 'read_back_disabled' };
  if (!el) return { ok: false, reason: 'not_found' };
  const sens = classifySensitivity(extractMetadata(el, el.ownerDocument));
  if (sens.sensitive) return { ok: false, reason: 'sensitive' };
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'select') return { ok: true, value: [...el.selectedOptions].map((o) => o.textContent.trim()).join(', ').slice(0, 200) };
  if (type === 'checkbox' || type === 'radio') return { ok: true, value: el.checked ? 'checked' : 'not checked' };
  if (tag === 'input' || tag === 'textarea') return { ok: true, value: String(el.value ?? '').slice(0, 200) };
  return { ok: true, value: (el.textContent ?? '').trim().slice(0, 200) };
}

// ---- typing into a field ---------------------------------------------------------------------------

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'search', 'number', 'date', 'time', 'month', 'week', 'datetime-local']);
const YES_WORDS = new Set(['yes', 'true', 'check', 'checked', 'on', 'tick']);
const NO_WORDS = new Set(['no', 'false', 'uncheck', 'unchecked', 'off', 'untick']);
const squashText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function fireInputEvents(el) {
  const View = el.ownerDocument.defaultView;
  el.dispatchEvent(new View.Event('input', { bubbles: true }));
  el.dispatchEvent(new View.Event('change', { bubbles: true }));
}

/** Uses the browser's own value setter, so pages built on React-style frameworks notice the change. */
function setNativeValue(el, text) {
  const View = el.ownerDocument.defaultView;
  const proto = el.tagName === 'TEXTAREA' ? View.HTMLTextAreaElement.prototype : View.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
}

/** Picks one choice by label or value: exact first, then "starts with", then "contains". */
export function pickOption(items, query) {
  const q = squashText(query).toLowerCase();
  if (!q) return { status: 'none' };
  const tiers = [
    (i) => i.label.toLowerCase() === q || String(i.value).toLowerCase() === q,
    (i) => i.label.toLowerCase().startsWith(q),
    (i) => i.label.toLowerCase().includes(q),
  ];
  for (const test of tiers) {
    const hits = items.filter(test);
    if (hits.length === 1) return { status: 'match', item: hits[0] };
    if (hits.length > 1) return { status: 'ambiguous', items: hits };
  }
  return { status: 'none' };
}

function choose(items, text) {
  const pick = pickOption(items, text);
  if (pick.status === 'match') return { item: pick.item };
  const shown = (pick.status === 'ambiguous' ? pick.items : items).map((i) => i.label).slice(0, 15);
  return { problem: { ok: false, reason: pick.status === 'ambiguous' ? 'ambiguous_option' : 'no_such_option', options: shown } };
}

/**
 * Puts a value the user typed into one ordinary field. Refuses sensitive fields (re-checked from metadata,
 * like read-back), disabled or read-only fields and anything it cannot set faithfully. Never returns the value.
 * Text and number fields take the text; dropdowns and radio groups take a choice; checkboxes take yes or no.
 */
export function fillValue(el, value, { type, members } = {}) {
  if (!el) return { ok: false, reason: 'not_found' };
  const doc = el.ownerDocument;
  if (classifySensitivity(extractMetadata(el, doc)).sensitive) return { ok: false, reason: 'sensitive' };
  const text = String(value ?? '');

  if (type === 'radio-group') {
    const group = (members?.length ? members : [el]).filter((m) => m.disabled !== true);
    if (!group.length) return { ok: false, reason: 'not_editable' };
    const items = group.map((m) => ({ label: accessibleName(m, doc).name, value: m.value ?? '', ref: m }));
    const { item, problem } = choose(items, text);
    if (problem) return problem;
    if (!item.ref.checked) item.ref.click(); // a real click, so the page's own handlers run
    return { ok: true, chosen: item.label };
  }

  if (el.disabled === true || el.readOnly === true) return { ok: false, reason: 'not_editable' };
  const tag = el.tagName.toLowerCase();
  const inputType = (el.getAttribute('type') || 'text').toLowerCase();

  if (tag === 'select') {
    const items = [...el.options]
      .filter((o) => o.value !== '' && !o.disabled)
      .map((o) => ({ label: squashText(o.textContent), value: o.value, ref: o }));
    const { item, problem } = choose(items, text);
    if (problem) return problem;
    el.value = item.ref.value;
    fireInputEvents(el);
    return { ok: true, chosen: item.label };
  }
  if (tag === 'input' && inputType === 'checkbox') {
    const q = text.trim().toLowerCase();
    if (!YES_WORDS.has(q) && !NO_WORDS.has(q)) return { ok: false, reason: 'unsupported_value' };
    const want = YES_WORDS.has(q);
    if (el.checked !== want) el.click();
    return { ok: true, checked: want };
  }
  if ((tag === 'input' && TEXT_INPUT_TYPES.has(inputType)) || tag === 'textarea') {
    if (el.maxLength > 0 && text.length > el.maxLength) return { ok: false, reason: 'too_long', max: el.maxLength };
    setNativeValue(el, text);
    if (el.value !== text) return { ok: false, reason: 'format_rejected' }; // e.g. a date field that only takes YYYY-MM-DD
    fireInputEvents(el);
    return { ok: true };
  }
  if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
    el.textContent = text;
    fireInputEvents(el);
    return { ok: true };
  }
  return { ok: false, reason: 'unsupported_type' };
}
