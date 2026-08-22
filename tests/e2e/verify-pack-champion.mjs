/**
 * The thing the whole content-pack-extraction batch is for: a champion that
 * exists only in a pack, picked on the real pregame screen, walking around a
 * real match and casting four abilities that were never part of core.
 *
 * Everything up to this task is proven in Vitest, which runs on
 * `environment: 'node'` — no renderer, no p5, no DOM. That suite can check
 * that `PackRegistry` holds Vera and that `getPregameCatalog()` lists her; it
 * cannot click a tile in a real browser, start a real match and watch a real
 * cooldown tick. This script is that last mile.
 *
 * Built on `tests/e2e/harness.mjs` (Vite server, browser, page-error capture,
 * `check()`/`report`/`guard()`) — see `tests/e2e/drive-bot-discipline.mjs`
 * for the model: wrap real methods, count what actually happened, end in a
 * numeric summary with no screenshots at all.
 *
 * The checks, in order:
 *   1. the pregame champion picker offers a tile named Vera;
 *   2. picking her tile and pressing Bắt Đầu starts a match whose player
 *      champion is *actually* named Vera — not merely a tile that exists.
 *      `LoadoutEditorModal.applyKit` only writes `mode: 'champion',
 *      championName: shelf.championName`, and `KitShelf.championName` is
 *      `champion.playable ? champion.name : null` (`pregameCatalog.ts`) — a
 *      partial (unplayable) shelf still renders under her name (batch 1
 *      shipped her that way on purpose) but falls into the *custom* kit
 *      branch instead, and the resulting champion is not named Vera. That
 *      distinction, not the tile's existence, is what `playable: true`
 *      actually buys, and it is what check 2 is really testing;
 *   3. her four spells are live in the Q/W/E/R slots, by the same `name`
 *      string the pack's `spellDisplay` promises;
 *   4. casting each of Q/W/E/R is accepted and moves its own cooldown from
 *      0 to non-zero — what "the cast happened" means, and it does not
 *      depend on a spell that happens to spawn an object (Vera_W is a
 *      self-buff, nothing else on her kit spawns one visible object);
 *   5. the *custom*-slot path: opening her shelf and tapping each of her
 *      four abilities into Q/W/E/R one at a time (rather than "dùng cả bộ"),
 *      the way a player builds a mixed loadout, stores her real
 *      registry-qualified ids (`reference:Vera_Q`, ...) and the match that
 *      follows actually casts her four spells — not four rerolled bundled
 *      ones. This is the path checks 1-4 do not cover: `packSpellCatalogEntry`
 *      used to hand the picker Vera's *bare* local id (`Vera_Q`), which wrote
 *      into a custom slot as a string `preset.ts` could not resolve back
 *      (`isSpellId('Vera_Q')` re-qualifies as `riot:Vera_Q`, the *bundled*
 *      pack's id, not `reference:Vera_Q`) and silently rerolled to a random
 *      bundled spell — a match starting wrong with no error anywhere. Champion
 *      mode (checks 1-4) never touched that code path, which is exactly why it
 *      passed while this was broken;
 *   6. no page errors the whole time.
 *
 * ai.count: 0 and world: { jungle: false, minions: false } in the seeded
 * config, so nothing else on the map can hit the player mid-check; manaFree
 * so the cast loop needs no per-spell mana bookkeeping. None of that is the
 * behaviour under test — see `smoke-new-champions.mjs`'s own `MATCH_CONFIG`
 * for the same shape used the same way.
 *
 *   node tests/e2e/verify-pack-champion.mjs
 *   LOL2D_CHROME_CHANNEL= node tests/e2e/verify-pack-champion.mjs   # bundled Chromium
 */
import { CFG_KEY, startHarness } from './harness.mjs';

const CFG_SEED = {
  player: {
    mode: 'champion',
    championName: 'random',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
  world: { jungle: false, minions: false },
};

/** The pack's own display names — `packs/reference/pack.ts`'s `spellDisplay`, never restated as a guess. */
const EXPECTED_SPELL_NAMES = [
  'Tia Lam (Vera_Q)',
  'Vỏ Sáng (Vera_W)',
  'Bước Chớp (Vera_E)',
  'Vòng Tận (Vera_R)',
];

const { url, page, report, check, guard, errors } = await startHarness();

await guard(async () => {
  // Seeded before the first navigation, same as `smoke-new-champions.mjs`:
  // `PregameConfigSource` reads `localStorage` once, at construction, when
  // the panel mounts.
  await page.addInitScript(
    ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
    [CFG_KEY, CFG_SEED]
  );
  await page.goto(url, { waitUntil: 'load' });

  // ---------------------------------------------------- 1. offered by name
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  await page.click('.practice-roster-main:has(#practice-row-toggle-0) .practice-roster-open');
  await page.waitForSelector('.loadout-modal', { state: 'visible' });

  const offered = await page.evaluate(
    () => !!document.querySelector('.kit-shelf[data-champion="Vera"] .kit-shelf-apply')
  );
  check('the pregame champion picker offers a tile named Vera', offered);

  // --------------------------------------------------- 2. pick her, confirm
  if (offered) {
    // Open the tile, then its whole-kit action — see `applyShelf` in
    // `drive-kit-builder.mjs`, the established two-step gesture: the header
    // button only opens the shelf, `.kit-apply-all` is what actually commits
    // the pick into the draft.
    await page.click('.kit-shelf[data-champion="Vera"] .kit-shelf-apply');
    await page.click('.kit-shelf[data-champion="Vera"] .kit-apply-all');
    await page.click('.kit-bar-btn:not(.secondary)'); // Xác nhận
    await page.waitForSelector('.loadout-modal', { state: 'detached' });
  }

  const stored = await page.evaluate(
    key => JSON.parse(localStorage.getItem(key) ?? 'null')?.player ?? null,
    CFG_KEY
  );
  report.storedPick = stored;
  check(
    'picking her tile selects a real champion, not a custom kit',
    stored?.mode === 'champion' && stored?.championName === 'Vera',
    JSON.stringify(stored)
  );

  await page.click('#pregame-start-btn'); // Bắt Đầu
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);

  // -------------------------------------------- 2b. the live player champion
  const player = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      name: game.player?.name ?? null,
      spellNames: (game.player?.spells ?? []).map(s => s?.name ?? null),
    };
  });
  report.player = player;
  check(
    'the match starts with Vera as the player champion',
    player.name === 'Vera',
    `player.name = ${JSON.stringify(player.name)}`
  );

  // ------------------------------------------------------- 3. her real kit
  // `SpellHotKeys` is [A, Q, W, E, R, D, F], so `spells[1..4]` is Q/W/E/R.
  const liveSpellNames = player.spellNames.slice(1, 5);
  check(
    'her four spells are live in the Q/W/E/R slots',
    JSON.stringify(liveSpellNames) === JSON.stringify(EXPECTED_SPELL_NAMES),
    liveSpellNames.join(' / ')
  );

  // ------------------------------------------------- 4. each spell, cast
  const casts = await page.evaluate(expectedNames => {
    const game = window.__lol2d.scene.oScene.game;
    const subject = game.player;
    const results = [];
    for (let slot = 1; slot <= 4; slot++) {
      const spell = subject.spells[slot];
      if (!spell) {
        results.push({
          slot,
          expected: expectedNames[slot - 1],
          ok: false,
          reason: 'no spell in slot',
        });
        continue;
      }
      spell.currentCooldown = 0;
      const before = spell.currentCooldown;
      const at = { x: subject.position.x + 200, y: subject.position.y };
      game.worldMouse = createVector(at.x, at.y);
      const context = game.createSpellContext(spell, subject, at);
      const accepted = context ? spell.press(context) : false;
      const after = spell.currentCooldown;
      results.push({
        slot,
        name: spell.name,
        accepted,
        before,
        after,
        ok: accepted && before === 0 && after > 0,
      });
    }
    return results;
  }, EXPECTED_SPELL_NAMES);
  report.casts = casts;

  const slotLetters = ['A', 'Q', 'W', 'E', 'R'];
  for (const cast of casts) {
    check(
      `${slotLetters[cast.slot]} (${cast.name ?? cast.expected ?? '?'}) casts and its cooldown starts`,
      Boolean(cast.ok),
      `accepted=${cast.accepted} cooldown ${cast.before}ms -> ${cast.after}ms`
    );
  }

  // ------------------------------------------------- 5. the custom-slot path
  // The `addInitScript` above reseeds `CFG_SEED` on every navigation,
  // including this reload — so this phase starts clean rather than on top of
  // check 2's `championName: 'Vera'`. That matters: a broken pick here must
  // not leave the loadout on a leftover champion-mode pick, or the match that
  // follows would still spawn the real Vera and pass by accident, hiding
  // exactly the bug this phase exists to catch.
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  await page.click('.practice-roster-main:has(#practice-row-toggle-0) .practice-roster-open');
  await page.waitForSelector('.loadout-modal', { state: 'visible' });

  // Opening the shelf and picking a card by DOM `.click()` rather than
  // `page.click(selector)` — the same idiom `drive-kit-builder.mjs`'s
  // `openShelf`/`pickSpell` use — so a card rendered under the *wrong* id
  // (what this phase exists to catch: `packSpellCatalogEntry` handing back a
  // pack champion's bare local id instead of its registry-qualified one)
  // is a registered `check` failure instead of a Playwright selector timeout
  // that would throw past every check after it and leave the run looking
  // like fewer checks simply didn't apply.
  const CUSTOM_ABILITY_IDS = [
    'reference:Vera_Q',
    'reference:Vera_W',
    'reference:Vera_E',
    'reference:Vera_R',
  ];
  const openedShelf = await page.evaluate(() => {
    const shelf = document.querySelector('.kit-shelf[data-champion="Vera"]');
    if (!shelf) return false;
    if (!shelf.classList.contains('open')) shelf.querySelector('.kit-shelf-apply')?.click();
    return true;
  });
  check("Vera's shelf is in the roster to open", openedShelf);

  // Slot indices 1-4 are Q/W/E/R (`SpellHotKeys`'s own order — see
  // `EXPECTED_SPELL_NAMES`'s comment above); `:nth-child` is 1-based and the
  // random pill is the *eighth* `.kit-slot-pill`, past every slot this loop
  // reaches, so it never collides.
  let allCardsFound = true;
  for (let i = 0; i < CUSTOM_ABILITY_IDS.length; i++) {
    const slotIndex = i + 1;
    await page.click(`.kit-slot-bar .kit-slot-pill:nth-child(${slotIndex + 1})`);
    const picked = await page.evaluate(spellId => {
      const card = document.querySelector(`.catalog-spell-card[data-spell="${spellId}"]`);
      if (!card) return false;
      card.click();
      return true;
    }, CUSTOM_ABILITY_IDS[i]);
    if (!picked) allCardsFound = false;
  }
  check(
    "the roster renders a card for each of Vera's four abilities under its real, registry-qualified id",
    allCardsFound,
    CUSTOM_ABILITY_IDS.join(', ')
  );

  await page.click('.kit-bar-btn:not(.secondary)'); // Xác nhận
  await page.waitForSelector('.loadout-modal', { state: 'detached' });

  const customStored = await page.evaluate(
    key => JSON.parse(localStorage.getItem(key) ?? 'null')?.player ?? null,
    CFG_KEY
  );
  report.customStoredPick = customStored;
  check(
    "a hand-built loadout of Vera's four abilities stores her real qualified ids, not rerolled bundled ones",
    customStored?.mode === 'custom' &&
      JSON.stringify(customStored.customSlots?.slice(1, 5)) === JSON.stringify(CUSTOM_ABILITY_IDS),
    JSON.stringify(customStored?.customSlots)
  );

  await page.click('#pregame-start-btn'); // Bắt Đầu
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);

  const customPlayer = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return { spellNames: (game.player?.spells ?? []).map(s => s?.name ?? null) };
  });
  report.customPlayer = customPlayer;
  const customLiveSpellNames = customPlayer.spellNames.slice(1, 5);
  check(
    'the match starts with her four hand-picked abilities, not rerolled bundled spells',
    JSON.stringify(customLiveSpellNames) === JSON.stringify(EXPECTED_SPELL_NAMES),
    customLiveSpellNames.join(' / ')
  );

  // ------------------------------------------------------ 6. no page errors
  check('no page errors', errors.length === 0, errors[0]);
});
