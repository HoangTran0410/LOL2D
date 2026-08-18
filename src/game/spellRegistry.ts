import { spellModules } from '@/generated/spellModules';

/**
 * Spell classes, fetched per champion and read back synchronously.
 *
 * ## The problem this solves
 *
 * `preset.ts` opened with `import * as AllSpells`, so every build of the game
 * contained all 238 spell modules in one chunk whether a match used two of them
 * or two hundred. That import is gone; what replaces it is a map of dynamic
 * importers (`src/generated/spellModules.ts`) plus this registry.
 *
 * ## Why the read side is synchronous
 *
 * Because the write side of the engine is. `Game`'s constructor builds the
 * player and every bot inline, `AIChampion` rebuilds its kit on respawn inside
 * `update()`, and `MatchDirector` swaps a live champion's spells from a Vue
 * click handler. Threading `await` through all three would turn a match's boot
 * into an async state machine for no gain, because the answer is always already
 * known by then.
 *
 * So loading is explicit and up front — `loadSpells(ids)` before a match, and
 * `spellClassOfId(id)` during one. The one rule: **anything that resolves an id
 * to a class at match time must have been named in a `loadSpells` beforehand.**
 * `MatchPlan` in `preset.ts` is how that list is computed, `GameScene` is where
 * it is awaited, and `tests/game/spellRegistry.test.ts` pins the contract.
 *
 * ## Random, and why it still works
 *
 * A default match is six `championName: 'random'` loadouts, and a random kit
 * can name any spell in the catalogue — so "load only what the match needs"
 * would have meant loading everything. It does not, because the dice are rolled
 * *before* the load rather than during it: `planMatchKits` picks the ids, and
 * only those champions' chunks are fetched.
 *
 * Respawns re-roll, which is the one case the plan cannot see ahead. That is
 * what `loadRemainingSpells()` is for: the match starts on its own kits, and the
 * rest of the catalogue streams in behind it, long before anything has died.
 * `randomLoadedId` is the backstop for the seconds in between, and it picks from
 * what is loaded rather than failing — a re-roll that quietly repeats a
 * champion is invisible; a crash is not.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpellClass = any;

const loaded = new Map<string, SpellClass>();
/** In-flight loads, so N units asking for the same champion fetch it once. */
const inFlight = new Map<string, Promise<void>>();
let everythingRequested = false;

/** Every id this build knows, loaded or not. Cheap — these are just strings. */
export const allSpellIds = (): string[] => Object.keys(spellModules);

export const isSpellId = (id: string): boolean => id in spellModules;

/** Whether `id`'s module is in memory and `spellClassOfId` will answer for it. */
export const isSpellLoaded = (id: string): boolean => loaded.has(id);

/**
 * The class for an id, or `null` if its module has not been loaded.
 *
 * Callers in the match treat `null` as "not this one" and fall back — see
 * `randomLoadedId`. It is deliberately not an exception: a missing module is a
 * scheduling mistake, and the recovery (play a different spell) is better than
 * the alternative (a dead match).
 */
export const spellClassOfId = (id: string): SpellClass | null => loaded.get(id) ?? null;

/** Every id currently in memory — the pool `random` actually draws from. */
export const loadedSpellIds = (): string[] => [...loaded.keys()];

/**
 * Fetch these ids' modules. Idempotent, deduplicated, and safe to call with
 * unknown ids (a stale `localStorage` slot naming a spell this build removed).
 */
export async function loadSpells(ids: readonly string[]): Promise<void> {
  const pending: Promise<void>[] = [];

  for (const id of ids) {
    if (loaded.has(id)) continue;
    const existing = inFlight.get(id);
    if (existing) {
      pending.push(existing);
      continue;
    }
    const importer = spellModules[id];
    if (!importer) continue;

    const load = importer()
      .then(module => {
        loaded.set(id, module.default);
      })
      .catch(error => {
        // One champion's chunk failing to arrive must not take the match with
        // it: the id stays unloaded, `spellClassOfId` keeps returning null, and
        // whatever asked for it falls back the same way it would for a stale id.
        // eslint-disable-next-line no-console
        console.error(`spellRegistry: could not load ${id}`, error);
      })
      .finally(() => {
        inFlight.delete(id);
      });

    inFlight.set(id, load);
    pending.push(load);
  }

  await Promise.all(pending);
}

/**
 * Everything not already loaded, in the background.
 *
 * Called once the match is running, never before it: the point is that pressing
 * Chơi waits for six kits rather than sixty-six. Fire-and-forget by design — the
 * caller has nothing useful to do with the promise, and nothing in a match may
 * block on it.
 */
export function loadRemainingSpells(): Promise<void> {
  if (everythingRequested) return Promise.resolve();
  everythingRequested = true;
  return loadSpells(allSpellIds());
}

/**
 * A random id from what is *loaded*, for the re-rolls that happen mid-match.
 *
 * Drawing from the loaded pool rather than the full catalogue is the one
 * concession lazy loading asks for, and it is a narrow one: `loadRemainingSpells`
 * makes the two sets identical within a second or so of the match starting, and
 * the first respawn cannot happen before then.
 */
export function randomLoadedId(): string | null {
  if (loaded.size === 0) return null;
  const ids = [...loaded.keys()];
  return ids[Math.floor(Math.random() * ids.length)];
}

/** Test seam: forget everything, so a test can observe a load from empty. */
export function resetSpellRegistryForTests(): void {
  loaded.clear();
  inFlight.clear();
  everythingRequested = false;
}

/**
 * Test seam: register a class without going through its module.
 *
 * Unit tests build spells directly and never touch the registry; this is for
 * the handful that drive `preset.ts`'s resolution, which would otherwise have
 * to await 238 dynamic imports to assert one lookup.
 */
export function registerSpellForTests(id: string, spellClass: SpellClass): void {
  loaded.set(id, spellClass);
}
