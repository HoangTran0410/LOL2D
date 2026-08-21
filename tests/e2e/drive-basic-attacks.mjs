/**
 * End-to-end drive of champion basic attacks in the real game.
 *
 * Boots its own Vite dev server on a free port, opens the game in system Chrome
 * through Playwright, and reaches the live scene through the DEV-only
 * `window.__lol2d` handle set in src/main.ts.
 *
 * What it proves, in order:
 *   1. a real right click on an enemy body becomes an attack order;
 *   2. a real right click on empty ground cancels it and moves instead;
 *   3. a real `A` press orders the enemy nearest the *cursor*, not the nearest
 *      one, and the slot 0 icon is in the HUD to press;
 *   4. the order is sticky: the champion chases a target that walks away and
 *      keeps swinging, with nobody pressing anything again;
 *   5. casting an ability drops the order;
 *   6. the player walks into range and trades until the target dies;
 *   7. a bot fights back rather than standing there;
 *   8. the frame rate holds with a crowded board.
 *
 *   node tests/e2e/drive-basic-attacks.mjs [outPrefix]
 */
import { startHarness } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/lol2d-attacks';
const { url, page, errors, report, check, guard } = await startHarness({
  out: OUT,
  viewport: { width: 1280, height: 800 },
});
const evaluate = (fn, arg) => page.evaluate(fn, arg);

/** Right click at a screen point through the real mouse pipeline. */
async function rightClick(x, y) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(100);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(120);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(80);
}

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // A pinned sparring partner: no wandering, no casting, no walking away, so the
  // input and the exchange can be measured instead of chased.
  //
  // Where it is pinned matters. A right click can only order an attack on a unit
  // the fog of war says you can see, so the bot is walked around the player until
  // it lands somewhere with line of sight — dropping it behind a wall is a
  // correct refusal, not a bug to work around.
  report.setup = await evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bot = game.objectManager.objects.find(
      o => o !== player && o.basicAttack && o.teamId !== player.teamId
    );
    if (!bot) throw new Error('No hostile bot is available for the basic-attack probe.');
    const pin = (unit, x, y) => {
      unit.position.set(x, y);
      unit.destination.set(x, y);
    };
    bot._autoAttack = false;
    bot._autoCast = false;
    bot._autoMove = false;
    bot._frozenSpeed = bot.stats.speed.baseValue;
    bot.stats.speed.baseValue = 0;
    bot.stats.healthRegen.baseValue = 0;
    player.destination.set(player.position.x, player.position.y);
    // The roster has been brawling since the scene loaded. Whatever landed on
    // these two before the measurement starts (a stasis, an untargetable window,
    // a slow) is cleared, otherwise the duel measures somebody else's spell.
    for (const unit of [player, bot]) {
      for (const buff of [...unit.buffs]) buff.deactivateBuff();
      unit.updateBuffs();
      unit.deathData = null;
      unit.stats.health.baseValue = unit.stats.maxHealth.value;
    }
    // keep the rest of the roster out of the duel
    for (const other of game.objectManager.objects) {
      if (other !== player && other !== bot && other.basicAttack) {
        other.position.set(400, 400);
        other.destination.set(400, 400);
      }
    }
    game.camera.target = null;
    game.camera.scale = 1;
    game.camera.currentScale = 1;

    // Turrets shoot whoever is nearest and deal 12 per 1.3s, which would muddy
    // a duel readout measured in 16s. Disarmed for the measurement, restored
    // before the crowd phase.
    for (const turret of game.turrets) {
      turret._savedDamage = turret.damage;
      turret.damage = 0;
    }

    const settle = () => new Promise(resolve => setTimeout(resolve, 260));
    let placed = null;
    for (const radius of [420, 340, 260]) {
      for (let step = 0; step < 8 && !placed; step++) {
        const angle = (step / 8) * Math.PI * 2;
        const x = player.position.x + Math.cos(angle) * radius;
        const y = player.position.y + Math.sin(angle) * radius;
        pin(bot, x, y);
        game.camera.position.set((player.position.x + x) / 2, (player.position.y + y) / 2);
        await settle();
        if (bot.visibleToPlayerTeam) placed = { x: Math.round(x), y: Math.round(y), radius };
      }
      if (placed) break;
    }

    window.__probe = {
      player,
      bot,
      rightClickHits: 0,
      rightClickDamage: 0,
      rightClickHealthBefore: bot.stats.health.value,
    };
    game.eventManager.on('onUnitAttackHit', hit => {
      if (hit.attacker !== player || hit.victim !== bot) return;
      window.__probe.rightClickHits += 1;
      window.__probe.rightClickDamage += hit.damage;
    });
    return {
      placed,
      botVisible: !!bot.visibleToPlayerTeam,
      botTargetable: !!bot.targetable,
      attackDamage: player.stats.attackDamage.value,
      attacksPerSecond: player.stats.attackSpeed.value,
      attackRange: player.stats.attackRange.value,
      ranged: player.basicAttack.isRanged,
      reach: Math.round(player.basicAttack.reachTo(bot)),
      startDistance: Math.round(player.position.dist(bot.position)),
      playerHealth: Math.round(player.stats.health.value),
      botHealth: Math.round(bot.stats.health.value),
    };
  });

  // 1. right click the enemy body
  const botScreen = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const point = game.camera.worldToScreen(
      window.__probe.bot.position.x,
      window.__probe.bot.position.y
    );
    return { x: point.x, y: point.y };
  });
  await rightClick(botScreen.x, botScreen.y);
  report.rightClickOnEnemy = await evaluate(() => {
    const player = window.__lol2d.scene.oScene.game.player;
    return {
      ordersTheBot: player.basicAttack.target === window.__probe.bot,
      cursorWasOnTheBot:
        Math.round(
          window.__lol2d.scene.oScene.game.worldMouse.dist(window.__probe.bot.position)
        ) < 20,
    };
  });
  check(
    'right click on an enemy body issues an attack order',
    report.rightClickOnEnemy.ordersTheBot === true,
    `cursorOnBody=${report.rightClickOnEnemy.cursorWasOnTheBot} ordered=${report.rightClickOnEnemy.ordersTheBot}`
  );
  // A target equality only proves acquisition. Let this exact pointer order
  // chase/wind up/fly all the way to one landed hit before the ground click
  // below is allowed to cancel it. Keep collecting a report on timeout so the
  // harness prints the useful zeroes instead of only a Playwright stack.
  await page
    .waitForFunction(
      () =>
        window.__probe.rightClickHits >= 1 &&
        window.__probe.bot.stats.health.value < window.__probe.rightClickHealthBefore,
      null,
      { timeout: 6_000 }
    )
    .catch(() => undefined);
  report.rightClickDamage = await evaluate(() => ({
    hits: window.__probe.rightClickHits,
    damage: window.__probe.rightClickDamage,
    healthLost: Math.round(
      window.__probe.rightClickHealthBefore - window.__probe.bot.stats.health.value
    ),
  }));
  check(
    'the right-click order lands a damaging basic attack',
    report.rightClickDamage.hits >= 1 && report.rightClickDamage.healthLost > 0,
    `hits=${report.rightClickDamage.hits} damage=${report.rightClickDamage.damage} healthLost=${report.rightClickDamage.healthLost}`
  );

  // 2. right click empty ground cancels the order and moves instead
  const groundBefore = await evaluate(
    () => window.__lol2d.scene.oScene.game.worldMouse.y
  );
  await rightClick(botScreen.x, botScreen.y - 200);
  report.rightClickOnGround = await evaluate(before => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      target: game.player.basicAttack.target,
      cursorMovedUpBy: Math.round(before - game.worldMouse.y),
      destinationFollowedTheCursor:
        Math.round(game.player.destination.y - game.worldMouse.y) === 0,
    };
  }, groundBefore);

  // 3. the A key: order the enemy nearest the CURSOR, not the nearest one
  //
  // A second bot is pinned half way between the player and the first one, on the
  // same line so it shares its line of sight. Nearest-to-the-champion is then the
  // decoy; nearest-to-the-cursor is the far bot. Putting the cursor past the far
  // bot and pressing `A` has to pick the far one, or the feature is just a
  // rename of the AI's own scan.
  report.aKeySetup = await evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bot = window.__probe.bot;
    const decoy = game.objectManager.objects.find(
      o => o !== player && o !== bot && o.basicAttack && !o.isDead && o.teamId !== player.teamId
    );
    window.__probe.decoy = decoy ?? null;

    player.basicAttack.clear();
    player.destination.set(player.position.x, player.position.y);
    for (const unit of [player, bot, decoy].filter(Boolean)) {
      for (const buff of [...unit.buffs]) buff.deactivateBuff();
      unit.updateBuffs();
      unit.deathData = null;
      unit.stats.health.baseValue = unit.stats.maxHealth.value;
    }

    if (decoy) {
      decoy._autoAttack = false;
      decoy._autoCast = false;
      decoy._autoMove = false;
      decoy._frozenSpeed = decoy.stats.speed.baseValue;
      decoy.stats.speed.baseValue = 0;
      const midX = (player.position.x + bot.position.x) / 2;
      const midY = (player.position.y + bot.position.y) / 2;
      decoy.position.set(midX, midY);
      decoy.destination.set(midX, midY);
    }
    await new Promise(resolve => setTimeout(resolve, 400));

    return {
      slotZero: {
        name: player.spells[0]?.name,
        image: player.spells[0]?.image?.path,
        manaCost: player.spells[0]?.manaCost,
        // the swing interval, read live off stats.attackSpeed
        coolDownMs: Math.round(player.spells[0]?.coolDown ?? -1),
        intervalFromStats: Math.round(1_000 / player.stats.attackSpeed.value),
      },
      hotKeys: player.spells.map(s => s?.name),
      decoyPlaced: !!decoy,
      decoyVisible: !!decoy?.visibleToPlayerTeam,
      botVisible: !!bot.visibleToPlayerTeam,
      decoyDistanceFromPlayer: decoy
        ? Math.round(player.position.dist(decoy.position))
        : null,
      botDistanceFromPlayer: Math.round(player.position.dist(bot.position)),
    };
  });

  // the cursor goes PAST the far bot, well clear of any body, then `A`
  const aimPoint = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bot = window.__probe.bot;
    const dx = bot.position.x - player.position.x;
    const dy = bot.position.y - player.position.y;
    const length = Math.hypot(dx, dy) || 1;
    // 90 world units beyond the bot, along the same line
    const world = {
      x: bot.position.x + (dx / length) * 90,
      y: bot.position.y + (dy / length) * 90,
    };
    const screen = game.camera.worldToScreen(world.x, world.y);
    return { world, screen: { x: screen.x, y: screen.y } };
  });
  await page.mouse.move(aimPoint.screen.x, aimPoint.screen.y);
  await page.waitForTimeout(150);
  await page.keyboard.press('a');
  await page.waitForTimeout(150);

  report.aKeyOrder = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bot = window.__probe.bot;
    const decoy = window.__probe.decoy;
    return {
      orderedTheFarBot: player.basicAttack.target === bot,
      orderedTheNearDecoy: !!decoy && player.basicAttack.target === decoy,
      cursorToBot: Math.round(game.worldMouse.dist(bot.position)),
      cursorToDecoy: decoy ? Math.round(game.worldMouse.dist(decoy.position)) : null,
      playerToBot: Math.round(player.position.dist(bot.position)),
      playerToDecoy: decoy ? Math.round(player.position.dist(decoy.position)) : null,
    };
  });
  await page.screenshot({ path: `${OUT}-a-key.png` });

  // The slot 0 icon as the DOM actually renders it. The swing timer runs
  // whenever the champion is fighting, so this slot must not get a real
  // cooldown's treatment — greyed out with the seconds stamped over it — or it
  // would be unreadable for the whole game.
  report.hudSlotZero = await evaluate(() => {
    const slot = document.querySelector('.bottom-HUD .spells .spell');
    if (!slot) return { found: false };
    const img = slot.querySelector('img');
    return {
      found: true,
      small: slot.classList.contains('small'),
      hotKey: slot.querySelector('.hotKey')?.textContent ?? null,
      iconSrc: img?.getAttribute('src') ?? null,
      greyedOut: (img?.getAttribute('style') ?? '').includes('grayscale'),
      hasSecondsStamp: !!slot.querySelector('.cooldown'),
      swingWedge: !!slot.querySelector('.cooldown-overlay.rhythm'),
      manaBadge: !!slot.querySelector('.mana-cost'),
    };
  });
  const hudBar = page.locator('.bottom-HUD').first();
  if (await hudBar.count()) await hudBar.screenshot({ path: `${OUT}-hud.png` });

  // 4. sticky: the target runs, nobody presses anything again
  report.stickyChase = await evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bot = window.__probe.bot;
    // half speed, so the chase actually closes and the swings keep coming
    bot.stats.speed.baseValue = (bot._frozenSpeed ?? 3) * 0.5;
    bot.stats.healthRegen.baseValue = 0;
    const away = {
      x: Math.max(300, Math.min(game.mapSize - 300, bot.position.x + 900)),
      y: Math.max(300, Math.min(game.mapSize - 300, bot.position.y + 900)),
    };
    bot.destination.set(away.x, away.y);

    let swings = 0;
    const stopCounting = game.eventManager.on('onUnitAttack', unit => {
      if (unit === player) swings += 1;
    });
    const startedAt = { x: player.position.x, y: player.position.y };
    const samples = [];
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 400));
      bot.destination.set(away.x, away.y);
      samples.push({
        at: i * 400,
        stillOrdered: player.basicAttack.target === bot,
        botHealth: Math.round(bot.stats.health.value),
        distance: Math.round(player.position.dist(bot.position)),
        chasing:
          Math.round(player.destination.dist(bot.position)) < 40 ||
          Math.round(player.position.dist(bot.position)) <=
            Math.round(player.basicAttack.reachTo(bot)),
        swings,
      });
    }
    stopCounting();
    return {
      playerMoved: Math.round(
        Math.hypot(player.position.x - startedAt.x, player.position.y - startedAt.y)
      ),
      botMoved: Math.round(Math.hypot(bot.position.x - away.x, bot.position.y - away.y)),
      swingsWhileChasing: swings,
      heldTheOrderThroughout: samples.every(s => s.stillOrdered),
      samples,
    };
  });
  await page.screenshot({ path: `${OUT}-chase.png` });

  // 5. casting an ability drops the order
  report.cancelOnCast = await evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bot = window.__probe.bot;
    bot.stats.speed.baseValue = 0;
    player.basicAttack.order(bot);
    const ordered = player.basicAttack.target === bot;

    // slot 1..4 is a random ability; give it the mana and the cooldown it needs
    // so the press is really accepted, then find which one went off
    const tried = [];
    for (const [slot, key] of [[1, 'q'], [2, 'w'], [3, 'e'], [4, 'r']]) {
      if (!player.spells[slot]) continue;
      player.basicAttack.order(bot);
      player.stats.mana.baseValue = player.stats.maxMana.value;
      player.spells[slot].resetCoolDown();
      await new Promise(resolve => setTimeout(resolve, 120));
      window.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: key.toUpperCase().charCodeAt(0), bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 200));
      window.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode: key.toUpperCase().charCodeAt(0), bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 120));
      tried.push({
        key,
        spell: player.spells[slot].name,
        droppedTheOrder: player.basicAttack.target === null,
        lastEnd: player.basicAttack.lastEnd,
      });
      if (player.basicAttack.target === null) break;
    }
    return { ordered, tried, droppedByACast: tried.some(t => t.droppedTheOrder) };
  });

  // and put the sparring partner back the way step 6 expects to find it
  await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const bot = window.__probe.bot;
    bot.stats.speed.baseValue = 0;
    player.basicAttack.clear();
    player.destination.set(player.position.x, player.position.y);
    for (const unit of [player, bot]) {
      unit.deathData = null;
      unit.stats.health.baseValue = unit.stats.maxHealth.value;
    }
    const dx = bot.position.x - player.position.x;
    const dy = bot.position.y - player.position.y;
    game.camera.position.set(player.position.x + dx / 2, player.position.y + dy / 2);
    if (window.__probe.decoy) {
      window.__probe.decoy.position.set(400, 400);
      window.__probe.decoy.destination.set(400, 400);
    }
  });
  await page.waitForTimeout(400);

  // 6. order the attack again and watch the whole exchange out
  await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    // both duellists start the measurement whole; the roster has been brawling
    // since the scene loaded and the player is usually already chewed up
    window.__probe.bot.stats.healthRegen.baseValue = 0;
    window.__probe.bot.stats.health.baseValue = window.__probe.bot.stats.maxHealth.value;
    game.player.stats.health.baseValue = game.player.stats.maxHealth.value;
    game.player.orderAttack(window.__probe.bot);
    window.__probe.log = [];
    window.__probe.allSwings = 0;
    window.__probe.allHits = 0;
    window.__probe.maxBolts = 0;
    const start = performance.now();
    game.eventManager.on('onUnitAttack', unit => {
      window.__probe.allSwings += 1;
      if (unit === game.player) {
        window.__probe.log.push({
          event: 'swing',
          firedFrom: Math.round(game.player.position.dist(window.__probe.bot.position)),
          at: Math.round(performance.now() - start),
        });
      }
    });
    game.eventManager.on('onUnitAttackHit', hit => {
      window.__probe.allHits += 1;
      if (hit.attacker !== game.player) return;
      window.__probe.log.push({
        event: 'hit',
        damage: hit.damage,
        ranged: hit.ranged,
        victimIsTheBot: hit.victim === window.__probe.bot,
        victimHealth: Math.round(hit.victim.stats.health.value),
        at: Math.round(performance.now() - start),
      });
    });
  });

  const samples = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    samples.push(
      await evaluate(() => {
        const game = window.__lol2d.scene.oScene.game;
        const bolts = game.objectManager.objects.filter(
          o => o.constructor.name === 'BasicAttackBolt'
        ).length;
        window.__probe.maxBolts = Math.max(window.__probe.maxBolts, bolts);
        return {
          playerHealth: Math.round(game.player.stats.health.value),
          botHealth: Math.round(window.__probe.bot.stats.health.value),
          distance: Math.round(game.player.position.dist(window.__probe.bot.position)),
          boltsInFlight: bolts,
          ordered: game.player.basicAttack.target ? 'yes' : 'no',
          orderEndedWith: game.player.basicAttack.lastEnd,
          playerCanAttack: game.player.canAttack,
          playerDead: !!game.player.isDead,
          botDead: !!window.__probe.bot.isDead,
          fps: Math.round(window.frameRate?.() ?? -1),
        };
      })
    );
    if (i === 3) await page.screenshot({ path: `${OUT}-exchange.png` });
    if (samples[samples.length - 1].botDead) break;
  }
  report.exchange = samples;
  report.playerHits = await evaluate(() => window.__probe.log);
  report.eventTotals = await evaluate(() => ({
    swingsFromEveryUnit: window.__probe.allSwings,
    hitsFromEveryUnit: window.__probe.allHits,
    maxBoltsInFlight: window.__probe.maxBolts,
  }));
  await page.screenshot({ path: `${OUT}-after.png` });

  // 7. a bot fights back on its own, with nobody ordering it to
  report.botFightsBack = await evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const bot = window.__probe.bot;
    const player = game.player;
    // the player may have died and respawned during the duel; put the bot back
    // on its feet next to wherever the player is standing now
    player.deathData = null;
    player.stats.health.baseValue = player.stats.maxHealth.value;
    player.basicAttack.clear();
    player.destination.set(player.position.x, player.position.y);
    bot.deathData = null;
    bot.stats.health.baseValue = bot.stats.maxHealth.value;
    bot.stats.speed.baseValue = bot._frozenSpeed;
    bot._autoAttack = true;
    bot._attackScanCooldown = 0;
    bot.position.set(player.position.x + 260, player.position.y);
    bot.destination.set(player.position.x + 260, player.position.y);
    game.camera.position.set(player.position.x + 130, player.position.y);

    const before = player.stats.health.value;
    let targetedAtSomePoint = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (bot.basicAttack.target === player) targetedAtSomePoint = true;
    }
    return {
      botTargetsPlayer: targetedAtSomePoint,
      playerHealthLost: Math.round(before - player.stats.health.value),
      playerOrderedNothing: player.basicAttack.target === null,
    };
  });
  await page.screenshot({ path: `${OUT}-botfight.png` });

  // 8. crowd the board and measure the frame rate
  report.crowd = await evaluate(async () => {
    const aiModule = await import('/src/game/gameObject/attackableUnits/AIChampion.ts');
    const presetModule = await import('/src/game/preset.ts');
    const game = window.__lol2d.scene.oScene.game;
    for (const turret of game.turrets) turret.damage = turret._savedDamage;
    for (let i = 0; i < 42; i++) {
      game.objectManager.addObject(
        new aiModule.default({
          game,
          position: window.createVector(2_700 + (i % 7) * 180, 2_800 + Math.floor(i / 7) * 160),
          preset: presetModule.getChampionPresetRandom(),
        })
      );
    }
    return game.objectManager.objects.length;
  });
  await page.waitForTimeout(3_000);
  const crowdSamples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(500);
    crowdSamples.push(
      await evaluate(() => {
        const objects = window.__lol2d.scene.oScene.game.objectManager.objects;
        return {
          fps: Math.round(window.frameRate?.() ?? -1),
          objects: objects.length,
          attacking: objects.filter(o => o.basicAttack?.target).length,
        };
      })
    );
  }
  report.crowdFps = crowdSamples;
  await page.screenshot({ path: `${OUT}-crowd.png` });

  report.errors = errors;
  check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
});
