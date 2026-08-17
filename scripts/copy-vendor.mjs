/**
 * Copies the two globals the game cannot boot without out of `node_modules`
 * and into `public/vendor/`, where Vite serves them verbatim in dev and copies
 * them into `dist/` on build.
 *
 * Both used to come from a CDN `<script>` tag, and both are load-bearing in the
 * hard sense: p5 supplies every drawing global, and `GameScene` calls
 * `new Stats()` with no guard, so either one failing to arrive is a white
 * screen rather than a degraded one. That is survivable for a page you reload;
 * it is not survivable for an installed app whose whole promise is that it
 * opens without a network. A service worker cannot fix it either — it can only
 * cache a cross-origin script it has already seen fetched successfully, so the
 * first launch on a bad connection would still be blank.
 *
 * Font Awesome deliberately stays on its CDN: a missing icon font is a missing
 * icon, and the service worker's runtime cache covers it after the first load.
 *
 * They are copied rather than committed so the version in `dist` is always the
 * version in `package.json` — `p5@^1.9.4` moving under us should move the file
 * too, not leave a stale one checked in beside it.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'vendor');

/** Source in `node_modules` → filename `index.html` asks for. */
const VENDORED = [
  ['p5/lib/p5.min.js', 'p5.min.js'],
  ['stats.js/build/stats.min.js', 'stats.min.js'],
];

mkdirSync(outDir, { recursive: true });
for (const [from, to] of VENDORED) {
  copyFileSync(join(root, 'node_modules', from), join(outDir, to));
  console.log(`vendor: ${to}`);
}
