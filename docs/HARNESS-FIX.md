# Harness fix: a Playwright script could lie about its own result

## The defect

`tests/e2e/harness.mjs`'s `finish()` ends with `process.exit(failures.length ? 1 : 0)`.
`process.exit()` inside a `finally` terminates the process before an in-flight exception can
propagate. A driver written as `try { ...checks... } finally { await finish(); }` — with no
`catch` — reaches `finally` after a throw, finds `failures` still empty (the throw happened
before any check recorded one), prints "all checks passed", and exits 0. It ran a prefix of
its checks and reported success for the whole run. `page.click(selector)` on a selector that
does not exist — very often the exact thing the script is testing — is the commonest way in.

### Repro (standalone)

```js
// mirrors the harness's old finish() shape exactly
const failures = [];
const finish = () => {
  console.log('\n--- FAILURES ---' + (failures.length ? '' : ' (none)'));
  for (const failure of failures) console.log(failure);
  if (!failures.length) console.log('all checks passed');
  process.exit(failures.length ? 1 : 0);
};

try {
  console.log('about to throw...');
  throw new Error('page.click: selector not found');
} finally {
  finish();
}
```

Output:

```
about to throw...

--- FAILURES --- (none)
all checks passed
EXIT CODE: 0
```

Confirmed: the throw is fully swallowed. The process reports success and exits 0.

## The API added: `guard(body, { cleanup } = {})`

Exported from `startHarness()`'s return value, alongside (not replacing) `finish`. A script's
whole body becomes:

```js
const { url, page, check, guard } = await startHarness({ ... });

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  ...checks...
});
```

`guard` runs the body in a `try`, catches anything thrown, records it as a failure
(`` `threw: ${error.stack ?? error.message ?? error}` ``) so it prints under `--- FAILURES ---`
and drives the exit code non-zero, then calls `finish()` from its own `finally` so the Vite
server and browser are torn down regardless of pass/fail/throw. `finish()` itself is unchanged
— `guard` is simply the only sanctioned way to reach it.

The optional second argument, `{ cleanup }`, exists for the one script (`drive-practice-panel.mjs`)
that has its own teardown beyond browser/server (clearing two `localStorage` keys so they can't
leak into the next script in the suite). `cleanup` runs after the body, pass or throw; a throw
inside `cleanup` is recorded as its own failure (`` `cleanup failed: ...` ``) rather than
replacing whatever the body already found, and `finish()` still runs after it. This exactly
reproduces the nested try/catch that `drive-practice-panel.mjs` used to hand-roll, but now
inside the one shared seam.

`finish` stays exported (not removed from the API) for the same reason `chromium.launch` and
`createServer` stay importable elsewhere in the codebase: the contract is enforced by the scan,
not by making misuse impossible at the type level — consistent with how the rest of this file
already works.

## Migrated scripts (all 12 harness importers)

Three previously exposed to the swallow bug (bare `try { } finally { await finish(); }`, no `catch`):
- `tests/e2e/drive-bot-discipline.mjs`
- `tests/e2e/measure-frame-pacing.mjs`
- `tests/e2e/verify-render-guard.mjs`

Four that hand-rolled a working `catch (error) { failures.push(...) } finally { await finish(); }`
(not buggy, but a different rule for the next author to remember — now uniform):
- `tests/e2e/drive-minimap.mjs`
- `tests/e2e/drive-mobile-hud.mjs`
- `tests/e2e/drive-touch-controls.mjs`
- `tests/e2e/verify-touch-aiming.mjs`

One whose `catch` block used `check('the basic-attack driver completed', false, ...)` instead
of pushing to `failures` directly (functionally equivalent, now folded into `guard`'s generic
message):
- `tests/e2e/drive-basic-attacks.mjs`

One with no `try`/`catch` at all — a throw anywhere skipped `finish()` and `browser`/`server`
teardown entirely, and any Node behavior (crash message, exit code) was accidental, not
guaranteed:
- `tests/e2e/drive-match-config.mjs`

Two that never called the harness's `finish()` and reimplemented (or half-reimplemented) their
own tail, one with no protection around it at all:
- `tests/e2e/drive-roster-stats.mjs` — no `try`/`catch`/`finally` anywhere; manual
  `browser.close()`/`server.close()`/exit-code tail at the very end, unreached on a throw.
- `tests/e2e/measure-chogath-stacks.mjs` — its own custom `try/catch/finally` with a correct
  `browser.close()`/`server.close()` in `finally` and `process.exit(exitCode)` after (this one
  was not buggy), but a completely separate `exitCode` variable instead of the harness's
  `check()`/`failures`. Migrated onto `guard` + `check()` for uniformity; the two scenario
  passes' `pageErrors` are now asserted via a `check(...)` call instead of a silent
  `if (...) exitCode = 1`.

One with its own nested cleanup `try`/`catch` plus a hand-rolled 20-line copy of the harness's
own `finish()` tail:
- `tests/e2e/drive-practice-panel.mjs` — migrated onto `guard(body, { cleanup })`; the
  duplicated report/page-errors/FAILURES/exit-code printing was deleted entirely, since
  `finish()` (called by `guard`) already does the exact same thing.

**Note on indentation**: for the three scripts that had no pre-existing `try { }` block
(`drive-match-config.mjs`, `drive-roster-stats.mjs`, `measure-chogath-stacks.mjs`), the body
was wrapped in `guard(async () => { ... })` without reindenting the body by two spaces. These
three files already failed `npx prettier --check` before this change (pre-existing, per
CLAUDE.md's note that several `tests/e2e/*.mjs` files predate Prettier), so the tradeoff was:
reindent ~250-380 lines of unrelated code by hand at real risk of a slip in a mechanical
sed/python pass across template literals and multi-line calls, for a file that was not
Prettier-clean to begin with — versus a boundary-only edit that `node --check` and a full test
run can verify byte-for-byte. I chose the boundary-only edit. The nine scripts that already had
a `try { }` block needed no reindentation at all: `guard(async () => { ... })` opens a block at
the same nesting depth `try { }` did, so their existing +2-space body indentation was already
correct. All six previously-Prettier-clean importers (`drive-bot-discipline.mjs`,
`drive-minimap.mjs`, `drive-mobile-hud.mjs`, `measure-frame-pacing.mjs`,
`verify-render-guard.mjs`, `verify-touch-aiming.mjs`) plus `harness.mjs` and
`tests/scripts/e2eHarness.test.ts` still pass `npx prettier --check` after this change.

## The scan: `tests/scripts/e2eHarness.test.ts`

Added two new rules to the existing `it.each(importers)` suite, following the file's own
idiom (comments stripped before matching, `stripComments`, reused as-is):

- `CALLS_FINISH_DIRECTLY = /\bfinish\s*\(/` — an importer must never call `finish()` itself,
  wrapped in anything or nothing. `%s does not call finish() directly — only guard() may`.
- `CALLS_GUARD = /\bguard\s*\(/` — an importer must run its body through `guard()`.
  `%s runs its body through guard()`.

Both run inside the existing `it.each(importers)` loop, so they inherit the file's existing
non-vacuity guard (`expect(importers.length).toBeGreaterThanOrEqual(5)` — currently 12).

### Demonstrated failing

Reverted `tests/e2e/verify-render-guard.mjs` to the pre-fix bare `try { } finally { await
finish(); }` shape (no `guard`), ran `npx vitest run tests/scripts/e2eHarness.test.ts`:

```
 FAIL  tests/scripts/e2eHarness.test.ts > tests/e2e scripts that share the harness take their
       whole boot from it > verify-render-guard.mjs does not call finish() directly — only
       guard() may
 FAIL  tests/scripts/e2eHarness.test.ts > tests/e2e scripts that share the harness take their
       whole boot from it > verify-render-guard.mjs runs its body through guard()

 Test Files  1 failed (1)
      Tests  2 failed | 48 passed (50)
```

The scan named the exact reverted file on both new rules. Restored `verify-render-guard.mjs`
(diffed byte-identical against a pre-revert backup to confirm); re-ran the scan: 50/50 passing.

## End-to-end demonstration: the harness now tells the truth

Used `verify-render-guard.mjs` (cheapest of the three originally-exposed scripts), with
`LOL2D_CHROME_CHANNEL=` (empty, Playwright's bundled Chromium — system Chrome was also
available and used for the final clean run). Broke it by pointing `page.click` at
`#play-btn-does-not-exist` (3s timeout) instead of the real `#play-btn`.

**BEFORE** — reverted to the pre-fix bare `try { } finally { await finish(); }` shape, broken
selector:

```
$ node tests/e2e/verify-render-guard.mjs
Port 5173 is in use, trying another one...

--- report ---
{}

all checks passed
BEFORE EXIT CODE: 0
```

The throw (`page.click: Timeout 3000ms exceeded`) is fully swallowed — exactly the defect.

**AFTER** — same broken selector, restored to the `guard()`-based shape:

```
$ node tests/e2e/verify-render-guard.mjs
Port 5173 is in use, trying another one...

--- report ---
{}

--- FAILURES ---
threw: page.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator('#play-btn-does-not-exist')

    at .../tests/e2e/verify-render-guard.mjs:28:14
    at async guard (.../tests/e2e/harness.mjs:191:7)
    at async file://.../tests/e2e/verify-render-guard.mjs:26:1
AFTER EXIT CODE: 1
```

The harness now reports exactly what happened: it prints `--- FAILURES ---` with the real
error and stack, and exits 1. Restored the file to its migrated state afterward (diffed
byte-identical against a pre-experiment backup).

## Clean run after restoring

Ran the real, unmodified, migrated `verify-render-guard.mjs` against the real `#play-btn`
selector (needed `npm run predev` first — `public/vendor/p5.min.js` didn't exist yet in this
freshly-installed worktree; that's environment setup, not part of the harness fix):

```
$ node tests/e2e/verify-render-guard.mjs
Port 5173 is in use, trying another one...
PASS  the frame loop is running  — 65 -> 95
PASS  the loop survives a draw that throws every frame  — 95 -> 143
PASS  the crash is put on the screen
PASS  it names the error
PASS  it offers a reload
PASS  it counts the frames that failed  — 48
PASS  drawing resumes once the fault clears  — 174
PASS  the error still reaches pageerror, once  — 1
PASS  nothing else went wrong  — pageerror: e2e-forced-draw-crash

all checks passed
CLEAN RUN EXIT CODE: 0
```

All 9 checks pass, exit 0. The migration did not break the normal path.

("Port 5173 is in use, trying another one" is a pre-existing, unrelated Vite dev server on this
machine from another worktree/session, not a leak from this work — confirmed via `lsof -i :5173`
and `ps aux`, whose PID and start time predate this session. No stray server or browser process
was left behind by any of the runs performed here.)

## `npm run verify`

Green: 243 test files, 3961 tests, exit code 0.

```
$ npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"
 Test Files  243 passed (243)
      Tests  3961 passed (3961)
```

## What I found but did not fix

- **`drive-game.mjs` and `verify-pwa-offline.mjs`** are correctly untouched (neither imports
  the harness), per the task's explicit instruction. Confirmed `git status --short` on both is
  empty.
- **Message-format drift, not a correctness issue**: a handful of migrated scripts lost a
  slightly more specific failure label in exchange for `guard`'s generic
  `` `threw: ${error.stack ...}` `` — e.g. `drive-basic-attacks.mjs`'s catch used to name the
  check `'the basic-attack driver completed'`; `drive-roster-stats.mjs` used to print
  `frames in ${OUT}` before its pass/fail line. Both are cosmetic; the FAILURES section still
  carries the real error and stack either way, and uniformity across all 12 scripts was the
  explicit goal.
- **`measure-chogath-stacks.mjs`'s two-scenario `pageErrors` check** is now a single combined
  `check('no page errors in either scenario', ...)` instead of two separate silent
  `if (...) exitCode = 1` branches — this makes a page-error failure visible in the printed
  report for the first time (previously it only flipped the exit code with no console line
  naming which scenario). Not a regression; strictly more informative.
- Did not touch Prettier formatting on the six already-non-compliant files
  (`drive-basic-attacks.mjs`, `drive-match-config.mjs`, `drive-practice-panel.mjs`,
  `drive-roster-stats.mjs`, `drive-touch-controls.mjs`, `measure-chogath-stacks.mjs`) beyond
  what the mechanical migration touched, per CLAUDE.md's explicit instruction not to run
  `--write` across files that predate Prettier as a side effect of an unrelated change.
