/**
 * End-to-end visual proof that a spell effect riding on a champion's body dies
 * with the body, driving the real game through the DEV-only `window.__lol2d`
 * handle the same way drive-game.mjs does.
 *
 * Ahri W is the worst offender of the class: three fox-fires orbit her for five
 * seconds, reading `owner.position` every frame, and before the fix they kept
 * circling her corpse — still hunting and slowing whatever walked past — and
 * would have followed her to the respawn point.
 *
 * A parked Varus arrow rides along as the control: a projectile already in
 * flight is cast into the world, not attached to a body, and must still be
 * there after its caster dies.
 *
 *   npx vite --port 5199 --strictPort   # in another terminal
 *   node tests/e2e/drive-attached-effects.mjs /tmp/lol2d-attached
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-attached';
const URL = process.env.LOL2D_URL ?? 'http://localhost:5199/';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(
  () => window.__lol2d?.scene?.oScene?.game?.objectManager,
  null,
  { timeout: 30_000 }
);
await page.waitForTimeout(1_500);

await page.evaluate(() => {
  const camera = window.__lol2d.scene.oScene.game.camera;
  camera.scale = 2.2;
  camera.currentScale = 2.2;
});

const cast = await page.evaluate(async () => {
  // Every pack spell's default export is now a factory (batch 4 task 3),
  // `buildContentApi()` is a cached process-wide singleton, and every
  // factory is memoized per api — so building against the same singleton
  // spellRegistry.ts uses is what keeps `instanceof Ahri_W_Object` true
  // across separate page.evaluate() calls below.
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { default: makeAhri_W } = await import('/packs/riot/spells/Ahri_W.ts');
  const { makeVarus_Q_Arrow } = await import('/packs/riot/spells/Varus_Q.ts');
  const Ahri_W = makeAhri_W(api);
  const Varus_Q_Arrow = makeVarus_Q_Arrow(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  champion.stats.mana.baseValue = champion.stats.maxMana.value;

  // Clear the neighbourhood first: a fox-fire that finds an enemy stops
  // orbiting and dives at it, which would end its life for an honest reason
  // and hide whether death ends it. Filter on addBuff/teleportTo so only real
  // units move — every GameObject gets a random teamId, so a teamId check also
  // catches the fountains, and relocating those corrupts every later spawn.
  for (const o of game.objectManager.objects) {
    if (o !== champion && typeof o.addBuff === 'function' && typeof o.teleportTo === 'function') {
      o.teleportTo(-10_000, -10_000);
    }
  }

  // the control: a projectile frozen mid-flight beside her
  const arrow = new Varus_Q_Arrow(champion);
  arrow.chargeRatio = 1;
  arrow.position = window.createVector(champion.position.x + 120, champion.position.y - 90);
  arrow.destination = window.createVector(champion.position.x + 520, champion.position.y - 90);
  arrow.speed = 0;
  arrow.maxHitCount = 0;
  game.objectManager.addObject(arrow);

  const spell = new Ahri_W(champion);
  spell.press(Object.freeze({
    spellId: 'e2e-ahri-w',
    activationId: 'e2e',
    startedAtMs: Date.now(),
    caster: champion,
    origin: Object.freeze({ x: champion.position.x, y: champion.position.y }),
    cursorWorld: Object.freeze({ x: champion.position.x + 100, y: champion.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
  }));

  return { castAt: { x: Math.round(champion.position.x), y: Math.round(champion.position.y) } };
});

// AI bots roll their own presets, so every count below is filtered to the
// fox-fires this script spawned on the player rather than the first ones found.
const countOwn = async () => page.evaluate(async () => {
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { makeAhri_W_Object } = await import('/packs/riot/spells/Ahri_W.ts');
  const { makeVarus_Q_Arrow } = await import('/packs/riot/spells/Varus_Q.ts');
  const Ahri_W_Object = makeAhri_W_Object(api);
  const Varus_Q_Arrow = makeVarus_Q_Arrow(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  const own = game.objectManager.objects.filter(
    o => o instanceof Ahri_W_Object && o.owner === champion
  );
  return {
    fires: own.length,
    firePositions: own.map(o => ({ x: Math.round(o.position.x), y: Math.round(o.position.y) })),
    arrows: game.objectManager.objects.filter(
      o => o instanceof Varus_Q_Arrow && o.owner === champion
    ).length,
    championAt: { x: Math.round(champion.position.x), y: Math.round(champion.position.y) },
    isDead: champion.isDead,
  };
});

await page.waitForTimeout(1_200); // let them settle into the orbit
const alive = await countOwn();
await page.screenshot({ path: `${OUT}-1-orbiting.png` });

await page.evaluate(() => {
  const champion = window.__lol2d.scene.oScene.game.player;
  champion.die({ reviveAfter: champion.reviveTime });
});
await page.waitForTimeout(400);
const afterDeath = await countOwn();
await page.screenshot({ path: `${OUT}-2-dead.png` });

// force the respawn instead of waiting out the timer, and drop the corpse
// somewhere else entirely: a fire that survived would light up at the new spot
await page.evaluate(() => {
  const champion = window.__lol2d.scene.oScene.game.player;
  champion.respawn();
  champion.teleportTo(champion.position.x + 700, champion.position.y + 400);
});
await page.waitForTimeout(900);
const afterRespawn = await countOwn();
await page.screenshot({ path: `${OUT}-3-respawned.png` });

const fps = await page.evaluate(() => Math.round(window.frameRate?.() ?? -1));
console.log(JSON.stringify({ cast, alive, afterDeath, afterRespawn, fps, errors }, null, 2));
await browser.close();

const failures = [];
if (alive.fires !== 3) failures.push(`expected 3 orbiting fox-fires, saw ${alive.fires}`);
if (afterDeath.fires !== 0) failures.push(`fox-fires outlived the death: ${afterDeath.fires}`);
if (afterRespawn.fires !== 0) failures.push(`fox-fires came back after respawn: ${afterRespawn.fires}`);
if (afterDeath.arrows !== 1) failures.push('the control arrow was removed by the caster dying');
if (errors.length) failures.push(...errors);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
