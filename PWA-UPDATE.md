# PWA update-prompt latency

## The report

> sao phần check pwa có bản mới, cần cập nhật nó chậm quá ta? t mở game lên phải đợi
> 10-20s ở màn menu nó mới hiện btn update, user thường vô là bấm chơi game luôn ấy,
> có cách nào cho nó check + hiện nhanh hơn ko

Opening the app after a new build has been deployed, the "Có bản mới — cập nhật" button
only appears 10-20 seconds after the menu is already on screen. Most players have
pressed Play well before then, so the prompt is effectively never seen.

## How this was measured

Reasoning from arithmetic about service-worker timing has burned a round here before
(see CLAUDE.md), so the whole investigation was instrumented rather than argued.

**CDP network throttling doesn't work for this bug.** The obvious tool —
`Network.emulateNetworkConditions` on a Playwright `CDPSession` — was tried first and
silently threw away every measurement: it only throttles the page's own `fetch`/XHR
calls, not the requests the *service worker* issues in the background for precaching.
Confirmed directly (`context.route()` intercepting a manual `fetch()` was slowed by CDP
throttling; the exact same throttle applied while a real SW install was in flight
changed nothing about its timing). Switched to `context.route('**/*', …)` with a
synthetic per-request delay (`latency + bytes / throughput`, "Fast 3G" numbers — 200KB/s,
+150ms), confirmed *that* does cover SW-initiated requests, and used it for every
timing number below.

**The repro needs two real builds and a way to swap the served files mid-run** — no
existing script does this shape (`verify-pwa-offline.mjs` serves one build once). The
new script (`tests/e2e/measure-pwa-update-latency.mjs`, `npm run e2e:pwa-update`)
builds v1, serves it, lets a real service worker install and take control (an
already-installed player), applies **one real line** inside `Game`'s constructor
(`console.debug(...)` — a comment doesn't survive minification and changes nothing in
the output, which cost an hour of chasing a non-bug before this was caught), rebuilds
as v2, and swaps v2's files into the same served directory (a deploy happening while
the device was closed). It then reopens the page fresh, throttled, and times both
`#menu-update-checking` (new) and `#menu-update-btn` (existing) from navigation start.

**That single-line bump was cross-checked against two real commits 14 apart**
(`39baf2c` → `6abcf1c`, a genuine day-to-day range: combat-text perf, AI fixes, a
buff-stacking rewrite — nothing touching spells) by building both in temporary
worktrees and diffing `dist/`: **65 changed files, ~1.2MB**. The synthetic bump produces
**67 files, ~1.24MB** — same order, same shape, and it's reproducible without pinning
to specific commit hashes, so it's what the permanent script uses.

## Where the 10-20 seconds actually goes

Not registration timing, not HTTP caching of `sw.js`, and not "the check never runs
soon enough" — all three were live hypotheses and all three were ruled out by
measurement:

- **`registerServiceWorker()` is not gated behind the menu rendering.** It is the last
  synchronous line of p5's `setup()`, which itself only runs at/after `window.load` —
  and `MenuScene` only mounts later still, once `LoadingScene` finishes its own asset
  fetch, well after `setup()` has already kicked off registration. There is no gap here
  to close.
- **The browser's own update check is fast.** `navigator.serviceWorker.register()`
  triggers a real byte-comparison of `sw.js` essentially immediately when a registration
  already exists — measured at low-single-digit-seconds even before any code change,
  confirmed both via an explicit `registration.update()` call (`updatefound` at ~6.5ms
  on localhost) and via a plain page reopen with the *original*, unmodified code
  (button appeared in ~2.3s against a *tiny*, one-file diff).
- **HTTP caching of `sw.js` isn't the culprit either.** Browsers bypass their HTTP
  cache for the main service-worker script specifically because of this well-known
  footgun, and Vite's preview server (used for every measurement here) sends
  `Cache-Control: no-cache` on it regardless.

**The actual bottleneck is `workbox-precaching`'s own install loop, which is
deliberately sequential** — `node_modules/workbox-precaching/PrecacheController.js`,
`install()`:

```js
// Cache entries one at a time.
// See https://github.com/GoogleChrome/workbox/issues/2528
for (const [url, cacheKey] of this._urlsToCacheKeys) {
  ...
  await Promise.all(this.strategy.handleAll({ ... }));
}
```

One request at a time, awaited, no concurrency — a deliberate upstream choice (the
linked issue is about `cache.put()` races in older browsers), and there is no public
config to change it. `updateReady` only flips once every changed entry has been
fetched this way, so the total time is roughly `(# changed files) × (per-request
latency)`, not bandwidth-bound. Confirmed directly: throttled route logging showed
**max concurrent in-flight requests = 1** during a real install, with each of the 67
changed files taking ~230ms back-to-back — `67 × ~230ms ≈ 15.4s`, plus ~1.5s of
registration/comparison overhead, matching the measured **19.3-19.5s** almost exactly.

**Why a typical deploy touches dozens of files at all**, not just the ones a commit
actually changed: every per-champion `spell-<name>.js` chunk imports the shared `game`
chunk *by its content-hashed filename*. Any change under `src/game/` changes that
filename, which changes the import statement's *text* in all 59 spell chunks, which
changes all 59 of their hashes too — even when not one of those 59 files has a single
different line of logic. This is a real, generalizable cache-busting cascade, not
specific to this bug's repro. Flagged below as a separate worthwhile optimization; not
fixed here.

## Before / after

| | signal | time |
|---|---|---|
| **Before** (original code, only signal = the button) | `#menu-update-btn` | **19,231 – 19,456 ms** |
| **After** (this change) | `#menu-update-checking` (new) | **2,321 – 2,331 ms** |
| **After** (this change) | `#menu-update-btn` (unchanged) | **19,231 – 19,260 ms** |

Same throttle profile, same ~1.2MB/65-67-file diff, three independent runs each side.
The actionable button's own timing is **intentionally unchanged** — see "what was
rejected" below.

## What changed

`src/pwa/updates.ts`:

- New `updateDownloading` ref: true from the moment `updatefound` fires on the
  registration (an update exists and has started installing) until it either finishes
  (`installed`/`redundant`) or `UPDATE_DOWNLOAD_STALL_MS` (2 minutes, exported tuning
  constant) gives up waiting — a cosmetic-only backstop against a stuck message on a
  connection that drops mid-download; nothing about the real update depends on it.
- `trackDownloadingUpdate()`: the small state machine above, pulled out on purpose so
  it is testable without `virtual:pwa-register` (which does not exist under Vitest) —
  covered by `tests/pwa/updates.test.ts` (7 cases, fake worker + fake timers, no real
  browser needed).
- `onRegisteredSW` now attaches `registration.addEventListener('updatefound', …)` and
  also checks `registration.installing` once immediately (the browser's own `register()`
  call can already have an install in flight by the time this callback runs, which
  would otherwise miss the event). Gated on `navigator.serviceWorker.controller` being
  present already — a bare `installing` worker with **no** controller is the very
  first install, `onOfflineReady`'s story, not "an update".
- `updateReady`/`onNeedRefresh` and `applyUpdate()` are **untouched**. Pressing the
  actionable button still requires the real `waiting` worker to exist — applying an
  update before its download has actually finished has nothing to skip-wait to, and
  this is exactly the boundary the task's "must not interrupt a running match"
  constraint depends on.

`src/scenes/MenuScene.vue` / `styles/menu-scene.css`:

- A new, **non-interactive** `<p id="menu-update-checking">` — "Đang tải bản cập nhật
  mới…" with a spinning icon — shown when `updateDownloading && !updateReady`, same
  corner as the real button, `pointer-events: none`. No touch handler needed: it is not
  a control, just a status line (the existing button is untouched and keeps both its
  click and touch handling from before).

## What was rejected

- **`registerType: 'autoUpdate'`.** Explicitly out of scope per the task — it reloads
  the page unconditionally, which would end a running match. Not implemented.
- **Making the actionable button appear before the download finishes, or auto-applying
  once `updatefound` fires.** Both would either silently do nothing when pressed early
  (no waiting worker yet) or risk reloading mid-match. `updateDownloading` was chosen
  specifically because it's honest — "downloading", not "ready" — and adds no new path
  to an unprompted reload.
- **Trying to parallelize `workbox-precaching`'s install loop.** No public option;
  would mean forking/patching an upstream library for a `generateSW`-mode build, which
  is a much bigger risk than this ticket's scope justifies.
- **Reducing `UPDATE_CHECK_INTERVAL_MS`.** Measured and ruled out as the cause (the
  browser's own registration-time check already fires in ~1-2s, long before any
  interval matters for a freshly-opened tab), so shortening it would not have moved the
  reported number. Left at 1 hour.

## Found, not fixed

**The `game`-chunk cascade above is a real, standing amplifier of every deploy's
update-download time**, independent of this bug: any change under `src/game/` (which is
most commits) invalidates all 59 per-champion `spell-*.js` chunks' hashes purely because
they reference `game`'s filename in an import statement, not because their own code
changed. Breaking that dependency (e.g. keying each spell's import off something more
stable, or accepting the churn but shrinking what's in the `game` chunk) would directly
shrink the *actual* download `updateReady` waits on, on top of what this change does for
the *signal*. Deliberately not attempted here — it touches `vite.config.ts`'s chunking
rules, which `scripts/check-chunks.mjs` and two boot-path tests guard closely, and is a
separate, larger piece of work from "the prompt shows up too late."

## Testing

- `npm run verify`: **246 test files, 3961 tests, all passing.** Includes the new
  `tests/pwa/updates.test.ts` (7 tests covering `trackDownloadingUpdate`'s branches:
  lights on `updatefound`-equivalent, clears on `installed`, clears on `redundant`,
  ignores non-terminal state changes, gives up after the stall timeout, cancels the
  stall timeout when the worker finishes first).
- Proven falsifiable: `trackDownloadingUpdate`'s "light on start" line was commented
  out, `npx vitest run tests/pwa/updates.test.ts` correctly failed 3 of 7 cases, the
  fix was restored, all 7 passed again.
- `npm run e2e:pwa`: **PASS** — offline boot, 458 cached entries, a match starts with
  the network cut. Unaffected by this change.
- `npm run e2e:pwa-update` (new): **PASS** against the fix (`checking=2321-2331ms
  btn=19231-19260ms over 67 throttled requests`). Proven falsifiable against the
  original code by `git stash`-ing the fix and rerunning: `#menu-update-checking` never
  appeared (correctly, since it does not exist yet) and the run reported `FAIL (3)`;
  fix restored, reran clean.
