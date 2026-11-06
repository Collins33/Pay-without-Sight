// Reads the semantic DOM: fields, labels, descriptions, required state, errors. Reports structure, never values.
import { classifySensitivity } from '../safety/sensitive-data-policy.js';
import { classifyActionText } from './action-classifier.js';

const FIELD_SELECTOR = 'input, select, textarea, [role="textbox"], [role="combobox"], [role="checkbox"], [role="switch"], [role="radio"], [role="listbox"]';
const BUTTON_SELECTOR = 'button, input[type="submit"], input[type="button"], [role="button"], a.button, a[role="button"]';
const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const MAX_TEXT = 200;

const clip = (s, n = MAX_TEXT) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function randomSalt() {
  const c = globalThis.crypto;
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isHidden(el) {
  const view = el.ownerDocument?.defaultView;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hidden || n.getAttribute('aria-hidden') === 'true') return true;
    const inline = n.style;
    if (inline && (inline.display === 'none' || inline.visibility === 'hidden')) return true;
    if (view?.getComputedStyle) {
      try {
        const cs = view.getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
      } catch { /* ignore */ }
    }
  }
  return false;
}

/** Text of a node, ignoring embedded controls and aria-hidden content. */
function textOfNode(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll?.('input, select, textarea, button, script, style, [aria-hidden="true"]').forEach((n) => n.remove());
  return squash(clone.textContent);
}

function textOfIds(doc, idList) {
  return squash(
    String(idList ?? '').split(/\s+/).filter(Boolean).map((id) => doc.getElementById(id)).filter(Boolean).map(textOfNode).join(' '),
  );
}

export function accessibleName(el, doc = el.ownerDocument) {
  const labelledBy = textOfIds(doc, el.getAttribute('aria-labelledby'));
  if (labelledBy) return { name: labelledBy, source: 'aria-labelledby' };
  const ariaLabel = squash(el.getAttribute('aria-label'));
  if (ariaLabel) return { name: ariaLabel, source: 'aria-label' };
  if (el.labels && el.labels.length) {
    const t = squash([...el.labels].map(textOfNode).join(' '));
    if (t) return { name: t, source: 'label' };
  }
  const title = squash(el.getAttribute('title'));
  if (title) return { name: title, source: 'title' };
  const placeholder = squash(el.getAttribute('placeholder'));
  if (placeholder) return { name: placeholder, source: 'placeholder' };
  const role = el.getAttribute('role');
  if (role && !['textbox', 'combobox', 'listbox'].includes(role)) {
    const t = textOfNode(el);
    if (t) return { name: t, source: 'content' };
  }
  return { name: '', source: 'none' };
}

function groupLabelOf(el, doc) {
  const fs = el.closest('fieldset');
  if (fs) {
    const legend = [...fs.children].find((c) => c.tagName === 'LEGEND');
    if (legend) return textOfNode(legend);
  }
  const g = el.closest('[role="group"], [role="radiogroup"]');
  if (g) return textOfIds(doc, g.getAttribute('aria-labelledby')) || squash(g.getAttribute('aria-label'));
  return '';
}

export function isErrorElement(el) {
  const cls = String(el.getAttribute('class') ?? '').toLowerCase();
  const id = String(el.id ?? '').toLowerCase();
  return el.getAttribute('role') === 'alert' || cls.includes('error') || id.startsWith('err') || id.includes('error');
}

function visibleText(el) {
  return isHidden(el) ? '' : clip(textOfNode(el));
}

function typeOf(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') return (el.getAttribute('type') || 'text').toLowerCase();
  if (tag === 'select') return el.multiple ? 'multiselect' : 'select';
  if (tag === 'textarea') return 'textarea';
  return el.getAttribute('role') || 'text';
}

/**
 * Metadata only. Used by the sensitive-data policy; contains no values.
 * Exported so the interaction manager can re-check sensitivity before any read-back.
 */
export function extractMetadata(el, doc = el.ownerDocument) {
  const { name } = accessibleName(el, doc);
  return {
    type: typeOf(el),
    autocomplete: el.getAttribute('autocomplete') ?? '',
    name: el.getAttribute('name') ?? '',
    id: el.id ?? '',
    labelText: name,
    ariaLabel: el.getAttribute('aria-label') ?? '',
    describedText: textOfIds(doc, el.getAttribute('aria-describedby')),
    placeholder: el.getAttribute('placeholder') ?? '',
  };
}

// ---- the only functions in this module that touch .value / .checked (and never for sensitive fields) ----

function isFilledPlain(el, type) {
  if (type === 'checkbox') return !!el.checked;
  if (type === 'file') return !!(el.files && el.files.length);
  if (type === 'select' || type === 'multiselect') return [...el.selectedOptions].some((o) => o.value !== '');
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return String(el.value ?? '').trim() !== '';
  const role = el.getAttribute('role');
  if (role === 'checkbox' || role === 'switch' || role === 'radio') return el.getAttribute('aria-checked') === 'true';
  return squash(el.textContent) !== '';
}

function changeToken(el, type) {
  if (type === 'checkbox') return el.checked ? '1' : '0';
  if (type === 'file') return String(el.files?.length ?? 0);
  if (type === 'select' || type === 'multiselect') return [...el.selectedOptions].map((o) => o.value).join(',');
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return String(el.value ?? '');
  const role = el.getAttribute('role');
  if (role === 'checkbox' || role === 'switch' || role === 'radio') return el.getAttribute('aria-checked') ?? '';
  return squash(el.textContent);
}

/** Input rules and the choices of a dropdown or radio group. Metadata only: never a value. */
function constraintsOf(members, type, doc) {
  const el = members[0];
  const c = {};
  for (const attr of ['minlength', 'maxlength', 'min', 'max', 'pattern']) {
    const v = el.getAttribute(attr);
    if (v) c[attr] = clip(v, 80);
  }
  if (type === 'select' || type === 'multiselect') {
    c.options = [...el.options].filter((o) => o.value !== '' && !o.disabled).map((o) => squash(o.textContent)).filter(Boolean).slice(0, 15);
  } else if (type === 'radio-group') {
    c.options = members.map((m) => accessibleName(m, doc).name).filter(Boolean).slice(0, 15);
  }
  return c;
}

/**
 * @param {Document} doc
 * @param {{salt?:string, href?:string}} [opts]
 */
export function createDiscovery(doc, opts = {}) {
  // The salt stays in this closure, so fingerprints cannot be brute-forced from outside the content script.
  const salt = opts.salt ?? randomSalt();
  let registry = new Map();

  function eligible(el) {
    if (el.tagName === 'INPUT' && SKIPPED_INPUT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase())) return false;
    return !isHidden(el);
  }

  function errorInfoFor(el) {
    const ids = `${el.getAttribute('aria-errormessage') ?? ''} ${el.getAttribute('aria-describedby') ?? ''}`.split(/\s+/).filter(Boolean);
    const texts = [];
    for (const id of ids) {
      const n = doc.getElementById(id);
      if (n && isErrorElement(n)) {
        const t = visibleText(n);
        if (t) texts.push(t);
      }
    }
    return texts.join(' ');
  }

  function describe(el) {
    const ids = String(el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const texts = [];
    for (const id of ids) {
      const n = doc.getElementById(id);
      if (n && !isErrorElement(n)) {
        const t = visibleText(n);
        if (t) texts.push(t);
      }
    }
    return texts.join(' ');
  }

  function buildField(id, members, groupKey) {
    const el = members[0];
    const isRadioGroup = members.length > 0 && el.tagName === 'INPUT' && el.getAttribute('type') === 'radio' && groupKey;
    const type = isRadioGroup ? 'radio-group' : typeOf(el);
    const { name: ownName, source } = accessibleName(el, doc);
    const group = groupLabelOf(el, doc);
    let name;
    let nameSource = source;
    if (isRadioGroup) {
      name = group || ownName;
      nameSource = group ? 'legend' : source;
    } else {
      name = group && ownName ? `${group}: ${ownName}` : ownName || group;
    }
    const meta = extractMetadata(el, doc);
    if (isRadioGroup) meta.labelText = name;
    const sens = classifySensitivity(meta);
    const required = members.some((m) => m.required === true || m.getAttribute('aria-required') === 'true');
    const errorText = members.map(errorInfoFor).find(Boolean) ?? '';
    const invalid = members.some((m) => m.getAttribute('aria-invalid') === 'true') || !!errorText;

    // Sensitive fields are never read: "filled" stays null (unknown).
    let filled = null;
    if (!sens.sensitive) {
      filled = isRadioGroup ? members.some((m) => m.checked) : isFilledPlain(el, type);
    }
    const field = {
      id,
      name: clip(name || `Unlabelled ${type} field`),
      nameSource: name ? nameSource : 'none',
      description: clip(describe(el)),
      type,
      required,
      filled,
      sensitive: sens.sensitive,
      sensitiveCategory: sens.category,
      invalid,
      errorText: clip(errorText),
      disabled: members.every((m) => m.disabled === true || m.getAttribute('aria-disabled') === 'true'),
      unlabelled: !name,
      weakName: nameSource === 'placeholder' || nameSource === 'title',
      constraints: constraintsOf(members, type, doc),
    };
    if (isRadioGroup) field.optionCount = members.length;
    registry.set(id, { el: members.find((m) => m.checked) ?? el, members, type, sensitive: sens.sensitive });
    return field;
  }

  function discover(options = {}) {
    registry = new Map();
    const candidates = [...doc.querySelectorAll(FIELD_SELECTOR)].filter(eligible);
    const fields = [];
    const doneGroups = new Set();
    let n = 0;
    for (const el of candidates) {
      const isNativeRadio = el.tagName === 'INPUT' && el.getAttribute('type') === 'radio' && el.getAttribute('name');
      if (isNativeRadio) {
        const key = `${el.form ? [...doc.forms].indexOf(el.form) : 'x'}::${el.getAttribute('name')}`;
        if (doneGroups.has(key)) continue;
        doneGroups.add(key);
        const members = candidates.filter((c) => c.tagName === 'INPUT' && c.getAttribute('type') === 'radio' && c.getAttribute('name') === el.getAttribute('name') && c.form === el.form);
        fields.push(buildField(`f${++n}`, members, key));
      } else {
        fields.push(buildField(`f${++n}`, [el], null));
      }
    }

    const actions = [];
    let a = 0;
    for (const el of doc.querySelectorAll(BUTTON_SELECTOR)) {
      if (isHidden(el)) continue;
      const nameInfo = accessibleName(el, doc);
      const label = nameInfo.name || squash(el.getAttribute('value')) || textOfNode(el);
      const id = `a${++a}`;
      const consequentialKind = classifyActionText({ text: label, type: el.getAttribute('type') });
      actions.push({ id, name: clip(label || 'Unlabelled button'), consequentialKind, disabled: el.disabled === true, unlabelled: !label });
      registry.set(id, { el, members: [el], type: 'action', sensitive: false });
    }

    const errors = [];
    const seen = new Set();
    for (const f of fields) {
      if (f.errorText && !seen.has(f.errorText)) {
        errors.push({ text: f.errorText, fieldId: f.id });
        seen.add(f.errorText);
      }
    }
    for (const el of doc.querySelectorAll('[role="alert"], [class*="error"], [aria-live="assertive"]')) {
      const t = visibleText(el);
      if (t && !seen.has(t)) {
        errors.push({ text: t, fieldId: null });
        seen.add(t);
      }
      if (errors.length >= 10) break;
    }

    const parts = [];
    for (const f of fields) {
      if (f.sensitive) continue; // never read, never fingerprinted
      const e = registry.get(f.id);
      const token = f.type === 'radio-group' ? String(e.members.findIndex((m) => m.checked)) : changeToken(e.el, f.type);
      parts.push(`${f.id}=${token}`);
    }
    // Display text the caller wants watched for changes (for example the review summary). Only hashed, never returned.
    for (const [key, selector] of Object.entries(options.fingerprintSelectors ?? {})) {
      try {
        const node = doc.querySelector(selector);
        parts.push(`sel:${key}=${node ? squash(node.textContent) : ''}`);
      } catch { /* invalid selector: ignore */ }
    }
    const fingerprint = cyrb53(salt + '|' + parts.join('|'));

    const details = {};
    for (const [key, selector] of Object.entries(options.detailSelectors ?? {})) {
      try {
        const node = doc.querySelector(selector);
        if (node) details[key] = clip(squash(node.textContent));
      } catch { /* invalid selector: ignore */ }
    }

    let focusedId = null;
    const active = doc.activeElement;
    if (active) for (const [id, e] of registry) if (e.members.includes(active)) { focusedId = id; break; }

    const empty = fields.filter((f) => f.filled === false);
    return {
      href: opts.href ?? doc.location?.href ?? '',
      title: clip(squash(doc.title)),
      headings: [...doc.querySelectorAll('h1, h2, h3')].filter((h) => !isHidden(h)).slice(0, 10).map((h) => ({ level: Number(h.tagName[1]), text: clip(textOfNode(h)) })),
      fields,
      actions,
      errors,
      details,
      focusedId,
      fingerprint,
      counts: {
        fields: fields.length,
        required: fields.filter((f) => f.required).length,
        empty: empty.length,
        requiredEmpty: empty.filter((f) => f.required).length,
        sensitive: fields.filter((f) => f.sensitive).length,
        requiredSensitive: fields.filter((f) => f.sensitive && f.required).length,
        errors: errors.length,
        unlabelled: fields.filter((f) => f.unlabelled).length,
      },
    };
  }

  return {
    discover,
    getEntry: (id) => registry.get(id) ?? null,
    getElement: (id) => registry.get(id)?.el ?? null,
  };
}

/** Reads the visible text of one element chosen by a selector from our own workflow config (e.g. a receipt). */
export function readTextBySelector(doc, selector, max = 1000) {
  try {
    const node = doc.querySelector(selector);
    if (!node || isHidden(node)) return null;
    return clip(textOfNode(node), max);
  } catch {
    return null;
  }
}
