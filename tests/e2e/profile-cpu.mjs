/**
 * Where does a worst-case mobile frame actually go?
 *
 * Boots the same scenario as bench-mobile-render (full bot roster, every bot
 * fighting, minimum zoom), takes a real V8 CPU profile through CDP, and prints
 * self-time by function — then, for the expensive canvas builtins, walks each
 * sample's stack up to the nearest frame in `src/` so the cost lands on the
 * game code responsible rather than on `fill`/`drawImage`.
 *
 * Written because guessing kept losing. Three separate "this allocation is
 * obviously hot" rewrites measured flat or backwards; the first profile said
 * game logic is under 5% of the frame and named the real owners in one run.
 *
 * Two things to keep in mind when reading the output:
 *
 * - `(program)` and the canvas builtins are **software** rasterisation here.
 *   Headless Chromium has no GPU canvas, so anything that paints pixels is
 *   inflated relative to a real phone, and the JS rows are correspondingly
 *   understated. Use it to rank JS work; treat raster rows as an upper bound.
 * - p5 ships minified on one line, so a row keyed by line number would collapse
 *   the whole library into a single entry. Rows are keyed by column and the
 *   source around that column is printed underneath to name the function.
 *
 * Usage: node tests/e2e/profile-cpu.mjs   (LOL2D_CPU_THROTTLE, LOL2D_PROFILE_SECONDS)
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const PORT = process.env.LOL2D_PORT ?? String(5_800 + Math.floor(Math.random() * 200));
const URL = `http://localhost:${PORT}/?touch=1&zoom=0.6`;
const CPU_THROTTLE = Number(process.env.LOL2D_CPU_THROTTLE ?? 4);
const SECONDS = Number(process.env.LOL2D_PROFILE_SECONDS ?? 10);

const server = spawn('npx', ['vite', '--port', PORT, '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => (serverLog += d));
server.stderr.on('data', d => (serverLog += d));
process.on('exit', () => server.kill('SIGTERM'));

{
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(new global.URL('src/game/Game.ts', URL));
      if (r.ok && !(await r.text()).includes('<!DOCTYPE html>')) { ready = true; break; }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!ready) { server.kill('SIGTERM'); throw new Error(`vite did not start\n${serverLog}`); }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

await page.goto(URL, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.director, null, {
  timeout: 30_000,
});

const setup = await page.evaluate(async () => {
  const game = window.__lol2d.scene.oScene.game;
  const { AI_COUNT_MAX, DEFAULT_CHAMPION_LOADOUT } = await import('/src/game/config/PregameConfig.ts');
  while (game.director.bots().length < AI_COUNT_MAX) {
    if (!game.director.addBot(DEFAULT_CHAMPION_LOADOUT)) break;
  }
  game.paused = false;
  game.director.revealMap = true;
  game.camera.target = null;
  game.camera.position.set(game.mapSize / 2, game.mapSize / 2);
  game.camera.scale = 0.3;
  game.camera.currentScale = 0.3;

  const champions = game.director.roster().map(e => e.unit);
  champions.forEach((unit, index) => {
    const angle = (index / champions.length) * Math.PI * 2;
    unit.position.set(
      game.mapSize / 2 + Math.cos(angle) * (index === 0 ? 0 : 340),
      game.mapSize / 2 + Math.sin(angle) * (index === 0 ? 0 : 340)
    );
    unit.destination.set(unit.position.x, unit.position.y);
    unit.alwaysVisible = true;
    // Everything but the player fights, so spells, buffs and VFX are all live.
    unit._autoMove = index > 0;
    unit._autoAttack = index > 0;
    unit._autoCast = index > 0;
  });
  return { champions: champions.length, objects: game.objectManager.objects.length };
});

await page.waitForTimeout(2_000);

await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 100 }); // microseconds
await client.send('Profiler.start');
await page.waitForTimeout(SECONDS * 1_000);
const { profile } = await client.send('Profiler.stop');

const frames = await page.evaluate(() => {
  const g = window.__lol2d.scene.oScene.game;
  return { objects: g.objectManager.objects.length };
});

await browser.close();
server.kill('SIGTERM');

// ---- aggregate self time -------------------------------------------------
// p5.min.js is one line, so `line` alone collapses the whole library into a
// single row. Key on the column too and recover the identity from the source.
const p5min = readFileSync(new global.URL('../../public/vendor/p5.min.js', import.meta.url), 'utf8');
const identify = col => {
  const head = p5min.slice(Math.max(0, col - 90), col + 40).replace(/\s+/g, ' ');
  return head.slice(-110);
};

const selfTicks = new Map();
const meta = new Map();
let totalTicks = 0;
for (const node of profile.nodes) {
  const hits = node.hitCount ?? 0;
  if (!hits) continue;
  totalTicks += hits;
  const cf = node.callFrame;
  const file = (cf.url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const isP5 = file.endsWith('p5.min.js');
  const key = isP5
    ? `p5 @${cf.columnNumber}`
    : `${cf.functionName || '(anonymous)'}  ${file}:${cf.lineNumber + 1}`;
  selfTicks.set(key, (selfTicks.get(key) ?? 0) + hits);
  if (isP5 && !meta.has(key)) meta.set(key, identify(cf.columnNumber));
}
const totalMs = (profile.endTime - profile.startTime) / 1000;
const msPerTick = totalMs / Math.max(1, totalTicks);

const rows = [...selfTicks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32);
console.log(`\nscenario: ${setup.champions} champions, ${frames.objects} live objects, CPU throttle ${CPU_THROTTLE}x`);
console.log(`profile: ${totalMs.toFixed(0)}ms wall, ${totalTicks} samples\n`);
console.log('  self%    self ms   function');
console.log('  ' + '-'.repeat(86));
for (const [key, ticks] of rows) {
  const pct = ((ticks / totalTicks) * 100).toFixed(1).padStart(5);
  const ms = (ticks * msPerTick).toFixed(0).padStart(7);
  console.log(`  ${pct}%  ${ms}ms   ${key}`);
  if (meta.has(key)) console.log(`                     ...${meta.get(key)}`);
}
console.log('');

// ---- who calls the expensive native drawing? ----------------------------
// `(program)` and the canvas builtins are leaves, so self-time alone never
// says which game code is responsible. Walk up each hot leaf to the nearest
// frame in /src/ and aggregate the blame there.
const nodeById = new Map(profile.nodes.map(n => [n.id, n]));
const parentOf = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);

const nearestGameFrame = id => {
  let cur = id;
  for (let hop = 0; hop < 60; hop++) {
    const n = nodeById.get(cur);
    if (!n) break;
    const url = n.callFrame.url || '';
    if (url.includes('/src/')) {
      const file = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      return `${n.callFrame.functionName || '(anonymous)'}  ${file}:${n.callFrame.lineNumber + 1}`;
    }
    const p = parentOf.get(cur);
    if (p === undefined) break;
    cur = p;
  }
  return '(no game frame on stack)';
};

for (const target of ['drawImage', 'fill', 'stroke', 'save', 'fillText', 'clip']) {
  const blame = new Map();
  let total = 0;
  for (const n of profile.nodes) {
    if (n.callFrame.functionName !== target || (n.callFrame.url || '') !== '') continue;
    const hits = n.hitCount ?? 0;
    if (!hits) continue;
    total += hits;
    const owner = nearestGameFrame(n.id);
    blame.set(owner, (blame.get(owner) ?? 0) + hits);
  }
  if (!total) continue;
  console.log(`\n  native ${target}(): ${(total * msPerTick).toFixed(0)}ms total (${((total / totalTicks) * 100).toFixed(1)}%) — charged to:`);
  for (const [owner, hits] of [...blame.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`      ${((hits / total) * 100).toFixed(0).padStart(3)}%  ${(hits * msPerTick).toFixed(0).padStart(5)}ms  ${owner}`);
  }
}
console.log('');
