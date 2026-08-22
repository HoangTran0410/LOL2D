/**
 * Drives the minimap in the real game: expand, teleport, dismiss, and the
 * reveal-the-whole-map cheat.
 *
 *   node tests/e2e/drive-minimap.mjs [outPrefix]
 *
 * The teleport check asserts an **absolute** destination, not a round trip.
 * `worldToMinimap`/`minimapToWorld` wrong by the same factor in both directions
 * round-trip perfectly, and an inverted axis round-trips perfectly too — so the
 * unit test cannot see either. This is the check that can: it taps a fixed
 * screen point and asserts the champion arrives at the one world coordinate
 * that point means. Invert the `y` in `minimapToWorld` and it goes red.
 *
 * A phone viewport with real touch, so the tap goes through the same
 * `Game.syncTouches` ordering the aiming controls share.
 *
 * Requires a system Chrome install.
 */
import { PHONE_VIEWPORT, startHarness } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/lol2d-minimap';

const { url, page, errors, report, check, dispatch, guard } = await startHarness({
  out: OUT,
  viewport: PHONE_VIEWPORT,
  hasTouch: true,
  deviceScaleFactor: 3,
  touch: true,
});

/**
 * Its own hold and settle rather than the harness's `tap`: 90ms down, then 140ms
 * afterwards for the minimap's expand — or the teleport it just ordered — to
 * land before the next `state()` read.
 */
const tap = async point => {
  await dispatch('touchStart', [point]);
  await page.waitForTimeout(90);
  await dispatch('touchEnd', []);
  await page.waitForTimeout(140);
};
const state = () =>
  page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      expanded: game.minimap.expanded,
      rect: { ...game.minimap.rect },
      player: { x: game.player.position.x, y: game.player.position.y },
    };
  });

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.minimap, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // --------------------------------------------------------------- 1. expand

  const collapsed = await state();
  report.collapsedRect = collapsed.rect;
  await tap({
    x: collapsed.rect.x + collapsed.rect.size / 2,
    y: collapsed.rect.y + collapsed.rect.size / 2,
  });
  const expanded = await state();
  report.expandedRect = expanded.rect;
  await page.screenshot({ path: `${OUT}-01-expanded.png` });
  check(
    'a tap on the collapsed minimap expands it',
    expanded.expanded && expanded.rect.size > collapsed.rect.size,
    `${collapsed.rect.size}px -> ${expanded.rect.size}px`
  );

  // ------------------------------------------------------------- 2. teleport

  // A destination in the open, so the assertion can be tight: `teleportTo`
  // does not check terrain (`TerrainMap.update()` pushes a body out of a wall
  // on the next tick), and landing in one would move the champion off the
  // predicted point by the push-out distance rather than by a bug.
  const open = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const walls = game.terrainMap.obstacles.filter(o => o.type === 'wall');
    const margin = 900;
    for (let x = margin; x <= game.mapSize - margin; x += 200) {
      for (let y = margin; y <= game.mapSize - margin; y += 200) {
        // Distance to the wall's box, not to its centre: a long thin wall's
        // centre can be far away while its edge is underfoot.
        const near = walls.some(wall => {
          const box = wall.getBoundingBox();
          const dx = Math.max(box.x - x, 0, x - (box.x + box.w));
          const dy = Math.max(box.y - y, 0, y - (box.y + box.h));
          return Math.hypot(dx, dy) < 300;
        });
        if (!near) return { x, y };
      }
    }
    return { x: game.mapSize / 2, y: game.mapSize / 2 };
  });
  report.openPoint = open;

  // The screen point that world coordinate sits at, and the world coordinate
  // that screen point predicts. Both computed here, by hand, and deliberately
  // *not* by calling `minimap.worldAt` — a transform asked to check itself
  // agrees with itself however wrong it is, which is the exact failure this
  // whole check exists to catch. Rounded, because a touch event is dispatched
  // in whole pixels: assert against what is actually tapped.
  const aim = await page.evaluate(target => {
    const game = window.__lol2d.scene.oScene.game;
    const rect = game.minimap.rect;
    const screen = {
      x: Math.round(rect.x + (target.x / game.mapSize) * rect.size),
      y: Math.round(rect.y + (target.y / game.mapSize) * rect.size),
    };
    const predicted = {
      x: ((screen.x - rect.x) / rect.size) * game.mapSize,
      y: ((screen.y - rect.y) / rect.size) * game.mapSize,
    };
    return { screen, predicted };
  }, open);
  report.teleportAim = aim;

  await tap(aim.screen);
  const landed = await state();
  const drift = Math.hypot(landed.player.x - aim.predicted.x, landed.player.y - aim.predicted.y);
  report.teleport = { predicted: aim.predicted, landed: landed.player, drift };
  await page.screenshot({ path: `${OUT}-02-teleported.png` });

  check(
    'the tap teleported the champion to the world point the transform predicts',
    drift < 40,
    `predicted (${Math.round(aim.predicted.x)}, ${Math.round(aim.predicted.y)}), ` +
      `landed (${Math.round(landed.player.x)}, ${Math.round(landed.player.y)}), ` +
      `${Math.round(drift)} units out`
  );
  check('teleporting collapsed the map again', !landed.expanded, `expanded ${landed.expanded}`);

  // -------------------------------------------------------------- 3. dismiss

  // There has to be a way out that is not a teleport, or opening it by accident
  // forces you to teleport somewhere.
  await tap({
    x: collapsed.rect.x + collapsed.rect.size / 2,
    y: collapsed.rect.y + collapsed.rect.size / 2,
  });
  const reopened = await state();
  await tap({ x: 8, y: PHONE_VIEWPORT.height - 8 });
  const dismissed = await state();
  report.dismiss = { reopened: reopened.expanded, expanded: dismissed.expanded };
  check(
    'a tap outside the expanded map dismisses it without teleporting',
    reopened.expanded &&
      !dismissed.expanded &&
      Math.hypot(dismissed.player.x - landed.player.x, dismissed.player.y - landed.player.y) < 400,
    JSON.stringify(report.dismiss)
  );

  // ---------------------------------------------------------- 4. reveal cheat

  // A unit the fog is hiding right now, then the same unit with the cheat on.
  report.reveal = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const drawn = () =>
      new Set(game.minimapBlips().map(b => `${Math.round(b.x)},${Math.round(b.y)}`));
    // Alive only: a dead unit is not drawn with the cheat on either, and the
    // cheat is about vision, not about death.
    const hidden = game.objectManager.objects.filter(
      o => o !== game.player && o.visibleToPlayerTeam === false && !o.isDead && o.position
    );
    const before = drawn();
    const missing = hidden.filter(
      o => !before.has(`${Math.round(o.position.x)},${Math.round(o.position.y)}`)
    );
    game.director.revealMap = true;
    const after = drawn();
    const nowDrawn = missing.filter(o =>
      after.has(`${Math.round(o.position.x)},${Math.round(o.position.y)}`)
    );
    game.director.revealMap = false;
    const restored = drawn();
    return {
      hiddenCount: missing.length,
      revealedCount: nowDrawn.length,
      blipsBefore: before.size,
      blipsRevealed: after.size,
      blipsRestored: restored.size,
    };
  });
  check(
    'the reveal cheat draws units the fog is hiding',
    report.reveal.hiddenCount > 0 &&
      report.reveal.revealedCount === report.reveal.hiddenCount &&
      report.reveal.blipsRevealed > report.reveal.blipsBefore,
    JSON.stringify(report.reveal)
  );
  check(
    'turning it off hides them again',
    report.reveal.blipsRestored === report.reveal.blipsBefore,
    `${report.reveal.blipsRevealed} revealed -> ${report.reveal.blipsRestored} restored`
  );

  // The panel holds the match paused, so nothing in the update loop runs while
  // the tab is open. `revealMap` is a plain flag for exactly that reason: it is
  // true the instant the checkbox is ticked, with no tick in between.
  report.pausedToggle = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    game.pause();
    game.director.revealMap = true;
    const whilePaused = game.minimapBlips().length;
    game.director.revealMap = false;
    const off = game.minimapBlips().length;
    game.unpause();
    return { whilePaused, off, paused: false };
  });
  check(
    'the cheat answers immediately under the pause the practice panel holds',
    report.pausedToggle.whilePaused > report.pausedToggle.off,
    JSON.stringify(report.pausedToggle)
  );
});
