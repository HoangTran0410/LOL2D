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
 * The editor inside that modal is one screen: seven slot pills pinned above
 * the whole spell roster, a shelf header to take a champion's entire kit, and
 * every pick held as a draft until "Xác nhận" ("Huỷ", the X and the backdrop
 * all discard it) — see LoadoutEditorModal.vue / KitRoster.vue. The mode
 * toggle, the champion grid and the per-slot drill-down catalogue it replaced
 * are gone, and so are the selectors that named them.
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
 *      modal, persists — and only once "Xác nhận" is pressed;
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
/** The header X. It discards the draft now, exactly like "Huỷ" — see LoadoutEditorModal.vue. */
const dismissLoadoutModal = () => page.click('.loadout-modal .pregame-modal-header .pregame-icon-btn');
const cancelLoadout = () => page.click('.kit-bar-btn.secondary'); // Huỷ
const confirmLoadout = () => page.click('.kit-bar-btn:not(.secondary)'); // Xác nhận
/**
 * Which slot the next roster tap fills. 0 = A, 1 = Q, ... 5 = D, 6 = F.
 * `.kit-slot-random` shares the `.kit-slot-pill` class but is the *eighth*
 * child of the bar, so `:nth-child` still addresses only the seven slots —
 * anything that *counts* pills has to say `:not(.kit-slot-random)` though.
 */
const selectSlot = index => page.click(`.kit-slot-bar .kit-slot-pill:nth-child(${index + 1})`);
/** Puts one catalogue entry (an `AllSpells` barrel key) into the selected slot. */
const pickSpell = id => page.click(`.catalog-spell-card[data-spell="${id}"]`);
/** Takes a whole shelf's kit in one tap — the shelf header doubles as the button. */
const applyShelf = name => page.click(`.kit-shelf[data-champion="${name}"] .kit-shelf-apply`);

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
    // A fresh config is a random champion, so that is what reads as picked —
    // the roster's own "Ngẫu Nhiên" card, not a shelf.
    selectedChampion: document.querySelector('.kit-shelf.selected')?.dataset.champion ?? null,
    randomCardSelected: !!document.querySelector('.catalog-random-card.selected'),
    slotKeys: [...document.querySelectorAll('.kit-slot-pill-key')].map(e => e.textContent),
    // D and F carry the summoners the config already holds (Flash / Heal).
    summonerD: document.querySelector('.kit-slot-pill:nth-child(6) img')?.getAttribute('title'),
    summonerF: document.querySelector('.kit-slot-pill:nth-child(7) img')?.getAttribute('title'),
    catalogCardCount: document.querySelectorAll('.catalog-spell-card').length,
  }));
  await dismissLoadoutModal();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });

  await openParticipantAt(2); // Bot 1
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.sameModalForBot = await evaluate(() => ({
    title: document.querySelector('.pregame-modal-header h3')?.textContent,
    slotPills: document.querySelectorAll('.kit-slot-pill:not(.kit-slot-random)').length,
    hasRandomSlotButton: !!document.querySelector('.kit-slot-random'),
    catalogCardCount: document.querySelectorAll('.catalog-spell-card').length,
    wholeKitActions: document.querySelectorAll('.kit-shelf-apply').length,
    barActions: [...document.querySelectorAll('.kit-bar-btn')].map(b => b.textContent.trim()),
    backdropCount: document.querySelectorAll('.pregame-modal-backdrop').length,
  }));
  await dismissLoadoutModal();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });

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

  // 6. pick a champion + both summoners for the player through the modal —
  // one tap on the shelf header for the whole kit, then one roster tap per
  // summoner slot. All three are a draft until "Xác nhận": nothing below is
  // stored yet at `draftBeforeConfirm`.
  await openTab('players');
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await applyShelf('Yasuo');
  await selectSlot(5); // D
  await pickSpell('Ghost');
  await selectSlot(6); // F
  await pickSpell('Ignite');
  await page.waitForTimeout(100);
  report.draftBeforeConfirm = await evaluate(() => ({
    changedPills: [...document.querySelectorAll('.kit-slot-pill.changed .kit-slot-pill-key')].map(e => e.textContent),
    selectedShelf: document.querySelector('.kit-shelf.selected')?.dataset.champion ?? null,
    storedPlayer: JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1') ?? 'null')?.player ?? null,
  }));
  if (report.draftBeforeConfirm.storedPlayer?.championName === 'Yasuo') {
    errors.push('draftBeforeConfirm: the pick reached localStorage before "Xác nhận" was pressed');
  }
  await confirmLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });

  report.persistedAfterEditing = await evaluate(() => JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1')));
  if (
    report.persistedAfterEditing.player.championName !== 'Yasuo' ||
    report.persistedAfterEditing.player.summonerD !== 'Ghost' ||
    report.persistedAfterEditing.player.summonerF !== 'Ignite'
  ) {
    errors.push(
      `persistedAfterEditing: expected Yasuo + Ghost/Ignite, got ${JSON.stringify(report.persistedAfterEditing.player)}`
    );
  }
  await page.screenshot({ path: `${OUT}-setup-customized.png` });

  // 7. reload the screen from scratch and confirm the edits survived
  await page.reload({ waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  const selectedChampionAfterReload = await evaluate(
    () => document.querySelector('.kit-shelf.selected')?.dataset.champion
  );
  await dismissLoadoutModal();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
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
  // regions fighting over the same drag gesture. The rebuilt editor has one
  // view and one scroller by construction (`.pregame-modal-body`, holding the
  // roster; the header, slot bar and hint line are fixed siblings), so this
  // now checks that single view — in both the touch and the pointer layout,
  // and both with and without the description panel open — so a panel added
  // later that reintroduces a second `overflow-y: auto` region with real
  // overflow trips this immediately instead of waiting for another user
  // report.
  //
  // `.spell-peek` is excluded on purpose: it is `position: fixed` and
  // `pointer-events: none`, it floats *over* the dialog rather than being a
  // region inside it, and scrolling its own long prose on touch is
  // deliberate (see `body.touch-ui .spell-peek .spell-detail-body` in
  // pregame-scene.css). What must stay singular is the dialog's own chrome.
  // ---------------------------------------------------------------------
  const activeScrollers = () =>
    Array.from(document.querySelectorAll('.pregame-modal, .pregame-modal *'))
      .filter(el => !el.closest('.spell-peek'))
      .filter(el => {
        const cs = getComputedStyle(el);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2;
      })
      .map(el => el.className);

  /**
   * Opens the description panel on a roster card the way that layout's user
   * would: a hover with a mouse, a 400ms hold with a thumb. `touchscreen.tap()`
   * is over in a few milliseconds, well under `PEEK_LONG_PRESS_MS`, so the
   * touch path holds a synthetic finger still through CDP instead.
   */
  const openSpellPeek = async (target, isTouch) => {
    const card = await target.$('.catalog-spell-card[data-spell="Lux_Q"]');
    await card.scrollIntoViewIfNeeded();
    await target.waitForTimeout(150);
    if (!isTouch) {
      await card.hover();
    } else {
      const box = await card.boundingBox();
      const cdp = await target.context().newCDPSession(target);
      const finger = { x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 6, radiusY: 6, force: 1 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
      await target.waitForTimeout(600);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    }
    await target.waitForTimeout(200);
    return target.evaluate(() => !!document.querySelector('.spell-peek .spell-detail-body')?.textContent.trim());
  };

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
    const label = `singleScrollerCheck(touch=${isTouchUiExpected})`;
    result.isTouchUi = await setupPage.evaluate(() => document.body.classList.contains('touch-ui'));

    await setupPage.click('#pregame-participant-list .participant-card:nth-child(1) .participant-card-main');
    await setupPage.waitForSelector('.loadout-modal', { state: 'visible' });
    await setupPage.waitForTimeout(120);
    result.scrollers = await setupPage.evaluate(activeScrollers);
    // ...and the one scroller must genuinely be scrolling: 85 cards past the
    // roster's cap in either layout, so "exactly one" is not passing vacuously.
    result.rosterOverflows = await setupPage.evaluate(() => {
      const body = document.querySelector('.pregame-modal-body');
      return body.scrollHeight > body.clientHeight + 2;
    });
    // The pinned chrome — every slot pill and both actions — must be reachable
    // without scrolling, which is the whole point of it not being in the
    // scroller. (38px is the short-viewport floor; see the `max-height: 480px`
    // block in pregame-scene.css.)
    result.slotBarReachable = await setupPage.evaluate(() => {
      const inView = el => {
        const r = el.getBoundingClientRect();
        return r.top >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 && r.width > 0 && r.height >= 36;
      };
      return [
        document.querySelector('.kit-slot-bar'),
        ...document.querySelectorAll('.kit-slot-pill'),
        ...document.querySelectorAll('.kit-bar-btn'),
      ].every(inView);
    });

    // Open the description panel — the only surface that floats over the
    // roster now — and confirm it did not add a second region to the dialog.
    result.peekOpened = await openSpellPeek(setupPage, isTouchUiExpected);
    result.scrollersWithPeek = await setupPage.evaluate(activeScrollers);

    if (result.isTouchUi !== isTouchUiExpected) {
      errors.push(`singleScrollerCheck: expected isTouchUi=${isTouchUiExpected}, got ${result.isTouchUi}`);
    }
    if (result.scrollers.length !== 1 || result.scrollers[0] !== 'pregame-modal-body') {
      errors.push(`${label}: active scrollers are ${JSON.stringify(result.scrollers)}, expected exactly ['pregame-modal-body']`);
    }
    if (!result.rosterOverflows) {
      errors.push(`${label}: the roster does not overflow at this viewport, so the single-scroller check proves nothing`);
    }
    if (!result.slotBarReachable) {
      errors.push(`${label}: the slot bar / actions are not fully reachable without scrolling`);
    }
    if (!result.peekOpened) {
      errors.push(`${label}: ${isTouchUiExpected ? 'a long press' : 'a hover'} did not open the description panel`);
    }
    if (result.scrollersWithPeek.length !== 1 || result.scrollersWithPeek[0] !== 'pregame-modal-body') {
      errors.push(`${label}: with the description open, active scrollers are ${JSON.stringify(result.scrollersWithPeek)}, expected exactly ['pregame-modal-body']`);
    }
    return result;
  };

  {
    // A landscape-ish phone: short enough that the `max-height: 480px`
    // compaction rules are in play and the roster is a real scroll region
    // squeezed under the pinned slot bar.
    const { context, page: touchPage } = await openSetupPage({ hasTouch: true, viewport: { width: 320, height: 480 } });
    report.singleScrollerTouch = await singleScrollerCheck(touchPage, true);
    await context.close();
  }
  {
    // Shorter than the usual 1280x900 test viewport on purpose: at 900px
    // tall a smaller roster could fit under `.pregame-modal`'s 90vh cap with
    // nothing scrolling at all, which "at most one scroller" would pass
    // vacuously. 700px reliably pushes real content past that cap, so this
    // actually exercises the single-scroller mechanism instead of just
    // failing to contradict it.
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
  // 14. Read-only ability preview, inside the editor: hovering a roster card
  // describes it without equipping it and without opening a second dialog.
  // There is no second click target beside the icon any more (the old
  // "icon describes / border picks" ambiguity is what the rebuild removed) —
  // reading is a *second gesture* on the same icon, and the panel it opens is
  // `position: fixed`, `pointer-events: none`, floating over the dialog
  // rather than being one.
  // ---------------------------------------------------------------------
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.abilityPreview = await evaluate(() => ({
    // The player is Yasuo, and the picker opens on Q — so Yasuo_Q is the card
    // the roster marks as "what is in the selected slot".
    selectedBefore: document.querySelector('.catalog-spell-card.selected')?.dataset.spell ?? null,
    changedPillsBefore: document.querySelectorAll('.kit-slot-pill.changed').length,
  }));
  await page.hover('.catalog-spell-card[data-spell="Lux_Q"]'); // deliberately not in the kit
  await page.waitForTimeout(250);
  report.abilityPreview.whileHovering = await evaluate(() => {
    const peek = document.querySelector('.spell-peek');
    return {
      title: peek?.querySelector('.spell-detail-header h3')?.textContent ?? null,
      descriptionNonEmpty: !!peek?.querySelector('.spell-detail-body')?.textContent?.trim(),
      pointerEvents: peek ? getComputedStyle(peek).pointerEvents : null,
      // Still one dialog: the description is not a second one.
      dialogCount: document.querySelectorAll('.pregame-modal-backdrop').length,
    };
  });
  // Backing out with "Huỷ" is the strong proof nothing got picked: the draft
  // is discarded, and the roster must read exactly as it did before.
  await cancelLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.abilityPreview.selectedAfterBackingOut = await evaluate(
    () => document.querySelector('.catalog-spell-card.selected')?.dataset.spell ?? null
  );
  if (report.abilityPreview.whileHovering.dialogCount !== 1) {
    errors.push(`abilityPreview: the description opened ${report.abilityPreview.whileHovering.dialogCount} dialogs, expected the loadout modal alone`);
  }
  if (!report.abilityPreview.whileHovering.descriptionNonEmpty) {
    errors.push('abilityPreview: hovering a roster card did not open a description');
  }
  if (report.abilityPreview.whileHovering.pointerEvents !== 'none') {
    errors.push(`abilityPreview: the description panel is a click target (pointer-events: ${report.abilityPreview.whileHovering.pointerEvents})`);
  }
  if (report.abilityPreview.selectedAfterBackingOut !== report.abilityPreview.selectedBefore) {
    errors.push(
      `abilityPreview: opening the description changed the pick (${report.abilityPreview.selectedBefore} -> ${report.abilityPreview.selectedAfterBackingOut})`
    );
  }

  // sample descriptions + CDR-aware costs across several champions directly
  // from preset.ts, the same function every description surface calls.
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
  await dismissLoadoutModal();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });

  // 15. A description reached from the participant list's kit-icon row
  // instead — there is no editor open at that point in the screen, so this
  // one is a small dialog of its own (`SpellPreviewModal.vue`). It must NOT
  // open the loadout editor, and must stay "one dialog at a time". The
  // player's card carries kit icons because step 6 gave it Yasuo's kit.
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
  if (!report.kitIconPreview.openedPreview || report.kitIconPreview.openedEditor || report.kitIconPreview.dialogCount !== 1) {
    errors.push(`kitIconPreview: ${JSON.stringify(report.kitIconPreview)} — expected the preview alone, one dialog, no editor`);
  }
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

} catch (error) {
  report.FAILURE = `${error.message}\n${error.stack}`;
} finally {
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}

if (errors.length || report.FAILURE) process.exitCode = 1;
