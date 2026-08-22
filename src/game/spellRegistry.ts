import { contentRegistry, resetContentRegistryForTests } from '@/content/registry';
import { BUNDLED_PACK_ID } from '@/content/install';

/**
 * Spell classes, fetched per champion and read back synchronously.
 *
 * ## The problem this solves
 *
 * Spell classes live behind `PackRegistry` now (`@/content/registry`), keyed
 * by qualified id — `riot:<Champion>_Q`, not `<Champion>_Q` — because a second
 * installed pack may reasonably reuse a local name. This module does not own
 * a map of its own any more; it is the thin, bare-id-friendly adapter the
 * rest of the engine already calls. `qualifySpellId` is the seam: a stored
 * loadout in a player's browser holds `"<Champion>_Q"`, and that string keeps
 * meaning "the bundled pack's <Champion>_Q" for as long as this file resolves it
 * that way.
 *
 * ## Why the read side is synchronous
 *
 * Because the engine read side is. `Game` builds the preloaded match plan
 * synchronously and `AIChampion` rebuilds on respawn inside `update()`.
 * Practice-panel changes are the deliberate exception: `MatchDirector` awaits
 * `loadChampionPresetFromLoadout` before it reaches this synchronous seam.
 *
 * So loading is explicit and up front — `loadSpells(ids)` before a match, and
 * `spellClassOfId(id)` during one. The one rule: **anything that resolves an id
 * to a class at match time must have been named in a `loadSpells` beforehand.**
 * `MatchPlan` in `preset.ts` is how that list is computed, `GameScene` is where
 * it is awaited, and `tests/game/spellRegistry.test.ts` pins the contract.
 *
 * ## Random, and why it still works
 *
 * A default match is four `championName: 'random'` loadouts. Each roll chooses
 * one coherent champion row before loading, so `planMatchKits` fetches only
 * those four champions' chunks rather than the full catalogue.
 *
 * Respawns re-roll, which is the one case the plan cannot see ahead. That is
 * what `loadRemainingSpells()` is for: the match starts on its own kits, and the
 * rest of the catalogue streams in behind it, long before anything has died.
 * If a respawn somehow beats that warm-up, its missing slots use the explicit
 * BasicAttack fallback rather than borrowing an unrelated champion's skill.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpellClass = any;

/** Set once `loadRemainingSpells()` has been called, so a second call is free. */
let everythingRequested = false;

/**
 * A bare id means the bundled pack.
 *
 * Loadouts persisted before content became packs hold `"<Champion>_Q"`, and a
 * player's saved kit is not something to throw away over a prefix. A pack id
 * is `[A-Za-z0-9][A-Za-z0-9._-]*` and a colon appears in no local id, so the
 * test is unambiguous.
 */
export const qualifySpellId = (id: string): string =>
  id.includes(':') ? id : `${BUNDLED_PACK_ID}:${id}`;

/**
 * Every id this build can offer a player, loaded or not. Cheap — a name and a
 * lookup, no module fetched.
 *
 * Backed by display data (`PackRegistry.spellDisplayIds`), not `spellIds()`:
 * this is the pool `preset.ts`'s `randomSpellId()` draws a `'random'` slot
 * from and the population a persisted slot is validated against, so an id in
 * here is a promise the HUD can render it. `riot:Recall` is a declared,
 * loadable spell with no display data — it exists so `Champion.recall` can
 * name it — and must never be dealt into an ability slot, which is exactly
 * what leaving it out of this list prevents.
 */
export const allSpellIds = (): string[] => [...contentRegistry().spellDisplayIds()];

/** Same population as `allSpellIds`, as a membership test. */
export const isSpellId = (id: string): boolean =>
  contentRegistry().hasDisplayFor(qualifySpellId(id));

/** Whether `id`'s class is in memory and `spellClassOfId` will answer for it. */
export const isSpellLoaded = (id: string): boolean =>
  contentRegistry().spellClass(qualifySpellId(id)) !== null;

/**
 * The class for an id, or `null` if its module has not been loaded.
 *
 * Callers in the match treat `null` as "not this one" and use their explicit
 * safe fallback. It is deliberately not an exception: a missing module is a
 * scheduling/load failure and must not take down the match.
 */
export const spellClassOfId = (id: string): SpellClass | null =>
  contentRegistry().spellClass(qualifySpellId(id));

/** Every id currently in memory, primarily for diagnostics and tests. */
export const loadedSpellIds = (): string[] => {
  const registry = contentRegistry();
  const out: string[] = [];
  for (const id of registry.spellIds()) {
    if (registry.spellClass(id) !== null) out.push(id);
  }
  return out;
};

/**
 * Fetch these ids' classes. Idempotent, deduplicated, and safe to call with
 * unknown ids (a stale `localStorage` slot naming a spell this build removed).
 *
 * `onSettled` fires once per id in `ids`, after that id is done — loaded,
 * failed, already in memory, or unknown. That "once per id, whatever happened"
 * rule is what makes it usable as a progress count: `GameScene` paints a bar
 * against `ids.length` while a match is waiting, and a bar that could stall
 * short of its own total on a dropped chunk would be worse than none.
 *
 * Delivered in **completion order, not `ids` order** — that is the point of
 * the callback existing at all. `contentRegistry()` is a module-level
 * singleton that outlives one match, so `kitIds` routinely mixes a fresh slow
 * chunk with ids a previous match already resolved; sequencing notification
 * behind `ids`' position would freeze the bar at that slow entry and then
 * jump several steps at once the moment it finally lands. `PackRegistry`
 * already shares one in-flight fetch across every caller asking for the same
 * qualified id, so this module keeps no dedupe map of its own — each entry
 * gets its own `.then(onSettled)`, gathered with one `Promise.all`.
 */
export async function loadSpells(
  ids: readonly string[],
  onSettled?: (id: string) => void
): Promise<void> {
  const registry = contentRegistry();
  const pending: Promise<void>[] = [];

  for (const id of ids) {
    const settled = registry
      .loadSpellClass(qualifySpellId(id))
      .catch(error => {
        // One champion's chunk failing to arrive must not take the match with
        // it: the id stays unloaded, `spellClassOfId` keeps returning null,
        // and whatever asked for it falls back the same way it would for a
        // stale id.
        // eslint-disable-next-line no-console
        console.error(`spellRegistry: could not load ${id}`, error);
      })
      .then(() => onSettled?.(id));
    pending.push(settled);
  }

  await Promise.all(pending);
}

/**
 * Everything not already loaded, in the background.
 *
 * Called once the match is running, never before it: the point is that pressing
 * Chơi waits for six kits rather than the full catalogue. Fire-and-forget by
 * design — the caller has nothing useful to do with the promise, and nothing
 * in a match may block on it.
 */
export function loadRemainingSpells(): Promise<void> {
  if (everythingRequested) return Promise.resolve();
  everythingRequested = true;
  return loadSpells(allSpellIds());
}

/**
 * A random id from what is loaded. Retained as a registry utility/test seam;
 * champion rolls now select a coherent catalogue row instead of composing
 * individual slots from this pool.
 */
export function randomLoadedId(): string | null {
  const ids = loadedSpellIds();
  if (ids.length === 0) return null;
  return ids[Math.floor(Math.random() * ids.length)];
}

/** Test seam: forget everything, so a test can observe a load from empty. */
export function resetSpellRegistryForTests(): void {
  resetContentRegistryForTests();
  everythingRequested = false;
}

/**
 * Test seam: register a class without going through its module.
 *
 * Unit tests build spells directly and never touch the registry; this is for
 * the handful that drive `preset.ts`'s resolution, which would otherwise have
 * to await 238 dynamic imports to assert one lookup. `id` is qualified the
 * same way any other id passed into this module is.
 */
export function registerSpellForTests(id: string, spellClass: SpellClass): void {
  contentRegistry().registerSpellForTests(qualifySpellId(id), spellClass);
}
