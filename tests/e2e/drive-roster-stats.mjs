/**
 * The stat sheet on the Đội tab, driven end to end.
 *
 * `participantStats.ts` is unit-tested and `MatchTally` is unit-tested, so what
 * is left is everything Vitest structurally cannot see: whether the numbers
 * reach a real Vue render, whether the strip is a real tap target under a real
 * thumb, and — the part that actually matters — whether the counters move when
 * a *real match* kills something, rather than when a test calls `die()`.
 *
 * So the arrangement here is deliberately not a fixture: the player really
 * shoots a bot to death and really last-hits a minion with the match running,
 * and only then does the panel get opened to read what it says.
 *
 *   node tests/e2e/drive-roster-stats.mjs [outDir]
 *
 * Requires a system Chrome install.
 */
import { mkdirSync } from 'node:fs';
import { CFG_KEY, DESKTOP_VIEWPORT, startHarness } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/lol2d-roster-stats';

mkdirSync(OUT, { recursive: true });

const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Garen',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 1, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
};

const { url, page, errors, check, guard } = await startHarness({
  viewport: DESKTOP_VIEWPORT,
});

/**
 * A real finger, not a synthetic click — see drive-practice-panel.mjs.
 *
 * Its own session per tap, detached after, rather than the harness's long-lived
 * one: this script taps twice in a run and the detach is what proves a stat
 * sheet opened by a finger survives the finger going away.
 */
await guard(async () => {
const session = async () => page.context().newCDPSession(page);
const tapSelector = async selector => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const tapSession = await session();
  const point = { x, y, radiusX: 6, radiusY: 6, force: 1 };
  await tapSession.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point],
  });
  await tapSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tapSession.detach();
  await page.waitForTimeout(150);
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
await page.waitForTimeout(1_500);

// ── Play a little: a champion kill, a last hit and some damage taken ─────────
const fought = await page.evaluate(async () => {
  const game = window.__lol2d.scene.oScene.game;
  const player = game.player;

  const bot = game.director.bots()[0];
  if (!bot) return { error: 'no bot in the match' };
  game.director.setBotBehaviour(bot, { autoMove: false, autoAttack: false, autoCast: false });
  game.objectManager.update();

  // The player kills the bot outright, and takes a little back from it, so both
  // sides of the ledger have something on them.
  bot.position.set(player.position.x + 60, player.position.y);
  bot.destination.set(bot.position.x, bot.position.y);
  bot.stats.health.baseValue = 30;
  bot.takeDamage(40, player);
  player.takeDamage(17, bot);

  // A minion, last-hit: the CS number did not exist before, and nothing in the
  // engine credited a wave kill to anybody.
  const Minion = (await import('/src/game/gameObject/attackableUnits/Minion.ts')).default;
  const minion = new Minion({
    game,
    teamId: 'blue',
    waypoints: [{ x: player.position.x + 120, y: player.position.y }],
  });
  game.objectManager.addObject(minion);
  game.objectManager.update();
  minion.stats.health.baseValue = 5;
  minion.takeDamage(20, player);

  return {
    botDead: bot.isDead,
    minionDead: minion.isDead,
    kills: player.tally.kills,
    deaths: player.tally.deaths,
    cs: player.tally.minionsKilled,
    dealt: player.tally.damageDealt,
    taken: player.tally.damageTaken,
    score: player.score,
  };
});

check(
  'a real match moves the ledger: kill, farm and damage on both sides',
  fought.botDead &&
    fought.minionDead &&
    fought.kills === 1 &&
    fought.cs === 1 &&
    fought.deaths === 0 &&
    fought.dealt === 35 &&
    fought.taken === 17 &&
    fought.score === 1,
  `K${fought.kills} D${fought.deaths} CS${fought.cs} dealt=${fought.dealt} taken=${fought.taken} score=${fought.score}`
);

// ── Open the panel and read what the card says ───────────────────────────────
await page.click('.spell-picker-btn');
await page.waitForSelector('.practice-panel', { state: 'visible', timeout: 5_000 });
await page.click('#practice-tab-roster');
await page.waitForTimeout(200);

const strips = await page.evaluate(() =>
  [...document.querySelectorAll('.practice-stat-toggle')].map(node => ({
    score: node.querySelector('.practice-score')?.textContent?.replace(/\s+/g, '') ?? '',
    expanded: node.getAttribute('aria-expanded'),
  }))
);
check(
  'every roster card carries a K/D/CS strip, collapsed by default',
  strips.length === 2 && strips[0].score === '1/0/1' && strips.every(s => s.expanded === 'false'),
  `cards=${strips.length} player=${strips[0]?.score} bot=${strips[1]?.score}`
);

check(
  'no stat sheet is open before anything is tapped',
  (await page.locator('.practice-stat-sheet').count()) === 0
);

// The strip is the tap target, and it is dispatched as a real touch: the panel
// lives over a canvas that cancels gestures, and every control here has been
// burned by that once already.
await tapSelector('.practice-stat-toggle');

const sheet = await page.evaluate(() => {
  const open = document.querySelectorAll('.practice-stat-sheet');
  if (open.length !== 1) return { count: open.length };
  const rows = {};
  for (const row of open[0].querySelectorAll('.practice-stat-row')) {
    const label = row.querySelector('.practice-stat-label')?.textContent?.trim();
    const value = row.querySelector('.practice-stat-value')?.textContent?.trim();
    if (label) rows[label] = value;
  }
  return {
    count: open.length,
    groups: [...open[0].querySelectorAll('.practice-stat-title')].map(n => n.textContent.trim()),
    rows,
    // the sheet must not push the panel body into a horizontal scroll
    overflows: open[0].scrollWidth > open[0].clientWidth + 1,
  };
});

check(
  'tapping the strip opens exactly one sheet, grouped — four stat groups plus the folded-in cheats',
  sheet.count === 1 &&
    sheet.groups?.length === 5 &&
    sheet.groups?.includes('Luyện tập'),
  `sheets=${sheet.count} groups=${(sheet.groups ?? []).join(',')}`
);

check(
  'the sheet states the tally it was given',
  sheet.rows?.['Hạ gục'] === '1' &&
    sheet.rows?.['Bị hạ'] === '0' &&
    sheet.rows?.['Lính & quái'] === '1' &&
    sheet.rows?.['Sát thương gây ra'] === '35' &&
    sheet.rows?.['Sát thương nhận'] === '17',
  `K=${sheet.rows?.['Hạ gục']} D=${sheet.rows?.['Bị hạ']} CS=${sheet.rows?.['Lính & quái']} ` +
    `dealt=${sheet.rows?.['Sát thương gây ra']} taken=${sheet.rows?.['Sát thương nhận']}`
);

check(
  'and the live stats beside it',
  !!sheet.rows?.['Máu'] && /đòn\/giây$/.test(sheet.rows?.['Tốc đánh'] ?? ''),
  `máu=${sheet.rows?.['Máu']} tốc đánh=${sheet.rows?.['Tốc đánh']} tầm=${sheet.rows?.['Tầm đánh']}`
);

check('the sheet does not scroll sideways at panel width', sheet.overflows === false);

await page.screenshot({ path: `${OUT}/1-stat-sheet-open.png` });

await tapSelector('.practice-stat-toggle');
check(
  'tapping again closes it',
  (await page.locator('.practice-stat-sheet').count()) === 0
);

// ── Narrow viewport: the stats collapse to one column, cheats stack, no overflow
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await tapSelector('.practice-stat-toggle');
const narrow = await page.evaluate(() => {
  const body = document.querySelector('.practice-tab-body');
  const sheetNode = document.querySelector('.practice-stat-sheet');
  // The stat grid lives in `.practice-stat-columns` now — the sheet itself is a
  // flex wrapper that stacks the stats zone and the cheats zone on a phone.
  const gridNode = document.querySelector('.practice-stat-columns');
  return {
    open: !!sheetNode,
    bodyOverflows: body ? body.scrollWidth > body.clientWidth + 1 : true,
    columns: gridNode ? getComputedStyle(gridNode).gridTemplateColumns.split(' ').length : 0,
  };
});
await page.screenshot({ path: `${OUT}/2-stat-sheet-390px.png` });
check(
  'at 390px the stats are one column and the panel still does not scroll sideways',
  narrow.open && narrow.columns === 1 && !narrow.bodyOverflows,
  `columns=${narrow.columns} bodyOverflows=${narrow.bodyOverflows}`
);

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
});
