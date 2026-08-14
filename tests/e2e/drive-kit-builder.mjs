/**
 * End-to-end drive of the free-form kit builder and per-bot AI config added
 * to the pregame setup screen. Boots its own Vite dev server, opens the game
 * in system Chrome through Playwright, and reaches the live scene through
 * the DEV-only `window.__lol2d` handle — same pattern as the other
 * tests/e2e/*.mjs scripts.
 *
 * What it proves, in order:
 *   1. the free-form picker exposes the whole spell catalogue (85 spells),
 *      including standalone abilities (Olaf_Q) the champion picker leaves
 *      out entirely;
 *   2. a spell's description/cooldown/mana can be read from inside the
 *      picker without committing it (tap icon = preview, tap card = pick);
 *   3. the description panel's cooldown number honours the CDR slider live;
 *   4. per-bot rows are an accordion (expanding one collapses another) and
 *      reuse the exact same champion/custom editor as the player section;
 *   5. a pre-existing v1 stored blob (no mode/customSlots/ai.bots) loads
 *      into the UI with every old field preserved and no error;
 *   6. a hand-built custom kit spawns exactly the chosen spells in exactly
 *      the chosen slots, and a per-bot champion assignment spawns that
 *      champion's real kit on that specific bot — both driven from a real
 *      match, not just read back from storage.
 *
 *   node tests/e2e/drive-kit-builder.mjs [outPrefix]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-kitbuilder';

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const url = `http://localhost:${port}/`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const report = {};
const evaluate = (fn, arg) => page.evaluate(fn, arg);

/** Clicks a spell card's icon (preview) or body (pick) inside a group by heading text. */
const clickCatalogSpell = (groupName, spellIndex, target) =>
  page.evaluate(
    ({ groupName, spellIndex, target }) => {
      const heading = Array.from(document.querySelectorAll('.catalog-group-heading')).find(
        h => h.textContent === groupName
      );
      const row = heading.nextElementSibling;
      const card = row.querySelectorAll('.catalog-spell-card')[spellIndex];
      const el = target === 'icon' ? card.querySelector('img') : card;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    },
    { groupName, spellIndex, target }
  );

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('lol2d:pregameConfig:v1'));
  await page.reload({ waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);

  // 1 & 2. free-form picker: full catalogue, standalone spell reachable,
  // preview-without-committing
  await page.click('#pregame-player-editor .kit-mode-btn:nth-child(2)'); // "Tự Ghép Chiêu"
  await page.click('#pregame-player-editor .custom-slot:nth-child(2)'); // slot 1 = Q
  await page.waitForSelector('#pregame-catalog-picker', { state: 'visible' });
  report.catalogCardCount = await evaluate(() => document.querySelectorAll('.catalog-spell-card').length);

  await clickCatalogSpell('Olaf', 0, 'icon');
  await page.waitForTimeout(120);
  report.previewWithoutCommitting = await evaluate(() => ({
    detailVisible: !document.querySelector('#pregame-spell-detail').hidden,
    detailName: document.querySelector('#pregame-detail-name').textContent,
    pickerStillOpen: !document.querySelector('#pregame-catalog-picker').hidden,
  }));
  await page.screenshot({ path: `${OUT}-picker-with-detail.png` });

  // 3. CDR slider live-updates the open detail panel's cooldown
  const cooldownAt0 = await evaluate(() => document.querySelector('#pregame-detail-cooldown').textContent);
  await evaluate(() => {
    const range = document.querySelector('#pregame-cdr');
    range.value = '50';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(80);
  const cooldownAt50 = await evaluate(() => document.querySelector('#pregame-detail-cooldown').textContent);
  report.liveCdrOnOpenDetail = { cooldownAt0, cooldownAt50 };
  await evaluate(() => {
    const range = document.querySelector('#pregame-cdr');
    range.value = '0';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#pregame-detail-close');

  // commit the Olaf_Q pick, then fill the rest of the kit
  await clickCatalogSpell('Olaf', 0, 'card');
  await page.waitForTimeout(80);
  const pick = async (slotIndex, groupName, spellIndex) => {
    await page.click(`#pregame-player-editor .custom-slot:nth-child(${slotIndex + 1})`);
    await page.waitForSelector('#pregame-catalog-picker', { state: 'visible' });
    await clickCatalogSpell(groupName, spellIndex, 'card');
    await page.waitForTimeout(80);
  };
  await pick(2, 'Yasuo', 1); // W
  await pick(3, 'Yasuo', 2); // E
  await pick(4, 'Yasuo', 3); // R
  await pick(5, 'Phép Bổ Trợ', 1); // D -> Ghost
  await pick(6, 'Phép Bổ Trợ', 3); // F -> Ignite
  await page.screenshot({ path: `${OUT}-custom-mode.png` });
  report.persistedCustomKit = await evaluate(
    () => JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1')).player
  );

  // 4. per-bot accordion
  await evaluate(() => {
    const range = document.querySelector('#pregame-ai-count');
    range.value = '3';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(80);
  report.botRowCount = await evaluate(() => document.querySelectorAll('.bot-row').length);
  await page.click('.bot-row:nth-child(1) .bot-row-header');
  await page.waitForTimeout(80);
  await page.click('.bot-row:nth-child(1) .champion-card[data-champion="Ahri"]');
  await page.waitForTimeout(80);
  report.bot1SummaryAfterPick = await evaluate(
    () => document.querySelector('.bot-row:nth-child(1) .bot-row-summary').textContent
  );
  await page.click('.bot-row:nth-child(2) .bot-row-header');
  await page.waitForTimeout(80);
  report.accordionCollapsesOthers = await evaluate(() => ({
    bot1Expanded: document.querySelector('.bot-row:nth-child(1)').classList.contains('expanded'),
    bot2Expanded: document.querySelector('.bot-row:nth-child(2)').classList.contains('expanded'),
  }));
  await page.screenshot({ path: `${OUT}-bot-config.png` });

  // 5. a pre-existing v1 blob (no mode/customSlots/ai.bots) loads cleanly
  await evaluate(() => {
    localStorage.setItem(
      'lol2d:pregameConfig:v1',
      JSON.stringify({
        player: { championName: 'Zed', summonerD: 'Ghost', summonerF: 'Ignite' },
        ai: { count: 6, autoMove: true, autoAttack: false, autoCast: true },
        rules: { cooldownReductionPercent: 20, manaFree: true },
      })
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  report.legacyV1BlobLoaded = await evaluate(() => ({
    selectedChampion: document.querySelector('#pregame-player-editor .champion-card.selected')?.dataset
      .champion,
    aiCount: document.querySelector('#pregame-ai-count').value,
    cdr: document.querySelector('#pregame-cdr').value,
    urf: document.querySelector('#pregame-urf').checked,
    botRowCount: document.querySelectorAll('.bot-row').length,
    bot1Summary: document.querySelector('.bot-row:nth-child(1) .bot-row-summary')?.textContent,
  }));
  await page.screenshot({ path: `${OUT}-legacy-blob-loaded.png` });

  // 6. start a real match with a custom kit and one fixed-champion bot
  await evaluate(() => {
    localStorage.setItem(
      'lol2d:pregameConfig:v1',
      JSON.stringify({
        player: {
          mode: 'custom',
          championName: 'random',
          summonerD: 'Flash',
          summonerF: 'Heal',
          customSlots: ['BasicAttack', 'Olaf_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R', 'Ghost', 'Ignite'],
        },
        ai: {
          count: 2,
          autoMove: false,
          autoAttack: true,
          autoCast: true,
          bots: [
            {
              mode: 'champion',
              championName: 'Ahri',
              summonerD: 'Flash',
              summonerF: 'Heal',
              customSlots: Array(7).fill('random'),
            },
            {
              mode: 'champion',
              championName: 'random',
              summonerD: 'Flash',
              summonerF: 'Heal',
              customSlots: Array(7).fill('random'),
            },
          ],
        },
        rules: { cooldownReductionPercent: 0, manaFree: false },
      })
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  report.liveMatch = await evaluate(async () => {
    const aiModule = await import('/src/game/gameObject/attackableUnits/AIChampion.ts');
    const game = window.__lol2d.scene.oScene.game;
    const bots = game.objectManager.objects.filter(o => o instanceof aiModule.default);
    return {
      playerSpellNames: game.player.spells.map(s => s.constructor.name),
      botCount: bots.length,
      ahriBotSpellNames: bots
        .map(b => b.spells.map(s => s.constructor.name))
        .find(names => names.includes('Ahri_Q')),
    };
  });
  await page.screenshot({ path: `${OUT}-live-match.png` });

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}

if (errors.length) process.exitCode = 1;
