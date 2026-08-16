/**
 * Stable worst-case mobile render benchmark.
 *
 * Boots touch mode at minimum zoom, fills the camera with the maximum live
 * champion roster, reveals every minimap blip, and reports both frame-time
 * percentiles and the inclusive time of each top-level game pass.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = process.env.LOL2D_PORT ?? String(5_800 + Math.floor(Math.random() * 200));
const URL = process.env.LOL2D_URL ?? `http://localhost:${PORT}/?touch=1&zoom=0.6`;
const OWN_SERVER = !process.env.LOL2D_URL;
const ACTIVE_AI = process.env.LOL2D_ACTIVE_AI === '1';
const CPU_THROTTLE = Number(process.env.LOL2D_CPU_THROTTLE ?? 4);

let server;
let serverLog = '';
if (OWN_SERVER) {
  server = spawn('npx', ['vite', '--port', PORT, '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => (serverLog += data));
  server.stderr.on('data', data => (serverLog += data));
}

const shutdown = async browser => {
  await browser?.close();
  server?.kill('SIGTERM');
};
process.on('exit', () => server?.kill('SIGTERM'));

{
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new global.URL('src/game/Game.ts', URL));
      if (response.ok && !(await response.text()).includes('<!DOCTYPE html>')) {
        ready = true;
        break;
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) {
    await shutdown();
    throw new Error(`Vite did not start at ${URL}\n${serverLog}`);
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', {
  rate: CPU_THROTTLE,
});

const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.director, null, {
  timeout: 30_000,
});

const setup = await page.evaluate(async ({ activeAi, cpuThrottle }) => {
  const game = window.__lol2d.scene.oScene.game;
  const { AI_COUNT_MAX, DEFAULT_CHAMPION_LOADOUT } = await import(
    '/src/game/config/PregameConfig.ts'
  );
  const { default: ParticleSystem } = await import(
    '/src/game/gameObject/helpers/ParticleSystem.ts'
  );

  game.director.jungleEnabled = false;
  game.director.minionsEnabled = false;
  while (game.director.bots().length < AI_COUNT_MAX) {
    const bot = game.director.addBot(DEFAULT_CHAMPION_LOADOUT);
    if (!bot) break;
  }
  game.paused = false;
  game.director.revealMap = true;
  game.camera.target = null;
  game.camera.position.set(game.mapSize / 2, game.mapSize / 2);
  game.camera.scale = 0.3;
  game.camera.currentScale = 0.3;

  const champions = game.director.roster().map(entry => entry.unit);
  champions.forEach((unit, index) => {
    const angle = (index / champions.length) * Math.PI * 2;
    const radius = index === 0 ? 0 : 340;
    unit.position.set(
      game.mapSize / 2 + Math.cos(angle) * radius,
      game.mapSize / 2 + Math.sin(angle) * radius
    );
    unit.destination.set(unit.position.x, unit.position.y);
    unit.alwaysVisible = true;
    unit._autoMove = activeAi && index > 0;
    unit._autoAttack = activeAi && index > 0;
    unit._autoCast = activeAi && index > 0;
  });

  for (let systemIndex = 0; systemIndex < 4; systemIndex++) {
    const particles = new ParticleSystem({
      owner: game.player,
      autoRemoveIfEmpty: false,
      isDeadFn: () => false,
      getParticlePosFn: particle => particle,
      getParticleSizeFn: particle => particle.size,
      preDrawFn: () => {
        noStroke();
        fill(120, 190, 255, 150);
      },
      drawFn: particle => circle(particle.x, particle.y, particle.size),
    });
    particles.particles = Array.from({ length: 250 }, (_, index) => ({
      x: game.mapSize / 2 + ((index * 37 + systemIndex * 61) % 700) - 350,
      y: game.mapSize / 2 + ((index * 53 + systemIndex * 43) % 700) - 350,
      size: 8 + (index % 5),
    }));
    game.objectManager.addObject(particles);
  }

  return {
    champions: champions.length,
    objects: game.objectManager.objects.length + game.objectManager._objectToBeAdd.length,
    scale: game.camera.currentScale,
    activeAi,
    cpuThrottle,
  };
}, { activeAi: ACTIVE_AI, cpuThrottle: CPU_THROTTLE });

await page.waitForTimeout(2_000);
await page.screenshot({
  path: process.env.LOL2D_RENDER_SHOT ?? '/tmp/lol2d-mobile-render.png',
});

const result = await page.evaluate(async () => {
  const game = window.__lol2d.scene.oScene.game;
  const { default: AttackableUnit } = await import(
    '/src/game/gameObject/attackableUnits/AttackableUnit.ts'
  );
  const { default: Champion } = await import(
    '/src/game/gameObject/attackableUnits/Champion.ts'
  );
  const { default: AIChampion } = await import(
    '/src/game/gameObject/attackableUnits/AIChampion.ts'
  );
  const { default: ParticleSystem } = await import(
    '/src/game/gameObject/helpers/ParticleSystem.ts'
  );
  const { default: TrailSystem } = await import(
    '/src/game/gameObject/helpers/TrailSystem.ts'
  );
  const timings = {};
  const wrap = (owner, key, label) => {
    const original = owner[key];
    timings[label] = { calls: 0, total: 0, max: 0 };
    owner[key] = function (...args) {
      const started = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const elapsed = performance.now() - started;
        const entry = timings[label];
        entry.calls++;
        entry.total += elapsed;
        entry.max = Math.max(entry.max, elapsed);
      }
    };
  };

  wrap(game, 'fixedUpdate', 'update');
  wrap(game.navigation, 'update', 'navigationUpdate');
  wrap(game.objectManager, 'update', 'objectUpdate');
  wrap(game.objectManager.unitCollision, 'resolve', 'collisionUpdate');
  wrap(game.terrainMap, 'update', 'terrainUpdate');
  wrap(game.terrainMap, 'draw', 'terrain');
  wrap(game.objectManager, 'draw', 'objects');
  wrap(game.fogOfWar, 'draw', 'fog');
  wrap(game.fogOfWar, 'drawVisions', 'fogDrawVisions');
  wrap(game.fogOfWar, 'calculateSight', 'fogCalculateSight');
  wrap(game.fogOfWar, 'calculateSightForObject', 'fogSightForObject');
  wrap(game.fogOfWar, 'getSightPoly', 'fogGetSightPoly');
  wrap(game.fogOfWar, 'computeSightPoly', 'fogComputeSightPoly');
  wrap(game.fogOfWar, 'buildSegments', 'fogBuildSegments');
  wrap(game.fogOfWar, 'prepareRadialGradient', 'fogPrepareGradient');
  wrap(game.minimap, 'draw', 'minimap');
  wrap(game.touchControls, 'draw', 'touch');
  wrap(AttackableUnit.prototype, 'drawAvatar', 'unitAvatar');
  wrap(AttackableUnit.prototype, 'drawDir', 'unitDirection');
  wrap(AttackableUnit.prototype, 'drawBuffs', 'unitBuffs');
  wrap(AttackableUnit.prototype, 'drawHealthBar', 'unitHealth');
  wrap(Champion.prototype, 'drawHealthBar', 'championHealth');
  wrap(Champion.prototype, 'drawAttackOrder', 'championAttackOrder');
  wrap(AIChampion.prototype, 'update', 'aiUpdate');
  wrap(ParticleSystem.prototype, 'draw', 'particles');
  wrap(TrailSystem.prototype, 'draw', 'trails');

  const frameTimes = [];
  let previous = performance.now();
  const deadline = previous + 6_000;
  await new Promise(resolve => {
    const sample = now => {
      frameTimes.push(now - previous);
      previous = now;
      if (now >= deadline) resolve();
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  frameTimes.sort((a, b) => a - b);
  const percentile = ratio => frameTimes[Math.floor((frameTimes.length - 1) * ratio)];
  const pass = Object.fromEntries(
    Object.entries(timings).map(([key, value]) => [
      key,
      {
        calls: value.calls,
        avgCallMs: Number((value.total / Math.max(1, value.calls)).toFixed(3)),
        avgFrameMs: Number((value.total / frameTimes.length).toFixed(2)),
        maxMs: Number(value.max.toFixed(2)),
      },
    ])
  );

  return {
    frames: frameTimes.length,
    frameMs: {
      p50: Number(percentile(0.5).toFixed(2)),
      p95: Number(percentile(0.95).toFixed(2)),
      p99: Number(percentile(0.99).toFixed(2)),
      max: Number(frameTimes.at(-1).toFixed(2)),
    },
    fps: Number((1_000 / percentile(0.5)).toFixed(1)),
    pass,
    drawables: game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      area: game.camera.getBoundingBox(),
    }).length,
    blips: game.minimap.host.blips().length,
  };
});

console.log(JSON.stringify({ setup, result, errors }, null, 2));
await shutdown(browser);
if (errors.length) process.exitCode = 1;
