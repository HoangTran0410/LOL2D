/**
 * End-to-end drive of the free-form kit builder and per-bot AI config on the
 * pregame setup screen. Boots its own Vite dev server, opens the game in
 * system Chrome through Playwright, and reaches the live scene through the
 * DEV-only `window.__lol2d` handle — same pattern as the other
 * tests/e2e/*.mjs scripts.
 *
 * The kit-slot picker used to be two separate overlays (a catalogue and a
 * spell-detail panel), disambiguated by *which pixels of a slot you tapped* —
 * the icon opened one, the rest of the slot opened the other. It is now one
 * pane (`SpellSelectorPane.vue`) with both halves always visible together,
 * opened by a slot's only click target. Tapping a catalogue entry only
 * highlights it (updates the description, changes nothing stored); a
 * separate "Dùng chiêu này" button commits it; the back arrow or the
 * backdrop cancels, leaving the slot as it was. This script drives exactly
 * that sequence rather than the old single-click-to-pick one.
 *
 * What it proves, in order:
 *   1. the free-form picker exposes the whole spell catalogue (85 spells),
 *      including standalone abilities (Olaf_Q) the champion picker leaves
 *      out entirely;
 *   2. highlighting a catalogue entry shows its description and does *not*
 *      commit it — the stored slot is untouched, and cancelling (the back
 *      arrow) leaves it that way;
 *   3. committing (Dùng chiêu này) does write it, and re-opening the slot
 *      shows that choice already highlighted and described — the same
 *      gesture answers "what is this" and "change it";
 *   4. opening the player's card and a bot's card opens the *same*
 *      loadout-editor modal, and the screen never has more than one dialog
 *      open at once (there is no more accordion to collapse — the modal
 *      makes two loadout editors on screen simultaneously structurally
 *      impossible, which is the fix for the layout duplication this
 *      screen's redesign was asked for);
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

const openParticipantAt = n =>
  page.click(`#pregame-participant-list .participant-card:nth-child(${n}) .participant-card-main`);
const closeLoadoutModal = () => page.click('.pregame-modal-header .pregame-icon-btn');
const openCustomSlot = index => page.click(`.custom-slot-row .kit-slot:nth-child(${index + 1})`);
const backFromSelector = () => page.click('.selector-pane .pregame-modal-header .pregame-icon-btn');
const commitSlot = () => page.click('.selector-commit');

/** Highlights (does not commit) a catalogue entry in a named group, by index within that group's row. */
const highlightCatalogEntry = (groupName, spellIndex) =>
  page.evaluate(
    ({ groupName, spellIndex }) => {
      const heading = Array.from(document.querySelectorAll('.catalog-group-heading')).find(
        h => h.textContent === groupName
      );
      const row = heading.nextElementSibling;
      row.querySelectorAll('.catalog-spell-card')[spellIndex].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    },
    { groupName, spellIndex }
  );

/** Opens a custom slot, highlights + commits one catalogue entry, and waits for the editor view to return. */
const pickSlot = async (slotIndex, groupName, spellIndex) => {
  await openCustomSlot(slotIndex);
  await page.waitForSelector('.selector-pane', { state: 'visible' });
  await highlightCatalogEntry(groupName, spellIndex);
  await commitSlot();
  await page.waitForSelector('.loadout-modal .kit-mode-toggle', { state: 'visible' });
};

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('lol2d:pregameConfig:v1'));
  await page.reload({ waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);

  // 1. free-form picker: full catalogue, standalone spell reachable
  await openParticipantAt(1); // the player
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await page.click('.loadout-modal .kit-mode-btn:nth-child(2)'); // "Tự Ghép Chiêu"
  await openCustomSlot(1); // Q
  await page.waitForSelector('.selector-pane', { state: 'visible' });
  report.catalogCardCount = await evaluate(() => document.querySelectorAll('.catalog-spell-card').length);

  // 2. highlighting shows the description and does not commit; cancelling leaves the slot unchanged
  await highlightCatalogEntry('Olaf', 0); // Olaf_Q — a standalone ability with no champion card of its own
  await page.waitForTimeout(100);
  report.highlightShowsDescriptionWithoutCommitting = await evaluate(() => ({
    highlightedName: document.querySelector('.catalog-spell-card.selected .catalog-spell-name')?.textContent,
    detailName: document.querySelector('.selector-detail .spell-detail-header h3')?.textContent,
    detailHasDescription: !!document.querySelector('.selector-detail .spell-detail-body')?.textContent.trim(),
  }));
  await page.screenshot({ path: `${OUT}-picker-with-detail.png` });

  await backFromSelector(); // cancel, not commit
  await page.waitForSelector('.loadout-modal .kit-mode-toggle', { state: 'visible' });
  report.slotUnchangedAfterCancel = await evaluate(
    () => JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1') ?? 'null')?.player.customSlots[1] ?? 'random'
  );

  // Re-opening the same slot starts with 'random' highlighted again — the
  // cancelled highlight did not leak into the next open.
  await openCustomSlot(1);
  await page.waitForSelector('.selector-pane', { state: 'visible' });
  report.reopenedSlotHighlightsCurrentChoice = await evaluate(
    () => document.querySelector('.catalog-random-card.selected')?.textContent.trim()
  );

  // 3. committing does write it, and shows description live from the CDR the
  // player already set — set CDR to 50% first: unlike the old two-overlay
  // picker, the loadout modal is a full-screen dialog, so the Settings tab's
  // CDR slider is not reachable *while* this pane is open any more (that is
  // the "no two overlays open at once" fix, at the layout level). The
  // description pane still honours whatever matchRules it is opened with —
  // proven here by setting CDR before opening rather than sliding it live.
  await backFromSelector();
  await closeLoadoutModal();
  await page.click('#pregame-tab-settings');
  await page.waitForSelector('#pregame-cdr', { state: 'visible' });
  await evaluate(() => {
    const range = document.querySelector('#pregame-cdr');
    range.value = '50';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#pregame-tab-players');
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await openCustomSlot(1);
  await page.waitForSelector('.selector-pane', { state: 'visible' });
  await highlightCatalogEntry('Olaf', 0);
  await page.waitForTimeout(80);
  report.cooldownReflectsCdrSetBeforeOpening = await evaluate(
    () => document.querySelector('.selector-detail .spell-detail-cooldown')?.textContent.trim()
  );
  await commitSlot();
  await page.waitForSelector('.loadout-modal .kit-mode-toggle', { state: 'visible' });
  report.slotChangedAfterCommit = await evaluate(
    () => JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1')).player.customSlots[1]
  );
  // reset CDR back to 0 so it doesn't leak into later steps
  await closeLoadoutModal();
  await page.click('#pregame-tab-settings');
  await page.waitForSelector('#pregame-cdr', { state: 'visible' });
  await evaluate(() => {
    const range = document.querySelector('#pregame-cdr');
    range.value = '0';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#pregame-tab-players');

  // fill the rest of the kit
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await pickSlot(2, 'Yasuo', 1); // W
  await pickSlot(3, 'Yasuo', 2); // E
  await pickSlot(4, 'Yasuo', 3); // R
  await pickSlot(5, 'Phép Bổ Trợ', 1); // D -> Ghost
  await pickSlot(6, 'Phép Bổ Trợ', 3); // F -> Ignite
  await page.screenshot({ path: `${OUT}-custom-mode.png` });
  report.persistedCustomKit = await evaluate(() => JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1')).player);
  await closeLoadoutModal();
  await page.waitForTimeout(80);

  // 4. the player's card and a bot's card open the identical modal, and only
  // one is ever open — there is no accordion state to collapse any more; the
  // full-viewport backdrop makes a second one structurally unreachable while
  // the first is up (confirmed here: exactly one backdrop exists, and the
  // player's own card behind it is not an actionable target).
  await openParticipantAt(2); // Bot 1
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.bot1EditorIsSameComponent = await evaluate(() => ({
    title: document.querySelector('.pregame-modal-header h3')?.textContent,
    hasKitModeToggle: !!document.querySelector('.kit-mode-toggle'),
    backdropCount: document.querySelectorAll('.pregame-modal-backdrop').length,
  }));
  report.playerCardNotClickableBehindModal = await page
    .click('.participant-card-player .participant-card-main', { timeout: 500 })
    .then(() => 'click went through (bug)')
    .catch(() => 'blocked, as expected');

  await page.click('.champion-card[data-champion="Ahri"]');
  await page.waitForTimeout(80);
  await closeLoadoutModal();
  await page.waitForTimeout(80);
  report.bot1SummaryAfterPick = await evaluate(
    () => document.querySelector('#pregame-participant-list .participant-card:nth-child(2) .participant-summary')?.textContent
  );
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
  const legacyBotCount = await evaluate(
    () => document.querySelectorAll('.participant-card:not(.participant-card-player)').length
  );
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  const legacySelectedChampion = await evaluate(() => document.querySelector('.champion-card.selected')?.dataset.champion);
  await closeLoadoutModal();
  await page.waitForTimeout(80);
  await page.click('#pregame-tab-settings');
  await page.waitForSelector('#pregame-cdr', { state: 'visible' });
  report.legacyV1BlobLoaded = {
    selectedChampion: legacySelectedChampion,
    botCount: legacyBotCount,
    cdr: await evaluate(() => document.querySelector('#pregame-cdr').value),
    urf: await evaluate(() => document.querySelector('#pregame-urf').checked),
  };
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
      ahriBotSpellNames: bots.map(b => b.spells.map(s => s.constructor.name)).find(names => names.includes('Ahri_Q')),
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
