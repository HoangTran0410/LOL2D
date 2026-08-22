/**
 * Verifies the touch-aiming fix for fix/touch-aiming: the targeting-mode audit
 * (Zed W and 66 other spells were silently inheriting `DIRECTION`, the one
 * mode that discards a drag's distance) and the existing aim telegraph in
 * `TouchControls.ts` (reticle, line to the champion, UNIT target highlight).
 *
 * Drives the real game with real touch events through CDP, at a phone
 * viewport, the same way tests/e2e/drive-touch-controls.mjs does.
 *
 *   node tests/e2e/verify-touch-aiming.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { PHONE_VIEWPORT, startHarness } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/lol2d-touch-aiming';

const { url, page, errors, report, check, touchStart, touchMove, touchEnd, guard } =
  await startHarness({
    out: OUT,
    viewport: PHONE_VIEWPORT,
    hasTouch: true,
    deviceScaleFactor: 3,
    touch: true,
  });

const settle = (ms = 120) => page.waitForTimeout(ms);

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.touchControls, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // ------------------------------------------------------------------ setup

  report.setup = await page.evaluate(async () => {
    // Every pack spell's default export is a factory now (batch 4 task 3),
    // resolved against the cached ContentApi singleton spellRegistry.ts
    // itself builds against.
    const { buildContentApi } = await import('/src/content/ContentApi.ts');
    const api = buildContentApi();
    const AllSpells = await import('/packs/riot/spells/index.ts');
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const mapSize = game.mapSize;
    const walls = game.terrainMap.obstacles.filter(o => o.type === 'wall');

    let open = null;
    for (let x = 1200; x <= mapSize - 1200 && !open; x += 400) {
      for (let y = 1200; y <= mapSize - 1200; y += 400) {
        const blocked = walls.some(wall => {
          const box = wall.getBoundingBox();
          return Math.hypot(box.x + box.w / 2 - x, box.y + box.h / 2 - y) < 900;
        });
        if (!blocked) {
          open = { x, y };
          break;
        }
      }
    }
    if (!open) open = { x: mapSize / 2, y: mapSize / 2 };

    for (const object of game.objectManager.objects) {
      if (object === player) continue;
      if (object.constructor.name === 'Minion') object.toRemove = true;
    }
    game.minionSpawner.update = () => {};
    for (const turret of game.turrets) turret.damage = 0;

    const bots = game.objectManager.objects.filter(o => o.constructor.name === 'AIChampion');
    for (const bot of bots) {
      bot._autoAttack = false;
      bot._autoCast = false;
      bot._autoMove = false;
      bot.stats.speed.baseValue = 0;
      bot.position.set(400, 400);
      bot.destination.set(400, 400);
      for (const buff of [...bot.buffs]) buff.deactivateBuff();
      bot.updateBuffs();
    }

    for (const buff of [...player.buffs]) buff.deactivateBuff();
    player.updateBuffs();
    player.stats.maxHealth.baseValue = 1e6;
    player.stats.health.baseValue = 1e6;
    player.stats.maxMana.baseValue = 1e6;
    player.stats.mana.baseValue = 1e6;
    player.teleportTo(open.x, open.y);
    player.basicAttack.clear();

    // Q = Zed_W (POINT, the headline bug), W = Malphite_Q (UNIT), E = Ahri_Q
    // (DIRECTION, unaffected — flies its own length no matter the drag).
    player.replaceSpell(1, new (AllSpells.Zed_W(api))(player));
    player.replaceSpell(2, new (AllSpells.Malphite_Q(api))(player));
    player.replaceSpell(3, new (AllSpells.Ahri_Q(api))(player));
    player.spells[1].manaCost = 0;
    player.spells[2].manaCost = 0;
    player.spells[3].manaCost = 0;

    // Two dummies due south, spread east/west, so a UNIT drag has two real
    // bodies to choose between — visible, stationary, and inside Malphite Q's
    // 500-range.
    const [left, right] = bots;
    left.position.set(open.x - 150, open.y + 350);
    left.destination.set(left.position.x, left.position.y);
    left.stats.maxHealth.baseValue = 1e6;
    left.stats.health.baseValue = 1e6;
    left.deathData = null;
    left.teamId = 'dummy-team';

    right.position.set(open.x + 150, open.y + 350);
    right.destination.set(right.position.x, right.position.y);
    right.stats.maxHealth.baseValue = 1e6;
    right.stats.health.baseValue = 1e6;
    right.deathData = null;
    right.teamId = 'dummy-team-2';

    game.camera.target = player.position;
    game.camera.position.set(player.position.x, player.position.y);
    // Zoomed all the way out (0.5 is the minimum): the reticle, the line back
    // to the champion, the dummies and the HUD all need to be legible in one
    // screenshot without overlapping.
    game.camera.scale = 0.5;
    game.camera.currentScale = 0.5;

    window.__spawned = [];
    const addObject = game.objectManager.addObject.bind(game.objectManager);
    game.objectManager.addObject = object => {
      if (object?.owner === player) {
        window.__spawned.push({
          kind: object.constructor.name,
          at: performance.now(),
          from: object.position ? { x: object.position.x, y: object.position.y } : null,
          to: object.destination ? { x: object.destination.x, y: object.destination.y } : null,
        });
      }
      return addObject(object);
    };

    return {
      open,
      left: { x: left.position.x, y: left.position.y },
      right: { x: right.position.x, y: right.position.y },
      zedRange: player.spells[1].range,
      malphiteRange: player.spells[2].range,
    };
  });
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const l = window.__lol2d.scene.oScene.game.touchControls.currentLayout;
    return {
      dragToRange: l.dragToRange,
      buttons: l.buttons.map(b => ({ slot: b.slot, x: b.x, y: b.y })),
    };
  });
  const slotQ = layout.buttons.find(b => b.slot === 1); // Zed_W
  const slotW = layout.buttons.find(b => b.slot === 2); // Malphite_Q
  const slotE = layout.buttons.find(b => b.slot === 3); // Ahri_Q

  const resetSlot = slot =>
    page.evaluate(s => {
      const game = window.__lol2d.scene.oScene.game;
      const spell = game.player.spells[s];
      spell.currentCooldown = 0;
      spell.state = 'READY';
      spell.zedWClone = null;
      game.player.stats.mana.baseValue = 1e6;
      window.__spawned.length = 0;
    }, slot);

  // -------------------------------------------------------- 1. Zed W: short drag

  await resetSlot(1);
  // Has to clear TAP_SLOP (18px) or the gesture reads as a tap, not a drag —
  // resolveSpellAim then falls back to the auto-target/facing point instead
  // of the manual aim this test means to exercise. dragToRange itself is only
  // ~46px on this viewport (0.7 * joystick radius), so "short" here means
  // "clearly short of the 350 cap", not "barely past the slop".
  const shortDrag = Math.max(24, Math.round(layout.dragToRange * 0.5));
  await touchStart([{ x: slotQ.x, y: slotQ.y }]);
  await settle(90);
  await touchMove([{ x: slotQ.x, y: slotQ.y - shortDrag }]); // due north, short
  await settle(160);
  report.zedShortAim = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const gesture = game.touchControls.gestureFor(1);
    const player = game.player;
    return gesture?.aim
      ? {
          distance: Math.hypot(
            gesture.aim.cursorWorld.x - player.position.x,
            gesture.aim.cursorWorld.y - player.position.y
          ),
          cursorWorld: gesture.aim.cursorWorld,
        }
      : null;
  });
  await page.screenshot({ path: `${OUT}-01-zedw-short-drag-reticle.png` });
  await touchEnd();
  await settle(250);
  report.zedShortCast = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const clone = game.player.spells[1].zedWClone;
    return clone
      ? // The clone dashes to `destination` over several frames; reading its
        // live `position` right after touchEnd races that animation.
        // `destination` is set synchronously inside onSpellCast and is the
        // actual number the targeting-mode fix produced.
        {
          distance: Math.hypot(
            clone.destination.x - player.position.x,
            clone.destination.y - player.position.y
          ),
        }
      : null;
  });

  check(
    'a short drag telegraphs a distance well short of the 350 range',
    report.zedShortAim !== null && report.zedShortAim.distance < 260,
    report.zedShortAim ? `telegraphed ${Math.round(report.zedShortAim.distance)} units` : 'no aim'
  );
  check(
    'Zed W actually lands close to where the short drag pointed, not at max range',
    report.zedShortCast !== null && report.zedShortCast.distance < 260,
    report.zedShortCast
      ? `landed ${Math.round(report.zedShortCast.distance)} units out (range is 350)`
      : 'no clone spawned'
  );

  // ---------------------------------------------------- 2. Zed W: long drag

  await resetSlot(1);
  const longDrag = layout.dragToRange * 2; // past full range, should clamp at 350
  await touchStart([{ x: slotQ.x, y: slotQ.y }]);
  await settle(90);
  await touchMove([{ x: slotQ.x, y: slotQ.y - longDrag }]);
  await settle(160);
  report.zedLongAim = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const gesture = game.touchControls.gestureFor(1);
    const player = game.player;
    return gesture?.aim
      ? {
          phase: gesture.phase,
          moved: gesture.moved,
          distance: Math.hypot(
            gesture.aim.cursorWorld.x - player.position.x,
            gesture.aim.cursorWorld.y - player.position.y
          ),
        }
      : null;
  });
  await page.screenshot({ path: `${OUT}-02-zedw-long-drag-reticle.png` });
  await touchEnd();
  await settle(250);
  report.zedLongCast = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const clone = game.player.spells[1].zedWClone;
    return clone
      ? // The clone dashes to `destination` over several frames; reading its
        // live `position` right after touchEnd races that animation.
        // `destination` is set synchronously inside onSpellCast and is the
        // actual number the targeting-mode fix produced.
        {
          distance: Math.hypot(
            clone.destination.x - player.position.x,
            clone.destination.y - player.position.y
          ),
        }
      : null;
  });
  check(
    'a long drag clamps at the spell\'s real range (350), the old "always max range" case',
    report.zedLongCast !== null &&
      report.zedLongCast.distance > 300 &&
      report.zedLongCast.distance <= 355,
    report.zedLongCast
      ? `landed ${Math.round(report.zedLongCast.distance)} units out`
      : 'no clone spawned'
  );

  // ------------------------------------------------- 3. Malphite Q: UNIT re-target

  // Screen deltas mirror the *exact* world-space direction to each dummy —
  // resolveSpellAim treats the drag's screen vector as the world aim
  // direction (Camera never rotates), so an approximate diagonal would
  // project past UNIT_SNAP_RADIUS (220) of a dummy 380 units away at a
  // slightly different bearing. Length is past dragToRange so reach always
  // saturates at the spell's full 500 range, putting the probe safely past
  // the dummy along the same ray rather than short of it.
  const towards = (from, to, length) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const mag = Math.hypot(dx, dy) || 1;
    return { x: (dx / mag) * length, y: (dy / mag) * length };
  };
  const dragLength = Math.max(60, layout.dragToRange * 1.5);

  await resetSlot(2);
  await touchStart([{ x: slotW.x, y: slotW.y }]);
  await settle(90);
  // Drag toward the left dummy first.
  const toLeft = towards(report.setup.open, report.setup.left, dragLength);
  await touchMove([{ x: slotW.x + toLeft.x, y: slotW.y + toLeft.y }]);
  await settle(160);
  report.unitAimLeft = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const gesture = game.touchControls.gestureFor(2);
    const left = game.objectManager.objects.find(o => o.teamId === 'dummy-team');
    return { targetIsLeft: gesture?.aim?.target === left };
  });
  await page.screenshot({ path: `${OUT}-03-unit-highlight-left.png` });

  // Drag toward the right dummy instead, without lifting — re-targeting.
  const toRight = towards(report.setup.open, report.setup.right, dragLength);
  await touchMove([{ x: slotW.x + toRight.x, y: slotW.y + toRight.y }]);
  await settle(160);
  report.unitAimRight = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const gesture = game.touchControls.gestureFor(2);
    const right = game.objectManager.objects.find(o => o.teamId === 'dummy-team-2');
    return { targetIsRight: gesture?.aim?.target === right };
  });
  await page.screenshot({ path: `${OUT}-04-unit-highlight-right.png` });
  await touchEnd();
  // Wait for the object rather than sleeping at it. Malphite Q has a cast time,
  // so a fixed pause here is a race against it — and it is one this assertion
  // lost about one run in three, reporting `spawned: 0` for a cast that was
  // merely still in flight. Polling for the observable turns a coin flip into
  // either a pass or a real, legible timeout.
  await page
    .waitForFunction(() => window.__spawned.length >= 1, { timeout: 3_000 })
    .catch(() => {});

  report.unitCast = await page.evaluate(() => {
    const context = window.__lol2d.scene.oScene.game.player.spells[2].castContext;
    const right = window.__lol2d.scene.oScene.game.objectManager.objects.find(
      o => o.teamId === 'dummy-team-2'
    );
    return { targetWasRight: context?.target === right, spawned: window.__spawned.length };
  });

  check(
    'dragging toward the left dummy highlights it as the UNIT target',
    report.unitAimLeft.targetIsLeft,
    JSON.stringify(report.unitAimLeft)
  );
  check(
    'moving the drag re-targets to the right dummy without lifting the thumb',
    report.unitAimRight.targetIsRight,
    JSON.stringify(report.unitAimRight)
  );
  check(
    'releasing casts on the body that was highlighted (right), not the first one aimed at',
    report.unitCast.targetWasRight && report.unitCast.spawned === 1,
    JSON.stringify(report.unitCast)
  );

  // ------------------------------------------------ 4. Ahri Q: DIRECTION unaffected

  await resetSlot(3);
  const tinyDrag = Math.round(layout.dragToRange * 0.05); // barely a flick
  await touchStart([{ x: slotE.x, y: slotE.y }]);
  await settle(90);
  await touchMove([{ x: slotE.x - tinyDrag, y: slotE.y }]);
  await settle(160);
  report.directionAimDebug = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const gesture = game.touchControls.gestureFor(3);
    const spell = game.player.spells[3];
    return {
      gesturePhase: gesture?.phase,
      moved: gesture?.moved,
      cursorWorld: gesture?.aim
        ? { x: gesture.aim.cursorWorld.x, y: gesture.aim.cursorWorld.y }
        : null,
      manual: gesture?.aim?.manual ?? null,
      spellState: spell.state,
      cooldown: spell.currentCooldown,
      mana: game.player.stats.mana.value,
      manaCost: spell.effectiveManaCost,
      castable: spell.checkCastCondition?.(),
    };
  });
  await page.screenshot({ path: `${OUT}-05-direction-tiny-drag-reticle.png` });
  await touchEnd();
  await settle(250);
  report.directionPostEnd = await page.evaluate(() => {
    const spell = window.__lol2d.scene.oScene.game.player.spells[3];
    return {
      state: spell.state,
      cooldown: spell.currentCooldown,
      spawnedCount: window.__spawned.length,
      spawnedKinds: window.__spawned.map(s => s.kind),
    };
  });
  report.directionCast = await page.evaluate(() => {
    // Filtered by kind, not index 0: a homing missile from the earlier UNIT
    // test can still land and spawn its own impact effects (also owned by the
    // player) in the gap between resetSlot's clear and this read.
    const spawned = window.__spawned.find(s => s.kind === 'Ahri_Q_Object');
    if (!spawned?.to || !spawned?.from) return null;
    return {
      length: Math.hypot(spawned.to.x - spawned.from.x, spawned.to.y - spawned.from.y),
    };
  });
  check(
    'a DIRECTION skillshot still flies its own full length even off a tiny drag',
    report.directionCast !== null && report.directionCast.length > 340,
    report.directionCast
      ? `flew ${Math.round(report.directionCast.length)} units (Ahri Q is 350)`
      : 'nothing spawned'
  );

  // --------------------------------------------------- 5. telegraph draw cost

  report.drawCost = await page.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const summarise = values => {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      const round = n => Math.round(n * 1000) / 1000;
      return {
        n: sorted.length,
        mean: round(sorted.reduce((t, v) => t + v, 0) / sorted.length),
        p95: round(at(0.95)),
      };
    };
    const original = game.touchControls.draw.bind(game.touchControls);
    const idle = [];
    game.touchControls.draw = (...args) => {
      const start = performance.now();
      original(...args);
      idle.push(performance.now() - start);
    };
    await new Promise(resolve => setTimeout(resolve, 1500));
    const idleResult = summarise(idle);

    // Simulate a held gesture with an active telegraph, without going through
    // CDP touch events: directly install a gesture the way syncPointers would.
    const layout = game.touchControls.currentLayout;
    const button = layout.buttons.find(b => b.slot === 1);
    game.touchControls.syncPointers([{ id: 999, x: button.x, y: button.y - 40 }]);
    await new Promise(resolve => setTimeout(resolve, 50));
    game.touchControls.syncPointers([{ id: 999, x: button.x, y: button.y - 40 }]);

    const held = [];
    game.touchControls.draw = (...args) => {
      const start = performance.now();
      original(...args);
      held.push(performance.now() - start);
    };
    await new Promise(resolve => setTimeout(resolve, 1500));
    const heldResult = summarise(held);

    game.touchControls.syncPointers([]);
    game.touchControls.draw = original;

    return { idle: idleResult, held: heldResult };
  });
  const idleP95 = report.drawCost.idle?.p95 ?? 0;
  const heldP95 = report.drawCost.held?.p95 ?? 0;
  report.telegraphAddedP95Ms = Math.round((heldP95 - idleP95) * 1000) / 1000;
  console.log(
    `\ntouchControls.draw() p95: idle ${idleP95}ms, thumb-down-with-telegraph ${heldP95}ms, ` +
      `telegraph adds ~${report.telegraphAddedP95Ms}ms/frame`
  );
});
