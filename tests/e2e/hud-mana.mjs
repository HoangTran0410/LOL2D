/**
 * Screenshots the spell bar so the mana-cost badges can be eyeballed.
 *
 * The HUD is a Vue app with no unit tests, and a test that asserts a number
 * reached a data object proves nothing about whether the badge is legible or
 * whether it collides with the hotkey and stack badges sharing the same icon.
 *
 *   npx vite --port 5211 --strictPort   # in another terminal
 *   node tests/e2e/hud-mana.mjs /tmp/hud
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/hud';
const URL = process.env.LOL2D_URL ?? 'http://localhost:5211/';

const browser = await chromium.launch({ channel: 'chrome' });
// The bar is ~40px tall; 3x makes the badges big enough to judge collisions.
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 3,
});
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
  timeout: 30_000,
});
await page.waitForTimeout(1_500);

// A stacking spell in slot 1 and a costly one in slot 2, so one icon carries the
// stack badge and the mana badge at once — that is where they would collide.
await page.evaluate(async () => {
  // Every pack spell's default export is a factory now (batch 4 task 3),
  // resolved against the cached ContentApi singleton spellRegistry.ts itself
  // builds against.
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const spells = await import('/packs/riot/spells/index.ts');
  const game = window.__lol2d.scene.oScene.game;
  game.player.replaceSpell(1, new (spells.Nasus_Q(api))(game.player));
  game.player.replaceSpell(2, new (spells.Ashe_R(api))(game.player));
  game.player.replaceSpell(3, new (spells.Varus_Q(api))(game.player));
});
await page.waitForTimeout(600);

const bar = page.locator('.champion-details .spells');
await bar.screenshot({ path: `${OUT}-affordable.png` });

// Tooltip: mana cost sits next to the cooldown in the header.
await page.locator('.champion-details .spells .spell').nth(3).hover();
await page.waitForTimeout(400);
await page.locator('.spell-info').screenshot({ path: `${OUT}-tooltip.png` });

// Empty the pool: every costed icon should grey out and flip its badge to red.
await page.evaluate(() => {
  window.__lol2d.scene.oScene.game.player.stats.mana.baseValue = 5;
});
await page.waitForTimeout(400);
await bar.screenshot({ path: `${OUT}-broke.png` });

const badges = await page.evaluate(() =>
  [...document.querySelectorAll('.champion-details .spells .spell')].map(spell => ({
    hotKey: spell.querySelector('.hotKey')?.textContent ?? null,
    mana: spell.querySelector('.mana-cost')?.textContent ?? null,
    short: Boolean(spell.querySelector('.mana-cost.short')),
    greyed: (spell.querySelector('img')?.getAttribute('style') ?? '').includes('grayscale'),
  }))
);

console.log(JSON.stringify({ badges, errors }, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
