/**
 * End-to-end guard for one property of Lux's ultimate: **the beam is drawn
 * even when Lux herself is not.**
 *
 * This exists because the bug it guards lived in the seam between
 * `ObjectManager.draw()` and `FogOfWar`, and no unit test in this repo could
 * see it. `Champion.draw()` calls `spell.drawVfx()`, so anything hung on
 * `castSpec.vfx` inherits the caster's visibility twice over: the draw pass
 * only reaches objects whose *own* display bounding box is on camera, and
 * `FogOfWar` clears `willDraw` on every unit the player cannot see. Lux R's
 * beam is 3400px long and her body is about 40px wide, so hanging the beam off
 * her meant that a bot standing off screen fired a beam across the player's
 * whole screen that was never painted — while still doing its damage and
 * stamping its reveal icon on them. Which is exactly how it was reported: the
 * Lux R icon appeared on the player's bar after a cast they never saw.
 *
 * `tests/game/spells/Lux_R.test.ts` pins the structural half (the beam is a
 * world object, drawn by the world pass rather than by the champion). It
 * cannot pin this half, because it simulates the draw pass rather than running
 * the real one. A future change to `ObjectManager.draw()` or `FogOfWar` could
 * reintroduce the culling with every unit test still green.
 *
 * ## The property is the conjunction
 *
 * Neither half means anything alone. "The beam was drawn" is trivially true
 * when the caster is on screen, and "the caster was unrendered" is trivially
 * true of anything far enough away. So the run asserts both at once, of the
 * same cast:
 *
 *   - the caster is genuinely unrendered — `willDraw` false on every sample
 *     across the cast, and her `Champion.draw()` called zero times, which is
 *     what makes `drawVfx()` unreachable; and
 *   - `LuxBeamEffect.draw()` ran anyway, in both phases; and
 *   - the cast really did reach the player — health dropped and a `TrueSight`
 *     carrying `spell_lux_r` landed — so a beam that quietly stopped working
 *     cannot pass this by drawing nothing and hitting nothing.
 *
 * A counter that is stuck on would pass the draw half for free, so the run
 * also checks the counters are zero before the cast.
 *
 *   node tests/e2e/drive-lux-beam-visibility.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-lux-beam-visibility';
const CFG_KEY = 'lol2d:pregameConfig:v1';
const VIEWPORT = { width: 1280, height: 900 };

/**
 * How far off to the side Lux stands. The camera box is about 1422x1000 world
 * units at the default scale and the player's vision radius is 500, so 2600
 * puts her outside both by a wide margin — this run should never be measuring
 * a caster that was marginally on screen.
 */
const LUX_OFFSET_PX = 2_600;

/**
 * A deterministic match: a named champion for the player and no bots but the
 * one this script adds, because a random kit wandering into the arena is how
 * every flaky assertion in this directory started.
 */
const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Veigar',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
};

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const failures = [];
/** Records a mismatch instead of throwing, so one bad expectation cannot hide the rest. */
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
await page.waitForTimeout(1_200);

// ------------------------------------------------------------------ stage ---
const staged = await page.evaluate(async offset => {
  const game = window.__lol2d.scene.oScene.game;
  const player = game.player;

  // Empty arena: another bot's spell objects drifting through frame would be
  // drawing `LuxBeamEffect` for nobody's benefit but the counters'.
  for (const object of game.objectManager.objects) {
    if (object === player) continue;
    const name = object.constructor?.name ?? '';
    if (name === 'Turret' || name === 'Fountain') continue;
    object.toRemove = true;
  }
  game.objectManager.update();
  for (const buff of player.buffs) buff.deactivateBuff();
  player.updateBuffs();
  player.stats.health.baseValue = player.stats.maxHealth.value;

  const bot = game.director.addBot({
    mode: 'champion',
    championName: 'Lux',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  });
  if (!bot) return { ok: false, reason: 'director.addBot returned null' };
  game.director.setBotBehaviour(bot, { autoMove: false, autoAttack: false, autoCast: false });
  game.objectManager.update();

  // Relative to wherever the player actually spawned, so neither of them is
  // teleported into a wall.
  bot.position.set(player.position.x + offset, player.position.y);
  bot.destination.set(bot.position.x, bot.position.y);
  bot.stats.mana.baseValue = bot.stats.maxMana.value;

  const luxR = bot.spells.find(spell => spell?.constructor?.name === 'Lux_R');
  if (!luxR) return { ok: false, reason: 'the Lux bot has no Lux_R in its kit' };

  // Counters for the two halves of the property.
  const counters = { prepare: 0, release: 0, casterDraws: 0 };
  const { default: LuxBeamEffect } = await import('/src/game/vfx/LuxBeamEffect.ts');
  const beamDraw = LuxBeamEffect.prototype.draw;
  LuxBeamEffect.prototype.draw = function () {
    counters[this.phase] = (counters[this.phase] ?? 0) + 1;
    return beamDraw.call(this);
  };
  const casterDraw = bot.draw.bind(bot);
  bot.draw = function () {
    counters.casterDraws += 1;
    return casterDraw();
  };

  window.__probe = { game, player, bot, luxR, counters, willDrawSamples: [] };
  return { ok: true, botName: bot.name ?? null };
}, LUX_OFFSET_PX);

check('a Lux bot is standing in the arena', staged.ok, staged.reason ?? `name=${staged.botName}`);

if (staged.ok) {
  // Let the camera settle on the player and the fog recompute at the new positions.
  await page.waitForTimeout(1_200);

  const before = await page.evaluate(() => {
    const { game, player, bot, counters } = window.__probe;
    const box = game.camera.getBoundingBox();
    const inCamera = game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      area: game.camera.getBoundingBox(),
    });
    return {
      counters: { ...counters },
      health: player.stats.health.value,
      distance: Math.hypot(bot.position.x - player.position.x, bot.position.y - player.position.y),
      playerVisionRadius: player.stats.visionRadius.value,
      casterInCameraBox: inCamera.includes(bot),
      cameraBox: { w: Math.round(box.w), h: Math.round(box.h) },
    };
  });

  // Nothing else in the arena paints a beam, so a nonzero count later can only
  // have come from the cast — a counter wired to something that ticks anyway
  // would pass the draw checks for free.
  check(
    'no beam is drawn before the cast',
    before.counters.prepare === 0 && before.counters.release === 0,
    JSON.stringify(before.counters)
  );
  check(
    'Lux is outside the camera box and the player’s vision',
    !before.casterInCameraBox && before.distance > before.playerVisionRadius,
    `distance=${Math.round(before.distance)} vision=${before.playerVisionRadius} ` +
      `camera=${before.cameraBox.w}x${before.cameraBox.h} inCamera=${before.casterInCameraBox}`
  );

  // Aimed at the player's live position rather than down a fixed axis. Both
  // champions drift a little between staging and here — a standing order, a
  // separation push — and an aim that assumed the axis still lined up put the
  // beam 250px off the player on one run, which fails the wrong check.
  await page.evaluate(offset => {
    const { luxR, bot, player, counters } = window.__probe;
    // Zeroed here rather than at staging, so every count below belongs to this
    // cast. The camera and the fog are still settling during the wait above,
    // and a single frame in which the caster slipped through would otherwise
    // be charged against a claim about the cast.
    counters.prepare = 0;
    counters.release = 0;
    counters.casterDraws = 0;
    player.stopMovement?.();
    player.destination.set(player.position.x, player.position.y);
    bot.position.set(player.position.x + offset, player.position.y);
    bot.destination.set(bot.position.x, bot.position.y);

    const dx = player.position.x - bot.position.x;
    const dy = player.position.y - bot.position.y;
    const length = Math.hypot(dx, dy);
    const accepted = luxR.press(
      Object.freeze({
        spellId: luxR.id,
        activationId: 'beam-visibility',
        startedAtMs: Date.now(),
        caster: bot,
        origin: Object.freeze({ x: bot.position.x, y: bot.position.y }),
        cursorWorld: Object.freeze({ x: player.position.x, y: player.position.y }),
        direction: Object.freeze({ x: dx / length, y: dy / length }),
      })
    );
    window.__probe.accepted = accepted;
    // Held still for the whole cast, so the beam it walks into is the beam it
    // was aimed at and the hit is not a coincidence of drift.
    window.__probe.pin = setInterval(() => {
      player.destination.set(player.position.x, player.position.y);
    }, 50);
    window.__probe.sampler = setInterval(() => {
      window.__probe.willDrawSamples.push(bot.willDraw);
    }, 60);
  }, LUX_OFFSET_PX);

  // Mid-cast: the wind-up lane should be on screen right now.
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${OUT}-1-midcast.png` });
  const midcast = await page.evaluate(() => ({ ...window.__probe.counters }));

  // Past the release flash.
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}-2-release.png` });

  const after = await page.evaluate(() => {
    const { player, bot, luxR, counters, willDrawSamples, accepted } = window.__probe;
    clearInterval(window.__probe.sampler);
    clearInterval(window.__probe.pin);
    const geometry = luxR.geometry;
    const distanceToBeam = (() => {
      if (!geometry) return null;
      const dx = geometry.end.x - geometry.start.x;
      const dy = geometry.end.y - geometry.start.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((player.position.x - geometry.start.x) * dx +
                  (player.position.y - geometry.start.y) * dy) /
                  lengthSquared
              )
            );
      return Math.hypot(
        player.position.x - (geometry.start.x + dx * t),
        player.position.y - (geometry.start.y + dy * t)
      );
    })();
    return {
      accepted,
      counters: { ...counters },
      health: player.stats.health.value,
      willDrawSeen: [...new Set(willDrawSamples)],
      sampleCount: willDrawSamples.length,
      distanceToBeam,
      tolerance: geometry ? geometry.width / 2 + player.collisionRadius : null,
      reveals: player.buffs
        .filter(buff => buff.constructor?.name === 'TrueSight')
        .map(buff => ({ imageKey: buff.image?.key ?? null, fromLux: buff.sourceUnit === bot })),
    };
  });

  check('the cast was accepted', after.accepted === true, `accepted=${after.accepted}`);
  check(
    'the beam really was aimed through the player',
    after.distanceToBeam !== null && after.distanceToBeam <= after.tolerance,
    `distanceToBeam=${Math.round(after.distanceToBeam ?? -1)} tolerance=${after.tolerance}`
  );

  // Half one: the caster is genuinely unrendered, so `Champion.draw()` — and
  // with it `spell.drawVfx()` — never ran.
  check(
    'the caster was unrendered for the whole cast (willDraw false, Champion.draw at zero)',
    after.sampleCount > 0 &&
      after.willDrawSeen.every(seen => seen === false) &&
      after.counters.casterDraws === 0,
    `willDrawSeen=${JSON.stringify(after.willDrawSeen)} samples=${after.sampleCount} ` +
      `casterDraws=${after.counters.casterDraws}`
  );

  // Half two: the beam was painted anyway, in both phases.
  check(
    'the wind-up lane was drawn while the caster was unrendered',
    midcast.prepare > 0,
    `prepareDraws=${midcast.prepare}`
  );
  check(
    'the release flash was drawn while the caster was unrendered',
    after.counters.release > 0,
    `releaseDraws=${after.counters.release}`
  );

  // And the cast was a real one, not a beam that had quietly stopped working.
  check(
    'the player took the hit',
    after.health < before.health,
    `${before.health} -> ${after.health}`
  );
  check(
    'the player wears Lux R’s reveal',
    after.reveals.some(reveal => reveal.imageKey === 'spell_lux_r' && reveal.fromLux),
    JSON.stringify(after.reveals)
  );
}

check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
await server.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
