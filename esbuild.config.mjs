// Build script: bundles the three entry points with esbuild and copies static files into dist/.
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'browser',
  target: 'chrome114',
  sourcemap: false,
  logLevel: 'info',
};

const entries = [
  // Service worker is an ES module (manifest declares "type": "module").
  { ...common, entryPoints: [path.join(root, 'src/background/service-worker.js')], outfile: path.join(dist, 'background/service-worker.js'), format: 'esm' },
  // Content script is injected on demand with chrome.scripting, so it must be a classic script.
  { ...common, entryPoints: [path.join(root, 'src/content/content-main.js')], outfile: path.join(dist, 'content/content.js'), format: 'iife' },
  // Side panel script is loaded as <script type="module">.
  { ...common, entryPoints: [path.join(root, 'src/sidepanel/app.js')], outfile: path.join(dist, 'sidepanel/app.js'), format: 'esm' },
];

async function copyStatic() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(path.join(dist, 'sidepanel'), { recursive: true });
  await cp(path.join(root, 'src/sidepanel/index.html'), path.join(dist, 'sidepanel/index.html'));
  await cp(path.join(root, 'src/sidepanel/styles.css'), path.join(dist, 'sidepanel/styles.css'));
  await cp(path.join(root, 'public/icons'), path.join(dist, 'icons'), { recursive: true });
}

if (watch) {
  const contexts = await Promise.all(entries.map((e) => context(e)));
  await copyStatic();
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('Watching for changes. Re-run `npm run build` if you change static files.');
} else {
  await rm(dist, { recursive: true, force: true });
  await Promise.all(entries.map((e) => build(e)));
  await copyStatic();
  console.log('Build complete: load the dist/ folder in chrome://extensions (Developer mode > Load unpacked).');
}
