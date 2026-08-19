/**
 * Visual proof, on the real game, that the three symptoms from the owner's
 * bug report are gone:
 *
 *   (a) walking right up to a wall
 *   (b) a click into a wall resolving sanely, not walking straight at it
 *   (c) walking through a narrow gap between two walls without freezing
 *
 * Turns the nav debug overlay on with a real keypress (`N`, the same key a
 * player would use), not by poking the flag directly, so the screenshot also
 * proves the binding works. Requires a system Chrome install.
 *
 *   node tests/e2e/verify-nav-fix.mjs /tmp/lol2d-nav
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-nav';

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(url, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.navigation, null, {
  timeout: 30_000,
});
await page.waitForTimeout(1_000);

// Clear the battlefield and make the player immortal, so a bot or a minion
// wave cannot end the demo before the navigation run this script is watching.
await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const hostile = new Set(['AIChampion', 'Minion']);
  for (const object of game.objectManager.objects) {
    if (object !== game.player && hostile.has(object.constructor.name)) object.toRemove = true;
  }
  game.minionSpawner.update = () => {};
  game.player.stats.maxHealth.baseValue = 1e6;
  game.player.stats.health.baseValue = 1e6;
  game.player.stats.speed.baseValue = 3.6;
});
await page.waitForTimeout(300);

// The real key a player presses -- proves the binding, not just the flag.
await page.click('canvas');
await page.keyboard.press('n');
const debugOn = await page.evaluate(() => window.__lol2d.scene.oScene.game.navigation.debugRoutes);
if (!debugOn) throw new Error('N did not toggle navigation.debugRoutes on');

const results = {};

// ---------------------------------------------------------- (a) hug a wall
results.hugWall = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const navigation = game.navigation;
  const grid = navigation.grid;
  const player = game.player;
  const radius = player.bodyRadius;

  // A point right at the edge of what navigation allows -- the closest a
  // body can legitimately be routed, per the new margin.
  const required = grid.requiredClearance(radius);
  let target = null;
  for (let attempt = 0; attempt < 20_000 && !target; attempt++) {
    const cx = Math.floor(Math.random() * grid.cols);
    const cy = Math.floor(Math.random() * grid.rows);
    const clearance = grid.clearance[cy * grid.cols + cx];
    if (clearance < required || clearance > required + 6) continue; // hugging the wall
    const x = grid.centreX(cx);
    const y = grid.centreY(cy);
    target = { x, y, clearance };
  }
  if (!target) return { found: false };

  const start = navigation.nearestWalkable(target.x + 400, target.y, radius, 500) ?? target;
  player.teleportTo(start.x, start.y);
  game.camera.target = window.createVector(target.x, target.y);
  game.camera.scale = 1.4;
  game.camera.currentScale = 1.4;
  player.orderMove(target.x, target.y, true);
  return { found: true, target, start };
});

if (results.hugWall.found) {
  await page.waitForTimeout(3_500);
  results.hugWall.final = await page.evaluate(() => {
    const player = window.__lol2d.scene.oScene.game.player;
    return {
      position: { x: player.position.x, y: player.position.y },
      state: player.pathAgent?.state,
    };
  });
  await page.screenshot({ path: `${OUT}-a-hug-wall.png` });
}

// --------------------------------------------------- (b) click into a wall
results.clickWall = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const navigation = game.navigation;
  const grid = navigation.grid;
  const player = game.player;
  const radius = player.bodyRadius;

  // The dead centre of a real wall polygon: as deep inside as a click gets.
  let wallCentre = null;
  for (let attempt = 0; attempt < 5_000 && !wallCentre; attempt++) {
    const cx = Math.floor(Math.random() * grid.cols);
    const cy = Math.floor(Math.random() * grid.rows);
    // `> 0` skips open ground. It used to read `!== 0`, which was the same
    // thing while every wall cell held 0 — the field is signed now, so wall
    // interiors are negative and `!== 0` excluded all 57,163 of them, leaving
    // this search picking from the ~455 cells that happen to land on exactly 0.
    if (grid.clearance[cy * grid.cols + cx] > 0) continue;
    // require a walkable spot within reach, so this is a real order, not one
    // that fails to find footing on either end
    const x = grid.centreX(cx);
    const y = grid.centreY(cy);
    const near = navigation.nearestWalkable(x, y, radius, 300);
    if (!near || Math.hypot(near.x - x, near.y - y) < 60) continue; // want it AWAY from open ground
    wallCentre = { x, y, near };
  }
  if (!wallCentre) return { found: false };

  const start =
    navigation.nearestWalkable(
      wallCentre.near.x + (wallCentre.near.x - wallCentre.x),
      wallCentre.near.y + (wallCentre.near.y - wallCentre.y),
      radius,
      500
    ) ?? wallCentre.near;
  player.teleportTo(start.x, start.y);
  game.camera.target = window.createVector(wallCentre.x, wallCentre.y);
  game.camera.scale = 1.1;
  game.camera.currentScale = 1.1;

  window.__navFramesInsideWall = 0;
  const timer = setInterval(() => {
    if (grid.clearanceAt(player.position.x, player.position.y) === 0) {
      window.__navFramesInsideWall++;
    }
  }, 16);
  window.__navClickTimer = timer;

  player.orderMove(wallCentre.x, wallCentre.y, true); // the click: dead centre of the wall
  return { found: true, wallCentre, start };
});

if (results.clickWall.found) {
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: `${OUT}-b-click-wall.png` });
  await page.waitForTimeout(2_500);
  results.clickWall.final = await page.evaluate(() => {
    clearInterval(window.__navClickTimer);
    const player = window.__lol2d.scene.oScene.game.player;
    return {
      position: { x: player.position.x, y: player.position.y },
      state: player.pathAgent?.state,
      framesInsideWall: window.__navFramesInsideWall,
    };
  });
}

// -------------------------------------------------- (c) a narrow gap
results.narrowGap = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const navigation = game.navigation;
  const grid = navigation.grid;
  const player = game.player;
  const radius = player.bodyRadius;
  const required = grid.requiredClearance(radius);

  let found = null;
  for (let attempt = 0; attempt < 60_000 && !found; attempt++) {
    const cx = Math.floor(Math.random() * grid.cols);
    const cy = Math.floor(Math.random() * grid.rows);
    const clearance = grid.clearance[cy * grid.cols + cx];
    // just barely wide enough: a genuine squeeze, not open ground
    if (clearance < required || clearance > required + 14) continue;
    const x = grid.centreX(cx);
    const y = grid.centreY(cy);

    for (const angle of [0, Math.PI / 2, Math.PI / 4, (Math.PI * 3) / 4]) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const a = navigation.nearestWalkable(x - dx * 260, y - dy * 260, radius, 40);
      const b = navigation.nearestWalkable(x + dx * 260, y + dy * 260, radius, 40);
      if (!a || !b) continue;
      if (!navigation.isLineClear(a.x, a.y, x, y, radius)) continue;
      if (!navigation.isLineClear(x, y, b.x, b.y, radius)) continue;
      found = { from: a, to: b, mid: { x, y }, clearance };
      break;
    }
  }
  if (!found) return { found: false };

  player.teleportTo(found.from.x, found.from.y);
  game.camera.target = window.createVector(found.mid.x, found.mid.y);
  game.camera.scale = 1.2;
  game.camera.currentScale = 1.2;

  window.__navGapStates = [];
  window.__navGapTimer = setInterval(() => {
    window.__navGapStates.push(player.pathAgent ? player.pathAgent.state : 'NONE');
  }, 50);

  player.orderMove(found.to.x, found.to.y, true);
  return { found: true, ...found };
});

if (results.narrowGap.found) {
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: `${OUT}-c-narrow-gap.png` });
  const deadline = Date.now() + 15_000;
  let arrived = false;
  while (Date.now() < deadline && !arrived) {
    await page.waitForTimeout(400);
    arrived = await page.evaluate(
      ({ tx, ty }) => {
        const player = window.__lol2d.scene.oScene.game.player;
        return Math.hypot(player.position.x - tx, player.position.y - ty) < 40;
      },
      { tx: results.narrowGap.to.x, ty: results.narrowGap.to.y }
    );
  }
  results.narrowGap.final = await page.evaluate(() => {
    clearInterval(window.__navGapTimer);
    const player = window.__lol2d.scene.oScene.game.player;
    return {
      position: { x: player.position.x, y: player.position.y },
      state: player.pathAgent?.state,
      states: [...new Set(window.__navGapStates)],
    };
  });
  results.narrowGap.arrived = arrived;
}

console.log(JSON.stringify({ debugOn, results, errors }, null, 2));

await browser.close();
await server.close();
if (errors.length) process.exitCode = 1;
