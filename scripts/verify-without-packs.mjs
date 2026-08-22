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
 *
 * ## Nothing here is ever allowed to delete the pack
 *
 * `cleanup()` removes the departure directory **only** when every pack is
 * verifiably back in `packs/`, and even then with `rmdirSync`, which refuses a
 * non-empty directory. The previous version got this exactly backwards and it
 * is worth stating why, because the shape is seductive: the restore-failure
 * branch printed "left at <path>" — telling the reader their content was safe —
 * and then fell through to `rmSync(departureDir, { recursive: true })`, whose
 * comment claimed it only removed an empty directory. It does not. A recursive
 * remove deletes a non-empty tree silently, so the one branch that exists for
 * "the restore went wrong" was the branch that turned a recoverable problem
 * into 240 spells and 378 images gone, while printing a message saying they
 * were fine. That is worse than having no safety copy at all, because it is
 * trusted.
 *
 * `--prove-restore-failure` exercises that branch on purpose: it moves the
 * pack, plants an obstacle where the pack has to go back, and goes straight to
 * the restore, skipping every expensive step. Read the paths it names and check
 * that both still hold the pack.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
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

/**
 * A byte-for-byte copy taken before anything moves, inside the departure
 * directory. A rename that half-completes is recoverable; a run killed with
 * `kill -9` between the rename and the restore is not, and the pack is not this
 * script's to lose. Removed by `cleanup()` only once every pack is back.
 */
const safetyDir = join(departureDir, '.safety-copy');

const lockPath = join(root, 'package-lock.json');
const lockBefore = readFileSync(lockPath);

/**
 * Packs that could not be put back. **While this is non-empty nothing is
 * deleted** — see this file's header for the bug that rule exists for.
 */
const stranded = [];

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

/**
 * Puts every moved pack back, and **removes nothing**. A pack it cannot put
 * back is recorded in `stranded`; `cleanup()` is the only thing that deletes,
 * and it refuses to while that list has anything in it.
 */
function restore() {
  for (const name of moved) {
    const from = join(departureDir, name);
    const to = join(root, 'packs', name);
    if (!existsSync(from)) {
      console.error(`CANNOT RESTORE packs/${name}: ${from} is gone`);
      stranded.push(name);
      continue;
    }
    if (existsSync(to)) {
      // Something recreated the directory while the pack was away. Keep both
      // rather than clobbering either; a human decides.
      console.error(`CANNOT RESTORE packs/${name}: ${to} exists again`);
      stranded.push(name);
      continue;
    }
    renameSync(from, to);
    console.log(`restored packs/${name}`);
  }
  moved = [];
  writeFileSync(lockPath, lockBefore);
}

/**
 * The only code in this file that deletes anything, and it deletes only when
 * every pack is demonstrably back in the tree.
 *
 * Two guards, because one of them was the bug. First: `stranded` non-empty
 * means the pack is still out here, so nothing goes — the run says where both
 * copies are and stops. Second: `rmdirSync`, never `rmSync(..., { recursive:
 * true })`. `rmdirSync` fails with `ENOTEMPTY` on a directory that still holds
 * anything, which makes "only if it is empty" a property of the call rather
 * than of a comment above it.
 */
function cleanup() {
  if (stranded.length) {
    const rule = '!'.repeat(74);
    console.error(`\n${rule}`);
    console.error('THE PACK IS NOT BACK IN THE TREE. Nothing has been deleted.');
    for (const name of stranded) {
      console.error(`  packs/${name} is at   ${join(departureDir, name)}`);
      console.error(`  a second copy is at   ${join(safetyDir, name)}`);
    }
    console.error('');
    console.error('Deal with whatever is sitting at packs/<name> now, then move the first');
    console.error('path back by hand. The second is a byte-for-byte duplicate taken before');
    console.error('anything moved, in case the first is somehow damaged. Delete neither');
    console.error('until `packs/` is right and `npm install` has been run.');
    console.error(`${rule}\n`);
    return;
  }
  // Every pack is back, so the safety copy is now a duplicate of live content
  // and is the one thing left in here.
  rmSync(safetyDir, { recursive: true, force: true });
  try {
    rmdirSync(departureDir);
  } catch (error) {
    console.error(
      `left ${departureDir} in place (${error.code ?? error.message}) — something is in it ` +
        'that this script did not put there; look before you remove it'
    );
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
    cleanup();
    process.exit(stranded.length ? 1 : 130);
  });
}

/**
 * A drill of the drill: move the pack, plant an obstacle where it has to go
 * back, and go straight to the restore — skipping `npm install`, `verify`,
 * `build` and the browser, none of which the failure branch touches. It exists
 * because that branch only ever runs when something has already gone wrong,
 * which is exactly the condition nobody reproduces, and it is the branch that
 * used to delete the pack.
 */
const PROVE_RESTORE_FAILURE = process.argv.includes('--prove-restore-failure');

/**
 * The sentinel `--prove-restore-failure` throws to reach the `finally`. Caught
 * and swallowed below, so the run ends in the drill's own summary and a
 * non-zero exit rather than an unhandled stack trace — a deliberate exercise
 * should not read like a crash.
 */
const PROOF_DONE = Symbol('prove-restore-failure');

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

  if (PROVE_RESTORE_FAILURE) {
    for (const name of DEPARTING) {
      const blocked = join(root, 'packs', name);
      mkdirSync(blocked, { recursive: true });
      writeFileSync(
        join(blocked, 'PLANTED-BY-PROVE-RESTORE-FAILURE'),
        'Planted by `npm run verify:without-packs -- --prove-restore-failure`.\n' +
          'Delete this directory, then move the pack back from the path the run printed.\n'
      );
      console.log(
        `planted an obstacle at packs/${name} — the restore must refuse and keep both copies`
      );
    }
    throw PROOF_DONE;
  }

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
} catch (error) {
  if (error !== PROOF_DONE) throw error;
} finally {
  log('restoring the pack');
  restoreOnce();
  if (!PROVE_RESTORE_FAILURE) {
    run('npm', ['install', '--no-audit', '--no-fund'], { allowFailure: true });
    run('node', ['scripts/generate-installed-packs.mjs'], { allowFailure: true });
  }
  cleanup();
}

if (stranded.length) {
  results.push([`packs/${stranded.join(', packs/')} restored`, false]);
  failed = true;
}

if (!PROVE_RESTORE_FAILURE && !process.argv.includes('--skip-restore-verify')) {
  log('step 7 — npm run verify again, with the pack back');
  const again = run('npm', ['run', 'verify'], { allowFailure: true });
  results.push(['verify (pack restored)', again.ok]);
  failed ||= !again.ok;
}

console.log('\n--- departure drill ---');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(failed ? '\nDRILL FAILED' : '\ndrill passed — core stands alone');
process.exit(failed ? 1 : 0);
