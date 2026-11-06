// @vitest-environment jsdom
// axe-core check on the side panel HTML in its default and review-visible states, plus structural a11y assertions.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import axe from 'axe-core';

const root = process.cwd();
const html = readFileSync(join(root, 'src/sidepanel/index.html'), 'utf8');
const css = readFileSync(join(root, 'src/sidepanel/styles.css'), 'utf8');

function load() {
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
  document.documentElement.lang = 'en';
  document.querySelectorAll('script, link').forEach((n) => n.remove());
}

// jsdom cannot compute real colours or layout, so colour-contrast is checked by hand below instead.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };
async function violations() {
  const res = await axe.run(document.documentElement, AXE_OPTIONS);
  return res.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

beforeEach(load);

describe('axe-core', () => {
  it('has no violations in the default state', async () => {
    expect(await violations()).toEqual([]);
  });

  it('has no violations with the review area, notice and settings open', async () => {
    document.getElementById('review').hidden = false;
    document.getElementById('review-notice').hidden = false;
    document.getElementById('review-notice-text').textContent = 'A detail changed. Confirm again.';
    document.getElementById('execute-btn').hidden = false;
    document.getElementById('settings-body').hidden = false;
    document.getElementById('settings-toggle').setAttribute('aria-expanded', 'true');
    expect(await violations()).toEqual([]);
  });
});

describe('structure', () => {
  it('has header, main and footer landmarks and exactly one h1', () => {
    expect(document.querySelectorAll('header').length).toBe(1);
    expect(document.querySelectorAll('main').length).toBe(1);
    expect(document.querySelectorAll('footer').length).toBe(1);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('never skips a heading level', () => {
    const levels = [...document.querySelectorAll('h1, h2, h3')].map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  it('every control has an accessible name', () => {
    for (const c of document.querySelectorAll('input, select, button')) {
      const named = c.labels?.length || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || c.textContent.trim();
      expect(named, c.id).toBeTruthy();
    }
  });

  it('the result is a polite live region and the progress bar exposes its value as text', () => {
    const result = document.getElementById('result');
    expect(result.getAttribute('role')).toBe('status');
    expect(result.getAttribute('aria-live')).toBe('polite');
    const bar = document.getElementById('progress-bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
    for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-valuetext']) expect(bar.hasAttribute(a)).toBe(true);
  });

  it('the review area starts hidden, its heading can receive focus, and the settings disclosure exposes expanded state', () => {
    expect(document.getElementById('review').hidden).toBe(true);
    expect(document.getElementById('review-heading').getAttribute('tabindex')).toBe('-1');
    const toggle = document.getElementById('settings-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('settings-body');
  });

  it('the instruction box comes first in the tab order after the skip link, and Run is a submit button (Enter runs)', () => {
    const focusables = [...document.querySelectorAll('a[href], button, input, select')].filter((n) => !n.closest('[hidden]'));
    expect(focusables.map((n) => n.id || n.className).slice(0, 3)).toEqual(['skip-link', 'command', 'run']);
    expect(document.getElementById('run').type).toBe('submit');
  });

  it('loads no external resources', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/https?:\/\/|@import|url\(/);
  });
});

describe('design system', () => {
  it('defines the required colours and focus ring, and never removes focus', () => {
    for (const token of ['#ffffff', '#f3faf5', '#d5e8db', '#0a0a0a', '#2b2b2b', '#166534', '#14532d', '#dcf2e3', '#b42318']) expect(css.toLowerCase()).toContain(token);
    expect(css).toMatch(/outline:\s*3px solid var\(--green\)/);
    expect(css).toMatch(/outline-offset:\s*2px/);
    expect(css).not.toMatch(/outline:\s*(none|0)/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/forced-colors:\s*active/);
    expect(css).not.toMatch(/gradient|@font-face/);
  });

  it('controls are at least 44px tall', () => {
    expect(css).toMatch(/button\s*{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/input\[type="text"\], select\s*{[^}]*min-height:\s*44px/);
  });

  it('text and background pairs meet WCAG AA contrast (4.5:1)', () => {
    const lum = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const pairs = [
      ['#0a0a0a', '#ffffff'], ['#2b2b2b', '#ffffff'], ['#0a0a0a', '#f3faf5'], ['#2b2b2b', '#f3faf5'], ['#0a0a0a', '#dcf2e3'],
      ['#ffffff', '#166534'], ['#ffffff', '#14532d'], ['#166534', '#ffffff'], ['#166534', '#dcf2e3'], ['#b42318', '#ffffff'],
    ];
    for (const [fg, bg] of pairs) expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
