/**
 * End-to-end drive of the pregame setup screen in the real game.
 *
 * Boots its own Vite dev server, opens the game in system Chrome through
 * Playwright, and reaches the live scene through the DEV-only `window.__lol2d`
 * handle set in src/main.ts — same pattern as the other tests/e2e/*.mjs
 * scripts.
 *
 * The screen is two tabs (Tướng / Cấu Hình) plus one shared loadout-editor
 * modal, opened by tapping any participant card — see SetupScene.vue's file
 * comment for the IA. Every click target on it is now unambiguous: nothing
 * has a `.stop`-guarded child handler competing with its own, so this script
 * uses plain `page.click()` throughout (no coordinate workarounds needed).
 *
 * What it proves, in order:
 *   1. the menu's "Chơi" button is still a one-click path into a match (no
 *      gate in front of Play);
 *   2. the Players tab, on first open, shows the human player first (marked
 *      "Bạn") and exactly `DEFAULT_PREGAME_CONFIG.ai.count` bots below —
 *      nothing else, which is the "reads cleanly on first open" goal;
 *   3. opening the player's card and a bot's card opens the *same* modal
 *      (identical DOM shape, bound to different data) — the fix for the
 *      layout duplication the redesign was asked for;
 *   4. "Thêm Bot" / the last bot's remove control actually change AI count,
 *      as direct manipulation on the list, not a slider in another tab;
 *   5. the Settings tab's AI behaviour + match-rule controls round-trip
 *      through real DOM interaction into localStorage;
 *   6. picking a champion + both summoners for the player, through the
 *      modal, persists;
 *   7. the whole edited config survives a reload;
 *   8. a non-default AI count actually spawns that many AIChampion instances;
 *   9. the AI auto-move / auto-attack toggles actually change bot behaviour,
 *      not just a field's resting value;
 *   10. cooldown reduction actually shortens a real spell's cooldown, cast
 *       through a real keypress, and URF lets that same cast go through at
 *       zero mana;
 *   11. the picked champion + kit (avatar, Q/W/E/R, both summoners) is what
 *       the player actually spawns with.
 *
 *   node tests/e2e/drive-pregame-config.mjs [outPrefix]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-pregame';

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const url = `http://localhost:${port}/`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const report = {};
const evaluate = (fn, arg) => page.evaluate(fn, arg);
const openTab = tab => page.click(`#pregame-tab-${tab}`);
/** The nth participant card (1 = the player, 2 = Bot 1, 3 = Bot 2, ...). */
const openParticipantAt = n => page.click(`#pregame-participant-list .participant-card:nth-child(${n}) .participant-card-main`);
/** Only valid while the modal's *editor* view (not the slot selector) is showing. */
const closeLoadoutModal = () => page.click('.pregame-modal-header .pregame-icon-btn');
/** The D or F summoner slot inside the currently-open editor view. */
const openSummonerSlot = which => page.click(`.summoner-row .kit-slot:nth-child(${which === 'D' ? 1 : 2})`);
/** The Nth custom slot (0 = A, 1 = Q, ...), inside the currently-open editor view. */
const openCustomSlot = index => page.click(`.custom-slot-row .kit-slot:nth-child(${index + 1})`);
/** Highlights (does not commit) a catalogue entry among the flat summoner list. */
const highlightFlatEntry = index =>
  page.evaluate(
    i => document.querySelectorAll('.selector-catalogue .catalog-spell-card')[i].dispatchEvent(new MouseEvent('click', { bubbles: true })),
    index
  );
const commitSlot = () => page.click('.selector-commit');

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('lol2d:pregameConfig:v1'));

  // 1. "Chơi" is still a one-click path into a match with nothing configured
  await page.reload({ waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  report.playIsOneClick = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      started: !!game,
      defaultAiCount: game.objectManager.objects.filter(o => o.constructor.name === 'AIChampion').length,
    };
  });
  await evaluate(() => window.__lol2d.scene.oScene.stopGame());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 2. Players tab, first open: the player marked "Bạn", 5 bots, nothing else
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  report.playersTabOnFirstOpen = await evaluate(() => {
    const cards = [...document.querySelectorAll('#pregame-participant-list .participant-card')];
    const player = cards.find(c => c.classList.contains('participant-card-player'));
    const bots = cards.filter(c => !c.classList.contains('participant-card-player'));
    return {
      activeTab: document.querySelector('.pregame-tab.selected')?.id,
      playerLabel: player?.querySelector('.participant-name')?.textContent,
      playerSummary: player?.querySelector('.participant-summary')?.textContent,
      botCount: bots.length,
      lastBotLabel: bots.at(-1)?.querySelector('.participant-name')?.textContent,
      modalOpen: !!document.querySelector('.pregame-modal-backdrop'),
    };
  });
  await page.screenshot({ path: `${OUT}-setup-defaults.png` });

  // 3. the player's card and a bot's card open the identical modal
  await openParticipantAt(1); // the player
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.playerEditor = await evaluate(() => ({
    title: document.querySelector('.pregame-modal-header h3')?.textContent,
    selectedChampion: document.querySelector('.champion-card.selected')?.dataset.champion,
    summonerD: document.querySelector('.summoner-row .kit-slot:nth-child(1) .kit-slot-name')?.textContent,
    summonerF: document.querySelector('.summoner-row .kit-slot:nth-child(2) .kit-slot-name')?.textContent,
    championCardCount: document.querySelectorAll('.champion-card').length,
  }));
  await closeLoadoutModal();
  await page.waitForTimeout(100);

  await openParticipantAt(2); // Bot 1
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.sameModalForBot = await evaluate(() => ({
    title: document.querySelector('.pregame-modal-header h3')?.textContent,
    hasKitModeToggle: !!document.querySelector('.kit-mode-toggle'),
    hasChampionGrid: !!document.querySelector('.champion-grid'),
    hasSummonerSlots: document.querySelectorAll('.summoner-row .kit-slot').length,
  }));
  await closeLoadoutModal();
  await page.waitForTimeout(100);

  // 4. "Thêm Bot" and the last bot's remove control actually change AI count
  await page.click('#pregame-add-bot-btn');
  await page.click('#pregame-add-bot-btn');
  await page.click('#pregame-add-bot-btn');
  await page.waitForTimeout(80);
  report.botCountAfterAdding = await evaluate(
    () => document.querySelectorAll('.participant-card:not(.participant-card-player)').length
  );

  // 5. Settings tab: AI behaviour + match rules round-trip into localStorage
  await openTab('settings');
  await page.waitForSelector('#pregame-ai-automove', { state: 'visible' });
  await page.click('#pregame-ai-automove');
  await page.click('#pregame-ai-autoattack'); // was on by default -> off
  await page.click('#pregame-ai-autocast'); // was on by default -> off
  await evaluate(() => {
    const range = document.querySelector('#pregame-cdr');
    range.value = '50';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#pregame-urf');
  await page.waitForTimeout(80);

  // 6. pick a champion + both summoners for the player through the modal
  await openTab('players');
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await page.click('.champion-card[data-champion="Yasuo"]');
  await openSummonerSlot('D');
  await page.waitForSelector('.selector-pane', { state: 'visible' });
  await highlightFlatEntry(1); // Flash(0), Ghost(1), Heal(2), Ignite(3), StealthWard(4)
  await commitSlot();
  await page.waitForSelector('.loadout-modal .kit-mode-toggle', { state: 'visible' });
  await openSummonerSlot('F');
  await page.waitForSelector('.selector-pane', { state: 'visible' });
  await highlightFlatEntry(3);
  await commitSlot();
  await page.waitForSelector('.loadout-modal .kit-mode-toggle', { state: 'visible' });
  await closeLoadoutModal();
  await page.waitForTimeout(100);

  report.persistedAfterEditing = await evaluate(() => JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1')));
  await page.screenshot({ path: `${OUT}-setup-customized.png` });

  // 7. reload the screen from scratch and confirm the edits survived
  await page.reload({ waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  const selectedChampionAfterReload = await evaluate(
    () => document.querySelector('.champion-card.selected')?.dataset.champion
  );
  await closeLoadoutModal();
  await page.waitForTimeout(80);
  // botCount must be read while the Players tab's DOM actually exists —
  // PlayersTab/SettingsTab are `v-if`/`v-else`, so only one is mounted at a
  // time (see SetupScene.vue).
  const botCountAfterReload = await evaluate(
    () => document.querySelectorAll('.participant-card:not(.participant-card-player)').length
  );
  await openTab('settings');
  await page.waitForSelector('#pregame-cdr', { state: 'visible' });
  report.survivesReload = {
    selectedChampion: selectedChampionAfterReload,
    botCount: botCountAfterReload,
    aiAutoMove: await evaluate(() => document.querySelector('#pregame-ai-automove').checked),
    cdr: await evaluate(() => document.querySelector('#pregame-cdr').value),
    urf: await evaluate(() => document.querySelector('#pregame-urf').checked),
  };

  // 8. start the match with this config
  await page.click('#pregame-start-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);

  report.matchRules = await evaluate(() => window.__lol2d.scene.oScene.game.matchRules);

  report.aiRoster = await evaluate(async () => {
    const aiModule = await import('/src/game/gameObject/attackableUnits/AIChampion.ts');
    const game = window.__lol2d.scene.oScene.game;
    const bots = game.objectManager.objects.filter(o => o instanceof aiModule.default);
    return {
      count: bots.length,
      allAutoMoveOn: bots.every(b => b._autoMove === true),
      allAutoAttackOff: bots.every(b => b._autoAttack === false),
      allAutoCastOff: bots.every(b => b._autoCast === false),
    };
  });

  // 9. AI toggles actually change behaviour, not just the field's resting
  // value: pin two bots adjacent to each other with autoAttack off, and watch
  // one bot's position to prove autoMove is really driving it to wander.
  report.aiBehaviour = await evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const [a, b] = game.objectManager.objects.filter(
      o => o !== game.player && o.basicAttack && o.constructor.name === 'AIChampion'
    );
    a.position.set(3200, 3200);
    a.destination.set(3200, 3200);
    b.position.set(3230, 3200); // well inside AI_ATTACK_AGGRO_RANGE (420)
    b.destination.set(3230, 3200);
    a.basicAttack.clear();
    b.basicAttack.clear();
    a._attackScanCooldown = 0;
    b._attackScanCooldown = 0;

    const wanderStart = { x: a.position.x, y: a.position.y };
    await new Promise(resolve => setTimeout(resolve, 1_600));

    return {
      noAutoAttackDespiteProximity: a.basicAttack.target === null && b.basicAttack.target === null,
      distanceStayedClose: Math.round(a.position.dist(b.position)),
      wanderedFromAutoMove: Math.round(Math.hypot(a.position.x - wanderStart.x, a.position.y - wanderStart.y)),
    };
  });

  // 10. cooldown reduction + URF, cast through a real keypress. Yasuo Q is
  // slot 1 (Q). Teleported to an empty corner and aimed into open ground so
  // the "reduced cooldown on hit" mechanic (a pre-existing, unrelated
  // mechanic) never fires — this measures the plain start-of-cast cooldown.
  report.spellSetup = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const spell = player.spells[1];
    player.position.set(200, 200);
    player.destination.set(200, 200);
    player.stats.mana.baseValue = 0; // prove URF: this alone would refuse a normal cast
    spell.resetCoolDown();
    return {
      slotName: spell.constructor.name,
      rawCoolDown: spell.coolDown,
      effectiveCoolDownMs: spell.effectiveCoolDownMs,
      manaCost: spell.manaCost,
      effectiveManaCost: spell.effectiveManaCost,
      manaBeforeCast: player.stats.mana.value,
    };
  });
  const aimScreen = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const point = game.camera.worldToScreen(400, 200); // straight right, open ground
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(aimScreen.x, aimScreen.y);
  await page.waitForTimeout(80);
  await page.keyboard.press('q');
  await page.waitForTimeout(150);
  report.spellAfterCast = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const spell = game.player.spells[1];
    return {
      manaAfterCast: game.player.stats.mana.value,
      currentCooldown: Math.round(spell.currentCooldown),
      state: spell.state,
    };
  });
  await page.screenshot({ path: `${OUT}-after-cast.png` });

  // 11. the picked champion + kit is what the player spawns with
  report.playerLoadout = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      avatarKey: game.player.avatar?.key,
      spellNames: game.player.spells.map(s => s.constructor.name),
    };
  });

  // Step 8 started a live match on `page` — back out to the setup screen
  // before driving it further (steps 14-16 below reuse this same page).
  await evaluate(() => window.__lol2d.scene.oScene.stopGame());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.click('#pregame-tab-players');
  await page.waitForSelector('#pregame-participant-list', { state: 'visible' });
  await page.waitForTimeout(100);

  // ---------------------------------------------------------------------
  // 12. Exactly one scroller in the loadout modal — this is precisely the
  // regression the modal shipped with (a scrollable champion grid nested
  // inside an independently-scrollable modal, and, in the spell selector,
  // a scrollable catalogue next to a scrollable detail pane): two touch
  // regions fighting over the same drag gesture. Checked in both the
  // champion-mode kit view and the spell-selector view, in both the touch
  // and the pointer layout, so a panel added later that reintroduces a
  // second `overflow-y: auto` region with real overflow trips this
  // immediately instead of waiting for another user report.
  // ---------------------------------------------------------------------
  const countActiveScrollers = () =>
    Array.from(document.querySelectorAll('.pregame-modal, .pregame-modal *')).filter(el => {
      const cs = getComputedStyle(el);
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    }).length;

  const openSetupPage = async ({ hasTouch, viewport }) => {
    const context = await browser.newContext({ viewport, hasTouch });
    const setupPage = await context.newPage();
    setupPage.on('pageerror', e => errors.push(`pageerror(${hasTouch ? 'touch' : 'pointer'}): ${e.message}`));
    setupPage.on('console', m => {
      if (m.type() === 'error') errors.push(`console(${hasTouch ? 'touch' : 'pointer'}): ${m.text()}`);
    });
    await setupPage.goto(url, { waitUntil: 'load' });
    await setupPage.evaluate(() => {
      localStorage.removeItem('lol2d:pregameConfig:v1');
      localStorage.removeItem('lol2d.touchControls');
    });
    await setupPage.reload({ waitUntil: 'load' });
    await setupPage.click('#config-btn');
    await setupPage.waitForSelector('#pregame-scene', { state: 'visible' });
    await setupPage.waitForTimeout(150);
    return { context, page: setupPage };
  };

  const singleScrollerCheck = async (setupPage, isTouchUiExpected) => {
    const result = {};
    result.isTouchUi = await setupPage.evaluate(() => document.body.classList.contains('touch-ui'));

    await setupPage.click('#pregame-participant-list .participant-card:nth-child(1) .participant-card-main');
    await setupPage.waitForSelector('.loadout-modal', { state: 'visible' });
    await setupPage.waitForTimeout(80);
    result.championScrollerCount = await setupPage.evaluate(countActiveScrollers);
    // the footer (D/F summoner slots) must be reachable without scrolling
    result.summonerRowReachable = await setupPage.evaluate(() => {
      const row = document.querySelector('.summoner-row');
      const r = row.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });

    // switch to the free-form catalogue (85 entries) and open Q — plenty of
    // content to force real overflow in either layout.
    await setupPage.click('.loadout-modal .kit-mode-btn:nth-child(2)');
    await setupPage.waitForTimeout(50);
    await setupPage.click('.custom-slot-row .kit-slot:nth-child(2)');
    await setupPage.waitForSelector('.selector-pane', { state: 'visible' });
    await setupPage.waitForTimeout(80);
    result.selectorScrollerCountCollapsed = await setupPage.evaluate(countActiveScrollers);
    result.commitReachableCollapsed = await setupPage.evaluate(() => {
      const r = document.querySelector('.selector-commit').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.height >= 44;
    });

    // highlight an entry with a real description; on touch this expands the
    // collapsible sheet (if the toggle is present) — still exactly one
    // scroller either way, just potentially a different element.
    await setupPage.evaluate(() =>
      document
        .querySelector('.selector-catalogue .catalog-spell-card')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await setupPage.waitForTimeout(80);
    const toggle = await setupPage.$('.spell-detail-toggle');
    if (toggle) await toggle.click();
    await setupPage.waitForTimeout(80);
    result.selectorScrollerCountExpanded = await setupPage.evaluate(countActiveScrollers);
    result.commitReachableExpanded = await setupPage.evaluate(() => {
      const r = document.querySelector('.selector-commit').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.height >= 44;
    });

    if (result.isTouchUi !== isTouchUiExpected) {
      errors.push(`singleScrollerCheck: expected isTouchUi=${isTouchUiExpected}, got ${result.isTouchUi}`);
    }
    if (result.championScrollerCount !== 1) {
      errors.push(`singleScrollerCheck(touch=${isTouchUiExpected}): champion view has ${result.championScrollerCount} active scrollers, expected exactly 1`);
    }
    if (!result.summonerRowReachable) {
      errors.push(`singleScrollerCheck(touch=${isTouchUiExpected}): summoner row not reachable without scrolling`);
    }
    if (result.selectorScrollerCountCollapsed > 1) {
      errors.push(`singleScrollerCheck(touch=${isTouchUiExpected}): selector view (collapsed) has ${result.selectorScrollerCountCollapsed} active scrollers, expected at most 1`);
    }
    if (!result.commitReachableCollapsed) {
      errors.push(`singleScrollerCheck(touch=${isTouchUiExpected}): commit button not reachable (collapsed)`);
    }
    if (result.selectorScrollerCountExpanded > 1) {
      errors.push(`singleScrollerCheck(touch=${isTouchUiExpected}): selector view (expanded) has ${result.selectorScrollerCountExpanded} active scrollers, expected at most 1`);
    }
    if (isTouchUiExpected && result.selectorScrollerCountExpanded !== 1) {
      // On touch specifically, the expanded sheet's own description is
      // *meant* to be a real, working scroller (see the file comment on
      // `body.touch-ui .selector-detail .spell-detail-body` in
      // pregame-scene.css) — 0 here would mean the mechanism never actually
      // engages, not just that this particular spell's text happened to
      // fit. The viewport below is small enough that even the shortest
      // catalogue entry's description overflows the sheet's cap.
      errors.push(`singleScrollerCheck(touch): expanded sheet has ${result.selectorScrollerCountExpanded} active scrollers, expected exactly 1 (the sheet's own description)`);
    }
    if (!result.commitReachableExpanded) {
      errors.push(`singleScrollerCheck(touch=${isTouchUiExpected}): commit button not reachable (expanded)`);
    }
    return result;
  };

  {
    // Small enough that the expanded detail sheet's description genuinely
    // overflows its cap even for the shortest catalogue entry — see the
    // note on `selectorScrollerCountExpanded` above.
    const { context, page: touchPage } = await openSetupPage({ hasTouch: true, viewport: { width: 320, height: 480 } });
    report.singleScrollerTouch = await singleScrollerCheck(touchPage, true);
    await context.close();
  }
  {
    // Shorter than the usual 1280x900 test viewport on purpose: at 900px
    // tall the champion grid comfortably fits under `.pregame-modal`'s 85vh
    // cap and nothing scrolls at all, which "at most one scroller" would
    // pass vacuously. 700px reliably pushes real content past that cap, so
    // this actually exercises the single-scroller mechanism instead of
    // just failing to contradict it.
    const { context, page: pointerPage } = await openSetupPage({ hasTouch: false, viewport: { width: 1280, height: 700 } });
    report.singleScrollerPointer = await singleScrollerCheck(pointerPage, false);
    await context.close();
  }

  // ---------------------------------------------------------------------
  // 13. Dialog width in touch mode is driven by the viewport, not the mode
  // flag — a touch-capable desktop still gets the bounded, centred dialog;
  // only a phone-width viewport goes edge to edge.
  // ---------------------------------------------------------------------
  {
    const widths = {};
    for (const [label, viewport] of [
      ['desktop', { width: 1920, height: 1080 }],
      ['tablet', { width: 820, height: 1180 }],
      ['phone', { width: 390, height: 844 }],
    ]) {
      const { context, page: p } = await openSetupPage({ hasTouch: true, viewport });
      await p.click('#pregame-participant-list .participant-card:nth-child(1) .participant-card-main');
      await p.waitForSelector('.loadout-modal', { state: 'visible' });
      widths[label] = await p.evaluate(() => document.querySelector('.pregame-modal').getBoundingClientRect().width);
      await context.close();
    }
    report.touchModalWidthByViewport = widths;
    if (widths.desktop > 800) {
      errors.push(`touch modal width at 1920x1080 is ${widths.desktop}px — expected a bounded dialog (~760px), not full-bleed`);
    }
    if (Math.abs(widths.phone - 390) > 1) {
      errors.push(`touch modal width at a phone viewport is ${widths.phone}px — expected edge-to-edge (390px)`);
    }
  }

  // ---------------------------------------------------------------------
  // 14. Read-only ability preview: a champion card's Q/W/E/R icon opens a
  // description without picking the champion, and without opening a second
  // dialog on top of the loadout modal.
  // ---------------------------------------------------------------------
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.abilityPreview = await evaluate(() => {
    const before = document.querySelector('.champion-card.selected')?.dataset.champion ?? null;
    document.querySelector('.champion-card[data-champion="Yasuo"] .champion-spell-btn')?.click();
    return { selectedBefore: before };
  });
  await page.waitForTimeout(80);
  // The champion grid is not in the DOM at all while the preview pane is
  // swapped in (see LoadoutEditorModal.vue's `previewDisplay`) — that alone
  // is part of the proof nothing got picked. The stronger proof is below:
  // after backing out, the grid's selection must read exactly as it did
  // before the ability icon was ever clicked.
  report.abilityPreview.afterClick = await evaluate(() => ({
    title: document.querySelector('.loadout-modal .pregame-modal-header h3')?.textContent,
    descriptionNonEmpty: !!document.querySelector('.spell-detail-pane .spell-detail-body')?.textContent?.trim(),
    dialogCount: document.querySelectorAll('.pregame-modal-backdrop').length,
    championGridGoneWhilePreviewOpen: document.querySelector('.champion-grid') === null,
  }));
  await page.click('.loadout-modal .pregame-modal-header .pregame-icon-btn'); // back to the edit view
  await page.waitForSelector('.loadout-modal .kit-mode-toggle', { state: 'visible' });
  report.abilityPreview.selectedAfterBackingOut = await evaluate(
    () => document.querySelector('.champion-card.selected')?.dataset.champion ?? null
  );
  if (report.abilityPreview.selectedAfterBackingOut !== report.abilityPreview.selectedBefore) {
    errors.push(
      `abilityPreview: opening the ability preview changed the champion pick (${report.abilityPreview.selectedBefore} -> ${report.abilityPreview.selectedAfterBackingOut})`
    );
  }

  // sample descriptions + CDR-aware costs across several champions directly
  // from preset.ts, the same function the preview button calls.
  report.abilityPreviewSample = await evaluate(async () => {
    const preset = await import('/src/game/preset.ts');
    const champs = preset.listSelectableChampions().slice(0, 5);
    const noRules = { cooldownMultiplier: 1, manaFree: false };
    const cdrRules = { cooldownMultiplier: 0.5, manaFree: false };
    return champs.map(c => ({
      name: c.name,
      allDescriptionsNonEmpty: c.spells.every(s => !!preset.getSpellDisplay(s.spellClass, noRules).description?.trim()),
      allRespectCdr: c.spells.every(s => {
        const base = preset.getSpellDisplay(s.spellClass, noRules).effectiveCoolDownMs;
        const withCdr = preset.getSpellDisplay(s.spellClass, cdrRules).effectiveCoolDownMs;
        return withCdr < base;
      }),
    }));
  });
  if (report.abilityPreviewSample.some(c => !c.allDescriptionsNonEmpty)) {
    errors.push(`abilityPreviewSample: some champion has an empty ability description: ${JSON.stringify(report.abilityPreviewSample)}`);
  }
  if (report.abilityPreviewSample.some(c => !c.allRespectCdr)) {
    errors.push(`abilityPreviewSample: some champion's ability cooldown does not shrink under CDR: ${JSON.stringify(report.abilityPreviewSample)}`);
  }
  await closeLoadoutModal();
  await page.waitForTimeout(80);

  // 15. Same preview, reached from the participant list's kit-icon row —
  // must NOT open the loadout editor, and must stay "one dialog at a time".
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await page.click('.champion-card[data-champion="Yasuo"] .champion-card-pick');
  await page.waitForTimeout(80);
  await closeLoadoutModal();
  await page.waitForTimeout(80);
  report.kitIconPreview = await evaluate(() => {
    document.querySelector('#pregame-participant-list .participant-card:nth-child(1) .kit-icon-btn')?.click();
    return null;
  });
  await page.waitForTimeout(80);
  report.kitIconPreview = await evaluate(() => ({
    openedPreview: !!document.querySelector('.spell-preview-modal'),
    openedEditor: !!document.querySelector('.loadout-modal'),
    dialogCount: document.querySelectorAll('.pregame-modal-backdrop').length,
  }));
  await page.click('.spell-preview-modal .pregame-modal-header .pregame-icon-btn');
  await page.waitForTimeout(80);

  // 16. The touch/pointer control lives in the Settings tab, as a three-option
  // row. All three are live: the point of the third one is that it is the only
  // way back out of a manual override, so it is asserted as a round trip —
  // pin a mode, then hand the decision back to the device and prove the stored
  // value really is 'auto' again.
  await page.click('#pregame-tab-settings');
  await page.waitForSelector('.input-mode-row', { state: 'visible' });
  const modeState = () =>
    evaluate(() => ({
      stored: localStorage.getItem('lol2d.touchControls'),
      bodyHasTouchUi: document.body.classList.contains('touch-ui'),
      selectedLabel: document.querySelector('.input-mode-btn.selected')?.textContent?.trim(),
      selectedCount: document.querySelectorAll('.input-mode-btn.selected').length,
      disabledCount: document.querySelectorAll('.input-mode-btn[disabled]').length,
      optionCount: document.querySelectorAll('.input-mode-btn').length,
    }));

  report.inputModePanel = { initial: await modeState() };

  await page.click('#pregame-input-mode-touch');
  await page.waitForTimeout(80);
  report.inputModePanel.afterChoosingTouch = await modeState();

  await page.click('#pregame-input-mode-auto');
  await page.waitForTimeout(80);
  // On this desktop Chrome, 'auto' must detect *pointer* — which is what makes
  // it a real escape from the pinned touch mode above rather than a no-op.
  report.inputModePanel.afterChoosingAuto = await modeState();

  await page.click('#pregame-input-mode-pointer'); // leave it pinned for a clean re-run
  await page.waitForTimeout(80);

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}

if (errors.length) process.exitCode = 1;
