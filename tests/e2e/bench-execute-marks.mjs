/**
 * What `drawExecuteMarks` costs, per frame, in a full match.
 *
 * It hangs off `Game.draw`, so it is paid every frame whether or not anything
 * is marked — and the expensive half is not the arithmetic but the quadtree
 * query each participating spell runs to find its candidates. Veigar Q is the
 * worst case in the game by a distance: its disc is `range + ORB_SIZE` = 576px
 * where Nasus Q's is 150, and it then runs a `lineCircle` per object the disc
 * returned.
 *
 * Measured against the frame budget rather than in the abstract: 60fps is
 * 16.67ms, and the numbers printed here are microseconds.
 *
 *   node tests/e2e/bench-execute-marks.mjs
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const CFG_KEY = 'lol2d:pregameConfig:v1';

/** A busy match: jungle on, minions on, a full bot roster. */
const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Veigar',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 9, autoMove: true, autoAttack: true, autoCast: true, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
  world: { jungle: true, minions: true },
};

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

await page.addInitScript(
  ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
  [CFG_KEY, MATCH_CONFIG]
);
await page.goto(url, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
  timeout: 30_000,
});
// let the wave clock spawn minions and the bots spread out
await page.waitForTimeout(12_000);

const result = await page.evaluate(async () => {
  const { drawExecuteMarks, executeMarkTargets } = await import(
    '/src/game/combat/ExecuteMarks.ts'
  );
  const { isExecuteSpell } = await import('/src/game/combat/ExecuteTargeting.ts');
  const game = window.__lol2d.scene.oScene.game;
  const player = game.player;

  // Q up and paid for, so the marks path is actually entered rather than
  // short-circuited by `isCastableNow`.
  for (const spell of player.spells) {
    if (spell) spell.currentCooldown = 0;
  }
  player.stats.mana.baseValue = player.stats.maxMana.value;
  game.worldMouse = createVector(player.position.x + 400, player.position.y);

  // Something actually killable on the line. Without it `executeMarks` comes
  // back empty, `drawExecuteMarks` returns before drawing anything, and V8 is
  // free to eliminate the whole call — which is exactly what it did: 0.03µs
  // against 6µs for the same work measured through a value the bench keeps.
  const doomed = game.director.addBot({
    mode: 'champion',
    championName: 'Garen',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  });
  if (doomed) {
    game.director.setBotBehaviour(doomed, { autoMove: false, autoAttack: false, autoCast: false });
    game.objectManager.update();
    doomed.position.set(player.position.x + 200, player.position.y);
    doomed.destination.set(doomed.position.x, doomed.position.y);
    doomed.stats.maxHealth.baseValue = 500;
    doomed.stats.health.baseValue = 4;
    doomed.stats.healthRegen.baseValue = 0;
  }
  // one frame so the quadtree has it where it was put
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const { lethalTargets } = await import('/src/game/combat/ExecuteTargeting.ts');
  const executeSpells = player.spells.filter(s => isExecuteSpell(s));
  const veigarQ = executeSpells[0];
  // `isCastableNow` gates the whole path, and zeroing `currentCooldown` only
  // feeds the runtime on its next update — measuring through the gate without
  // waiting for that measures an early return, which is what the first run of
  // this bench actually did (0.03µs, marked=0).
  const castable = !!veigarQ?.isCastableNow;
  const marked = executeMarkTargets(player);

  const time = (label, fn, runs) => {
    for (let i = 0; i < 200; i++) fn(); // warm the JIT
    const start = performance.now();
    for (let i = 0; i < runs; i++) fn();
    const micros = ((performance.now() - start) / runs) * 1000;
    return { label, micros: Math.round(micros * 100) / 100 };
  };

  const RUNS = 3_000;
  return {
    objects: game.objectManager.objects.length,
    monsters: game.monsters?.length ?? 0,
    executeSpells: executeSpells.map(s => s.constructor.name),
    castable,
    marked: marked.length,
    candidates: veigarQ ? veigarQ.executeCandidates().length : 0,
    // The real per-frame work, measured on the spell directly so the
    // `isCastableNow` gate cannot hide it: the 576px quadtree query plus a
    // `lineCircle` per object it returns, plus the lethality test on each.
    select: time('lethalTargets(Veigar_Q)', () => lethalTargets(veigarQ), RUNS),
    query: time('  its quadtree query alone', () => veigarQ.executeCandidates(), RUNS),
    // The whole thing including the p5 drawing calls, which is what the frame
    // actually pays.
    full: time('drawExecuteMarks', () => drawExecuteMarks(game), RUNS),
    // For scale: one of the queries the engine already runs every frame anyway.
    baseline: time(
      'objectManager camera query',
      () =>
        game.objectManager.queryObjects({
          queryByDisplayBoundingBox: true,
          area: game.camera.getBoundingBox(),
        }),
      RUNS
    ),
  };
});

const FRAME_MS = 1000 / 60;
console.log(`objects=${result.objects} monsters=${result.monsters} marked=${result.marked}`);
console.log(`execute spells in kit: ${result.executeSpells.join(', ') || '(none)'}`);
console.log(`castable=${result.castable} candidates on the line=${result.candidates}`);
for (const row of [result.select, result.query, result.full, result.baseline]) {
  const share = ((row.micros / 1000 / FRAME_MS) * 100).toFixed(2);
  console.log(`  ${row.label.padEnd(28)} ${String(row.micros).padStart(8)} µs   ${share}% of a 60fps frame`);
}
if (errors.length) console.error(`errors: ${errors.slice(0, 3).join(' | ')}`);

await browser.close();
await server.close();
