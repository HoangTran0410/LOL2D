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
 *   3. the player walks into range and trades until the target dies;
 *   4. a bot fights back rather than standing there;
 *   5. the frame rate holds with a crowded board.
 *
 *   node tests/e2e/drive-basic-attacks.mjs [outPrefix]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-attacks';

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const url = `http://localhost:${port}/`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const report = {};
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

try {
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
    const bot = game.objectManager.objects.find(o => o !== player && o.basicAttack);
    const pin = (unit, x, y) => {
      unit.position.set(x, y);
      unit.destination.set(x, y);
    };
    bot._autoAttack = false;
    bot._autoCast = false;
    bot._autoMove = false;
    bot._frozenSpeed = bot.stats.speed.baseValue;
    bot.stats.speed.baseValue = 0;
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
        if (bot.willDraw) placed = { x: Math.round(x), y: Math.round(y), radius };
      }
      if (placed) break;
    }

    window.__probe = { player, bot };
    return {
      placed,
      botVisible: !!bot.willDraw,
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

  // 3. order the attack again and watch the whole exchange out
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

  // 4. a bot fights back on its own, with nobody ordering it to
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

  // 5. crowd the board and measure the frame rate
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
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}

if (errors.length) process.exitCode = 1;
