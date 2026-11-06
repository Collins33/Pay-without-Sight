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
