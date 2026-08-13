/**
 * End-to-end smoke drive of the real game in Chrome.
 *
 * Unit tests stub every p5 drawing global, so they can prove which primitives a
 * spell asks for but never that the game actually boots and paints. This script
 * drives the live app instead: it starts the game, parks the projectiles that
 * have hand-drawn visuals in front of the camera, and screenshots the result.
 *
 *   npx vite --port 5199 --strictPort   # in another terminal
 *   npm run e2e -- /tmp/lol2d
 *
 * Requires the dev server (it reaches the scene through the DEV-only
 * `window.__lol2d` handle set in src/main.ts) and a system Chrome install.
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d';
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

// Park a fully charged Varus arrow and a thrown Pantheon spear beside the
// player: frozen in place they stay in frame, so the screenshot shows the
// projectile art rather than a blur leaving the screen.
const spawned = await page.evaluate(async () => {
  const varus = await import('/src/game/gameObject/spells/Varus_Q.ts');
  const pantheon = await import('/src/game/gameObject/spells/Pantheon_Q.ts');
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

  const arrow = new varus.Varus_Q_Arrow(champion);
  arrow.chargeRatio = 1;
  const spear = new pantheon.Pantheon_Q_Spear(champion);
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

const fps = await page.evaluate(() => Math.round(window.frameRate?.() ?? -1));
console.log(JSON.stringify({ spawned, fps, errors }, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
