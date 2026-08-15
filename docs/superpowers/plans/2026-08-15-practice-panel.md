# Practice Panel v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the in-game spell picker into a four-tab practice panel that reshapes the running match — roster, rules, world — without leaving it, plus a saved-kit library shared with the pregame editor.

**Architecture:** Every mutation of a running match goes through one new class, `MatchDirector`, constructed by `Game` and exposed as `game.director`. The Vue tabs are thin callers. `MatchDirector` is written against a narrow context interface (not `Game` itself) so it unit-tests under plain Vitest with no p5 globals. Saved kits are a separate `localStorage` module under their own key.

**Tech Stack:** TypeScript, Vue 3 (`<script setup>`), p5.js global mode, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-practice-panel-design.md`

## Global Constraints

- **The match is paused while the panel is open.** `Game.update()` and `Game.draw()` return early when `paused` (`Game.ts:252`, `Game.ts:257`), so `ObjectManager.update()` does not run. Spawns and removals land on the first unpaused tick. Never write a test or a UI affordance that assumes a mutation is visible on the canvas while the panel is open.
- **The panel never writes `lol2d:pregameConfig:v1`.** Saved kits use their own key, `lol2d:savedKits:v1`, and only on an explicit user save.
- **No p5 globals at module eval time.** Anything touching `createVector`, `deltaTime`, `push`, `fill` etc. must run inside `setup()` or later. `MatchDirector` must not reference them at all — see `src/main.ts`'s file comment.
- **Prettier:** 2 spaces, single quotes, trailing commas, 100 columns (`.prettierrc`). Do not run `prettier --write` across files you did not otherwise change.
- **Tuning values are exported constants** from the module that owns them, so tests import them instead of copying numbers.
- **`npm run verify` must pass** before any task is considered done: `assets:check` + `ability:check` + `typecheck` + `typecheck:core` + full Vitest + `build`.
- Existing constants to reuse, never redefine: `CDR_PERCENT_MIN` = 0, `CDR_PERCENT_MAX` = 90, `AI_COUNT_MIN` = 0, `AI_COUNT_MAX` = 10 (all `src/game/config/PregameConfig.ts`).
- **uuid:** this repo does not use the `uuid` package (it is an unused dependency with no types installed). Use `import { uuidv4 } from '../utils'` — the hand-rolled generator at `src/utils/index.ts:28`, which is what `Game.ts:24` imports.
- **`localStorage` does not exist in the test environment.** `vitest.config.ts` sets `environment: 'node'` and `tests/setup.ts` stubs p5 globals only. Any suite touching storage must install `MemoryStorage` via `vi.stubGlobal('localStorage', …)` in `beforeEach` and `vi.unstubAllGlobals()` in `afterEach`, exactly as `tests/game/config/PregameConfig.test.ts` does.

- **`Array.prototype.filter` cannot narrow a type in this repo.** `src/types/global.d.ts:78-84` re-declares the optimized array methods (see CLAUDE.md's "Polyfills" note), and a merged `interface Array<T>` puts that `filter(cb: (value, index) => boolean): T[]` overload ahead of the built-in type-predicate one — so `objects.filter((o): o is AIChampion => …)` is typed `GameObject[]` and fails to assign. The four existing call sites in `src/` survive only because they narrow `T | null` to `T`, which collapses under `strict: false`. **Write a hand-rolled loop**, not a cast: a cast asserts a narrowing the compiler could have checked.

### Test-harness facts every task's tests depend on

Learned the hard way in Task 1. Every code block below that calls
`createVector` or builds a stub spell is affected — including Tasks 4, 5 and 6.

- **`createGame()` does not install the p5 globals.** `tests/setup.ts:9` stubs
  `createVector` as a bare `vi.fn()` returning `undefined`, so any test that
  constructs a unit needs `beforeEach(() => stubGameGlobals())` and
  `afterEach(() => vi.unstubAllGlobals())`, both from `tests/game/fixtures.ts`
  (`stubGameGlobals` is at `:65`).
- **A stub spell needs `targetingMode`.** `Spell.castSpec` throws without one
  (`Spell.ts:266`), and `applyPreset` → `replaceSpells` → `removeSpell` →
  `deactivate()` builds the runtime, so a bare `class X extends Spell { name;
  coolDown }` blows up. Give every stub `targetingMode = 'SELF' as const;`.
- **`ChampionPresetFactory` requires an avatar:**
  `() => ChampionPresetData & { avatar: AssetKey }` (`AIChampion.ts:17`). A
  preset fixture without one does not typecheck as a factory return — wrap it
  in a helper with a documented cast rather than loosening the type.
- **Never let a test fall through to `getChampionPresetRandom`.** It resolves a
  real asset key and drags the asset manifest into a unit test. Always pass an
  explicit `presetFactory`.

## Working-tree hygiene — read before your first commit

> **Updated after Task 7.** The 44 files of uncommitted work that made this
> section necessary have been reviewed and committed as `7ac4b85`, `06e29d8`,
> `116ea3a`, `e8eab22`, `e077e3a` and `eebd0f5`, and the four staged `.vue`
> deletions went with them. **The working tree is clean.** Rule 2 below no
> longer applies to anything — Tasks 8-11 commit normally, one checkpoint each.
> Rule 1 stands on its own merits: keep using the pathspec form so a commit
> contains what you meant and nothing else.

This branch was **dirty before any of this work started**. About 45 files carried
uncommitted changes, and four `src/scenes/setup/*.vue` deletions sat **staged in
the index**. Two rules followed, and the second caused one near-miss:

1. **`git add <paths>` followed by a bare `git commit` commits the whole index,
   not just the paths you added.** Always use the pathspec form, which commits
   only the named paths and leaves the rest of the index exactly as it was:

   ```bash
   git commit -m "your message" -- path/one.ts path/two.test.ts
   ```

   Never `git add -A`, never `git add .`, never a bare `git commit`. Never a
   directory as a path (`tests/game/minions/` swept in two unrelated modified
   files) — name every file.

   **A pathspec commit cannot commit a file git has never seen** — it fails with
   `pathspec … did not match any file(s) known to git`. Every task here creates
   files, so the working sequence is: `git add` each *named* new file (a single
   named path is safe; it is the bare `git commit` afterwards that is not), then
   the pathspec commit listing every path:

   ```bash
   git add src/game/NewThing.ts tests/game/practice/NewThing.test.ts
   git commit -m "your message" -- src/game/NewThing.ts tests/game/practice/NewThing.test.ts src/game/Existing.ts
   ```

2. **These files already contain someone else's uncommitted work. Do not commit
   them at all.** Make your edits, verify them, and then *report* rather than
   commit; the human will slice their own working tree:

   `styles/hud.css`, `styles/pregame-scene.css`, `styles/main.css`,
   `src/game/hud/hudInteractions.ts`, `src/game/hud/InGameHUD.vue`,
   `src/game/hud/DesktopHudView.vue`, `src/game/hud/MobileHudView.vue`,
   `src/game/hud/SpellPickerModal.vue`,
   `src/scenes/setup/LoadoutEditorModal.vue`, `src/scenes/setup/KitRoster.vue`

   ~~This makes Tasks 8, 9, 10 and 11 no-commit tasks.~~ **Obsolete — see the
   note at the top of this section. All of those files are committed; commit
   your work normally.**

## Dependency order

Tasks 1, 2 and 3 are independent of each other and of everything else — they can run in parallel. Task 4 needs 1. Task 5 needs 4. Task 6 needs 3 and 4. Task 7 needs 4-6. Tasks 8 onward are UI and need 7.

---

### Task 1: `Champion.applyPreset` — extract it, and fix the respawn bug

`Champion`'s constructor sets `name`, `spells` and three attack stats from a preset. `AIChampion.respawn()` does the same job for a bot rolling a new champion, except it only restores `avatar` and `spells` — **a bot that respawns as a new champion keeps the previous champion's name, attack damage, attack speed and attack range.** That is a live bug. Extracting one method and routing all callers through it fixes it.

**Files:**
- Modify: `src/game/gameObject/attackableUnits/Champion.ts:83-104` (constructor), add `applyPreset`
- Modify: `src/game/gameObject/attackableUnits/AIChampion.ts:299-307` (`respawn`)
- Test: `tests/game/attackableUnits/ChampionPreset.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Champion.prototype.applyPreset(preset: ChampionPresetData): void`, and `AIChampion.prototype.setRespawnRollsNewPreset(on: boolean): void`. Task 4 and Task 7 both call these.

> **Done — commit `116d425`.** The test code below does not run as written; the
> fixes are now in "Test-harness facts" under Global Constraints. One collateral
> change was needed and is included in the commit:
> `tests/game/integration/ChampionSpellLifecycle.test.ts:63` hand-rolls an
> `AIChampion` via `Object.create` with a `stats` stub carrying only `health`
> and `maxHealth`. Routing `respawn()` through `applyPreset` makes it write
> `attackDamage`/`attackSpeed`/`attackRange` too, so the stub gained those three.
> That is a fixture gap, not a design problem — the alternative was a defensive
> guard in production code to accommodate a stub, which is worse.

- [ ] **Step 1: Write the failing test**

Create `tests/game/attackableUnits/ChampionPreset.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Champion, { DEFAULT_CHAMPION_ATTACK } from '../../../src/game/gameObject/attackableUnits/Champion';
import type { ChampionPresetData } from '../../../src/game/gameObject/attackableUnits/Champion';
import Spell from '../../../src/game/gameObject/Spell';
import { createGame } from '../fixtures';

class RedSpell extends Spell {
  name = 'Red';
  coolDown = 1000;
}
class BlueSpell extends Spell {
  name = 'Blue';
  coolDown = 2000;
}

const RED: ChampionPresetData = {
  name: 'Red',
  spells: [RedSpell as never],
  attack: { damage: 11, attacksPerSecond: 1.1, range: 111 },
};
const BLUE: ChampionPresetData = {
  name: 'Blue',
  spells: [BlueSpell as never],
  attack: { damage: 22, attacksPerSecond: 2.2, range: 222 },
};

const makeChampion = (preset: ChampionPresetData) => {
  const game = createGame();
  const champion = new Champion({ game, position: createVector(0, 0), preset });
  game.setPlayer(champion);
  return champion;
};

describe('Champion.applyPreset', () => {
  it('is what the constructor uses, so a fresh champion carries its preset', () => {
    const champion = makeChampion(RED);
    expect(champion.name).toBe('Red');
    expect(champion.spells.map(s => s.name)).toEqual(['Red']);
    expect(champion.stats.attackDamage.baseValue).toBe(11);
    expect(champion.stats.attackSpeed.baseValue).toBe(1.1);
    expect(champion.stats.attackRange.baseValue).toBe(111);
  });

  it('replaces name, spells and every attack stat together', () => {
    const champion = makeChampion(RED);
    champion.applyPreset(BLUE);

    expect(champion.name).toBe('Blue');
    expect(champion.spells.map(s => s.name)).toEqual(['Blue']);
    expect(champion.stats.attackDamage.baseValue).toBe(22);
    expect(champion.stats.attackSpeed.baseValue).toBe(2.2);
    expect(champion.stats.attackRange.baseValue).toBe(222);
  });

  it('falls back to DEFAULT_CHAMPION_ATTACK when the preset has no attack profile', () => {
    const champion = makeChampion(RED);
    champion.applyPreset({ name: 'Plain', spells: [] });

    expect(champion.stats.attackDamage.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.damage);
    expect(champion.stats.attackSpeed.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.attacksPerSecond);
    expect(champion.stats.attackRange.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.range);
  });

  it('leaves health and mana alone — refilling the bars is applyLoadout\'s job, not this one', () => {
    const champion = makeChampion(RED);
    champion.stats.health.baseValue = 7;
    champion.applyPreset(BLUE);
    expect(champion.stats.health.baseValue).toBe(7);
  });
});
```

Then create `tests/game/attackableUnits/AIChampionRespawn.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { DEFAULT_CHAMPION_ATTACK } from '../../../src/game/gameObject/attackableUnits/Champion';
import type { ChampionPresetData } from '../../../src/game/gameObject/attackableUnits/Champion';
import Spell from '../../../src/game/gameObject/Spell';
import { createGame } from '../fixtures';

class RedSpell extends Spell {
  name = 'Red';
  coolDown = 1000;
}
class BlueSpell extends Spell {
  name = 'Blue';
  coolDown = 2000;
}

const RED: ChampionPresetData = {
  name: 'Red',
  spells: [RedSpell as never],
  attack: { damage: 11, attacksPerSecond: 1.1, range: 111 },
};
const BLUE: ChampionPresetData = {
  name: 'Blue',
  spells: [BlueSpell as never],
  attack: { damage: 22, attacksPerSecond: 2.2, range: 222 },
};

describe('AIChampion.respawn with a new preset', () => {
  it('restores the whole champion, not just its avatar and spells', () => {
    const game = createGame();
    const bot = new AIChampion({
      game,
      position: createVector(0, 0),
      preset: RED,
      presetFactory: () => BLUE,
    });
    game.setPlayer(bot);

    bot.respawn();

    expect(bot.spells.map(s => s.name)).toEqual(['Blue']);
    // The bug: these three and the name used to keep Red's values forever.
    expect(bot.name).toBe('Blue');
    expect(bot.stats.attackDamage.baseValue).toBe(22);
    expect(bot.stats.attackSpeed.baseValue).toBe(2.2);
    expect(bot.stats.attackRange.baseValue).toBe(222);
  });

  it('keeps the current champion when respawn rolls are switched off', () => {
    const game = createGame();
    const bot = new AIChampion({
      game,
      position: createVector(0, 0),
      preset: RED,
      presetFactory: () => BLUE,
    });
    game.setPlayer(bot);

    bot.setRespawnRollsNewPreset(false);
    bot.respawn();

    expect(bot.name).toBe('Red');
    expect(bot.spells.map(s => s.name)).toEqual(['Red']);
    expect(bot.stats.attackDamage.baseValue).toBe(11);
  });

  it('still refills health, which is super.respawn()\'s job', () => {
    const game = createGame();
    const bot = new AIChampion({ game, position: createVector(0, 0), preset: RED });
    game.setPlayer(bot);
    bot.stats.health.baseValue = 1;

    bot.respawn();

    expect(bot.stats.health.baseValue).toBe(bot.stats.maxHealth.value);
    expect(DEFAULT_CHAMPION_ATTACK.damage).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/game/attackableUnits/ChampionPreset.test.ts tests/game/attackableUnits/AIChampionRespawn.test.ts`

Expected: FAIL — `champion.applyPreset is not a function`, `bot.setRespawnRollsNewPreset is not a function`, and the name/attack-stat assertions in the respawn test fail even once the methods exist, because that is the bug.

- [ ] **Step 3: Add `applyPreset` and route the constructor through it**

In `src/game/gameObject/attackableUnits/Champion.ts`, replace the tail of the constructor:

```ts
  constructor({ game, position, collisionRadius, visionRadius, teamId, id, stats, avatar, preset }: ChampionOptions) {
    super({
      game,
      position,
      collisionRadius,
      visionRadius,
      teamId,
      id,
      avatar: avatar ?? (preset?.avatar ? AssetManager.get(preset.avatar) : undefined),
      stats,
    });

    this.score = 0;
    if (preset) this.applyPreset(preset);
    else this.applyAttackTuning(DEFAULT_CHAMPION_ATTACK);
  }

  /**
   * Everything a `ChampionPresetData` decides about a champion, in one place.
   *
   * Written as a method rather than left in the constructor because a champion
   * takes a preset in three different situations, not one: at construction, on
   * a respawn that rolls a new champion (`AIChampion.respawn`), and when the
   * practice panel swaps a champion under a unit that is standing there
   * (`MatchDirector.applyLoadout`). Those used to be three partial copies of
   * this, and the respawn copy restored only `avatar` and `spells` — so a bot
   * that respawned as a new champion kept the old one's name and its attack
   * damage, speed and range for the rest of the match.
   *
   * Deliberately does NOT touch health or mana. The constructor must not (the
   * unit is still being built) and `respawn()` must not (`super.respawn()` has
   * already refilled). Refilling on a live champion swap is specific to that
   * one case and belongs to `MatchDirector.applyLoadout`.
   */
  applyPreset(preset: ChampionPresetData): void {
    this.name = preset.name;
    if (preset.avatar) this.avatar = AssetManager.get(preset.avatar);
    this.replaceSpells((preset.spells ?? []).map(SpellClass => new SpellClass(this)));
    this.applyAttackTuning(preset.attack ?? DEFAULT_CHAMPION_ATTACK);
  }

  private applyAttackTuning(attack: ChampionAttackTuning): void {
    this.stats.attackDamage.baseValue = attack.damage;
    this.stats.attackSpeed.baseValue = attack.attacksPerSecond;
    this.stats.attackRange.baseValue = attack.range;
  }
```

- [ ] **Step 4: Route `AIChampion.respawn` through it and type the flag**

In `src/game/gameObject/attackableUnits/AIChampion.ts`, replace `respawn()`:

```ts
  respawn() {
    super.respawn();
    if (this._respawnWithNewPreset) this.applyPreset(this.presetFactory());
  }

  /**
   * Whether the next respawn rolls this bot's champion again. On by default —
   * a bot left on "random" re-rolls every life, which is the game's own
   * behaviour. The in-game picker's "Clone my spells" turns it off so a bot
   * handed the player's kit keeps it (see `hudInteractions.ts`).
   */
  setRespawnRollsNewPreset(on: boolean): void {
    this._respawnWithNewPreset = on;
  }

  /** What the next respawn would roll from. `MatchDirector.applyLoadout` rewrites this so a champion swap survives death. */
  setPresetFactory(factory: ChampionPresetFactory): void {
    this.presetFactory = factory;
  }
```

`presetFactory` is `private`; `setPresetFactory` is how Task 5 reaches it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/game/attackableUnits/`
Expected: PASS, all cases.

- [ ] **Step 6: Run the full suite — this touches a class everything extends**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. If a test fails on a champion's attack stats, the constructor's no-preset path is wrong — a champion built with no preset must still get `DEFAULT_CHAMPION_ATTACK`, which is what the old code did implicitly via `preset?.attack ?? DEFAULT_CHAMPION_ATTACK`.

- [ ] **Step 7: Commit**

```bash
git add src/game/gameObject/attackableUnits/Champion.ts src/game/gameObject/attackableUnits/AIChampion.ts tests/game/attackableUnits/
git commit -m "fix(champion): restore name and attack stats on a respawn that rolls a new champion

Extracts the constructor's preset handling into Champion.applyPreset and
routes AIChampion.respawn through it. That copy only ever restored avatar
and spells, so a bot that respawned as a new champion kept the previous
one's name, attack damage, attack speed and range for the rest of the match."
```

---

### Task 2: The saved-kit library

Independent of everything else. A named `ChampionLoadout` you can save from either screen and apply to the player or any bot.

**Files:**
- Create: `src/game/config/savedKits.ts`
- Test: `tests/game/config/savedKits.test.ts`

**Interfaces:**
- Consumes: `ChampionLoadout` from `src/game/config/PregameConfig.ts`.
- Produces: `SavedKit`, `loadSavedKits()`, `saveKit(name, loadout)`, `renameKit(id, name)`, `deleteKit(id)`, `SAVED_KITS_STORAGE_KEY`, `SAVED_KIT_NAME_MAX`. Tasks 10 and 11 consume all of these.

> **Done — commit `050dae2`.** Two corrections, both now folded into Global
> Constraints above: the `uuid` import in Step 3's code is wrong (use
> `import { uuidv4 } from '../utils'`), and Step 1's
> `beforeEach(() => localStorage.clear())` cannot work under `environment: 'node'`
> (install `MemoryStorage` via `vi.stubGlobal`, as `PregameConfig.test.ts` does).
> Both code blocks are left as written for the record.

- [ ] **Step 1: Write the failing test**

Create `tests/game/config/savedKits.test.ts`. Read `tests/game/config/PregameConfig.test.ts` first and follow its `localStorage` setup exactly.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAVED_KITS_STORAGE_KEY,
  SAVED_KIT_NAME_MAX,
  deleteKit,
  loadSavedKits,
  renameKit,
  saveKit,
} from '../../../src/game/config/savedKits';
import type { ChampionLoadout } from '../../../src/game/config/PregameConfig';

const LOADOUT: ChampionLoadout = {
  mode: 'custom',
  championName: 'random',
  summonerD: 'Flash',
  summonerF: 'Heal',
  customSlots: ['BasicAttack', 'Ahri_Q', 'Yasuo_W', 'Zed_E', 'Lux_R', 'Flash', 'Heal'],
};

beforeEach(() => localStorage.clear());

describe('savedKits', () => {
  it('round-trips a kit', () => {
    const saved = saveKit('Zed tàng hình', LOADOUT);
    expect(saved.name).toBe('Zed tàng hình');
    expect(saved.loadout).toEqual(LOADOUT);
    expect(saved.id).toBeTruthy();
    expect(saved.savedAt).toBeGreaterThan(0);

    expect(loadSavedKits()).toEqual([saved]);
  });

  it('keeps kits newest first', () => {
    const first = saveKit('A', LOADOUT);
    const second = saveKit('B', LOADOUT);
    expect(loadSavedKits().map(k => k.id)).toEqual([second.id, first.id]);
  });

  it('renames and deletes by id', () => {
    const kit = saveKit('old', LOADOUT);
    renameKit(kit.id, 'new');
    expect(loadSavedKits()[0].name).toBe('new');

    deleteKit(kit.id);
    expect(loadSavedKits()).toEqual([]);
  });

  it('ignores a rename or delete for an id that is not there', () => {
    saveKit('keep', LOADOUT);
    renameKit('nope', 'x');
    deleteKit('nope');
    expect(loadSavedKits()).toHaveLength(1);
  });

  it('trims and caps a name, and refuses an empty one', () => {
    const kit = saveKit(`  ${'x'.repeat(SAVED_KIT_NAME_MAX + 20)}  `, LOADOUT);
    expect(kit.name).toHaveLength(SAVED_KIT_NAME_MAX);
    expect(() => saveKit('   ', LOADOUT)).toThrow();
  });

  it('reads a corrupt blob as an empty library rather than throwing', () => {
    localStorage.setItem(SAVED_KITS_STORAGE_KEY, '{not json');
    expect(loadSavedKits()).toEqual([]);
  });

  it('drops a malformed entry and keeps the sound ones', () => {
    const good = saveKit('good', LOADOUT);
    const raw = JSON.parse(localStorage.getItem(SAVED_KITS_STORAGE_KEY)!);
    raw.push({ id: 'bad', name: 'bad' }); // no loadout
    raw.push({ id: 'bad2', loadout: LOADOUT }); // no name
    raw.push(null);
    localStorage.setItem(SAVED_KITS_STORAGE_KEY, JSON.stringify(raw));

    expect(loadSavedKits().map(k => k.id)).toEqual([good.id]);
  });

  it('never touches the pregame config key', () => {
    saveKit('a', LOADOUT);
    expect(localStorage.getItem('lol2d:pregameConfig:v1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/game/config/savedKits.test.ts`
Expected: FAIL — cannot resolve `src/game/config/savedKits`.

- [ ] **Step 3: Write the module**

Create `src/game/config/savedKits.ts`:

```ts
/**
 * The saved-kit library: a named `ChampionLoadout` you can build once and
 * reuse, from the pregame editor or from the in-game practice panel, on
 * yourself or on any bot.
 *
 * Deliberately its own storage key rather than a field inside
 * `lol2d:pregameConfig:v1`. Two reasons. A library grows without bound while
 * the match config is a fixed shape, and a corrupt library must not be able to
 * take a player's match configuration down with it — `loadSavedKits` failing
 * closed to an empty list costs you your saved kits; the same failure inside
 * the pregame blob would cost you your champion, your bots and your rules.
 *
 * It is also the one thing the practice panel writes to `localStorage` at all.
 * The panel's other edits (champion swaps, bot count, CDR, jungle) mutate the
 * running match and nothing else, by design — see the spec. Saving a kit is a
 * different act: the player asked for it, by name, on purpose.
 *
 * Validation follows `sanitizePregameConfig`'s rule, for the same reason:
 * every field independently checked with a per-field fallback, a malformed
 * entry dropped rather than thrown on. A stored kit naming a spell that no
 * longer exists is not this module's problem — `getChampionPresetFromLoadout`
 * already falls back per slot.
 */
import { v4 as uuidv4 } from 'uuid';
import type { ChampionLoadout } from './PregameConfig';
import { SLOT_COUNT } from './PregameConfig';

export const SAVED_KITS_STORAGE_KEY = 'lol2d:savedKits:v1';

/** Long enough for "Ahri nhưng có Flash trên A", short enough to fit a shelf heading. */
export const SAVED_KIT_NAME_MAX = 40;

export interface SavedKit {
  id: string;
  name: string;
  loadout: ChampionLoadout;
  /** Epoch ms. The library is listed newest first. */
  savedAt: number;
}

const isLoadout = (value: unknown): value is ChampionLoadout => {
  if (!value || typeof value !== 'object') return false;
  const loadout = value as Partial<ChampionLoadout>;
  return (
    (loadout.mode === 'champion' || loadout.mode === 'custom') &&
    typeof loadout.championName === 'string' &&
    typeof loadout.summonerD === 'string' &&
    typeof loadout.summonerF === 'string' &&
    Array.isArray(loadout.customSlots) &&
    loadout.customSlots.length === SLOT_COUNT &&
    loadout.customSlots.every(slot => typeof slot === 'string')
  );
};

const isSavedKit = (value: unknown): value is SavedKit => {
  if (!value || typeof value !== 'object') return false;
  const kit = value as Partial<SavedKit>;
  return (
    typeof kit.id === 'string' &&
    kit.id.length > 0 &&
    typeof kit.name === 'string' &&
    kit.name.length > 0 &&
    typeof kit.savedAt === 'number' &&
    isLoadout(kit.loadout)
  );
};

const read = (): SavedKit[] => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVED_KITS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isSavedKit);
};

const write = (kits: SavedKit[]): void => {
  try {
    localStorage.setItem(SAVED_KITS_STORAGE_KEY, JSON.stringify(kits));
  } catch {
    // A full or blocked storage costs the player this save, nothing more.
    // Never let it take down the screen that called us.
  }
};

/** Newest first. Never throws; a corrupt library reads as an empty one. */
export const loadSavedKits = (): SavedKit[] => read();

/** @throws if `name` is blank once trimmed — an unnamed kit is unfindable. */
export const saveKit = (name: string, loadout: ChampionLoadout): SavedKit => {
  const trimmed = name.trim().slice(0, SAVED_KIT_NAME_MAX);
  if (!trimmed) throw new Error('A saved kit needs a name.');

  const kit: SavedKit = {
    id: uuidv4(),
    name: trimmed,
    // Copied, not referenced: the caller's loadout is usually a live draft
    // that keeps being edited after the save.
    loadout: { ...loadout, customSlots: loadout.customSlots.slice() },
    savedAt: Date.now(),
  };
  write([kit, ...read()]);
  return kit;
};

export const renameKit = (id: string, name: string): void => {
  const trimmed = name.trim().slice(0, SAVED_KIT_NAME_MAX);
  if (!trimmed) return;
  write(read().map(kit => (kit.id === id ? { ...kit, name: trimmed } : kit)));
};

export const deleteKit = (id: string): void => {
  write(read().filter(kit => kit.id !== id));
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/game/config/savedKits.test.ts`
Expected: PASS.

If `localStorage` is undefined under your Vitest environment, check what `tests/game/config/PregameConfig.test.ts` does — that suite already solves this, and the fix belongs in the same place it does, not in a new stub.

- [ ] **Step 5: Commit**

```bash
git add src/game/config/savedKits.ts tests/game/config/savedKits.test.ts
git commit -m "feat(config): a saved-kit library under its own storage key"
```

---

### Task 3: `MinionSpawner.enabled`

One flag, so the practice panel can stop the wave clock. It goes on the spawner rather than at `Game.fixedUpdate`'s call site because the spawner already owns the clock and the live cap.

**Files:**
- Modify: `src/game/managers/MinionSpawner.ts:78` (`update`)
- Test: `tests/game/minions/MinionSpawner.enabled.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `MinionSpawner.prototype.enabled: boolean` (default `true`). Task 6 sets it.

> **Done — commit `609b8ed`.** Two corrections came out of it, recorded here
> because the same mistakes are easy to repeat in later tasks:
>
> - The harness is in **`tests/game/minions/MinionSpawner.test.ts`**, not in
>   `Lanes.test.ts` (pure geometry, builds no game) or `Minion.test.ts` (builds
>   a game with no spawner and no fountains). It was lifted into
>   `tests/game/minions/helpers.ts` as `createSpawnerContext()`.
> - **The loop length below is wrong and the test it appears in cannot fail.**
>   200 iterations × the 16ms stubbed `deltaTime` is 3200ms, well under
>   `FIRST_WAVE_DELAY_MS` (8000), so `waveCount` stays 0 whether the flag works
>   or not. Derive loop lengths from the exported constants
>   (`FIRST_WAVE_DELAY_MS`, `WAVE_INTERVAL_MS`), and always pair a "nothing
>   happens" assertion with a positive control proving the same loop *does*
>   make it happen when the flag is on. Left as written for the record.

- [ ] **Step 1: Write the failing test**

Read `tests/game/minions/Lanes.test.ts` and `Minion.test.ts` first for the spawner's existing test harness — reuse its game/fountain setup rather than inventing one.

Create `tests/game/minions/MinionSpawner.enabled.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import MinionSpawner from '../../../src/game/managers/MinionSpawner';
// Reuse whatever Lanes.test.ts / Minion.test.ts use to build a spawner context.
// Do not hand-roll a second one.
import { createSpawnerContext } from './helpers';

describe('MinionSpawner.enabled', () => {
  it('defaults to on, so today\'s behaviour is unchanged', () => {
    const spawner = new MinionSpawner(createSpawnerContext());
    expect(spawner.enabled).toBe(true);
  });

  it('queues no waves while off', () => {
    const spawner = new MinionSpawner(createSpawnerContext());
    spawner.enabled = false;

    const before = spawner.waveCount;
    for (let i = 0; i < 200; i++) spawner.update();

    expect(spawner.waveCount).toBe(before);
    expect(spawner.liveCount).toBe(0);
  });

  it('resumes queueing when switched back on', () => {
    const spawner = new MinionSpawner(createSpawnerContext());
    spawner.enabled = false;
    for (let i = 0; i < 200; i++) spawner.update();

    spawner.enabled = true;
    spawner.queueWave();
    spawner.releaseQueued();

    expect(spawner.waveCount).toBeGreaterThan(0);
  });

  it('still prunes dead minions while off, so turning it off does not leak corpses', () => {
    const spawner = new MinionSpawner(createSpawnerContext());
    spawner.queueWave();
    spawner.releaseQueued();
    const spawned = spawner.liveCount;
    expect(spawned).toBeGreaterThan(0);

    for (const minion of spawner.minions) minion.toRemove = true;
    spawner.enabled = false;
    spawner.update();

    expect(spawner.liveCount).toBe(0);
  });
});
```

If `./helpers` does not exist, create `tests/game/minions/helpers.ts` by lifting the context builder that `Lanes.test.ts` and `Minion.test.ts` already share, and update both to import it. That is a refactor those two files want anyway; do it in this task's commit.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/game/minions/MinionSpawner.enabled.test.ts`
Expected: FAIL — `spawner.enabled` is `undefined`.

- [ ] **Step 3: Add the flag**

In `src/game/managers/MinionSpawner.ts`, add the field beside `waveCount` and gate `update`:

```ts
  /**
   * The wave clock. Off stops queueing and releasing; it does not stop
   * pruning, so minions already dead still leave the list and a field cleared
   * by `MatchDirector` stays cleared. The practice panel's "lính" switch is
   * this and nothing else.
   */
  enabled = true;

  update() {
    this.prune();
    if (!this.enabled) return;

    this._nextWaveIn -= deltaTime;
    if (this._nextWaveIn <= 0) {
      this._nextWaveIn = WAVE_INTERVAL_MS;
      this.queueWave();
    }

    this.releaseQueued();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/game/minions/`
Expected: PASS, including the pre-existing lane and minion suites.

- [ ] **Step 5: Commit**

```bash
git add src/game/managers/MinionSpawner.ts tests/game/minions/
git commit -m "feat(minions): an enabled flag on the wave clock"
```

---

### Task 4: `MatchDirector` — the roster

The class, its context interface, and roster read/add/remove. Champion swapping is Task 5; world and rules are Task 6.

**Files:**
- Create: `src/game/MatchDirector.ts`
- Test: `tests/game/practice/MatchDirector.roster.test.ts` (create)

**Interfaces:**
- Consumes: `Champion.applyPreset` and `AIChampion.setPresetFactory` / `setRespawnRollsNewPreset` (Task 1).
- Produces: `MatchDirector` (default export), `MatchDirectorContext`, `BotBehaviour`, `RosterEntry`. Tasks 5, 6, 7 extend the class; tasks 9-10 call it.

> **Done — commit `a42839f`.** The `MatchDirectorContext` in Step 3's code below
> is **wrong and was replaced**; the spec's version is wrong the same way. It
> declared a narrow structural interface and then smuggled it past the compiler
> with `game: this.game as never` inside `addBot` — but `addBot` hands that
> context to the bot *as the bot's own game*, and from the next tick the bot
> reaches for `eventManager`, `navigation`, `createSpellContext`, `mapSize` and
> `objectManager.queryObjects` on its own. It failed with
> `Cannot read properties of undefined (reading 'emit')` from `Spell.press` —
> **intermittently**, because it needs the bot's `random() < 0.1` auto-cast roll
> to come up, so a shallower run would have committed a landmine for Task 7.
>
> The shipped interface is `MatchDirectorContext extends GameObjectRuntimeContext`,
> narrowing `player` to `Champion` and adding `monsters` / `minionSpawner` /
> `matchRules` / `spawnJungle`. No cast anywhere. This costs nothing:
> `GameObjectRuntimeContext` is a plain interface that `tests/game/fixtures.ts`'s
> `createGame()` already satisfies with no p5 scene and no `Game`, so the
> unit-testability the whole design rests on is intact — and `Game` satisfies it
> unchanged, so **Task 7's wiring is a one-liner**.
>
> In the test bench `context` and `game` are now the same object, as they are in
> production. Tasks 5 and 6 still destructure `{ context, game, player }` from
> `context()` in `tests/game/practice/helpers.ts`, and `ctx.monsters = …` /
> `ctx.spawnJungle = vi.fn()` still work.

- [ ] **Step 1: Write the failing test**

Create `tests/game/practice/MatchDirector.roster.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import type { MatchDirectorContext } from '../../../src/game/MatchDirector';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { DEFAULT_CHAMPION_LOADOUT } from '../../../src/game/config/PregameConfig';
import { createGame } from '../fixtures';

const context = () => {
  const game = createGame();
  const player = new Champion({ game, position: createVector(100, 100) });
  game.setPlayer(player);
  game.objectManager.addObject(player);
  game.objectManager.update();

  return {
    context: {
      objectManager: game.objectManager,
      player,
      randomSpawnPoint: () => createVector(500, 500),
      monsters: [],
      minionSpawner: { minions: [], enabled: true },
      matchRules: { cooldownMultiplier: 1, manaFree: false },
      spawnJungle: () => {},
    } as unknown as MatchDirectorContext,
    game,
    player,
  };
};

describe('MatchDirector roster', () => {
  it('lists the player first, then every live bot in spawn order', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);

    const first = director.addBot(DEFAULT_CHAMPION_LOADOUT);
    const second = director.addBot(DEFAULT_CHAMPION_LOADOUT);
    game.objectManager.update();

    const roster = director.roster();
    expect(roster).toHaveLength(3);
    expect(roster[0].isPlayer).toBe(true);
    expect(roster[0].unit).toBe(ctx.player);
    expect(roster[1].unit).toBe(first);
    expect(roster[2].unit).toBe(second);
  });

  it('reports behaviour flags for bots and none for the player', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    director.addBot(DEFAULT_CHAMPION_LOADOUT);
    game.objectManager.update();

    const [player, bot] = director.roster();
    expect(player.behaviour).toBeUndefined();
    expect(bot.behaviour).toEqual({ autoMove: false, autoAttack: true, autoCast: true });
  });

  it('a new bot is not in the world until the paused match ticks again', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);

    director.addBot(DEFAULT_CHAMPION_LOADOUT);
    expect(director.roster()).toHaveLength(1);

    game.objectManager.update();
    expect(director.roster()).toHaveLength(2);
  });

  it('removeBot marks the unit and it leaves on the next tick', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT);
    game.objectManager.update();

    director.removeBot(bot);
    expect(bot.toRemove).toBe(true);

    game.objectManager.update();
    expect(director.roster()).toHaveLength(1);
  });

  it('refuses to remove the player', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);

    director.removeBot(player as unknown as AIChampion);

    expect(player.toRemove).toBeFalsy();
  });

  it('caps the bot count at AI_COUNT_MAX', async () => {
    const { AI_COUNT_MAX } = await import('../../../src/game/config/PregameConfig');
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);

    for (let i = 0; i < AI_COUNT_MAX + 5; i++) {
      director.addBot(DEFAULT_CHAMPION_LOADOUT);
      game.objectManager.update();
    }

    expect(director.roster().filter(entry => !entry.isPlayer)).toHaveLength(AI_COUNT_MAX);
  });

  it('setBotBehaviour writes only the flags it is given', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT);
    game.objectManager.update();

    director.setBotBehaviour(bot, { autoMove: true });

    const entry = director.roster().find(e => e.unit === bot)!;
    expect(entry.behaviour).toEqual({ autoMove: true, autoAttack: true, autoCast: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/game/practice/MatchDirector.roster.test.ts`
Expected: FAIL — cannot resolve `src/game/MatchDirector`.

- [ ] **Step 3: Write the class**

Create `src/game/MatchDirector.ts`:

```ts
/**
 * Every mutation of a *running* match, in one place.
 *
 * The pregame config describes a match that does not exist yet; this describes
 * changes to one that does. They look similar and are not: "remove bot 3" is
 * an array splice on one side and, on the other, marking a unit for the
 * quadtree sweep, dropping its pathfinding agent, and letting everything it
 * owns unwind. Trying to serve both through one interface is where this would
 * have gone wrong, so they stay separate — see the spec.
 *
 * Written against `MatchDirectorContext`, not `Game`, so it unit-tests under
 * plain Vitest with no p5 globals and no scene. `Game` satisfies the interface
 * structurally; nothing else needs to.
 *
 * ## Nothing here takes effect immediately, and that is the design
 *
 * The panel that drives this only opens with the match paused, and
 * `Game.update()` returns early while paused — so `ObjectManager.update()`,
 * which is what actually flushes `_objectToBeAdd` and sweeps `toRemove`, does
 * not run. Every spawn and removal lands on the first unpaused tick. The
 * picker already batches picks behind Huỷ / Xác nhận; this keeps that
 * contract for the rest of the match's settings.
 */
import AIChampion from './gameObject/attackableUnits/AIChampion';
import Champion from './gameObject/attackableUnits/Champion';
import { AI_COUNT_MAX } from './config/PregameConfig';
import type { ChampionLoadout } from './config/PregameConfig';
import type { MatchRules } from './config/PregameConfig';
import { getChampionPresetFromLoadout } from './preset';
import type GameObject from './gameObject/GameObject';
import type Monster from './gameObject/attackableUnits/Monster';

export interface BotBehaviour {
  autoMove: boolean;
  autoAttack: boolean;
  autoCast: boolean;
}

export interface RosterEntry {
  unit: Champion;
  isPlayer: boolean;
  /** Bots only — the player has no behaviour to configure. */
  behaviour?: BotBehaviour;
}

/** What `MatchDirector` needs from a match. `Game` satisfies this structurally. */
export interface MatchDirectorContext {
  objectManager: {
    objects: GameObject[];
    addObject(object: GameObject): void;
  };
  player: Champion;
  randomSpawnPoint(): { x: number; y: number };
  monsters: Monster[];
  minionSpawner: { minions: { toRemove: boolean }[]; enabled: boolean };
  matchRules: MatchRules;
  spawnJungle(): void;
}

export default class MatchDirector {
  constructor(private readonly game: MatchDirectorContext) {}

  /**
   * The player first, then every live bot in spawn order. One definition of
   * "who is in this match" — `hudInteractions.ts` used to filter the object
   * list for `AIChampion` itself, in two places, through an `any` cast.
   */
  roster(): RosterEntry[] {
    const player: RosterEntry = { unit: this.game.player, isPlayer: true };
    return [player, ...this.bots().map(unit => ({ unit, isPlayer: false, behaviour: behaviourOf(unit) }))];
  }

  bots(): AIChampion[] {
    return this.game.objectManager.objects.filter(
      (object): object is AIChampion => object instanceof AIChampion && !object.toRemove
    );
  }

  /**
   * Spawns a bot at a fountain spawn point, capped at the same `AI_COUNT_MAX`
   * the pregame screen enforces. Returns the bot, which enters the world on
   * the next unpaused tick; a caller that needs it in `roster()` right away is
   * asking the wrong question (see the file comment).
   */
  addBot(loadout: ChampionLoadout): AIChampion | null {
    if (this.bots().length >= AI_COUNT_MAX) return null;

    const spawn = this.game.randomSpawnPoint();
    const bot = new AIChampion({
      game: this.game as never,
      position: createVector(spawn.x, spawn.y),
      preset: getChampionPresetFromLoadout(loadout),
      presetFactory: () => getChampionPresetFromLoadout(loadout),
    });
    this.game.objectManager.addObject(bot);
    return bot;
  }

  /** No-op on the player: a match with nobody in it is not a state the panel can offer. */
  removeBot(unit: Champion): void {
    if (unit === this.game.player) return;
    if (!(unit instanceof AIChampion)) return;
    unit.toRemove = true;
  }

  setBotBehaviour(bot: AIChampion, flags: Partial<BotBehaviour>): void {
    if (flags.autoMove !== undefined) bot._autoMove = flags.autoMove;
    if (flags.autoAttack !== undefined) bot._autoAttack = flags.autoAttack;
    if (flags.autoCast !== undefined) bot._autoCast = flags.autoCast;
  }
}

const behaviourOf = (bot: AIChampion): BotBehaviour => ({
  autoMove: bot._autoMove,
  autoAttack: bot._autoAttack,
  autoCast: bot._autoCast,
});
```

`addBot` returns `AIChampion | null` — the cap is real and the caller has to see it. Update the test's `addBot` uses to assert non-null where it matters (`const bot = director.addBot(...)!`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/game/practice/MatchDirector.roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/MatchDirector.ts tests/game/practice/
git commit -m "feat(practice): MatchDirector, and the match roster it owns"
```

---

### Task 5: `MatchDirector.applyLoadout` — swap a champion in place

**Files:**
- Modify: `src/game/MatchDirector.ts`
- Test: `tests/game/practice/MatchDirector.loadout.test.ts` (create)

**Interfaces:**
- Consumes: Task 4's class, Task 1's `applyPreset` / `setPresetFactory`.
- Produces: `MatchDirector.prototype.applyLoadout(unit: Champion, loadout: ChampionLoadout): void`. Tasks 9-10 call it.

- [ ] **Step 1: Write the failing test**

Create `tests/game/practice/MatchDirector.loadout.test.ts`, reusing the `context()` helper from Task 4's file (export it from there, or lift both into `tests/game/practice/helpers.ts` — do not copy it).

```ts
import { describe, expect, it } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import { context } from './helpers';

const AHRI: ChampionLoadout = { ...DEFAULT_CHAMPION_LOADOUT, mode: 'champion', championName: 'Ahri' };
const ZED: ChampionLoadout = { ...DEFAULT_CHAMPION_LOADOUT, mode: 'champion', championName: 'Zed' };

describe('MatchDirector.applyLoadout', () => {
  it('keeps the unit exactly where it stands', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    player.position.set(1234, 5678);

    director.applyLoadout(player, ZED);

    expect(player.position.x).toBe(1234);
    expect(player.position.y).toBe(5678);
  });

  it('swaps the kit', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    director.applyLoadout(player, AHRI);
    const ahriSpells = player.spells.map(s => s.constructor.name);

    director.applyLoadout(player, ZED);

    expect(player.spells.map(s => s.constructor.name)).not.toEqual(ahriSpells);
  });

  it('refills health and mana — trying a champion on 12 HP is not trying it', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    player.stats.health.baseValue = 12;
    player.stats.mana.baseValue = 3;

    director.applyLoadout(player, ZED);

    expect(player.stats.health.baseValue).toBe(player.stats.maxHealth.value);
    expect(player.stats.mana.baseValue).toBe(player.stats.maxMana.value);
  });

  it('hands over fresh spells, so nothing arrives mid-cooldown', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    director.applyLoadout(player, ZED);

    expect(player.spells.every(spell => spell.currentCooldown === 0)).toBe(true);
  });

  it('makes a bot keep its new champion across a respawn', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(AHRI)!;
    game.objectManager.update();

    director.applyLoadout(bot, ZED);
    const afterSwap = bot.name;
    bot.respawn();

    expect(bot.name).toBe(afterSwap);
  });
});
```

Import `ChampionLoadout` and `DEFAULT_CHAMPION_LOADOUT` from `src/game/config/PregameConfig`. Confirm the exact `currentCooldown` property name against `src/game/gameObject/Spell.ts` before writing the assertion — if it is named differently there, use the real name.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/game/practice/MatchDirector.loadout.test.ts`
Expected: FAIL — `director.applyLoadout is not a function`.

- [ ] **Step 3: Implement it**

Add to `src/game/MatchDirector.ts`:

```ts
  /**
   * Swaps a champion under a unit that is standing there — the whole point of
   * a practice tool. Position, team and any orders in flight are untouched;
   * the kit, name, avatar and attack profile all come from the new loadout,
   * and the bars are refilled because a Yasuo on 12 HP that becomes a Zed on
   * 12 HP is not what "try this champion now" means.
   *
   * For a bot this also rewrites `presetFactory`, so the identity the player
   * just chose survives the bot's next death instead of being re-rolled.
   */
  applyLoadout(unit: Champion, loadout: ChampionLoadout): void {
    unit.applyPreset(getChampionPresetFromLoadout(loadout));
    unit.stats.health.baseValue = unit.stats.maxHealth.value;
    unit.stats.mana.baseValue = unit.stats.maxMana.value;

    if (unit instanceof AIChampion) {
      unit.setPresetFactory(() => getChampionPresetFromLoadout(loadout));
      unit.setRespawnRollsNewPreset(true);
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/game/practice/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/MatchDirector.ts tests/game/practice/
git commit -m "feat(practice): swap a champion in place, keeping position and refilling bars"
```

---

### Task 6: `MatchDirector` — world and rules

**Files:**
- Modify: `src/game/MatchDirector.ts`
- Test: `tests/game/practice/MatchDirector.world.test.ts` (create)

**Interfaces:**
- Consumes: Task 3's `MinionSpawner.enabled`, Task 4's class.
- Produces: `jungleEnabled` / `minionsEnabled` accessors, `setRules(rules: MatchRulesConfig)`, `getRules(): MatchRulesConfig`. Task 9 calls all four.

- [ ] **Step 1: Write the failing test**

Create `tests/game/practice/MatchDirector.world.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import { context } from './helpers';

describe('MatchDirector world', () => {
  it('clears every monster when the jungle goes off', () => {
    const { context: ctx } = context();
    const monsters = [{ toRemove: false }, { toRemove: false }];
    ctx.monsters = monsters as never;
    const director = new MatchDirector(ctx);

    director.jungleEnabled = false;

    expect(monsters.every(m => m.toRemove)).toBe(true);
    expect(ctx.monsters).toHaveLength(0);
    expect(director.jungleEnabled).toBe(false);
  });

  it('re-runs spawnJungle when it goes back on', () => {
    const { context: ctx } = context();
    ctx.spawnJungle = vi.fn();
    const director = new MatchDirector(ctx);

    director.jungleEnabled = false;
    director.jungleEnabled = true;

    expect(ctx.spawnJungle).toHaveBeenCalledTimes(1);
    expect(director.jungleEnabled).toBe(true);
  });

  it('does not respawn the jungle when it is already on', () => {
    const { context: ctx } = context();
    ctx.spawnJungle = vi.fn();
    const director = new MatchDirector(ctx);

    director.jungleEnabled = true;

    expect(ctx.spawnJungle).not.toHaveBeenCalled();
  });

  it('clears the field and stops the clock when minions go off', () => {
    const { context: ctx } = context();
    const minions = [{ toRemove: false }, { toRemove: false }];
    ctx.minionSpawner = { minions, enabled: true } as never;
    const director = new MatchDirector(ctx);

    director.minionsEnabled = false;

    expect(minions.every(m => m.toRemove)).toBe(true);
    expect(ctx.minionSpawner.enabled).toBe(false);
  });
});

describe('MatchDirector rules', () => {
  it('writes the derived multipliers Spell.ts reads live', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    director.setRules({ cooldownReductionPercent: 40, manaFree: true });

    expect(ctx.matchRules.cooldownMultiplier).toBeCloseTo(0.6);
    expect(ctx.matchRules.manaFree).toBe(true);
  });

  it('mutates the object Game already handed out rather than replacing it', () => {
    const { context: ctx } = context();
    const rules = ctx.matchRules;
    const director = new MatchDirector(ctx);

    director.setRules({ cooldownReductionPercent: 10, manaFree: false });

    expect(ctx.matchRules).toBe(rules);
  });

  it('clamps out-of-range CDR the same way the pregame screen does', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    director.setRules({ cooldownReductionPercent: 999, manaFree: false });

    expect(director.getRules().cooldownReductionPercent).toBe(90);
  });

  it('a spell built before the change reports the new cooldown — the live claim, asserted', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    const spell = player.spells[0];
    if (!spell) return;
    const before = spell.effectiveCoolDownMs;

    director.setRules({ cooldownReductionPercent: 50, manaFree: false });

    expect(spell.effectiveCoolDownMs).toBeLessThan(before);
  });
});
```

Check `Spell.ts` for the real name of the effective-cooldown accessor before writing that last case; `Spell.ts:320` is where the multiplier is read.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/game/practice/MatchDirector.world.test.ts`
Expected: FAIL — `jungleEnabled` is undefined.

- [ ] **Step 3: Implement it**

Add to `src/game/MatchDirector.ts` (and import `toMatchRules`, `clampInt` equivalents from `./config/PregameConfig` — reuse `toMatchRules`, do not recompute the multiplier):

```ts
  private _jungleEnabled = true;
  private _rules: MatchRulesConfig = { cooldownReductionPercent: 0, manaFree: false };

  get jungleEnabled(): boolean {
    return this._jungleEnabled;
  }

  /**
   * Off clears the camps; on respawns them from `MonsterPreset` through
   * `Game.spawnJungle()`, which is the one definition of where a camp lives.
   * Setting it to what it already is does nothing — flipping "on" twice must
   * not stack a second set of camps on the first.
   */
  set jungleEnabled(on: boolean) {
    if (on === this._jungleEnabled) return;
    this._jungleEnabled = on;

    if (on) {
      this.game.spawnJungle();
      return;
    }
    for (const monster of this.game.monsters) monster.toRemove = true;
    this.game.monsters.length = 0;
  }

  get minionsEnabled(): boolean {
    return this.game.minionSpawner.enabled;
  }

  /** Off stops the wave clock and clears the field; the spawner keeps pruning either way. */
  set minionsEnabled(on: boolean) {
    this.game.minionSpawner.enabled = on;
    if (on) return;
    for (const minion of this.game.minionSpawner.minions) minion.toRemove = true;
  }

  getRules(): MatchRulesConfig {
    return { ...this._rules };
  }

  /**
   * `Spell.ts` reads `game.matchRules` at cast time (`:320`, `:369`), not at
   * construction, so this is the whole of applying a rule change mid-match —
   * every spell already built picks it up on its next cast. Mutates the
   * existing object rather than replacing it, because `Game` handed that
   * reference out to every spell context already.
   */
  setRules(rules: MatchRulesConfig): void {
    this._rules = {
      cooldownReductionPercent: Math.min(
        CDR_PERCENT_MAX,
        Math.max(CDR_PERCENT_MIN, Math.round(rules.cooldownReductionPercent) || 0)
      ),
      manaFree: !!rules.manaFree,
    };
    const derived = toMatchRules(this._rules);
    this.game.matchRules.cooldownMultiplier = derived.cooldownMultiplier;
    this.game.matchRules.manaFree = derived.manaFree;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/game/practice/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/MatchDirector.ts tests/game/practice/
git commit -m "feat(practice): jungle, minion and match-rule control on MatchDirector"
```

---

### Task 7: Wire it to `Game`, and clean up `hudInteractions`

**Files:**
- Modify: `src/game/Game.ts:107-189` (constructor), add a `director` field
- Modify: `src/game/hud/hudInteractions.ts:299-322`
- Test: `tests/game/practice/MatchDirector.roster.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 4-6.
- Produces: `game.director: MatchDirector`. Every UI task reaches it through `hud`.

- [ ] **Step 1: Construct the director in `Game`**

In `src/game/Game.ts`, after `this.minionSpawner = new MinionSpawner(this);` (line ~185):

```ts
    // Last: it reads the roster, the spawner and the rules, so all three have
    // to exist. Nothing in the constructor uses it — it is the entry point for
    // changes made *during* the match (see MatchDirector's file comment).
    this.director = new MatchDirector(this);
```

Declare it beside `minionSpawner`:

```ts
  director!: MatchDirector;
```

Seed it with the config's own rules so `getRules()` starts truthful:

```ts
    this.director.setRules(pregameConfig.rules);
```

Place that immediately after the `new MatchDirector(this)` line. Note `this.matchRules` was already assigned at line 114 from the same source, so this changes no behaviour — it only teaches the director what the match started with.

- [ ] **Step 2: Replace the `any` casts in `hudInteractions`**

In `src/game/hud/hudInteractions.ts`, `confirmPicks` currently does:

```ts
const bots = game.objectManager.objects.filter((o: any) => o instanceof AIChampion);
```

and reaches `bot._respawnWithNewPreset` through `(bot: any)`. Replace with:

```ts
      const bots = game.director.bots();
```

and each `bot._respawnWithNewPreset = false` with `bot.setRespawnRollsNewPreset(false)`, each `= true` with `(true)`. Drop the now-unneeded `any` annotations on the `forEach` parameters — they are `AIChampion` now.

- [ ] **Step 3: Extend the roster test to cover the seeding**

Add to `tests/game/practice/MatchDirector.roster.test.ts`:

```ts
  it('getRules starts as whatever the match was configured with', () => {
    const { context: ctx } = context();
    ctx.matchRules = { cooldownMultiplier: 0.7, manaFree: true };
    const director = new MatchDirector(ctx);
    director.setRules({ cooldownReductionPercent: 30, manaFree: true });

    expect(director.getRules()).toEqual({ cooldownReductionPercent: 30, manaFree: true });
  });
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run typecheck:core && npx vitest run`
Expected: PASS. The typecheck is the real gate here — removing the `any` casts is only safe if `game.director.bots()` really is `AIChampion[]`.

- [ ] **Step 5: Drive the game to confirm nothing regressed**

Run: `node tests/e2e/drive-mobile-hud.mjs /tmp/lol2d-mh`
Expected: all 17 checks PASS. "Clone my spells" runs through the flag that just changed shape.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.ts src/game/hud/hudInteractions.ts tests/game/practice/
git commit -m "feat(practice): hang MatchDirector off Game, and type the bot roster it replaces"
```

---

### Task 8: `PracticePanel.vue` — the tab shell

The modal stops being a spell picker that happens to be a modal, and becomes a panel whose first tab is the spell picker.

**Files:**
- Create: `src/game/hud/PracticePanel.vue`
- Modify: `src/game/hud/SpellPickerModal.vue` (becomes a tab body: drop the outer `.spell-picker` wrapper's role as the modal root)
- Modify: `src/game/hud/InGameHUD.vue:82-83`
- Modify: `styles/hud.css` (tab bar)

**Interfaces:**
- Consumes: `hud.showSpellsPicker`, `hud.closeSpellPicker()`, `hud.confirmPicks()` (all existing).
- Produces: the `.practice-tab` / `.practice-panel` class names Task 12's e2e script drives.

- [ ] **Step 1: Read the two files you are restructuring**

Read `src/game/hud/SpellPickerModal.vue` in full — its file comment explains why the sticky header works the way it does and why a flex shell was rejected. The scroll container must stay `.spell-picker` with `overflow-y: auto`; `tests/e2e/drive-mobile-hud.mjs:237` scrolls exactly that element and `:91` depends on `.picker-header` being sticky inside it.

- [ ] **Step 2: Create the shell**

Create `src/game/hud/PracticePanel.vue`:

```vue
<script setup lang="ts">
/**
 * The in-game practice panel: four tabs over one paused match.
 *
 * This is the old `SpellPickerModal` grown a tab bar. That modal was the only
 * thing in the game you could change without quitting to the setup screen, and
 * it could change exactly one thing — your own seven slots. Everything else
 * that shapes a match (who you are fighting, how many, cooldowns, whether the
 * jungle exists) meant abandoning the match and rebuilding it.
 *
 * Every tab writes through `hud.director` (`MatchDirector`), never into
 * `localStorage`: the panel reshapes *this* match and leaves the setup
 * screen's stored configuration alone. The one exception is the saved-kit
 * library, which the player fills on purpose, by name.
 *
 * The tab bar is `.pregame-tabs` from styles/pregame-scene.css, not a copy of
 * it — both stylesheets load globally (index.html:22-27) and the two screens
 * share the `--hextech-*` palette, so the setup screen's tabs and these are
 * one control with one definition.
 */
import { ref } from 'vue';
import type { HudState } from './hudState';
import SpellPickerModal from './SpellPickerModal.vue';
import RosterTab from './practice/RosterTab.vue';
import RulesTab from './practice/RulesTab.vue';
import WorldTab from './practice/WorldTab.vue';

defineProps<{ state: HudState }>();

const TABS = [
  { id: 'spells', label: 'Chiêu thức' },
  { id: 'roster', label: 'Đấu thủ' },
  { id: 'rules', label: 'Trận đấu' },
  { id: 'world', label: 'Thế giới' },
] as const;

const tab = ref<(typeof TABS)[number]['id']>('spells');
</script>

<template>
  <div class="practice-panel">
    <div class="pregame-tabs practice-tabs">
      <button
        v-for="item in TABS"
        :key="item.id"
        type="button"
        class="pregame-tab practice-tab"
        :class="{ selected: tab === item.id }"
        :id="`practice-tab-${item.id}`"
        @click="tab = item.id"
        @touchend.prevent="tab = item.id"
      >
        {{ item.label }}
      </button>
    </div>

    <SpellPickerModal v-show="tab === 'spells'" :state="state" />
    <RosterTab v-if="tab === 'roster'" />
    <RulesTab v-if="tab === 'rules'" />
    <WorldTab v-if="tab === 'world'" />
  </div>
</template>
```

`v-show` on the spell tab, `v-if` on the rest: the picker owns scroll position and staged `draftSpells`, and re-mounting it on every tab switch would throw both away. The other three read their state from the director on mount, so they cost nothing to rebuild and gain nothing from being kept alive.

- [ ] **Step 3: Point `InGameHUD.vue` at the panel**

In `src/game/hud/InGameHUD.vue`, the picker is currently rendered from inside `DesktopHudView` / `MobileHudView`. Find where `SpellPickerModal` is mounted (grep both view components) and replace that mount with `PracticePanel`, passing the same `:state`. Do not mount it twice.

- [ ] **Step 4: Style the tab bar**

In `styles/hud.css`, in the Spell Picker section, add:

```css
/* The panel's tab bar. `.pregame-tabs`/`.pregame-tab` in
   styles/pregame-scene.css do the work; these two rules only fit that control
   into a modal that has less vertical room than a full setup screen, and pin
   it above the scrolling tab body the way `.picker-header` is pinned. */
.practice-tabs {
  position: sticky;
  top: 0;
  z-index: 13;
  background: var(--hextech-bg);
  margin-bottom: 0;
  padding-top: 0.6rem;
}

.practice-tab {
  padding: 0.4rem 0.3rem;
  font-size: 0.85em;
}
```

- [ ] **Step 5: Verify by looking at it**

Run `npm run dev`, open the game, press the corner wand button. Confirm: four tabs, the spell roster still scrolls, the slot row still sticks, Huỷ and Xác nhận still work. Then:

Run: `node tests/e2e/drive-mobile-hud.mjs /tmp/lol2d-mh`
Expected: all 17 PASS. If the scroll check at step "a touch drag inside the picker scrolls it" fails, the scroll container moved — `.spell-picker` must stay the element with `overflow-y: auto`.

- [ ] **Step 6: Commit**

```bash
git add src/game/hud/PracticePanel.vue src/game/hud/InGameHUD.vue src/game/hud/DesktopHudView.vue src/game/hud/MobileHudView.vue styles/hud.css
git commit -m "feat(practice): a tab shell around the in-game picker"
```

---

### Task 9: `RulesTab` and `WorldTab`

The two small tabs, together — each is a handful of controls over the director and neither is worth its own review gate.

**Files:**
- Create: `src/game/hud/practice/RulesTab.vue`
- Create: `src/game/hud/practice/WorldTab.vue`
- Modify: `styles/hud.css`

**Interfaces:**
- Consumes: `hud.director.getRules() / setRules() / jungleEnabled / minionsEnabled` (Task 6), `CDR_PERCENT_MIN`, `CDR_PERCENT_MAX`.
- Produces: `#practice-cdr`, `#practice-urf`, `#practice-jungle`, `#practice-minions` — the ids Task 12 drives.

- [ ] **Step 1: Read the pregame originals**

Read `src/scenes/setup/MatchRulesPanel.vue` and reproduce its control markup and its labels. These are the same two settings; they should read identically in both places. Do not invent new copy.

- [ ] **Step 2: Write `RulesTab.vue`**

```vue
<script setup lang="ts">
/**
 * CDR and URF, mid-match. `Spell.ts` reads `game.matchRules` at cast time
 * rather than capturing it at construction (`:320`, `:369`), so moving this
 * slider changes the cooldown of spells that already exist, on their next
 * cast — no respawn, no rebuild. That is the whole reason this tab is cheap
 * and the roster tab is not.
 *
 * Same two controls and the same copy as `MatchRulesPanel.vue` on the setup
 * screen, pointed at the live match instead of at `localStorage`.
 */
import { inject, ref } from 'vue';
import type { HudInteractions } from '../hudInteractions';
import { CDR_PERCENT_MAX, CDR_PERCENT_MIN } from '../../config/PregameConfig';

const hud = inject<HudInteractions>('hud')!;
const rules = ref(hud.director.getRules());

const push = (): void => hud.director.setRules(rules.value);
</script>

<template>
  <div class="practice-tab-body">
    <label class="pregame-field">
      <span>Giảm hồi chiêu: {{ rules.cooldownReductionPercent }}%</span>
      <input
        id="practice-cdr"
        type="range"
        :min="CDR_PERCENT_MIN"
        :max="CDR_PERCENT_MAX"
        v-model.number="rules.cooldownReductionPercent"
        @input="push"
      />
    </label>

    <label class="pregame-toggle">
      <input id="practice-urf" type="checkbox" v-model="rules.manaFree" @change="push" />
      <span>URF — mọi chiêu không tốn mana</span>
    </label>
  </div>
</template>
```

- [ ] **Step 3: Write `WorldTab.vue`**

```vue
<script setup lang="ts">
/**
 * What exists in the world besides the champions: the jungle camps and the
 * lane minions.
 *
 * Both switches take effect on the first unpaused tick, not while you are
 * looking at them — the panel opens paused and `ObjectManager.update()` is
 * what sweeps removed units out (see `MatchDirector`'s file comment). Turning
 * the jungle back on re-runs `Game.spawnJungle()`, so the camps return at
 * their `MonsterPreset` positions rather than wherever they had wandered.
 */
import { inject, ref } from 'vue';
import type { HudInteractions } from '../hudInteractions';

const hud = inject<HudInteractions>('hud')!;
const jungle = ref(hud.director.jungleEnabled);
const minions = ref(hud.director.minionsEnabled);
</script>

<template>
  <div class="practice-tab-body">
    <label class="pregame-toggle">
      <input
        id="practice-jungle"
        type="checkbox"
        v-model="jungle"
        @change="hud.director.jungleEnabled = jungle"
      />
      <span>Quái rừng</span>
    </label>

    <label class="pregame-toggle">
      <input
        id="practice-minions"
        type="checkbox"
        v-model="minions"
        @change="hud.director.minionsEnabled = minions"
      />
      <span>Lính</span>
    </label>

    <p class="practice-note">Thay đổi có hiệu lực khi bạn đóng bảng và trận chạy tiếp.</p>
  </div>
</template>
```

- [ ] **Step 4: Expose the director on `hud`**

`RulesTab` and `WorldTab` reach `hud.director`. Add it in `src/game/hud/hudInteractions.ts` where the other `game`-derived members are exposed, typed as `MatchDirector`, and add it to the `HudInteractions` interface at `:136`.

- [ ] **Step 5: Style the tab bodies**

In `styles/hud.css`:

```css
.practice-tab-body {
  padding: 0.8rem 0.2rem;
}

.practice-note {
  margin: 0.8rem 0 0;
  font-size: 0.75em;
  color: var(--hextech-muted);
  font-style: italic;
}
```

- [ ] **Step 6: Verify by hand**

`npm run dev`, open the panel, Trận đấu tab, drag CDR to 90, close, cast a spell, confirm it comes off cooldown visibly faster. Thế giới tab, turn the jungle off, close, confirm the camps are gone.

- [ ] **Step 7: Commit**

```bash
git add src/game/hud/practice/ src/game/hud/hudInteractions.ts styles/hud.css
git commit -m "feat(practice): match-rule and world tabs"
```

---

### Task 10: `RosterTab`

**Files:**
- Create: `src/game/hud/practice/RosterTab.vue`
- Modify: `styles/hud.css`

**Interfaces:**
- Consumes: `hud.director.roster() / addBot() / removeBot() / applyLoadout() / setBotBehaviour()`, `LoadoutEditorModal` from `src/scenes/setup/`, `DEFAULT_CHAMPION_LOADOUT`.
- Produces: `.practice-roster-row`, `.practice-add-bot`, `.practice-remove-bot` — the class names Task 12 drives.

- [ ] **Step 1: Read `ParticipantCard.vue` and `LoadoutEditorModal.vue`**

`src/scenes/setup/ParticipantCard.vue` is the row shape to follow. `LoadoutEditorModal.vue` is the editor to reuse verbatim — it already takes a `loadout`, a `matchRules` and an `isTouchUi` prop and emits `change` with a `ChampionLoadout`, which is exactly what `applyLoadout` wants. Do not build a second editor.

- [ ] **Step 2: Write the component**

```vue
<script setup lang="ts">
/**
 * The live roster: who is in this match, and every knob on each of them.
 *
 * Reuses `LoadoutEditorModal` from the setup screen unchanged. It already
 * emits a `ChampionLoadout`, which is precisely what
 * `MatchDirector.applyLoadout` consumes — the difference between the two
 * screens is what happens to that loadout afterwards, not how it is chosen,
 * so there is one editor and one roster, not two of each.
 *
 * A champion swap lands on the unit where it stands, with its bars refilled
 * (see `applyLoadout`). Adding and removing a bot does not show until the
 * panel closes and the match ticks — nothing here is drawn on a paused canvas.
 */
import { computed, inject, ref } from 'vue';
import type { HudInteractions } from '../hudInteractions';
import type { RosterEntry } from '../../MatchDirector';
import type { ChampionLoadout } from '../../config/PregameConfig';
import { DEFAULT_CHAMPION_LOADOUT } from '../../config/PregameConfig';
import LoadoutEditorModal from '../../../scenes/setup/LoadoutEditorModal.vue';

const hud = inject<HudInteractions>('hud')!;

/** Re-read after every mutation: the director is the source of truth, this is a view of it. */
const version = ref(0);
const roster = computed<RosterEntry[]>(() => {
  version.value;
  return hud.director.roster();
});

const editing = ref<RosterEntry | null>(null);

const addBot = (): void => {
  hud.director.addBot(DEFAULT_CHAMPION_LOADOUT);
  version.value++;
};

const removeBot = (entry: RosterEntry): void => {
  hud.director.removeBot(entry.unit);
  version.value++;
};

const applyLoadout = (loadout: ChampionLoadout): void => {
  if (editing.value) hud.director.applyLoadout(editing.value.unit, loadout);
  editing.value = null;
  version.value++;
};

const atCap = computed(() => roster.value.filter(entry => !entry.isPlayer).length >= 10);
</script>

<template>
  <div class="practice-tab-body">
    <div
      v-for="(entry, index) in roster"
      :key="index"
      class="practice-roster-row"
      :class="{ 'is-player': entry.isPlayer }"
    >
      <button type="button" class="practice-roster-open" @click="editing = entry">
        <span class="practice-roster-name">
          {{ entry.isPlayer ? 'Bạn' : entry.unit.name ?? 'Bot' }}
        </span>
      </button>

      <label v-if="entry.behaviour" class="practice-flag">
        <input
          type="checkbox"
          :checked="entry.behaviour.autoMove"
          @change="hud.director.setBotBehaviour(entry.unit as never, { autoMove: ($event.target as HTMLInputElement).checked }); version++"
        />
        <span>Di chuyển</span>
      </label>
      <label v-if="entry.behaviour" class="practice-flag">
        <input
          type="checkbox"
          :checked="entry.behaviour.autoAttack"
          @change="hud.director.setBotBehaviour(entry.unit as never, { autoAttack: ($event.target as HTMLInputElement).checked }); version++"
        />
        <span>Đánh</span>
      </label>
      <label v-if="entry.behaviour" class="practice-flag">
        <input
          type="checkbox"
          :checked="entry.behaviour.autoCast"
          @change="hud.director.setBotBehaviour(entry.unit as never, { autoCast: ($event.target as HTMLInputElement).checked }); version++"
        />
        <span>Chiêu</span>
      </label>

      <button
        v-if="!entry.isPlayer"
        type="button"
        class="practice-remove-bot"
        title="Xoá"
        @click="removeBot(entry)"
      >
        <i class="fas fa-times"></i>
      </button>
    </div>

    <button type="button" class="practice-add-bot" :disabled="atCap" @click="addBot">
      <i class="fas fa-plus"></i> Thêm bot
    </button>

    <p class="practice-note">Thêm và xoá có hiệu lực khi bạn đóng bảng và trận chạy tiếp.</p>

    <LoadoutEditorModal
      v-if="editing"
      title="Đổi tướng"
      :loadout="DEFAULT_CHAMPION_LOADOUT"
      :match-rules="hud.director.getRules()"
      :is-touch-ui="hud.touchUi"
      @change="applyLoadout"
      @close="editing = null"
    />
  </div>
</template>
```

Two things to resolve while implementing, both flagged rather than guessed:

1. `LoadoutEditorModal`'s `matchRules` prop expects a `MatchRules` (`{ cooldownMultiplier, manaFree }`), not a `MatchRulesConfig`. Pass `hud.game.matchRules`, not `getRules()`. Fix the binding above accordingly.
2. The `:loadout` binding passes `DEFAULT_CHAMPION_LOADOUT`, which throws away what the unit currently is. `MatchDirector` does not currently remember the loadout a unit was built from. **Add it**: store the last applied `ChampionLoadout` per unit in a `WeakMap<Champion, ChampionLoadout>` inside `MatchDirector`, written by `addBot` and `applyLoadout`, exposed as `loadoutOf(unit): ChampionLoadout`. `Game` seeds it for the player and the initial bots. Extend Task 4/5's tests to cover it.

- [ ] **Step 3: Style the rows**

Follow `.participant-card` in `styles/pregame-scene.css` for the row's look; add only the rules the narrower modal needs.

- [ ] **Step 4: Verify by hand**

`npm run dev`. Add a bot, close, confirm it appears. Change its champion, close, confirm the unit is a different champion *at the same place on the map*. Remove it, close, confirm it is gone.

- [ ] **Step 5: Commit**

```bash
git add src/game/hud/practice/RosterTab.vue src/game/MatchDirector.ts tests/game/practice/ styles/hud.css
git commit -m "feat(practice): the live roster tab"
```

---

### Task 11: Saved kits in the roster, on both screens

**Files:**
- Modify: `src/scenes/setup/KitRoster.vue`
- Modify: `src/scenes/setup/LoadoutEditorModal.vue` (the save control)
- Modify: `styles/pregame-scene.css`

**Interfaces:**
- Consumes: Task 2's `savedKits.ts`.
- Produces: `.saved-kit-shelf`, `.saved-kit-apply`, `.saved-kit-save` — Task 12 drives these.

- [ ] **Step 1: Add the save control to the editor**

In `LoadoutEditorModal.vue`, beside Huỷ / Xác nhận, add a "Lưu bộ" button that prompts for a name and calls `saveKit(name, draft.value)`. Use the existing `.kit-bar-btn` styling. Saving does not close the editor and does not commit the draft — those are separate acts.

- [ ] **Step 2: Add the shelf to `KitRoster.vue`**

Above the existing "Ngẫu Nhiên" card, render one `.saved-kit-shelf` per `loadSavedKits()` entry: its name, an apply button that emits the kit's `loadout`, and a delete button. Emit a new `applySavedKit` event; `LoadoutEditorModal` handles it by replacing `draft.value` wholesale.

Both screens get this for free — `KitRoster` is already shared between the pregame editor and (via Task 8) the in-game panel.

- [ ] **Step 3: Verify**

`npm run dev`. On the setup screen, build a kit, save it as "test", cancel out. Re-open: the shelf is there. Apply it — the slot row fills. Start a match, open the practice panel's Chiêu thức tab: the same shelf is there.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/setup/ styles/pregame-scene.css
git commit -m "feat(setup): save a kit and reuse it in any match, from either screen"
```

---

### Task 12: End-to-end drive

**Files:**
- Create: `tests/e2e/drive-practice-panel.mjs`

- [ ] **Step 1: Write the script**

Model it on `tests/e2e/drive-kit-builder.mjs` (its harness: own Vite server, system Chrome, `window.__lol2d`). Cover, each as a `check(...)`:

1. the corner button opens a panel with four tabs
2. Đấu thủ: add a bot → close → `game.director.roster()` has one more, and the bot is in `objectManager.objects`
3. change that bot's champion → close → its `name` changed and its `position` is the same as before the swap
4. remove it → close → it is gone from `objectManager.objects`
5. Trận đấu: drag `#practice-cdr` to 90 → `game.matchRules.cooldownMultiplier` is 0.1, and a spell instance that existed before the drag reports the lower effective cooldown
6. Thế giới: uncheck `#practice-jungle` → close → `game.monsters` is empty
7. Chiêu thức: the roster still scrolls and Xác nhận still applies a pick (regression guard on Task 8)
8. save a kit from the panel, reload the page, start a new match, confirm the shelf is still there

- [ ] **Step 2: Run it**

Run: `node tests/e2e/drive-practice-panel.mjs /tmp/lol2d-practice`
Expected: every check PASS, `--- page errors ---` empty.

- [ ] **Step 3: Full verification**

Run: `npm run verify`
Then: `node tests/e2e/drive-kit-builder.mjs /tmp/kb && node tests/e2e/drive-pregame-config.mjs /tmp/pc && node tests/e2e/drive-mobile-hud.mjs /tmp/mh`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/drive-practice-panel.mjs
git commit -m "test(e2e): drive the practice panel end to end"
```

---

## Self-review notes

- **Spec coverage.** Four tabs: Chiêu thức (Task 8), Đấu thủ (Task 10), Trận đấu (Task 9), Thế giới (Task 9). Saved kits: Tasks 2 and 11. `MatchDirector`: Tasks 4-7. `applyPreset` + respawn bug: Task 1. `MinionSpawner.enabled`: Task 3. Verification: every task plus Task 12.
- **Gap found and closed during review.** The spec's `MatchDirector` API has no way to read back the `ChampionLoadout` a unit was built from, but `RosterTab` needs it to open the editor on the unit's *current* kit rather than on a default. Task 10 Step 2 note 2 adds `loadoutOf` and the `WeakMap` behind it. Implementers of Tasks 4 and 5 should expect Task 10 to extend their tests.
- **Naming consistency checked:** `applyPreset`, `applyLoadout`, `setRespawnRollsNewPreset`, `setPresetFactory`, `jungleEnabled`, `minionsEnabled`, `setRules`, `getRules`, `roster`, `bots`, `addBot`, `removeBot`, `setBotBehaviour` are used identically in every task that mentions them.
- **Known soft spot.** Task 10's `version` counter is a blunt way to re-read the director after a mutation. It is honest (the director is the source of truth and Vue cannot observe a plain class) and cheap at ten rows. If it turns ugly, the fix is to make `MatchDirector` emit through the existing `EventManager` rather than to add reactivity to the class.
