/**
 * Every Playwright script in `tests/e2e/` used to boot itself from scratch.
 * All 24 called `chromium.launch` directly, 17 built their own Vite server and
 * 23 reached for `window.__lol2d` — with no shared module anywhere in the
 * directory. The seven touch drivers had drifted into *byte-identical*
 * preambles: same 844x390 viewport, same `deviceScaleFactor: 3`, same
 * `pageerror`/`console` capture, same CDP session, same `check()`, same
 * `dispatch`/`touchStart`/`touchMove`/`touchEnd`. 32 lines of code, copied
 * three times verbatim and four more times with a different viewport, plus a
 * stray `tests/e2e/_s.mjs` in the working tree that was an eighth copy made by
 * hand.
 *
 * That is what makes a `src/` change expensive: the boot is not the part
 * anyone is testing, but it is the part that has to be edited N times.
 *
 * So this is a static source scan, in the shape of
 * tests/game/spells/mana-spend-seam.test.ts: it fails on the *pattern* rather
 * than on any one script's behaviour. It also runs inside `npm run verify`,
 * which no `tests/e2e/*.mjs` script does — the scripts themselves are manual
 * instruments and cannot fail CI, so a rule about them is only enforced if
 * something in the suite enforces it.
 *
 * ## The rule, and why it is this one
 *
 * "A script that imports the harness must not also declare its own boot."
 *
 * The first version of this test asserted that every script *driving touch*
 * imported the harness, and identified those scripts by searching for
 * `Input.dispatchTouchEvent`. That marker destroys itself: a script that
 * successfully moves onto the harness no longer contains the string, so the
 * class emptied out as the migration succeeded and the scan quietly became
 * vacuous. Its own non-vacuity guard is what caught that, which is the reason
 * the guard below is still here.
 *
 * The rule as written cannot rot that way — the importer list only grows — and
 * it catches the failure that actually costs something: a half-migrated script
 * that asks the harness for a page *and* starts a second Vite server of its
 * own, which is the "stray dev server holding 5173" condition CLAUDE.md names
 * as making the known flakes far likelier.
 *
 * ## The second rule: a script must reach `finish()` through `guard()`
 *
 * `finish()` ends with `process.exit(failures.length ? 1 : 0)`. `process.exit()`
 * inside a `finally` terminates the process before an in-flight exception can
 * propagate — so `try { ...checks... } finally { await finish(); }`, with no
 * `catch`, reaches `finally` after a throw, finds `failures` still empty
 * because the throw happened before any check recorded one, and reports "all
 * checks passed" with exit code 0. It ran a prefix of its checks and lied
 * about the rest. `page.click(selector)` on a selector that does not exist —
 * very often the exact thing a script is testing — is the commonest way in.
 * Three scripts shipped exactly that shape; a fourth called `finish()` with no
 * `try`/`catch` around it at all, which is the same hole with no bottom.
 *
 * `guard(body)` is the only correct way to run a driver's body: it always
 * reaches `finish()` through a `catch` that has already turned the throw into
 * a recorded failure, so the exit code always reflects what actually ran. A
 * script that calls `finish()` itself — wrapped in its own `try`/`finally`,
 * wrapped in nothing, named differently, it does not matter — has reopened
 * the exact hole `guard()` exists to close, so this scan bans the call
 * outright and requires `guard()` in its place.
 *
 * And the wrapper itself is banned, not only the call inside it: no importer
 * may declare a `finally` block. `guard()` *is* the try/finally every driver
 * used to write, and its `cleanup` option is the sanctioned place for a
 * script's own teardown (`drive-practice-panel.mjs` clears two `localStorage`
 * keys there). A hand-rolled `finally` underneath `guard()` either duplicates
 * that or means the migration is half done. Deliberately `finally` and not
 * `try`: a `try`/`catch` with no `finally` is a probe, not a wrapper —
 * `drive-practice-panel.mjs` uses one to click a dialog that may or may not
 * have been prompted — and banning it would be banning the wrong shape.
 *
 * ## What is deliberately not checked
 *
 * The *gesture*. `drive-minimap` taps with a 90ms hold and a 140ms settle,
 * `drive-roster-stats` with `radiusX: 6` and a session it detaches per tap, the
 * other three with `radiusX: 14` and a 70ms hold, `drive-practice-panel` with
 * 60ms. Those numbers are each script's own subject matter — how big a finger,
 * how long a press — so forcing them onto one shared `tap()` would flatten the
 * thing under test. The boot, by contrast, was byte-identical everywhere it
 * appeared, which is exactly what makes it safe to state once.
 *
 * Per-page CDP sessions are not checked either: `drive-pregame-config` opens
 * extra pages through the harness's `openPage` and has to make a session
 * against each one, because the harness's own session belongs to the main page.
 *
 * And the two scripts that boot differently are simply not importers, so the
 * rule never reaches them. That is on purpose. `drive-game.mjs` spawns
 * `npx vite` as a child process and honours `LOL2D_URL`/`LOL2D_PORT` so it can
 * be pointed at an already-running server; `verify-pwa-offline.mjs` serves the
 * *built* `dist/` through `preview()` and cuts the network. Folding either in
 * would mean the harness growing a mode for it.

 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const E2E_DIRECTORY = fileURLToPath(new URL('../e2e', import.meta.url));

const HARNESS = 'harness.mjs';

const IMPORTS_HARNESS = new RegExp(`from\\s+['"]\\./${HARNESS}['"]`);

/** Booting a browser, rather than asking the harness for one. */
const DECLARES_BROWSER_BOOT = /\bchromium\.launch\(/;

/** Booting a dev server, rather than asking the harness for one. */
const DECLARES_DEV_SERVER = /\bcreateServer\(/;

/**
 * Calling `finish()` itself, rather than letting `guard()` be the only thing
 * that ever does. This is the pattern regardless of what wraps it — a bare
 * `try`/`finally` with no `catch`, no wrapping at all, or anything else —
 * because every one of those shapes reopens the swallowed-exception hole
 * `guard()` exists to close.
 */
const CALLS_FINISH_DIRECTLY = /\bfinish\s*\(/;

/** Running the body through `guard()`, the only sanctioned replacement. */
const CALLS_GUARD = /\bguard\s*\(/;

/**
 * A hand-rolled `finally` block — the wrapper `guard()` exists to make
 * unnecessary, and whose `cleanup` option is where a script's own teardown
 * belongs. Matched on `finally` rather than on `try`: a `try`/`catch` with no
 * `finally` is a probe for something that may legitimately not be there
 * (`drive-practice-panel.mjs` clicks a discard dialog that is only sometimes
 * prompted), which is not the shape this rule is about.
 */
const DECLARES_FINALLY = /\bfinally\s*\{/;

/**
 * Comments have to go before anything is matched, or the scan flags its own
 * documentation: this file's prose names every pattern it bans, and so do the
 * migrated scripts' headers, which still explain what the harness does for
 * them. `drive-practice-panel.mjs` says "a real `Input.dispatchTouchEvent`
 * through CDP" in its file comment and nowhere in its code.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

const scripts = readdirSync(E2E_DIRECTORY).filter(name => name.endsWith('.mjs'));

const read = (name: string) => stripComments(readFileSync(join(E2E_DIRECTORY, name), 'utf8'));

const importers = scripts.filter(name => name !== HARNESS && IMPORTS_HARNESS.test(read(name)));

describe('tests/e2e scripts that share the harness take their whole boot from it', () => {
  it('ships the harness module', () => {
    expect(scripts).toContain(HARNESS);
  });

  it('has importers to check, so the scan cannot pass by finding nothing', () => {
    // The guard that caught this test's first version silently emptying out.
    // Seven scripts were migrated; a legitimate deletion can lower that, but
    // not to nothing without someone reading this comment.
    expect(importers.length).toBeGreaterThanOrEqual(5);
  });

  it.each(importers)('%s does not launch a second browser', name => {
    expect(read(name)).not.toMatch(DECLARES_BROWSER_BOOT);
  });

  it.each(importers)('%s does not start a second dev server', name => {
    expect(read(name)).not.toMatch(DECLARES_DEV_SERVER);
  });

  it.each(importers)('%s does not call finish() directly — only guard() may', name => {
    expect(read(name)).not.toMatch(CALLS_FINISH_DIRECTLY);
  });

  it.each(importers)('%s runs its body through guard()', name => {
    expect(read(name)).toMatch(CALLS_GUARD);
  });

  it.each(importers)('%s hand-rolls no finally block — guard() is the wrapper', name => {
    expect(read(name)).not.toMatch(DECLARES_FINALLY);
  });
});
