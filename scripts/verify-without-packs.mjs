/**
 * The departure drill: move the optional content packs out of this tree, and
 * require core to still install, generate, typecheck, test and build.
 *
 * This is the acceptance test for the whole content-pack extraction. Every
 * other guard in this repository is *arrangement* — packs are workspace
 * packages, they reach core only through `import type`, core's public surface
 * is declared in `exports`, the scans derive their roots from the installed
 * set. None of that proves core can actually stand alone, because with
 * `packs/riot/` sitting in the tree every one of those guards runs against a
 * checkout that has the pack. Only taking it away proves anything.
 *
 * It is one command on purpose. The same procedure written as a paragraph in
 * a design document is a procedure nobody runs, and the first time anybody
 * would have found out is the day the pack became a separate repository.
 *
 *   npm run verify:without-packs
 *
 * ## What it does
 *
 *   1. move `packs/riot/` outside the tree — `rename`, never `rm`. It is 240
 *      spells and 378 images and it is not this script's to delete. Restored
 *      in a `finally`, and on SIGINT/SIGTERM too.
 *   2. `npm install`, so the `node_modules/@moba2d/content-riot` workspace
 *      link actually goes away. Without this the pack is still resolvable by
 *      package name through a dangling symlink and the drill proves nothing.
 *   3. regenerate `src/generated/installedPacks.ts` — the generated barrel is
 *      the one place "which packs are installed" is written down, and a stale
 *      one would still name the departed pack.
 *   4. `npm run verify`
 *   5. `npm run build`
 *   6. **boot the thing** — `tests/e2e/verify-core-alone.mjs` drives a real
 *      browser to a real, playable match on the reference pack's map. A build
 *      that succeeds and a menu that dead-ends is the failure this drill
 *      exists to catch, and steps 1-5 cannot see it: Vitest runs on
 *      `environment: 'node'`, with no renderer and no `GameScene`.
 *   7. restore everything and verify again, so a green drill leaves the tree
 *      exactly as it found it rather than merely claiming to.
 *
 * `package-lock.json` is snapshotted and restored byte for byte: step 2
 * rewrites it (a workspace member disappearing is a real lockfile change) and
 * that edit must not survive the run.
 *
 * `--skip-restore-verify` drops step 7's second `npm run verify` when you are
 * iterating and only care about the pack-free half; `--skip-boot` drops step 6,
 * for a machine with no browser. The restore itself always runs, on every path,
 * including a throw and a SIGINT.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Which pack directories leave. `reference` deliberately does not: it is
 * core's own content, the thing that makes core a complete game standing
 * alone rather than a menu, and it is not an optional install. See
 * `src/content/install.ts`'s own header.
 */
const DEPARTING = ['riot'];

/**
 * Outside the tree, and outside every glob that reads it — `packs/*` in
 * `package.json`'s `workspaces`, `src/**` in `tsconfig.json`, Vitest's own
 * default include. A sibling of the checkout is the cheapest place that is
 * certainly on the same filesystem, so the move is a rename rather than a
 * copy of 378 images.
 */
const departureDir = join(dirname(root), `.${basename(root)}-pack-departure`);

const lockPath = join(root, 'package-lock.json');
const lockBefore = readFileSync(lockPath);

const log = message => console.log(`\n=== ${message}`);

const run = (command, args, { allowFailure = false } = {}) => {
  log(`${command} ${args.join(' ')}`);
  try {
    execFileSync(command, args, { cwd: root, stdio: 'inherit' });
    return { ok: true };
  } catch (error) {
    if (!allowFailure) throw error;
    return { ok: false, status: error.status ?? 1 };
  }
};

let moved = [];

function depart() {
  mkdirSync(departureDir, { recursive: true });
  for (const name of DEPARTING) {
    const from = join(root, 'packs', name);
    const to = join(departureDir, name);
    if (!existsSync(from)) throw new Error(`packs/${name} is not here to move`);
    if (existsSync(to)) throw new Error(`${to} already exists — a previous drill did not restore`);
    renameSync(from, to);
    moved.push(name);
    console.log(`moved packs/${name} -> ${to}`);
  }
}

function restore() {
  for (const name of moved) {
    const from = join(departureDir, name);
    const to = join(root, 'packs', name);
    if (!existsSync(from)) {
      console.error(`CANNOT RESTORE packs/${name}: ${from} is gone`);
      continue;
    }
    if (existsSync(to)) {
      // Something recreated the directory while the pack was away. Keep both
      // rather than clobbering either; a human decides.
      console.error(`CANNOT RESTORE packs/${name}: ${to} exists again — left at ${from}`);
      continue;
    }
    renameSync(from, to);
    console.log(`restored packs/${name}`);
  }
  moved = [];
  writeFileSync(lockPath, lockBefore);
  try {
    rmSync(departureDir, { recursive: true });
  } catch {
    /* only if empty and only if it can be — never worth failing the run over */
  }
}

let restored = false;
const restoreOnce = () => {
  if (restored) return;
  restored = true;
  restore();
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.error(`\n${signal} — restoring the pack before exiting`);
    restoreOnce();
    process.exit(130);
  });
}

const results = [];
let failed = false;

try {
  // A copy first: a rename that half-completes is recoverable, but a run
  // killed with `kill -9` between the rename and the restore is not, and the
  // pack is not this script's to lose.
  log('snapshotting packs/ before anything moves');
  const safety = join(departureDir, '.safety-copy');
  mkdirSync(safety, { recursive: true });
  for (const name of DEPARTING) {
    cpSync(join(root, 'packs', name), join(safety, name), { recursive: true });
  }
  console.log(`safety copy at ${safety}`);

  log('step 1 — moving the optional packs out of the tree');
  depart();

  log('step 2 — npm install, so the workspace link goes away');
  run('npm', ['install', '--no-audit', '--no-fund']);

  log('step 3 — regenerating the installed-packs barrel');
  run('node', ['scripts/generate-installed-packs.mjs']);

  log('step 4 — npm run verify, with no riot pack in the tree');
  const verify = run('npm', ['run', 'verify'], { allowFailure: true });
  results.push(['verify (pack absent)', verify.ok]);
  failed ||= !verify.ok;

  log('step 5 — npm run build, with no riot pack in the tree');
  const build = run('npm', ['run', 'build'], { allowFailure: true });
  results.push(['build (pack absent)', build.ok]);
  failed ||= !build.ok;

  // The step that is easy to skip and is the actual point. A build that
  // succeeds and a menu that dead-ends is the failure this whole drill exists
  // to catch, and nothing above this line can see it: `verify` runs Vitest on
  // `environment: 'node'`, with no renderer, no p5, no DOM and no `GameScene`.
  // `--skip-boot` is for a machine with no browser at all; `LOL2D_CHROME_CHANNEL=`
  // (empty) is the better answer there, and swaps system Chrome for
  // Playwright's own bundled Chromium.
  if (process.argv.includes('--skip-boot')) {
    console.log('\n=== step 6 — skipped (--skip-boot)');
  } else {
    log('step 6 — does it still boot? a real browser, a real match');
    const boot = run('node', ['tests/e2e/verify-core-alone.mjs'], { allowFailure: true });
    results.push(['boots to a playable match (pack absent)', boot.ok]);
    failed ||= !boot.ok;
  }
} finally {
  log('restoring the pack');
  restoreOnce();
  run('npm', ['install', '--no-audit', '--no-fund'], { allowFailure: true });
  run('node', ['scripts/generate-installed-packs.mjs'], { allowFailure: true });
  rmSync(join(departureDir), { recursive: true, force: true });
}

if (!process.argv.includes('--skip-restore-verify')) {
  log('step 7 — npm run verify again, with the pack back');
  const again = run('npm', ['run', 'verify'], { allowFailure: true });
  results.push(['verify (pack restored)', again.ok]);
  failed ||= !again.ok;
}

console.log('\n--- departure drill ---');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(failed ? '\nDRILL FAILED' : '\ndrill passed — core stands alone');
process.exit(failed ? 1 : 0);
