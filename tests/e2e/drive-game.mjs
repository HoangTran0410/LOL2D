/**
 * End-to-end smoke drive of the real game in Chrome.
 *
 * Unit tests stub every p5 drawing global, so they can prove which primitives a
 * spell asks for but never that the game actually boots and paints. This script
 * drives the live app instead: it starts the game, parks the projectiles that
 * have hand-drawn visuals in front of the camera, then watches a real minion
 * wave leave its base, walk its lane, meet the other side and get shot by a
 * turret — and screenshots the result.
 *
 *   npm run e2e                 # boots its own dev server
 *   npm run e2e -- /tmp/lol2d   # and writes screenshots under that prefix
 *
 * Set LOL2D_URL to point at a server you already have running instead.
 * Requires a system Chrome install.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d';
// A random high port by default. A fixed one collides with whatever dev server
// is already up, and with --strictPort that either kills this run or — worse —
// silently drives someone else's checkout.
const PORT = process.env.LOL2D_PORT ?? String(5_200 + Math.floor(Math.random() * 600));
const URL = process.env.LOL2D_URL ?? `http://localhost:${PORT}/`;
const OWN_SERVER = !process.env.LOL2D_URL;
// requested through the DEV-only window.__lol2d handle later; fetched up front
// as the proof that the server on this port is serving THIS checkout
const CANARY = 'src/game/gameObject/attackableUnits/Minion.ts';

// ---------------------------------------------------------------- dev server

let server;
let serverLog = '';
if (OWN_SERVER) {
  server = spawn('npx', ['vite', '--port', PORT, '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => (serverLog += data));
  server.stderr.on('data', data => (serverLog += data));
  server.on('exit', code => {
    if (code) serverLog += `\nvite exited with ${code}`;
  });
}

const shutdown = async browser => {
  await browser?.close();
  server?.kill('SIGTERM');
};

// A dev server left running past a failed run holds its port, and the next run
// then drives whatever that stale server is serving.
process.on('exit', () => server?.kill('SIGTERM'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server?.kill('SIGTERM');
    process.exit(1);
  });
}

// Poll for a module this checkout has and an older one does not, rather than
// trusting the banner: vite answers unknown paths with the index.html fallback,
// so a wrong-root server looks healthy right up until an import returns HTML.
{
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new global.URL(CANARY, URL));
      const body = await response.text();
      if (response.ok && !body.includes('<!DOCTYPE html>')) {
        ready = true;
        break;
      }
    } catch {
      // server not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) {
    await shutdown();
    throw new Error(
      `No dev server serving this checkout at ${URL} (looked for ${CANARY}).\n${serverLog}`
    );
  }
}

// ---------------------------------------------------------------- boot

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
// stamped as early as possible so the wave clock can be measured against it
await page.evaluate(() => (window.__gameBootedAt = performance.now()));
await page.waitForTimeout(1_500);

// Park a fully charged Varus arrow and a thrown Pantheon spear beside the
// player: frozen in place they stay in frame, so the screenshot shows the
// projectile art rather than a blur leaving the screen.
const spawned = await page.evaluate(async () => {
  // Every pack spell's named siblings are factories now (batch 4 task 3) —
  // resolved against the same cached ContentApi singleton spellRegistry.ts
  // itself builds against, so identity matches whatever the live game
  // already resolved.
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const varus = await import('/packs/riot/spells/Varus_Q.ts');
  const pantheon = await import('/packs/riot/spells/Pantheon_Q.ts');
  const Varus_Q_Arrow = varus.makeVarus_Q_Arrow(api);
  const Pantheon_Q_Spear = pantheon.makePantheon_Q_Spear(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player ?? game.champion ?? game.objectManager.objects.find(o => o.spells);

  const park = (object, offsetY) => {
    object.position = window.createVector(champion.position.x + 110, champion.position.y + offsetY);
    object.destination = window.createVector(champion.position.x + 520, champion.position.y + offsetY);
    object.speed = 0; // freeze mid-flight
    object.maxHitCount = 0; // never collide, never self-remove
    game.objectManager.addObject(object);
    return object.constructor.name;
  };

  const arrow = new Varus_Q_Arrow(champion);
  arrow.chargeRatio = 1;
  const spear = new Pantheon_Q_Spear(champion);
  return [park(arrow, -80), park(spear, 40)];
});

await page.waitForTimeout(1_200);
await page.screenshot({ path: `${OUT}-game.png` });

// Zoom in so the avatar edge and the projectile silhouettes are legible.
await page.evaluate(() => {
  const camera = window.__lol2d.scene.oScene.game.camera;
  camera.scale = 2.4;
  camera.currentScale = 2.4;
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}-zoom.png` });

// ---------------------------------------------------------------- minions

/**
 * Everything below watches lane minions. The probe runs inside the page on
 * requestAnimationFrame so it samples the same frames the game draws, and it
 * reuses the terrain quadtree for the wall test rather than scanning all 329
 * polygons per minion per frame.
 */
await page.evaluate(async () => {
  const MinionModule = await import('/src/game/gameObject/attackableUnits/Minion.ts');
  const Minion = MinionModule.default;
  const game = window.__lol2d.scene.oScene.game;

  game.fogOfWar.outOfViewColor = '#0003';

  const probe = {
    // Observation aid, not gameplay: fog of war clears visibleToPlayerTeam on every unit
    // outside the player's sight, so any lane but the one the player is standing
    // in screenshots black. `alwaysVisible` is a per-instance field, so this has
    // to be re-applied to each minion rather than set on the prototype once.
    // Turned back off before the frame rate is measured.
    revealMinions: true,
    frames: 0,
    deaths: 0,
    maxAlive: 0,
    wallHits: [],
    // per lane: how far a minion got from its own fountain, and how close the
    // two teams came to each other
    lanes: {},
    fightSamples: 0,
    minionVsMinionSamples: 0,
    turretTargetingMinion: 0,
    boltsHomingMinion: 0,
    maxWaypointIndex: {},
  };
  window.__minionProbe = probe;

  const die = Minion.prototype.die;
  Minion.prototype.die = function (deathData) {
    probe.deaths += 1;
    return die.call(this, deathData);
  };

  const pointInPolygon = (px, py, verts) => {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const { x: xi, y: yi } = verts[i];
      const { x: xj, y: yj } = verts[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  const fountainOf = teamId => game.fountains.find(f => f.teamId === teamId);

  const tick = () => {
    const minions = game.minionSpawner?.minions ?? [];
    probe.frames += 1;
    probe.maxAlive = Math.max(probe.maxAlive, minions.length);

    for (const minion of minions) {
      minion.alwaysVisible = probe.revealMinions;
      const lane = minion.lane;
      const key = `${lane}:${minion.teamId}`;
      probe.maxWaypointIndex[key] = Math.max(probe.maxWaypointIndex[key] ?? 0, minion.waypointIndex);

      const fountain = fountainOf(minion.teamId);
      if (fountain) {
        const away = Math.hypot(
          minion.position.x - fountain.position.x,
          minion.position.y - fountain.position.y
        );
        const row = (probe.lanes[lane] ??= { maxFromBase: 0, closestTeams: Infinity, fightAt: null });
        row.maxFromBase = Math.max(row.maxFromBase, Math.round(away));
      }

      // wall test, using the terrain quadtree the game already maintains
      const near = game.terrainMap.getObstaclesInArea(minion.getCollideBoundingBox(), ['wall']);
      for (const wall of near) {
        if (pointInPolygon(minion.position.x, minion.position.y, wall.vertices)) {
          if (probe.wallHits.length < 40) {
            probe.wallHits.push({
              lane,
              team: minion.teamId,
              x: Math.round(minion.position.x),
              y: Math.round(minion.position.y),
            });
          }
          break;
        }
      }

      const target = minion.targetLock;
      if (target && minion.phase === 'ATTACK') {
        probe.fightSamples += 1;
        if (target.unitType === 'minion') {
          probe.minionVsMinionSamples += 1;
          const row = (probe.lanes[lane] ??= { maxFromBase: 0, closestTeams: Infinity, fightAt: null });
          const d = Math.hypot(
            minion.position.x - target.position.x,
            minion.position.y - target.position.y
          );
          if (d < row.closestTeams) {
            row.closestTeams = Math.round(d);
            row.fightAt = { x: Math.round(minion.position.x), y: Math.round(minion.position.y) };
          }
        }
      }
    }

    for (const turret of game.turrets) {
      if (turret.target?.unitType === 'minion') probe.turretTargetingMinion += 1;
    }
    for (const object of game.objectManager.objects) {
      if (object.constructor.name === 'TurretBolt' && object.target?.unitType === 'minion') {
        probe.boltsHomingMinion += 1;
      }
    }

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// The first wave leaves on its own clock, so wait it out rather than forcing it:
// this is the check that the game spawns waves without being poked.
const firstWave = await page.evaluate(async () => {
  const game = window.__lol2d.scene.oScene.game;
  const spawner = game.minionSpawner;
  const spawnerModule = await import('/src/game/managers/MinionSpawner.ts');

  await new Promise(resolve => {
    const check = () => (spawner.minions.length > 0 ? resolve() : setTimeout(check, 100));
    check();
  });

  return {
    // measured from the frame the game became reachable, not from here: the
    // projectile screenshots above already burned a few seconds of wave clock
    firstWaveAfterMs: Math.round(performance.now() - window.__gameBootedAt),
    declaredDelayMs: spawnerModule.FIRST_WAVE_DELAY_MS,
    waveIntervalMs: spawnerModule.WAVE_INTERVAL_MS,
    liveCap: spawnerModule.MINION_LIVE_CAP,
    composition: spawnerModule.WAVE_COMPOSITION,
    startedAt: spawner.minions.map(m => ({
      lane: m.lane,
      team: m.teamId,
      kind: m.kind,
      x: Math.round(m.position.x),
      y: Math.round(m.position.y),
    })),
  };
});

// Fast-forward the walk. Speed only scales how quickly a minion covers the same
// waypoint segments, so the path — and therefore the wall clearance the probe
// checks — is exactly the one it walks at normal speed.
const FAST = 12;
await page.evaluate(async fast => {
  const MinionModule = await import('/src/game/gameObject/attackableUnits/Minion.ts');
  const game = window.__lol2d.scene.oScene.game;
  for (const preset of Object.values(MinionModule.MinionPresets)) preset.speed = fast;
  for (const minion of game.minionSpawner.minions) minion.stats.speed.baseValue = fast;
  game.camera.target = null;
  game.camera.scale = 0.5;
}, FAST);

await page.waitForTimeout(6_000);

// Screenshot each lane on the wave that is actually walking it, rather than at
// a guessed map coordinate.
const laneShots = {};
for (const lane of ['top', 'mid', 'bot']) {
  const at = await page.evaluate(laneName => {
    const game = window.__lol2d.scene.oScene.game;
    const inLane = game.minionSpawner.minions.filter(m => m.lane === laneName);
    if (inLane.length === 0) return null;
    // the front of the blue wave: furthest along its waypoint list
    const front = inLane
      .filter(m => m.teamId === 'team-blue')
      .sort((a, b) => b.waypointIndex - a.waypointIndex)[0] ?? inLane[0];

    game.camera.target = null;
    game.camera.position.set(front.position.x, front.position.y);
    game.camera.scale = 1;
    game.camera.currentScale = 1;
    return {
      x: Math.round(front.position.x),
      y: Math.round(front.position.y),
      waypointIndex: front.waypointIndex,
      inLane: inLane.length,
    };
  }, lane);

  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}-lane-${lane}.png` });
  laneShots[lane] = { path: `${OUT}-lane-${lane}.png`, ...at };
}

// Queue extra waves so both sides collide, and keep watching long enough for
// turrets to open up on whatever survives.
await page.evaluate(() => {
  const spawner = window.__lol2d.scene.oScene.game.minionSpawner;
  spawner.queueWave();
});
await page.waitForTimeout(14_000);

// Park on a minion that is mid-fight with another minion, so the clash shot
// shows the two waves trading rather than an empty stretch of lane.
const clashAt = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const fighting = game.minionSpawner.minions.filter(
    m => m.phase === 'ATTACK' && m.targetLock?.unitType === 'minion'
  );
  const focus = fighting[0] ?? game.minionSpawner.minions[0];
  if (!focus) return null;
  game.camera.target = null;
  game.camera.position.set(focus.position.x, focus.position.y);
  game.camera.scale = 1.4;
  game.camera.currentScale = 1.4;
  return { lane: focus.lane, x: Math.round(focus.position.x), y: Math.round(focus.position.y), fighting: fighting.length };
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}-lane-clash.png` });

// And on a turret that is shooting a minion, which is the other half of what a
// lane is supposed to look like.
const turretAt = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const shooting = game.turrets.filter(t => t.target?.unitType === 'minion');
  if (shooting.length === 0) return null;
  const turret = shooting[0];
  game.camera.position.set(turret.position.x, turret.position.y);
  game.camera.scale = 1.4;
  game.camera.currentScale = 1.4;
  return {
    team: turret.teamId,
    targetTeam: turret.target.teamId,
    x: Math.round(turret.position.x),
    y: Math.round(turret.position.y),
    shootingMinions: shooting.length,
  };
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}-turret-vs-minions.png` });

const observed = await page.evaluate(() => {
  const probe = window.__minionProbe;
  return {
    ...probe,
    lanes: Object.fromEntries(
      Object.entries(probe.lanes).map(([lane, row]) => [
        lane,
        { ...row, closestTeams: row.closestTeams === Infinity ? null : row.closestTeams },
      ])
    ),
  };
});

// ---------------------------------------------------------------- frame rate

// Back to real speed and real fog, then fill the board and measure. Waves are
// queued directly rather than waited for: this is the frame budget question,
// not the cadence one, which the probe above already answered.
const frameRate = await page.evaluate(async () => {
  const MinionModule = await import('/src/game/gameObject/attackableUnits/Minion.ts');
  const game = window.__lol2d.scene.oScene.game;

  window.__minionProbe.revealMinions = false;
  game.fogOfWar.outOfViewColor = '#0007';
  MinionModule.MinionPresets.melee.speed = 2.6;
  MinionModule.MinionPresets.ranged.speed = 2.6;
  MinionModule.MinionPresets.cannon.speed = 2.6;

  const spawner = game.minionSpawner;
  for (let i = 0; i < 6; i++) spawner.queueWave();

  const sample = async (label, seconds) => {
    const rates = [];
    await new Promise(resolve => {
      const started = performance.now();
      const collect = () => {
        rates.push(window.frameRate());
        if (performance.now() - started > seconds * 1_000) resolve();
        else requestAnimationFrame(collect);
      };
      requestAnimationFrame(collect);
    });
    rates.sort((a, b) => a - b);
    return {
      label,
      alive: spawner.minions.length,
      objects: game.objectManager.objects.length,
      min: Math.round(rates[0]),
      median: Math.round(rates[Math.floor(rates.length / 2)]),
      max: Math.round(rates[rates.length - 1]),
    };
  };

  // let the queue drain into the world first
  await new Promise(resolve => setTimeout(resolve, 4_000));

  game.camera.target = null;
  game.camera.position.set(3_200, 3_200);
  game.camera.scale = 0.5;
  const zoomedOut = await sample('camera parked at mid, zoomed out', 4);

  game.camera.target = game.player.position;
  game.camera.scale = 1;
  const followingPlayer = await sample('camera following the player', 4);

  return { zoomedOut, followingPlayer };
});

await page.screenshot({ path: `${OUT}-full-board.png` });

console.log(
  JSON.stringify(
    { spawned, laneShots, clashAt, turretAt, firstWave, observed, frameRate, errors },
    null,
    2
  )
);
await shutdown(browser);
if (errors.length) process.exitCode = 1;
