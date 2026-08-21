/**
 * End-to-end visual verification for the Ashe R travel fix and the Twitch Q
 * post-death cloak fix, driving the real game the same way drive-game.mjs
 * does (through the DEV-only `window.__lol2d` handle).
 *
 *   npx vite --port 5199 --strictPort   # in another terminal
 *   node tests/e2e/drive-bugfixes.mjs /tmp/lol2d-bugfixes
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-bugfixes';
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

// --- Bug 1: Ashe R must fire even when the cursor sits exactly on the caster
// (an idle AI's resting aim, or a player who has not moved the mouse), and
// must travel, not sit on the spawn point.
const asheResult = await page.evaluate(async () => {
  // Every pack spell's default and named siblings are factories now (batch 4
  // task 3), resolved against the cached ContentApi singleton spellRegistry.ts
  // itself builds against — RANGE is a plain tuning constant and needs none.
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { default: makeAshe_R, makeAshe_R_Object, RANGE } = await import(
    '/packs/riot/spells/Ashe_R.ts'
  );
  const Ashe_R = makeAshe_R(api);
  const Ashe_R_Object = makeAshe_R_Object(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;

  // Move every other unit far away so the arrow's own collision check cannot
  // explode it on frame one and mask whether it actually travels. Filter to
  // addBuff-bearing AttackableUnits specifically — the naive "has a teamId"
  // check also matches Fountain (every GameObject gets a random teamId by
  // default) and relocating those corrupts every later randomSpawnPoint().
  for (const o of game.objectManager.objects) {
    if (o !== champion && typeof o.addBuff === 'function' && typeof o.teleportTo === 'function') {
      o.teleportTo(-10_000, -10_000);
    }
  }

  const spell = new Ashe_R(champion);
  const cursorWorld = { x: champion.position.x, y: champion.position.y }; // exactly on the caster
  const context = Object.freeze({
    spellId: 'e2e-ashe-r',
    activationId: 'e2e',
    startedAtMs: Date.now(),
    caster: champion,
    origin: Object.freeze({ x: champion.position.x, y: champion.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 0, y: 0 }),
  });

  spell.press(context);

  const arrow = game.objectManager._objectToBeAdd.find(o => o instanceof Ashe_R_Object);
  return {
    spawned: Boolean(arrow),
    direction: arrow ? { x: arrow.direction.x, y: arrow.direction.y } : null,
    startPosition: arrow ? { x: arrow.position.x, y: arrow.position.y } : null,
    range: RANGE,
  };
});

await page.waitForTimeout(1_000); // let several real frames run the arrow forward

const asheAfter = await page.evaluate(async () => {
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { makeAshe_R_Object } = await import('/packs/riot/spells/Ashe_R.ts');
  const Ashe_R_Object = makeAshe_R_Object(api);
  const game = window.__lol2d.scene.oScene.game;
  const arrow = game.objectManager.objects.find(o => o instanceof Ashe_R_Object);
  return arrow
    ? { alive: true, position: { x: arrow.position.x, y: arrow.position.y }, exploding: arrow.exploding }
    : { alive: false };
});

await page.screenshot({ path: `${OUT}-ashe-r.png` });

// --- Bug 3: Twitch Q's stealth VFX must not survive death, and must not
// reappear after respawn somewhere else.
const twitchBefore = await page.evaluate(async () => {
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { default: makeTwitch_Q, makeTwitch_Q_Object } = await import(
    '/packs/riot/spells/Twitch_Q.ts'
  );
  const Twitch_Q = makeTwitch_Q(api);
  const Twitch_Q_Object = makeTwitch_Q_Object(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  champion.stats.mana.baseValue = champion.stats.maxMana.value;

  const spell = new Twitch_Q(champion);
  const context = Object.freeze({
    spellId: 'e2e-twitch-q',
    activationId: 'e2e',
    startedAtMs: Date.now(),
    caster: champion,
    origin: Object.freeze({ x: champion.position.x, y: champion.position.y }),
    cursorWorld: Object.freeze({ x: champion.position.x + 1, y: champion.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });
  spell.press(context);

  return { buffCount: champion.buffs.length, deathSpot: { x: champion.position.x, y: champion.position.y } };
});

await page.waitForTimeout(500); // let the cloak object actually get added and start drawing
await page.screenshot({ path: `${OUT}-twitch-stealthed.png` });

const twitchAfterDeath = await page.evaluate(async () => {
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { makeTwitch_Q_Object } = await import('/packs/riot/spells/Twitch_Q.ts');
  const Twitch_Q_Object = makeTwitch_Q_Object(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  // AI bots auto-cast randomly and may independently roll Twitch's preset, so
  // filter to the cloak this script actually spawned on the player instead of
  // trusting the first Twitch_Q_Object in the world.
  const cloakBefore = game.objectManager.objects.find(
    o => o instanceof Twitch_Q_Object && o.owner === champion
  );
  const cloakedBeforeDeath = cloakBefore ? cloakBefore._cloaked : null;

  champion.die({ reviveAfter: champion.reviveTime });

  const cloakAfterDie = game.objectManager.objects.find(
    o => o instanceof Twitch_Q_Object && o.owner === champion
  );
  return {
    foundOwnCloak: Boolean(cloakBefore),
    cloakedBeforeDeath,
    buffCountAfterDie: champion.buffs.length,
    cloakedImmediatelyAfterDie: cloakAfterDie ? cloakAfterDie._cloaked : null,
  };
});

await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}-twitch-died.png` });

// force an immediate respawn at a different spot, then confirm the cloak does
// not resurrect and does not linger at the death location.
const twitchAfterRespawn = await page.evaluate(async () => {
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { makeTwitch_Q_Object } = await import('/packs/riot/spells/Twitch_Q.ts');
  const Twitch_Q_Object = makeTwitch_Q_Object(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  champion.deathData.reviveAfter = 0;
  return { deathSpot: { x: champion.position.x, y: champion.position.y } };
});

await page.waitForTimeout(1_500); // real frames tick deathData down to 0 and respawn() fires

const finalState = await page.evaluate(async () => {
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { makeTwitch_Q_Object } = await import('/packs/riot/spells/Twitch_Q.ts');
  const Twitch_Q_Object = makeTwitch_Q_Object(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  const cloak = game.objectManager.objects.find(
    o => o instanceof Twitch_Q_Object && o.owner === champion
  );
  return {
    isDead: champion.isDead,
    buffCount: champion.buffs.length,
    buffNames: champion.buffs.map(b => b.constructor.name),
    respawnPosition: { x: champion.position.x, y: champion.position.y },
    cloakStillPresent: Boolean(cloak),
    cloakCloaked: cloak ? cloak._cloaked : null,
  };
});

await page.screenshot({ path: `${OUT}-twitch-respawned.png` });

console.log(
  JSON.stringify(
    { asheResult, asheAfter, twitchBefore, twitchAfterDeath, twitchAfterRespawn, finalState, errors },
    null,
    2
  )
);
await browser.close();
if (errors.length) process.exitCode = 1;
