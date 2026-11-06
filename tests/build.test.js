// Build check: `npm run build` succeeds and dist/ holds a valid, minimal-permission MV3 extension with an isolated toolkit seam.
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const read = (p) => readFileSync(join(dist, p), 'utf8');
let manifest;

beforeAll(() => {
  execSync('npm run build', { cwd: root, stdio: 'pipe' });
  manifest = JSON.parse(read('manifest.json'));
}, 120_000);

describe('dist/manifest.json', () => {
  it('is Manifest V3 with the required fields', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Pay Without Sight');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.background).toEqual({ service_worker: 'background/service-worker.js', type: 'module' });
    expect(manifest.side_panel.default_path).toBe('sidepanel/index.html');
  });

  it('requests exactly the four permitted permissions and nothing broader', () => {
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'scripting', 'sidePanel', 'storage']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/<all_urls>|\*:\/\//);
  });

  it('every file the manifest references exists', () => {
    const refs = [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
    for (const ref of refs) expect(existsSync(join(dist, ref)), ref).toBe(true);
    expect(existsSync(join(dist, 'content/content.js'))).toBe(true); // injected on demand
    expect(existsSync(join(dist, 'sidepanel/styles.css'))).toBe(true);
  });

  it('has a strict extension page CSP', () => {
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });
});

describe('bundles', () => {
  const files = ['background/service-worker.js', 'content/content.js', 'sidepanel/app.js'];

  it('contain no network calls, remote code or dynamic evaluation', () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|\beval\s*\(|new Function\s*\(/);
      expect(src, f).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org)/);
    }
  });

  it('keep the toolkit provider out of the side panel and content script (only the service worker touches it)', () => {
    expect(read('background/service-worker.js')).toContain('standalone');
    for (const f of ['sidepanel/app.js', 'content/content.js']) {
      expect(read(f), f).not.toMatch(/createStandaloneProvider|assertProvider|getProvider|createToolkit/);
    }
  });

  it('the content script is a classic script (no import/export), as chrome.scripting requires', () => {
    expect(read('content/content.js')).not.toMatch(/^\s*(import|export)\s/m);
  });

  it('the side panel html loads only local files', () => {
    const html = read('sidepanel/index.html');
    expect(html).toMatch(/<script type="module" src="app\.js">/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]/); // no inline scripts
  });
});

describe('seam hygiene in the source tree', () => {
  const list = (dir) => readdirSync(join(root, dir), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join(dir, f));
  const importsOf = (file) => [...readFileSync(join(root, file), 'utf8').matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

  it('only the service worker and the toolkit folder import toolkit code', () => {
    const offenders = [];
    for (const f of list('src')) {
      if (f.startsWith(join('src', 'toolkit')) || f === join('src', 'background', 'service-worker.js')) continue;
      if (importsOf(f).some((i) => /toolkit/.test(i))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('safety code imports nothing from the toolkit, and the toolkit imports nothing from safety (separate consent and confirmation)', () => {
    for (const f of list(join('src', 'safety'))) expect(importsOf(f).filter((i) => /toolkit/.test(i)), f).toEqual([]);
    for (const f of list(join('src', 'toolkit'))) expect(importsOf(f).filter((i) => /safety/.test(i)), f).toEqual([]);
  });

  it('safety code has no DOM, chrome or network dependency', () => {
    for (const f of list(join('src', 'safety'))) {
      const src = readFileSync(join(root, f), 'utf8');
      expect(src, f).not.toMatch(/\bdocument\b|\bwindow\b|\bchrome\./);
      expect(src, f).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('no source file makes a network call', () => {
    for (const f of list('src')) {
      if (f.includes('demo-site')) continue;
      expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    }
  });

  it('the package installs no toolkit dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(all.filter((d) => /toolkit|accessibility/i.test(d))).toEqual([]);
    expect(statSync(join(root, 'src/toolkit')).isDirectory()).toBe(true);
  });
});
