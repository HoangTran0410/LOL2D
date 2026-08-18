/**
 * Copies the one global the game cannot boot without out of `node_modules` and
 * into `public/vendor/`, where Vite serves it verbatim in dev and copies it
 * into `dist/` on build.
 *
 * p5 used to come from a CDN `<script>` tag, and it is load-bearing in the hard
 * sense: it supplies every drawing global, so failing to arrive is a white
 * screen rather than a degraded one. That is survivable for a page you reload;
 * it is not survivable for an installed app whose whole promise is that it
 * opens without a network. A service worker cannot fix it either — it can only
 * cache a cross-origin script it has already seen fetched successfully, so the
 * first launch on a bad connection would still be blank.
 *
 * stats.js was vendored here too and is gone. It was never a boot dependency —
 * `GameScene` only ever constructed it under `import.meta.env.DEV` — so every
 * production player was fetching, parsing and precaching a blocking script for
 * three FPS panels they would never see.
 *
 * Font Awesome deliberately stays on its CDN: a missing icon font is a missing
 * icon, and the service worker's runtime cache covers it after the first load.
 *
 * It is copied rather than committed so the version in `dist` is always the
 * version in `package.json` — `p5@^1.9.4` moving under us should move the file
 * too, not leave a stale one checked in beside it.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'vendor');

/** Source in `node_modules` → filename `index.html` asks for. */
const VENDORED = [['p5/lib/p5.min.js', 'p5.min.js']];

mkdirSync(outDir, { recursive: true });
for (const [from, to] of VENDORED) {
  copyFileSync(join(root, 'node_modules', from), join(outDir, to));
  console.log(`vendor: ${to}`);
}
