/**
 * End-to-end drive of the rebuilt loadout editor and per-bot AI config on the
 * pregame setup screen. Boots its own Vite dev server, opens the game in
 * system Chrome through Playwright, and reaches the live scene through the
 * DEV-only `window.__lol2d` handle — same pattern as the other
 * tests/e2e/*.mjs scripts.
 *
 * The editor used to be a mode toggle ("Chọn Tướng" / "Tự Ghép Chiêu") over
 * two different editors, each of which drilled into a *third* view: a per-slot
 * catalogue you highlighted in and committed out of ("Dùng chiêu này"), one
 * slot at a time. All of that is gone. It is now one screen — seven slot pills
 * pinned above the whole roster, one tap to fill the selected slot, one tap on
 * a shelf header to take a champion's entire kit — with every pick held as a
 * *draft* until "Xác nhận" (see `LoadoutEditorModal.vue` and `KitRoster.vue`).
 * This script drives exactly that shape rather than the old drill-down.
 *
 * What it proves, in order:
 *   1. the roster exposes the whole spell catalogue (85 spells) in one
 *      scrolling list, including the standalone abilities (Olaf_Q, Graves_W)
 *      the old champion grid left out entirely, and offers a whole-kit action
 *      on every shelf that actually has a kit;
 *   2. picks are a draft: nothing reaches `localStorage` until "Xác nhận", and
 *      both "Huỷ" and the header's X discard the draft without a trace;
 *   3. the *gesture* decides the mode, since there is no mode toggle left to
 *      ask: a shelf header is a champion pick; a real summoner spell dropped
 *      into D/F keeps champion mode; a single ability (or a non-summoner in
 *      D/F) turns the loadout custom with the champion's own kit expanded into
 *      the seven slots first; and a partial shelf (Graves) writes only the
 *      slot its name claims, through that same custom path; plus
 *      `.kit-slot-random`, the eighth control in the slot group, which leaves
 *      the *selected* slot to chance (disabled when that slot already is) and
 *      whose `'random'` really does resolve to a spell at spawn;
 *   4. hovering a card describes it — with this match's CDR already applied —
 *      without picking it and without opening a second dialog, and hovering a
 *      *slot pill* gives the same answer for the spell already in that slot,
 *      out of the same single panel, without selecting the slot;
 *   5. the player's card and a bot's card open the *same* modal, and the
 *      screen never has more than one dialog open at once (the full-viewport
 *      backdrop makes two loadout editors structurally impossible, which is
 *      the fix for the layout duplication this screen's redesign was asked
 *      for);
 *   6. a pre-existing v1 stored blob (no mode/customSlots/ai.bots) loads into
 *      the UI with every old field preserved and no error;
 *   7. a hand-built custom kit spawns exactly the chosen spells in exactly the
 *      chosen slots, and a per-bot champion assignment spawns that champion's
 *      real kit on that specific bot — both driven from a real match, not just
 *      read back from storage.
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
const CFG = 'lol2d:pregameConfig:v1';

/** Records a mismatch instead of throwing, so one bad expectation doesn't hide the rest of the run. */
const expect = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const openParticipantAt = n =>
  page.click(`#pregame-participant-list .participant-card:nth-child(${n}) .participant-card-main`);
/** The header X — same as "Huỷ" now: it discards the draft (see LoadoutEditorModal.vue). */
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

const storedPlayer = () => evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.player ?? null, CFG);
const setCdr = async percent => {
  await page.click('#pregame-tab-settings');
  await page.waitForSelector('#pregame-cdr', { state: 'visible' });
  await evaluate(value => {
    const range = document.querySelector('#pregame-cdr');
    range.value = value;
    range.dispatchEvent(new Event('input', { bubbles: true }));
  }, String(percent));
  await page.click('#pregame-tab-players');
  await page.waitForSelector('#pregame-participant-list', { state: 'visible' });
};

/** Opens the player's editor, runs `steps` inside it, commits, and returns what was actually stored. */
const editPlayer = async steps => {
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await steps();
  await confirmLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  return storedPlayer();
};

try {
  await page.goto(url, { waitUntil: 'load' });
  await evaluate(k => localStorage.removeItem(k), CFG);
  await page.reload({ waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);

  // 1. one roster, whole catalogue, standalone abilities reachable
  await openParticipantAt(1); // the player
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.rosterShape = await evaluate(() => ({
    catalogCardCount: document.querySelectorAll('.catalog-spell-card').length,
    shelfCount: document.querySelectorAll('.kit-shelf').length,
    wholeKitActions: document.querySelectorAll('.kit-shelf-apply').length,
    // Only the two shelves that are not a champion — no Q/W/E/R to land in.
    shelvesWithoutWholeKitAction: [...document.querySelectorAll('.kit-shelf')]
      .filter(s => !s.querySelector('.kit-shelf-apply'))
      .map(s => s.dataset.champion),
    standaloneAbilitiesReachable: ['Olaf_Q', 'Graves_W', 'Fizz_E', 'Nasus_Q'].every(
      id => !!document.querySelector(`.catalog-spell-card[data-spell="${id}"]`)
    ),
    slotKeys: [...document.querySelectorAll('.kit-slot-pill-key')].map(e => e.textContent),
    activeSlot: document.querySelector('.kit-slot-pill.active .kit-slot-pill-key')?.textContent,
    // Seven slots plus the "leave this one to chance" button that acts on them.
    slotBarButtons: document.querySelectorAll('.kit-slot-bar .kit-slot-pill').length,
    // The default loadout is a random champion, so that is what reads as picked.
    randomCardSelected: !!document.querySelector('.catalog-random-card.selected'),
    selectedShelf: document.querySelector('.kit-shelf.selected')?.dataset.champion ?? null,
  }));
  expect('rosterShape.catalogCardCount', report.rosterShape.catalogCardCount, 85);
  expect('rosterShape.shelfCount', report.rosterShape.shelfCount, 33);
  expect('rosterShape.wholeKitActions', report.rosterShape.wholeKitActions, 31);
  expect('rosterShape.shelvesWithoutWholeKitAction', report.rosterShape.shelvesWithoutWholeKitAction, [
    'Đánh Thường',
    'Phép Bổ Trợ',
  ]);
  expect('rosterShape.slotKeys', report.rosterShape.slotKeys, ['A', 'Q', 'W', 'E', 'R', 'D', 'F']);
  expect('rosterShape.slotBarButtons', report.rosterShape.slotBarButtons, 8);
  await page.screenshot({ path: `${OUT}-roster.png` });

  // 2. a pick is a draft: visible in the slot bar, absent from storage, and
  // thrown away by either exit. There is no highlight-then-commit step inside
  // the picker any more — the commit is the modal's own "Xác nhận".
  await selectSlot(1); // Q
  await pickSpell('Olaf_Q');
  await page.waitForTimeout(120);
  report.draftIsNotStored = {
    changedPills: await evaluate(() =>
      [...document.querySelectorAll('.kit-slot-pill.changed .kit-slot-pill-key')].map(e => e.textContent)
    ),
    selectedCard: await evaluate(() => document.querySelector('.catalog-spell-card.selected')?.dataset.spell ?? null),
    storedWhileDrafting: await storedPlayer(),
  };
  expect('draftIsNotStored.changedPills', report.draftIsNotStored.changedPills, ['Q']);
  expect('draftIsNotStored.selectedCard', report.draftIsNotStored.selectedCard, 'Olaf_Q');
  expect('draftIsNotStored.storedWhileDrafting', report.draftIsNotStored.storedWhileDrafting, null);

  await dismissLoadoutModal(); // the X discards, same as Huỷ
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.storedAfterXDiscards = await storedPlayer();
  expect('storedAfterXDiscards', report.storedAfterXDiscards, null);

  // re-opening starts from the stored loadout again — the discarded draft did
  // not leak into the next open.
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.reopenedAfterDiscard = await evaluate(() => ({
    changedPills: document.querySelectorAll('.kit-slot-pill.changed').length,
    selectedCard: document.querySelector('.catalog-spell-card.selected')?.dataset.spell ?? null,
    randomCardSelected: !!document.querySelector('.catalog-random-card.selected'),
  }));
  expect('reopenedAfterDiscard', report.reopenedAfterDiscard, {
    changedPills: 0,
    selectedCard: null,
    randomCardSelected: true,
  });

  // ...and "Huỷ" discards a whole-kit pick just as completely.
  await applyShelf('Ahri');
  await page.waitForTimeout(80);
  await cancelLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.storedAfterCancelDiscards = await storedPlayer();
  expect('storedAfterCancelDiscards', report.storedAfterCancelDiscards, null);

  // 3. the gesture decides the mode — there is no toggle left to ask.
  const yasuoKit = ['BasicAttack', 'Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R'];
  report.gestureDecidesMode = {
    // a shelf header: a champion pick, keeping the summoners already chosen
    shelfHeader: await editPlayer(() => applyShelf('Yasuo')),
    // a real summoner spell into D: still a champion pick (D/F have their own fields)
    summonerIntoD: await editPlayer(async () => {
      await selectSlot(5);
      await pickSpell('Ghost');
    }),
    // one ability into R: custom, with Yasuo's own kit expanded into the slots first
    abilityIntoR: await editPlayer(async () => {
      await selectSlot(4);
      await pickSpell('Zed_R');
    }),
    // back to a champion pick in one tap, from a custom kit
    backToChampion: await editPlayer(() => applyShelf('Ahri')),
    // something that is not a summoner spell, into F: also custom
    nonSummonerIntoF: await editPlayer(async () => {
      await selectSlot(6);
      await pickSpell('Ahri_W');
    }),
    championBeforePartialShelf: await editPlayer(() => applyShelf('Teemo')),
    // Graves' shelf is only `Graves_W` — no championName can name it, so it
    // goes through the custom path and lands in the slot its *name* claims
    // (W, index 2), not the first slot of the shelf.
    partialShelf: await editPlayer(() => applyShelf('Graves')),
    randomCard: await editPlayer(() => page.click('.catalog-random-card')),
  };
  const g = report.gestureDecidesMode;
  expect('gestureDecidesMode.shelfHeader', g.shelfHeader, {
    mode: 'champion',
    championName: 'Yasuo',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  });
  expect('gestureDecidesMode.summonerIntoD', g.summonerIntoD, {
    mode: 'champion',
    championName: 'Yasuo',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  });
  expect('gestureDecidesMode.abilityIntoR', g.abilityIntoR, {
    mode: 'custom',
    championName: 'Yasuo',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: [...yasuoKit.slice(0, 4), 'Zed_R', 'Ghost', 'Heal'],
  });
  expect('gestureDecidesMode.backToChampion.mode', [g.backToChampion.mode, g.backToChampion.championName], [
    'champion',
    'Ahri',
  ]);
  expect('gestureDecidesMode.nonSummonerIntoF', g.nonSummonerIntoF, {
    mode: 'custom',
    championName: 'Ahri',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: ['BasicAttack', 'Ahri_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R', 'Ghost', 'Ahri_W'],
  });
  expect('gestureDecidesMode.partialShelf', g.partialShelf, {
    mode: 'custom',
    championName: 'Teemo',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: ['BasicAttack', 'Teemo_Q', 'Graves_W', 'Teemo_E', 'Teemo_R', 'Ghost', 'Heal'],
  });
  expect('gestureDecidesMode.randomCard.mode', [g.randomCard.mode, g.randomCard.championName], [
    'champion',
    'random',
  ]);

  // ...and one slot left to chance. `.kit-slot-random` is the eighth control
  // in the slot group because it acts on the *selected slot*, not on a spell:
  // it is the per-slot `'random'` the old drill-down catalogue offered as its
  // own "Ngẫu Nhiên" card, which the roster has nowhere to put that would not
  // be mistaken for the whole-loadout one. It is disabled while the selected
  // slot is already random — there is nothing for it to do.
  const randomSlotState = () =>
    evaluate(() => ({
      disabled: document.querySelector('.kit-slot-random').disabled,
      activeSlot: document.querySelector('.kit-slot-pill.active .kit-slot-pill-key')?.textContent ?? null,
    }));
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  // The loadout is still the random champion left by the step above, so Q —
  // the slot the picker opens on — is already rolling the dice.
  report.randomSlotButton = { onARandomSlot: await randomSlotState() };
  await applyShelf('Yasuo');
  await page.waitForTimeout(80);
  report.randomSlotButton.afterTakingAKit = await randomSlotState();
  await selectSlot(4); // R
  await page.click('.kit-slot-random');
  await page.waitForTimeout(80);
  report.randomSlotButton.afterRandomising = await randomSlotState();
  await confirmLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.randomSlotButton.stored = await storedPlayer();
  expect('randomSlotButton.onARandomSlot', report.randomSlotButton.onARandomSlot, { disabled: true, activeSlot: 'Q' });
  expect('randomSlotButton.afterTakingAKit', report.randomSlotButton.afterTakingAKit, {
    disabled: false,
    activeSlot: 'Q',
  });
  // Having just rolled R back to chance, there is nothing left to randomise.
  expect('randomSlotButton.afterRandomising', report.randomSlotButton.afterRandomising, {
    disabled: true,
    activeSlot: 'R',
  });
  expect('randomSlotButton.stored', report.randomSlotButton.stored, {
    mode: 'custom',
    championName: 'Yasuo',
    summonerD: 'Ghost',
    summonerF: 'Heal',
    customSlots: ['BasicAttack', 'Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'random', 'Ghost', 'Heal'],
  });

  // ...and that `'random'` is resolved at spawn, not dropped: six fixed slots
  // and one real, arbitrary spell where R was left open.
  await page.click('#pregame-start-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.player, null, { timeout: 30_000 });
  await page.waitForTimeout(400);
  report.randomSlotButton.spawnedSpells = await evaluate(() =>
    window.__lol2d.scene.oScene.game.player.spells.map(s => s?.constructor?.name ?? null)
  );
  const spawned = report.randomSlotButton.spawnedSpells;
  expect('randomSlotButton.spawnedSpells (fixed slots)', [...spawned.slice(0, 4), ...spawned.slice(5)], [
    'BasicAttack',
    'Yasuo_Q',
    'Yasuo_W',
    'Yasuo_E',
    'Ghost',
    'Heal',
  ]);
  if (typeof spawned[4] !== 'string' || spawned[4].length === 0) {
    errors.push(`randomSlotButton.spawnedSpells: the R slot rolled ${JSON.stringify(spawned[4])}, expected a real spell`);
  }
  // back out to the setup screen — the rest of this script drives it further
  await evaluate(() => window.__lol2d.scene.oScene.stopGame());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForSelector('#pregame-participant-list', { state: 'visible' });
  await page.waitForTimeout(120);

  // ...and a kit assembled slot by slot, exactly as the free-form builder used
  // to do it in seven round trips through a nested dialog.
  report.persistedCustomKit = await editPlayer(async () => {
    await selectSlot(0);
    await pickSpell('BasicAttack');
    await selectSlot(1);
    await pickSpell('Olaf_Q');
    await selectSlot(2);
    await pickSpell('Yasuo_W');
    await selectSlot(3);
    await pickSpell('Yasuo_E');
    await selectSlot(4);
    await pickSpell('Yasuo_R');
    await selectSlot(5);
    await pickSpell('Ghost');
    await selectSlot(6);
    await pickSpell('Ignite');
  });
  expect('persistedCustomKit.customSlots', report.persistedCustomKit.customSlots, [
    'BasicAttack',
    'Olaf_Q',
    'Yasuo_W',
    'Yasuo_E',
    'Yasuo_R',
    'Ghost',
    'Ignite',
  ]);
  expect('persistedCustomKit.mode', report.persistedCustomKit.mode, 'custom');
  await page.screenshot({ path: `${OUT}-custom-kit.png` });

  // 4. hovering a card describes it — under this match's CDR — and picks
  // nothing. The description panel floats over the roster (`position: fixed`,
  // `pointer-events: none`); it is not a second dialog and there is no commit
  // button beside it any more. CDR is set *before* opening because the modal
  // is full-screen: the Settings tab's slider is not reachable while it is up,
  // which is the "no two overlays open at once" fix at the layout level.
  await setCdr(50);
  const beforeHover = await storedPlayer();
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  // Deliberately a spell the kit above does *not* contain, so "hovering picks
  // nothing" is visible in the roster too: `.catalog-spell-card.selected`
  // tracks whatever sits in the active slot (Olaf_Q, from the kit just built),
  // and must still say so with Lux_Q under the cursor.
  await page.hover('.catalog-spell-card[data-spell="Lux_Q"]');
  await page.waitForTimeout(250);
  report.hoverDescribesWithoutPicking = await evaluate(() => {
    const peek = document.querySelector('.spell-peek');
    const rect = peek?.getBoundingClientRect();
    return {
      name: peek?.querySelector('.spell-detail-header h3')?.textContent ?? null,
      cooldown: peek?.querySelector('.spell-detail-cooldown')?.textContent.trim() ?? null,
      hasDescription: !!peek?.querySelector('.spell-detail-body')?.textContent.trim(),
      pointerEvents: peek ? getComputedStyle(peek).pointerEvents : null,
      insideViewport: !!rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      dialogCount: document.querySelectorAll('.pregame-modal-backdrop').length,
      changedPills: document.querySelectorAll('.kit-slot-pill.changed').length,
      selectedCard: document.querySelector('.catalog-spell-card.selected')?.dataset.spell ?? null,
    };
  });
  await page.screenshot({ path: `${OUT}-hover-description.png` });
  // The same numbers straight from preset.ts, so "reflects CDR" is measured
  // against the spell's own tuning rather than a copied constant.
  report.cooldownUnderCdr = await evaluate(async () => {
    const preset = await import('/src/game/preset.ts');
    const entry = preset.listSpellCatalog().find(e => e.id === 'Lux_Q');
    const raw = preset.getSpellDisplay(entry.spellClass, { cooldownMultiplier: 1, manaFree: false });
    const halved = preset.getSpellDisplay(entry.spellClass, { cooldownMultiplier: 0.5, manaFree: false });
    return {
      rawLabel: `${(raw.effectiveCoolDownMs / 1000).toFixed(1)}s`,
      halvedLabel: `${(halved.effectiveCoolDownMs / 1000).toFixed(1)}s`,
    };
  });
  const peeked = report.hoverDescribesWithoutPicking;
  expect('hoverDescribesWithoutPicking.hasDescription', peeked.hasDescription, true);
  expect('hoverDescribesWithoutPicking.pointerEvents', peeked.pointerEvents, 'none');
  expect('hoverDescribesWithoutPicking.insideViewport', peeked.insideViewport, true);
  expect('hoverDescribesWithoutPicking.dialogCount', peeked.dialogCount, 1);
  expect('hoverDescribesWithoutPicking.changedPills', peeked.changedPills, 0);
  expect('hoverDescribesWithoutPicking.selectedCard', peeked.selectedCard, 'Olaf_Q');
  if (!peeked.cooldown?.includes(report.cooldownUnderCdr.halvedLabel)) {
    errors.push(
      `hoverDescribesWithoutPicking.cooldown: "${peeked.cooldown}" does not show the 50% CDR value ${report.cooldownUnderCdr.halvedLabel} (raw ${report.cooldownUnderCdr.rawLabel})`
    );
  }

  // 4b. The slot bar answers the same question for the spell already in a
  // slot — the one a player is most likely to be asking about, and the one
  // this screen used to answer only by making them find that spell again down
  // in an 85-card roster.
  //
  // The expected text is not typed here: it is whatever the *roster card* for
  // the same spell says, read a moment earlier. Two independent surfaces, one
  // answer — and nothing in the check recomputes the answer itself.
  const peekTitle = () =>
    evaluate(() => document.querySelector('.spell-peek .spell-detail-header h3')?.textContent ?? null);
  await page.hover('.catalog-spell-card[data-spell="Yasuo_W"]');
  await page.waitForTimeout(250);
  const cardTitle = await peekTitle();
  // W, not the active slot (Q): hovering has to describe without selecting.
  await page.hover('.kit-slot-bar .kit-slot-pill:nth-child(3)');
  await page.waitForTimeout(250);
  report.slotPillDescribes = await evaluate(() => ({
    title: document.querySelector('.spell-peek .spell-detail-header h3')?.textContent ?? null,
    hasDescription: !!document.querySelector('.spell-peek .spell-detail-body')?.textContent.trim(),
    // One editor, one panel: the slot bar and the roster share an instance.
    panels: document.querySelectorAll('.spell-peek').length,
    // A hover ends itself on `mouseleave`, so it must not raise the
    // full-screen dismiss layer the touch path needs.
    scrims: document.querySelectorAll('.spell-peek-scrim').length,
    activeSlot: document.querySelector('.kit-slot-pill.active .kit-slot-pill-key')?.textContent ?? null,
    changedPills: document.querySelectorAll('.kit-slot-pill.changed').length,
  }));
  expect('slotPillDescribes.title', report.slotPillDescribes.title, cardTitle);
  expect('slotPillDescribes.hasDescription', report.slotPillDescribes.hasDescription, true);
  expect('slotPillDescribes.panels', report.slotPillDescribes.panels, 1);
  expect('slotPillDescribes.scrims', report.slotPillDescribes.scrims, 0);
  expect('slotPillDescribes.activeSlot', report.slotPillDescribes.activeSlot, 'Q');
  expect('slotPillDescribes.changedPills', report.slotPillDescribes.changedPills, peeked.changedPills);
  if (!cardTitle) {
    errors.push('slotPillDescribes: the roster card it is compared against described nothing');
  }
  // Off the pill: a hover ends itself, and the panel must not linger.
  await page.hover('.kit-hint');
  await page.waitForTimeout(150);
  expect('slotPillDescribes.closedOnLeave', await peekTitle(), null);

  await cancelLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.storedUnchangedByHover = (await storedPlayer())?.customSlots?.join(',') === beforeHover?.customSlots?.join(',');
  expect('storedUnchangedByHover', report.storedUnchangedByHover, true);
  await setCdr(0); // don't let it leak into the live match below

  // 5. the player's card and a bot's card open the identical modal, and only
  // one is ever open — the full-viewport backdrop makes a second one
  // structurally unreachable while the first is up (confirmed here: exactly
  // one backdrop exists, and the player's own card behind it is not an
  // actionable target).
  await openParticipantAt(2); // Bot 1
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.bot1EditorIsSameComponent = await evaluate(() => ({
    title: document.querySelector('.pregame-modal-header h3')?.textContent,
    slotPills: document.querySelectorAll('.kit-slot-pill:not(.kit-slot-random)').length,
    hasRandomSlotButton: !!document.querySelector('.kit-slot-random'),
    catalogCardCount: document.querySelectorAll('.catalog-spell-card').length,
    wholeKitActions: document.querySelectorAll('.kit-shelf-apply').length,
    backdropCount: document.querySelectorAll('.pregame-modal-backdrop').length,
  }));
  expect('bot1EditorIsSameComponent', report.bot1EditorIsSameComponent, {
    title: 'Bot 1',
    slotPills: 7,
    hasRandomSlotButton: true,
    catalogCardCount: 85,
    wholeKitActions: 31,
    backdropCount: 1,
  });
  report.playerCardNotClickableBehindModal = await page
    .click('.participant-card-player .participant-card-main', { timeout: 500 })
    .then(() => 'click went through (bug)')
    .catch(() => 'blocked, as expected');
  expect('playerCardNotClickableBehindModal', report.playerCardNotClickableBehindModal, 'blocked, as expected');

  await applyShelf('Ahri');
  await confirmLoadout();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  report.bot1SummaryAfterPick = await evaluate(
    () =>
      document.querySelector('#pregame-participant-list .participant-card:nth-child(2) .participant-summary')
        ?.textContent
  );
  expect('bot1SummaryAfterPick', report.bot1SummaryAfterPick, 'Ahri');
  await page.screenshot({ path: `${OUT}-bot-config.png` });

  // 6. a pre-existing v1 blob (no mode/customSlots/ai.bots) loads cleanly
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
  const legacyEditorState = await evaluate(() => ({
    selectedShelf: document.querySelector('.kit-shelf.selected')?.dataset.champion ?? null,
    // The old blob's D/F really are Ghost/Ignite, so no slot reads as "roll
    // the dice" — every pill carries a real icon rather than the dice glyph.
    slotsStillRandom: [...document.querySelectorAll('.kit-slot-pill:not(.kit-slot-random)')].filter(
      p => !p.querySelector('img')
    ).length,
    pillTitles: [...document.querySelectorAll('.kit-slot-pill img')].map(i => i.getAttribute('title')),
  }));
  await dismissLoadoutModal();
  await page.waitForSelector('.loadout-modal', { state: 'detached' });
  await page.click('#pregame-tab-settings');
  await page.waitForSelector('#pregame-cdr', { state: 'visible' });
  report.legacyV1BlobLoaded = {
    ...legacyEditorState,
    botCount: legacyBotCount,
    cdr: await evaluate(() => document.querySelector('#pregame-cdr').value),
    urf: await evaluate(() => document.querySelector('#pregame-urf').checked),
  };
  expect('legacyV1BlobLoaded.selectedShelf', report.legacyV1BlobLoaded.selectedShelf, 'Zed');
  expect('legacyV1BlobLoaded.slotsStillRandom', report.legacyV1BlobLoaded.slotsStillRandom, 0);
  expect('legacyV1BlobLoaded.botCount', report.legacyV1BlobLoaded.botCount, 6);
  expect('legacyV1BlobLoaded.cdr', report.legacyV1BlobLoaded.cdr, '20');
  expect('legacyV1BlobLoaded.urf', report.legacyV1BlobLoaded.urf, true);
  await page.screenshot({ path: `${OUT}-legacy-blob-loaded.png` });

  // 7. start a real match with a custom kit and one fixed-champion bot
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
  expect('liveMatch.playerSpellNames', report.liveMatch.playerSpellNames, [
    'BasicAttack',
    'Olaf_Q',
    'Yasuo_W',
    'Yasuo_E',
    'Yasuo_R',
    'Ghost',
    'Ignite',
  ]);
  expect('liveMatch.botCount', report.liveMatch.botCount, 2);
  expect('liveMatch.ahriBotSpellNames', report.liveMatch.ahriBotSpellNames?.slice(0, 5), [
    'BasicAttack',
    'Ahri_Q',
    'Ahri_W',
    'Ahri_E',
    'Ahri_R',
  ]);
  await page.screenshot({ path: `${OUT}-live-match.png` });
} catch (error) {
  report.FAILURE = `${error.message}\n${error.stack}`;
} finally {
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}

if (errors.length || report.FAILURE) process.exitCode = 1;
