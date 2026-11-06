// Observes the page: title, headings, landmarks, and debounced live-change notifications (never values).
import { isHidden } from './form-discovery.js';

const LANDMARK_ROLES = { header: 'banner', nav: 'navigation', main: 'main', footer: 'contentinfo', aside: 'complementary', form: 'form', search: 'search' };

export function getPageInfo(doc) {
  const landmarks = new Set();
  for (const el of doc.querySelectorAll('header, nav, main, footer, aside, form, [role]')) {
    if (isHidden(el)) continue;
    const role = el.getAttribute('role') || LANDMARK_ROLES[el.tagName.toLowerCase()];
    if (role && ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'form', 'search', 'region'].includes(role)) landmarks.add(role);
  }
  return {
    title: String(doc.title ?? '').replace(/\s+/g, ' ').trim(),
    headings: [...doc.querySelectorAll('h1, h2, h3')].filter((h) => !isHidden(h)).slice(0, 10).map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.replace(/\s+/g, ' ').trim() })),
    landmarks: [...landmarks],
  };
}

/**
 * Calls onChange(reason) after the page changes. The callback gets a reason only, never any content.
 * Returns a function that stops watching.
 */
export function watchPage(doc, onChange, { debounceMs = 400 } = {}) {
  let timer = null;
  let pendingReason = null;
  const schedule = (reason) => {
    pendingReason = pendingReason === 'input' ? 'input' : reason;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const r = pendingReason;
      pendingReason = null;
      onChange(r);
    }, debounceMs);
  };
  const onInput = () => schedule('input');
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('change', onInput, true);
  const View = doc.defaultView;
  const observer = View?.MutationObserver ? new View.MutationObserver(() => schedule('mutation')) : null;
  observer?.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-invalid', 'disabled', 'class'] });
  return () => {
    clearTimeout(timer);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('change', onInput, true);
    observer?.disconnect();
  };
}
