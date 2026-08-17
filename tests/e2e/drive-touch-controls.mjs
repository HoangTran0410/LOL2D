/**
 * End-to-end drive of the Wild Rift touch controls in the real game.
 *
 * Boots its own Vite dev server on a free port, opens the game in system Chrome
 * at a landscape phone viewport with touch emulation on, and drives it with
 * real touch events through CDP — not synthetic calls into the game object.
 *
 * What it proves, in order:
 *   1. the controls turn on from the query parameter, and the HUD switches with
 *      them;
 *   2. the stick walks the champion, and takes over from a running route;
 *   3. releasing the stick stops the champion dead;
 *   4. a dragged skillshot flies where the drag pointed, not where the finger
 *      landed;
 *   5. a plain PRESS spell does *not* fire when the thumb touches down;
 *   6. a tap casts at an auto-picked target;
 *   7. dragging back onto the button spends no mana and starts no cooldown;
 *   8. a charged spell still charges under a thumb, and releases when it lifts.
 *
 *   node tests/e2e/drive-touch-controls.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-touch';
/** iPhone 14 held sideways, in CSS pixels. */
const VIEWPORT = { width: 844, height: 390 };

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = `${server.resolvedUrls.local[0]}?touch=1`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: VIEWPORT,
  hasTouch: true,
  // A retina phone. Also what makes the fog-buffer reading below meaningful.
  deviceScaleFactor: 3,
});
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const cdp = await page.context().newCDPSession(page);
const report = {};
const failures = [];

const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/**
 * Real touch events down the browser's own input pipeline.
 *
 * CDP requires touchEnd to carry no points, so a gesture here lifts every
 * finger at once. That is enough: the game reconciles against the whole list
 * on every event, so a partial lift and a full one take the same code path.
 */
const dispatch = (type, points) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point, index) => ({
      x: Math.round(point.x),
      y: Math.round(point.y),
      id: point.id ?? index,
      radiusX: 14,
      radiusY: 14,
      force: 1,
    })),
  });
const touchStart = points => dispatch('touchStart', points);
const touchMove = points => dispatch('touchMove', points);
const touchEnd = () => dispatch('touchEnd', []);
const settle = (ms = 120) => page.waitForTimeout(ms);

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.touchControls, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // ------------------------------------------------------------------ 1. on

  report.mode = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      enabled: game.touchControls.enabled,
      bodyClass: document.body.classList.contains('touch-ui'),
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
  check('query parameter turns the controls on', report.mode.enabled === true);
  check('HUD switches to the touch layout with them', report.mode.bodyClass === true);

  report.layout = await page.evaluate(() => {
    const layout = window.__lol2d.scene.oScene.game.touchControls.currentLayout;
    const round = n => Math.round(n * 10) / 10;
    return {
      joystick: {
        x: round(layout.joystickHome.x),
        y: round(layout.joystickHome.y),
        radius: round(layout.joystickHome.radius),
      },
      dragToRange: round(layout.dragToRange),
      tapSlop: layout.tapSlop,
      buttons: layout.buttons.map(b => ({
        slot: b.slot,
        x: round(b.x),
        y: round(b.y),
        diameter: round(b.radius * 2),
      })),
    };
  });

  // What the fog actually allocates at devicePixelRatio 3. p5.Graphics takes
  // its density from the sketch, and the sketch is pinned to 1 in
  // GameScene.enter — one line away, in another file. FogOfWar now pins its own
  // too; this reads back both, and what p5 would have chosen unaided.
  report.fogBuffer = await page.evaluate(() => {
    const fog = window.__lol2d.scene.oScene.game.fogOfWar;
    const probe = createGraphics(8, 8);
    const inherited = probe.pixelDensity();
    probe.remove();
    const backing = fog.overlay.drawingContext.canvas;
    return {
      cssSize: `${fog.overlay.width}x${fog.overlay.height}`,
      backingStore: `${backing.width}x${backing.height}`,
      overlayDensity: fog.overlay.pixelDensity(),
      sketchDensity: window.pixelDensity(),
      densityANewGraphicsWouldInherit: inherited,
      megapixelsPerFrame: Math.round((backing.width * backing.height) / 1e5) / 10,
    };
  });

  // What a thumb can and cannot reach. The bottom-HUD strip that used to sit
  // here does not render in touch mode at all any more (see
  // MobileHudView.vue's file comment: health, mana, buff stacks, CC and the
  // revive countdown all already draw on the canvas over the champion), so
  // the only DOM control left is the corner button into the practice panel.
  // Compared against the desktop numbers at the end of the run.
  report.hudTouch = await page.evaluate(() => {
    const btn = document.querySelector('.spell-picker-btn')?.getBoundingClientRect();
    const round = n => (n == null ? null : Math.round(n));
    return {
      bottomHudPresent: !!document.querySelector('.bottom-HUD'),
      pickerBtn: btn
        ? { top: round(btn.top), right: round(window.innerWidth - btn.right), size: round(btn.width) }
        : null,
      statsPanelsVisible: getComputedStyle(document.querySelector('#stats')).display !== 'none',
    };
  });
  check('the bottom-HUD strip does not render in touch mode', report.hudTouch.bottomHudPresent === false);
  check(
    'the practice-panel corner button is up top, out of both thumbs’ way, and at least the 44px thumb target',
    report.hudTouch.pickerBtn !== null &&
      report.hudTouch.pickerBtn.top < 20 &&
      report.hudTouch.pickerBtn.right < 20 &&
      report.hudTouch.pickerBtn.size >= 44,
    JSON.stringify(report.hudTouch.pickerBtn)
  );
  check(
    'the profiler is out of the way in touch mode',
    report.hudTouch.statsPanelsVisible === false,
    `stats ${report.hudTouch.statsPanelsVisible}`
  );

  await page.screenshot({ path: `${OUT}-01-layout.png` });

  // Clear ground to walk and shoot over, and a pinned, visible sparring
  // partner. Same reasoning as drive-basic-attacks: the roster has been
  // brawling since load, and a measurement taken in the middle of that is
  // measuring somebody else's spell.
  report.setup = await page.evaluate(async () => {
    const AllSpells = await import('/src/game/gameObject/spells/index.ts');
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

    // Nobody else in the fight, and no wave clock refilling it.
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
      // Parked far away, except the one victim placed below.
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

    // Known kit, so the assertions below are about the input and not about
    // whichever champion the lobby rolled.
    player.replaceSpell(1, new AllSpells.Ahri_Q(player)); // DIRECTION, PRESS
    player.replaceSpell(2, new AllSpells.Varus_Q(player)); // DIRECTION, HOLD_RELEASE
    player.spells[1].manaCost = 40;
    player.spells[1].coolDown = 6000;

    // The victim: due south of the champion, comfortably inside Ahri Q's reach,
    // and visible — a tap cannot auto-target through fog.
    const victim = bots[0];
    victim.position.set(open.x, open.y + 300);
    victim.destination.set(open.x, open.y + 300);
    victim.stats.maxHealth.baseValue = 1e6;
    victim.stats.health.baseValue = 1e6;
    victim.deathData = null;

    game.camera.target = player.position;
    game.camera.position.set(player.position.x, player.position.y);
    game.camera.scale = 1;
    game.camera.currentScale = 1;

    // A recorder for every spell object the player spawns, so the assertions
    // can read what actually went into the world.
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
      victim: { x: victim.position.x, y: victim.position.y },
      spells: player.spells.map(s => s?.constructor.name ?? null),
    };
  });
  await page.waitForTimeout(600);

  const layout = report.layout;
  const stick = layout.joystick;
  const slot1 = layout.buttons.find(b => b.slot === 1);
  const slot2 = layout.buttons.find(b => b.slot === 2);
  const slot3 = layout.buttons.find(b => b.slot === 3);

  // ------------------------------------------------------------ 2/3. stick

  report.joystick = await (async () => {
    // Put a route in flight first, so the takeover has something to take over.
    const before = await page.evaluate(() => {
      const game = window.__lol2d.scene.oScene.game;
      const player = game.player;
      player.orderMove(player.position.x + 2200, player.position.y + 1400, true);
      return { x: player.position.x, y: player.position.y };
    });
    await page.waitForTimeout(350);
    const routed = await page.evaluate(
      () => window.__lol2d.scene.oScene.game.player.pathAgent?.state ?? 'NONE'
    );

    // Grab the stick and push it north-west.
    await touchStart([{ x: stick.x, y: stick.y }]);
    await settle(80);
    await touchMove([{ x: stick.x - 60, y: stick.y - 60 }]);
    await page.waitForTimeout(120);
    const duringRoute = await page.evaluate(
      () => window.__lol2d.scene.oScene.game.player.pathAgent?.state ?? 'NONE'
    );
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}-02-joystick.png` });

    const during = await page.evaluate(() => {
      const player = window.__lol2d.scene.oScene.game.player;
      return { x: player.position.x, y: player.position.y };
    });

    await touchEnd();
    await page.waitForTimeout(300);
    const settled = await page.evaluate(() => {
      const player = window.__lol2d.scene.oScene.game.player;
      return {
        x: player.position.x,
        y: player.position.y,
        destinationGap: Math.hypot(
          player.destination.x - player.position.x,
          player.destination.y - player.position.y
        ),
      };
    });
    await page.waitForTimeout(500);
    const afterRelease = await page.evaluate(() => {
      const player = window.__lol2d.scene.oScene.game.player;
      return { x: player.position.x, y: player.position.y };
    });

    return {
      before,
      routeStateBeforeStick: routed,
      routeStateUnderStick: duringRoute,
      during,
      settled,
      afterRelease,
      travelled: Math.round(Math.hypot(during.x - before.x, during.y - before.y)),
      driftAfterRelease: Math.round(
        Math.hypot(afterRelease.x - settled.x, afterRelease.y - settled.y)
      ),
    };
  })();

  // A liveness check: does holding the stick produce movement at all. The
  // distance is not the claim and cannot be — the walk runs for ~1s of wall
  // clock, so what it covers depends on how many frames the machine rendered
  // in that second. The old bound of 120 was read off one machine's frame rate
  // and failed at 109-115 on a slower one, which is a measurement of the
  // machine rather than of the joystick. The direction assertion below is the
  // one that says the stick works *correctly*.
  check(
    'the stick walks the champion',
    report.joystick.travelled > 90,
    `${report.joystick.travelled} world units in ~1s`
  );
  check(
    'the stick walks the champion the way it points',
    report.joystick.during.x < report.joystick.before.x &&
      report.joystick.during.y < report.joystick.before.y,
    `north-west push moved (${Math.round(report.joystick.during.x - report.joystick.before.x)}, ${Math.round(report.joystick.during.y - report.joystick.before.y)})`
  );
  check(
    'the stick takes over from a running route',
    report.joystick.routeStateBeforeStick === 'FOLLOWING' &&
      report.joystick.routeStateUnderStick !== 'FOLLOWING',
    `${report.joystick.routeStateBeforeStick} -> ${report.joystick.routeStateUnderStick}`
  );
  check(
    'releasing the stick stops the champion dead',
    report.joystick.driftAfterRelease < 8,
    `${report.joystick.driftAfterRelease} world units of coast`
  );

  // ------------------------------------------- 5. no cast on touch-down

  const resetSpell = () =>
    page.evaluate(() => {
      const game = window.__lol2d.scene.oScene.game;
      const spell = game.player.spells[1];
      spell.currentCooldown = 0;
      spell.state = 'READY';
      game.player.stats.mana.baseValue = 1e6;
      window.__spawned.length = 0;
      return {
        mana: game.player.stats.mana.value,
        cooldown: spell.currentCooldown,
      };
    });

  await resetSpell();
  await touchStart([{ x: slot1.x, y: slot1.y }]);
  await page.waitForTimeout(400);
  report.pressDeferral = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const spell = game.player.spells[1];
    return {
      state: spell.state,
      cooldown: Math.round(spell.currentCooldown),
      mana: Math.round(game.player.stats.mana.value),
      spawned: window.__spawned.length,
    };
  });
  check(
    'a PRESS spell does not fire when the thumb lands',
    report.pressDeferral.spawned === 0 && report.pressDeferral.cooldown === 0,
    `state ${report.pressDeferral.state}, ${report.pressDeferral.spawned} objects spawned`
  );

  // -------------------------------------------------- 4. dragged skillshot

  // Same gesture, continued: drag due west and lift.
  await touchMove([{ x: slot1.x - 130, y: slot1.y }]);
  await page.waitForTimeout(160);
  await page.screenshot({ path: `${OUT}-03-aiming.png` });
  await touchEnd();
  await page.waitForTimeout(250);

  report.draggedSkillshot = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const spell = game.player.spells[1];
    const context = spell.castContext;
    return {
      spawned: window.__spawned.length,
      first: window.__spawned[0] ?? null,
      direction: context ? { x: context.direction.x, y: context.direction.y } : null,
      cursorWorld: context ? { x: context.cursorWorld.x, y: context.cursorWorld.y } : null,
      origin: context ? { x: context.origin.x, y: context.origin.y } : null,
      cooldown: Math.round(spell.currentCooldown),
      mana: Math.round(game.player.stats.mana.value),
    };
  });

  const dragged = report.draggedSkillshot;
  check(
    'the dragged skillshot cast on release',
    dragged.spawned === 1 && dragged.cooldown > 0,
    `${dragged.spawned} object(s), ${dragged.cooldown}ms cooldown`
  );
  check(
    'it flew where the drag pointed (due west)',
    dragged.direction !== null &&
      dragged.direction.x < -0.97 &&
      Math.abs(dragged.direction.y) < 0.2,
    dragged.direction
      ? `direction (${dragged.direction.x.toFixed(3)}, ${dragged.direction.y.toFixed(3)})`
      : 'no cast context'
  );
  check(
    'the projectile was sent the same way',
    dragged.first?.to != null && dragged.first.to.x < dragged.first.from.x - 200,
    dragged.first
      ? `${dragged.first.kind} from (${Math.round(dragged.first.from.x)}, ${Math.round(dragged.first.from.y)}) to (${Math.round(dragged.first.to.x)}, ${Math.round(dragged.first.to.y)})`
      : 'nothing spawned'
  );

  // ---------------------------------------------------- 6. tap auto-targets

  await resetSpell();
  const tapVictim = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bot = game.objectManager.objects.find(
      o => o.constructor.name === 'AIChampion' && Math.hypot(o.position.x - player.position.x, o.position.y - player.position.y) < 900
    );
    if (bot) {
      // Re-pin it relative to wherever the stick walked the champion.
      bot.position.set(player.position.x, player.position.y + 300);
      bot.destination.set(bot.position.x, bot.position.y);
    }
    return bot
      ? { x: bot.position.x, y: bot.position.y, visible: bot.visibleToPlayerTeam }
      : null;
  });
  await page.waitForTimeout(400);

  await touchStart([{ x: slot1.x, y: slot1.y }]);
  await page.waitForTimeout(90);
  await touchEnd();
  await page.waitForTimeout(250);

  report.tap = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const spell = game.player.spells[1];
    const context = spell.castContext;
    const bot = game.objectManager.objects.find(o => o.constructor.name === 'AIChampion' && o.visibleToPlayerTeam);
    return {
      // Counted by kind: an orb still in flight from the previous check spawns
      // its own trail and impact effects, which are also owned by the player.
      spawned: window.__spawned.filter(o => o.kind === 'Ahri_Q_Object').length,
      direction: context ? { x: context.direction.x, y: context.direction.y } : null,
      cooldown: Math.round(spell.currentCooldown),
      victim: bot ? { x: bot.position.x, y: bot.position.y, visible: bot.visibleToPlayerTeam } : null,
      origin: context ? { x: context.origin.x, y: context.origin.y } : null,
    };
  });
  report.tap.pinned = tapVictim;

  check(
    'a tap casts',
    report.tap.spawned === 1 && report.tap.cooldown > 0,
    `${report.tap.spawned} object(s), ${report.tap.cooldown}ms cooldown`
  );
  check(
    'the tap aimed itself at the auto-picked target (due south)',
    report.tap.direction !== null &&
      report.tap.direction.y > 0.9 &&
      Math.abs(report.tap.direction.x) < 0.3,
    report.tap.direction
      ? `direction (${report.tap.direction.x.toFixed(3)}, ${report.tap.direction.y.toFixed(3)}), victim ${report.tap.victim ? 'visible' : 'missing'}`
      : 'no cast context'
  );

  // A UNIT spell starts with the nearest tap target, then a deliberately short
  // eastward drag must release it and lock the enemy along that aim ray. This
  // is the thumb case an endpoint-only picker made unnecessarily precise.
  const unitAimSetup = await page.evaluate(async () => {
    const AllSpells = await import('/src/game/gameObject/spells/index.ts');
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bots = game.objectManager.objects.filter(o => o.constructor.name === 'AIChampion');
    const nearest = bots[0];
    const intended = bots[1];
    player.replaceSpell(3, new AllSpells.Leblanc_Q(player));
    nearest.position.set(player.position.x, player.position.y + 180);
    nearest.destination.set(nearest.position.x, nearest.position.y);
    intended.position.set(player.position.x + 500, player.position.y + 40);
    intended.destination.set(intended.position.x, intended.position.y);
    nearest.deathData = null;
    intended.deathData = null;
    return { nearestId: nearest.id, intendedId: intended.id };
  });
  await page.waitForTimeout(400);

  await touchStart([{ x: slot3.x, y: slot3.y }]);
  await settle(80);
  await touchMove([{ x: slot3.x + 30, y: slot3.y }]);
  await settle(140);
  await touchEnd();
  await page.waitForTimeout(300);

  report.unitDrag = await page.evaluate(() => {
    const spell = window.__lol2d.scene.oScene.game.player.spells[3];
    return {
      targetId: spell.castContext?.target?.id ?? null,
      cooldown: Math.round(spell.currentCooldown),
    };
  });
  check(
    'a short UNIT drag releases the nearest auto-lock and selects along the aim ray',
    report.unitDrag.targetId === unitAimSetup.intendedId && report.unitDrag.cooldown > 0,
    JSON.stringify({ ...unitAimSetup, ...report.unitDrag })
  );

  // --------------------------------------------------------- 7. cancelling

  const beforeCancel = await resetSpell();
  await touchStart([{ x: slot1.x, y: slot1.y }]);
  await settle(90);
  await touchMove([{ x: slot1.x - 200, y: slot1.y - 60 }]);
  await settle(140);
  await page.screenshot({ path: `${OUT}-04-cancel-armed.png` });
  await touchMove([{ x: slot1.x, y: slot1.y }]);
  await settle(160);
  await page.screenshot({ path: `${OUT}-05-cancel.png` });
  await touchEnd();
  await page.waitForTimeout(300);

  report.cancel = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const spell = game.player.spells[1];
    return {
      spawned: window.__spawned.length,
      cooldown: Math.round(spell.currentCooldown),
      mana: Math.round(game.player.stats.mana.value),
      state: spell.state,
    };
  });
  check(
    'dragging back onto the button spends nothing',
    report.cancel.spawned === 0 &&
      report.cancel.cooldown === 0 &&
      report.cancel.mana === Math.round(beforeCancel.mana),
    `${report.cancel.spawned} objects, ${report.cancel.cooldown}ms cooldown, mana ${report.cancel.mana} of ${Math.round(beforeCancel.mana)}`
  );

  // ----------------------------------------------------- 8. charged spells

  await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const spell = game.player.spells[2];
    spell.currentCooldown = 0;
    spell.state = 'READY';
    game.player.stats.mana.baseValue = 1e6;
    window.__spawned.length = 0;
  });

  await touchStart([{ x: slot2.x, y: slot2.y }]);
  await page.waitForTimeout(150);
  const chargeStart = await page.evaluate(() => {
    const spell = window.__lol2d.scene.oScene.game.player.spells[2];
    return { state: spell.state, chargeMs: Math.round(spell.chargeMs ?? -1) };
  });
  await touchMove([{ x: slot2.x - 40, y: slot2.y - 150 }]);
  await page.waitForTimeout(700);
  const chargeHeld = await page.evaluate(() => {
    const spell = window.__lol2d.scene.oScene.game.player.spells[2];
    return { state: spell.state, chargeMs: Math.round(spell.chargeMs ?? -1) };
  });
  await page.screenshot({ path: `${OUT}-06-charging.png` });
  await touchEnd();
  await page.waitForTimeout(300);
  const chargeReleased = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const spell = game.player.spells[2];
    // Not spell.castContext: for a charge that is deliberately the *press*
    // snapshot, taken before the thumb had aimed anything. The arrow is what
    // the release actually produced, so the arrow is what gets read.
    const arrow = window.__spawned.find(o => o.kind === 'Varus_Q_Arrow');
    const direction = arrow?.to
      ? (() => {
          const dx = arrow.to.x - arrow.from.x;
          const dy = arrow.to.y - arrow.from.y;
          const length = Math.hypot(dx, dy) || 1;
          return { x: dx / length, y: dy / length };
        })()
      : null;
    return {
      state: spell.state,
      cooldown: Math.round(spell.currentCooldown),
      spawned: window.__spawned.filter(o => o.kind === 'Varus_Q_Arrow').length,
      arrowRange: arrow?.to ? Math.round(Math.hypot(arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y)) : null,
      direction,
    };
  });
  report.charge = { chargeStart, chargeHeld, chargeReleased };

  check(
    'a charge starts when the thumb lands',
    chargeStart.state === 'CHARGING',
    `state ${chargeStart.state} after 150ms`
  );
  check(
    'the charge builds while the thumb drags',
    chargeHeld.state === 'CHARGING' && chargeHeld.chargeMs > chargeStart.chargeMs,
    `${chargeStart.chargeMs}ms -> ${chargeHeld.chargeMs}ms`
  );
  check(
    'the charge releases when the thumb lifts, aimed by the drag',
    chargeReleased.state !== 'CHARGING' &&
      chargeReleased.spawned === 1 &&
      chargeReleased.direction !== null &&
      chargeReleased.direction.y < -0.8,
    chargeReleased.direction
      ? `state ${chargeReleased.state}, arrow flew (${chargeReleased.direction.x.toFixed(3)}, ${chargeReleased.direction.y.toFixed(3)}) for ${chargeReleased.arrowRange} units`
      : `state ${chargeReleased.state}, no arrow`
  );

  // ---------------------------------------------------- HUD in a phone view

  await page.evaluate(() => {
    // `openSpellPicker`/`closeSpellPicker` live on the shared
    // `HudInteractions` object (see src/game/hud/hudInteractions.ts),
    // injected into both DesktopHudView and MobileHudView rather than owned
    // by the root Vue instance directly. `openSpellPicker` is the touch
    // corner button's own entry point (`openPlayerLoadout` is the desktop
    // strip's, and needs an equipped-icon index no touch surface supplies).
    window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.openSpellPicker();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}-07-practice-panel.png` });

  // The panel is the whole DOM HUD in touch mode, so what this view has to
  // prove is that it came up on a tab and inside the viewport. The long-press
  // description that used to be checked here went with the deleted picker's
  // icons — its replacement is the loadout editor's own spell peek, one tap
  // further in, driven under a real thumb by drive-mobile-hud.mjs.
  report.panelInPhoneView = await page.evaluate(() => {
    const panel = document.querySelector('.practice-panel');
    if (!panel) return { visible: false };
    const box = panel.getBoundingClientRect();
    return {
      visible: true,
      selectedTab: document.querySelector('.practice-tab.selected')?.id ?? null,
      onScreen:
        box.top >= 0 &&
        box.left >= 0 &&
        box.right <= window.innerWidth + 1 &&
        box.bottom <= window.innerHeight + 1,
    };
  });
  check(
    'the practice panel opens on Đấu thủ and fits the phone viewport',
    report.panelInPhoneView.visible &&
      report.panelInPhoneView.onScreen &&
      report.panelInPhoneView.selectedTab === 'practice-tab-roster',
    JSON.stringify(report.panelInPhoneView)
  );

  await page.evaluate(() => {
    window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.closeSpellPicker();
  });
  await page.waitForTimeout(400);

  // The desktop layout, from the same build, through the same Game API the
  // (now pregame-Settings-tab-owned) mode preference will eventually call —
  // the regression check that both live in one HUD. `setTouchControlsEnabled`
  // stays a plain method on `Game` regardless of what UI calls it.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__lol2d.scene.oScene.game.setTouchControlsEnabled(false, false);
  });
  await page.waitForTimeout(600);
  report.desktopAfterToggle = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const hud = document.querySelector('.bottom-HUD');
    const box = hud?.getBoundingClientRect();
    const icon = document.querySelectorAll('.bottom-HUD .spell')[1]?.getBoundingClientRect();
    return {
      controlsEnabled: game.touchControls.enabled,
      bodyClass: document.body.classList.contains('touch-ui'),
      hudBottomGap: box ? Math.round(window.innerHeight - box.bottom) : null,
      hudCentred: box ? Math.abs(box.x + box.width / 2 - window.innerWidth / 2) < 4 : null,
      iconSize: icon ? Math.round(icon.width) : null,
      hotKeyVisible: (() => {
        const badge = document.querySelector('.bottom-HUD .spell .hotKey');
        return !!badge && getComputedStyle(badge).display !== 'none';
      })(),
    };
  });
  await page.screenshot({ path: `${OUT}-09-desktop.png` });
  check(
    'switching back restores the desktop HUD, unaffected by anything in touch mode',
    report.desktopAfterToggle.controlsEnabled === false &&
      report.desktopAfterToggle.bodyClass === false &&
      report.desktopAfterToggle.hudCentred === true &&
      report.desktopAfterToggle.hudBottomGap < 20 &&
      // 3em plus the 2px padding either side, which is what main has.
      report.desktopAfterToggle.iconSize === 52 &&
      report.desktopAfterToggle.hotKeyVisible === true,
    JSON.stringify(report.desktopAfterToggle)
  );
} catch (error) {
  failures.push(`threw: ${error.stack ?? error}`);
} finally {
  console.log('\n--- report ---');
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) {
    console.log('\n--- page errors ---');
    for (const error of errors.slice(0, 10)) console.log(error);
  }
  console.log(`\nscreenshots: ${OUT}-*.png`);
  if (failures.length) {
    console.log('\n--- FAILURES ---');
    for (const failure of failures) console.log(failure);
  } else {
    console.log('\nall checks passed');
  }
  await browser.close();
  await server.close();
  process.exit(failures.length ? 1 : 0);
}
