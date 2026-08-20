import type { ContentApi } from './ContentApi';

/**
 * What a content pack is, and why it is a function.
 *
 * A pack could have been a module of exports. It is a factory taking core's
 * API instead, because the alternative is a pack that bundles its own copy of
 * `Spell`, `SpellObject` and the buffs — and then there are two classes of
 * every name in the process. `instanceof` stops answering, `Z_INDEX_MAP` is
 * looked up by base-class identity so a pack's spell object matches no key and
 * falls to z-index 99 on top of every champion, and the buff registry exists
 * twice. One core, handed in.
 *
 * The same shape also loads at runtime, which is the whole point:
 *
 *     Stage 1  import factory from '@lol2d/content-riot'      -> factory(api)
 *     Stage 2  const { default: factory } = await import(url) -> factory(api)
 *
 * so batch 2 changes `install.ts` and nothing a pack author wrote.
 */
export type ContentPackFactory = (api: ContentApi) => ContentPack;

export interface PackManifest {
  /** A bare identifier. It becomes the prefix in every `<packId>:<localId>`. */
  id: string;
  version: string;
  /** Which core versions this pack was built against. */
  coreRange: string;
}

/** A spell class. Loose on purpose — `spellRegistry.SpellClass` is `any` too. */
export type SpellClass = new (...args: never[]) => unknown;

export interface ChampionEntry {
  id: string;
  name: string;
  /** Pack-relative asset key, or null for a champion with no portrait yet. */
  image: string | null;
  /** Local spell ids, in slot order. */
  spells: string[];
  /** Local id of this champion's way home. Absent on a map that grants none. */
  recall?: string;
}

export interface MonsterDef {
  id: string;
  name: string;
  /** Slot roles this monster can occupy. Free strings; core only matches. */
  fills: string[];
  health: number;
}

export interface Faction {
  id: string;
}

export interface SpawnSlot {
  faction: string;
  x: number;
  y: number;
  r: number;
}

export interface MinionSlot {
  faction: string;
  lane: string;
  x: number;
  y: number;
}

/** Core's own vocabulary — `Turret` and `Fountain` are core classes. */
export type StructureKind = 'turret';

export interface StructureSlot {
  faction: string;
  kind: StructureKind;
  x: number;
  y: number;
}

export interface NeutralSlot {
  /** A free string a monster's `fills` matches. Core never interprets it. */
  role: string;
  x: number;
  y: number;
  r: number;
}

export interface LaneDefinition {
  id: string;
  from: string;
  to: string;
  waypoints: { x: number; y: number }[];
}

export interface MapDefinition {
  id: string;
  /** Square edge length in world units. */
  size: number;
  terrain: {
    wall: { x: number; y: number }[][];
    bush: { x: number; y: number }[][];
    water: { x: number; y: number }[][];
  };
  factions: Faction[];
  slots: {
    spawn: SpawnSlot[];
    minion: MinionSlot[];
    structure: StructureSlot[];
    neutral: NeutralSlot[];
  };
  /** Absent on a map with no lanes — no waves, and PUSH falls through. */
  lanes?: LaneDefinition[];
}

export interface ContentPack {
  manifest: PackManifest;
  spells?: Record<string, SpellClass>;
  champions?: ChampionEntry[];
  monsters?: Record<string, MonsterDef>;
  maps?: MapDefinition[];
}

export const STRUCTURE_KINDS: readonly StructureKind[] = Object.freeze(['turret']);
