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
 *
 * Pure data plus storage, like `PregameConfig.ts`: no p5 globals, no Vue, no
 * reach into the game object graph, so it imports safely from anywhere and
 * unit-tests in plain node.
 */
import { uuidv4 } from '@/utils';
import { SLOT_COUNT } from './PregameConfig';
import type { ChampionLoadout } from './PregameConfig';

export const SAVED_KITS_STORAGE_KEY = 'lol2d:savedKits:v1';

/** Long enough for "<champion> nhưng có <summoner spell> trên A", short enough to fit a shelf heading. */
export const SAVED_KIT_NAME_MAX = 40;

export interface SavedKit {
  id: string;
  name: string;
  loadout: ChampionLoadout;
  /** Epoch ms. The library is listed newest first. */
  savedAt: number;
}

/**
 * Unlike `sanitizeChampionLoadout`, which repairs a loadout field by field,
 * this only asks "is this one still sound?" — a kit whose loadout is broken
 * is dropped whole rather than silently resurrected as a random champion the
 * player never saved under that name.
 */
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
    // `localStorage` disabled entirely, or absent (node). Not an error here.
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

/** Silently ignores an unknown id, and a name that is blank once trimmed. */
export const renameKit = (id: string, name: string): void => {
  const trimmed = name.trim().slice(0, SAVED_KIT_NAME_MAX);
  if (!trimmed) return;
  write(read().map(kit => (kit.id === id ? { ...kit, name: trimmed } : kit)));
};

/** Silently ignores an unknown id. */
export const deleteKit = (id: string): void => {
  write(read().filter(kit => kit.id !== id));
};
