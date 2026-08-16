/**
 * Repro rig for "the champion freezes when a move-speed buff expires".
 *
 * Reported: hold right mouse button to walk after the cursor, cast something
 * that grants haste or applies a slow, and the moment the buff runs out the
 * champion stops dead and stops following the held cursor.
 *
 * Nothing in Vitest can see this. The bug needs the real input path
 * (`mouseIsPressed` + `mouseButton === RIGHT` in `Game.update`), the real
 * camera (which is what makes the held cursor's *world* position move while
 * the champion walks), and a real `deltaTime` clock for the buff to expire on.
 *
 *   node tests/e2e/drive-hold-move-buff.mjs
 *
 * It prints a distance-travelled sample per phase, so the failure is a number
 * rather than a screenshot: the phase after the buff expires should cover
 * roughly the same ground as the phase before it.
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const CFG_KEY = 'lol2d:pregameConfig:v1';
const VIEWPORT = { width: 1280, height: 900 };

const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Ashe',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
};

// `hmr: false`: this repo is worked on by several agents in one tree, and a
// stray save anywhere in `src/` makes Vite reload the page mid-run, which wipes
// `window.__lol2d` and takes the whole script down with a bare "cannot read
// properties of undefined". The rig has no use for hot reload — it loads the
// page once and drives it.
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));

const failures = [];
const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.addInitScript(
  ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
  [CFG_KEY, MATCH_CONFIG]
);
await page.goto(url, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
  timeout: 30_000,
});
await page.waitForTimeout(1_500);

// Empty arena: nothing to bump into, nothing to chase, so every pixel of
// movement in the sample is the held right click and nothing else.
await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const player = game.player;
  for (const object of game.objectManager.objects) {
    if (object === player) continue;
    const name = object.constructor?.name ?? '';
    if (name === 'Turret' || name === 'Fountain') continue;
    object.toRemove = true;
  }
  game.objectManager.update();
  player.stats.health.baseValue = player.stats.maxHealth.value;
  // Middle of the map, on open ground: the first attempt started him in the
  // base and he simply walked into the boundary, which parks a pathfinder for
  // an honest reason and has nothing to do with the bug under test.
  const mid = game.mapSize / 2;
  player.teleportTo(mid, mid);
  window.__rig = { game, player };
});

/** Distance the champion covered since the last call, plus its live state. */
const sample = async () =>
  page.evaluate(() => {
    const { game, player } = window.__rig;
    const last = window.__last ?? { x: player.position.x, y: player.position.y };
    const moved = Math.hypot(player.position.x - last.x, player.position.y - last.y);
    window.__last = { x: player.position.x, y: player.position.y };
    return {
      moved: Math.round(moved),
      speed: Number(player.moveSpeed.toFixed(2)),
      agent: player.pathAgent?.state ?? 'none',
      // how far the held cursor currently is, in world units
      toCursor: Math.round(
        Math.hypot(game.worldMouse.x - player.position.x, game.worldMouse.y - player.position.y)
      ),
      buffs: player.buffs.filter(buff => !buff.toRemove).map(buff => buff.constructor.name),
      // whether the agent could just walk straight at the held cursor
      lineClear: game.navigation.isLineClear(
        player.position.x,
        player.position.y,
        game.worldMouse.x,
        game.worldMouse.y,
        player.terrainRadius
      ),
    };
  });

// Park the cursor well off to one side and hold the button down. It is never
// moved again: the whole point is that the *world* point under a stationary
// cursor keeps moving, because the camera rides the champion.
const CURSOR = { x: VIEWPORT.width / 2 + 330, y: VIEWPORT.height / 2 - 40 };
await page.mouse.move(CURSOR.x, CURSOR.y);
await page.mouse.down({ button: 'right' });

await page.waitForTimeout(300);
await sample(); // prime the baseline

/**
 * A bare `Speedup`, applied straight to the champion — no spell, so no
 * `Phasing`, no cast time and nothing else in the picture. Ghost was the first
 * thing tried here and it grants both, which made the trace unreadable.
 */
const applyHaste = (durationMs) =>
  page.evaluate(async ms => {
    const { Speedup } = await import('/src/game/gameObject/buffs/Speedup.ts').then(m => ({
      Speedup: m.default,
    }));
    const { player } = window.__rig;
    const buff = new Speedup(ms, player, player);
    buff.percent = 0.4;
    player.addBuff(buff);
  }, durationMs);

const timeline = [];
const trace = async (label) => {
  const row = await sample();
  timeline.push({ label, ...row });
  console.log(
    `${label.padEnd(16)} moved=${String(row.moved).padStart(3)}px  speed=${row.speed}  ` +
      `agent=${row.agent.padEnd(9)} toCursor=${row.toCursor}px  ` +
      `lineClear=${row.lineClear}  buffs=[${row.buffs.join(',')}]`
  );
  return row;
};

// Baseline: five samples of nothing but a held right click.
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(400);
  await trace(`baseline ${i + 1}`);
}
const before = timeline[timeline.length - 1];

await applyHaste(1_400);
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(400);
  await trace(`hasted ${i + 1}`);
}
const during = timeline[timeline.length - 1];

for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(400);
  await trace(`expired ${i + 1}`);
}
const after = timeline[timeline.length - 1];

await page.mouse.up({ button: 'right' });
await browser.close();
await server.close();

check(
  'walks before the buff',
  before.moved > 40,
  `moved=${before.moved}px agent=${before.agent}`
);
check(
  'walks while hasted',
  during.moved > 40,
  `moved=${during.moved}px speed=${during.speed} agent=${during.agent}`
);
check(
  'still follows the held cursor after the buff expires',
  after.moved > 40,
  `moved=${after.moved}px speed=${after.speed} agent=${after.agent} toCursor=${after.toCursor}px`
);
check('no page errors during the run', errors.length === 0, `${errors.length} error(s)`);
for (const error of errors.slice(0, 6)) console.log(' ', error);

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');
