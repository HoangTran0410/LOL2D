import type { ContentApi } from './ContentApi';

/**
 * What a content pack is, and why the code half is a function.
 *
 * A pack's contract splits into a data half (`ContentPackData` — manifest,
 * champions, spell display, monsters, maps: read to draw a picker) and a code
 * half (`ContentPackCode` — spells: real engine classes). `ContentPack`, the
 * union every existing reader still names, is their intersection.
 *
 * The code half stays a factory taking core's API, because the alternative is
 * a pack that bundles its own copy of `Spell`, `SpellObject` and the buffs —
 * and then there are two classes of every name in the process. `instanceof`
 * stops answering, `Z_INDEX_MAP` is looked up by base-class identity so a
 * pack's spell object matches no key and falls to z-index 99 on top of every
 * champion, and the buff registry exists twice. One core, handed in.
 *
 * The reason the split exists at all: reading a pack's *data* — its champion
 * list, a map to offer in a picker — used to mean building that whole engine
 * surface first, because the one function a pack exported needed the api to
 * run. A menu screen that only wants names and icons now never has to.
 *
 * The same shape also loads at runtime, which is the whole point:
 *
 *     Stage 1  import code from '@lol2d/content-riot'          -> code(api)
 *     Stage 2  const { default: code } = await import(url)     -> code(api)
 *
 * so batch 2 changes `install.ts` and nothing a pack author wrote.
 */
export type ContentPackFactory = (api: ContentApi) => ContentPackCode;

export interface PackManifest {
  /** A bare identifier. It becomes the prefix in every `<packId>:<localId>`. */
  id: string;
  version: string;
  /** Which core versions this pack was built against. */
  coreRange: string;
}

/** A spell class. Loose on purpose — `spellRegistry.SpellClass` is `any` too. */
export type SpellClass = new (...args: never[]) => unknown;

/** A spell class that has not been fetched yet. Resolved at most once. */
export type SpellLoader = () => Promise<SpellClass>;

/**
 * How a pack hands over a spell.
 *
 * A class outright for a small pack; a thunk for a large one. The Riot pack is
 * 240 spells behind `src/generated/spellModules.ts`'s dynamic imports, and
 * handing those over eagerly would put every spell in the game into the first
 * chunk a match downloads — a chunking optimisation this codebase already made
 * once, on purpose, and which nothing in a type would have caught being undone.
 */
export type SpellSource = SpellClass | SpellLoader;

/**
 * Marks a `SpellLoader` explicitly, rather than asking `PackRegistry` to guess.
 *
 * The obvious discriminator — a class has a `prototype`, a loader does not —
 * is only half true: an arrow-function loader indeed has none (an arrow
 * function can never be a class, full stop), but a pack author who writes an
 * ordinary `function` expression as a loader gets one too, and it would be
 * misread as the spell class itself. `PackRegistry` trusts the no-`prototype`
 * case unconditionally and otherwise requires this mark before treating a
 * function as a loader; wrap a `function`-expression loader in `lazy()` and it
 * is read correctly.
 */
const SPELL_LOADER_MARK: unique symbol = Symbol('lol2d.content.spellLoader');

export function lazy(load: SpellLoader): SpellSource {
  return Object.assign(load, { [SPELL_LOADER_MARK]: true as const });
}

/**
 * True when `source` is a loader — a bare arrow function (which structurally
 * can never be a class) or anything wrapped by `lazy()`. Exported for
 * `PackRegistry`, the only reader of `SPELL_LOADER_MARK`.
 */
export function isSpellLoader(source: SpellSource): source is SpellLoader {
  if (typeof source !== 'function') return false;
  if (source.prototype === undefined) return true;
  return (source as unknown as Record<symbol, unknown>)[SPELL_LOADER_MARK] === true;
}

export interface ChampionEntry {
  id: string;
  name: string;
  /** Pack-relative asset key, or null for a champion with no portrait yet. */
  image: string | null;
  /** Local spell ids, in slot order. */
  spells: string[];
  /** Local id of this champion's way home. Absent on a map that grants none. */
  recall?: string;
  /**
   * Whether the pregame screen may offer this as a champion.
   *
   * `false` is the normal answer for a shelf — a group of loose abilities, or
   * a one-ability stub that exists only to widen the random pool. Core used to
   * decide this by testing whether the portrait key started with `champ_`,
   * which is a naming convention no pack has any reason to share.
   */
  playable: boolean;
  /** Basic-attack profile. Omitted means core's `DEFAULT_CHAMPION_ATTACK`. */
  attack?: ChampionAttack;
}

/**
 * One spell's display fields, as data.
 *
 * Field-for-field the same shape `src/generated/spellCatalog.ts` produces, and
 * that is not a coincidence: the pregame screen renders a whole roster without
 * loading a single spell class, and it can only keep doing that if a pack's
 * spells arrive as data too. A pack repo generates this with its own
 * `spell-catalog` command (spec §9) exactly the way core generates its own.
 *
 * `iconKey` is a plain string, not core's generated `AssetKey` union — a
 * pack's art is its own and its keys type-check inside its own build.
 */
export interface SpellDisplayData {
  name: string;
  /** Vietnamese HTML — `<span class="damage">`/`.buff`/`.time`/plain `<span>`. */
  description: string;
  iconKey: string | null;
  /** The spell's own tuning number, before match rules. */
  coolDownMs: number;
  /** The spell's own tuning number, before match rules. */
  manaCost: number;
  /** `castSpec.cooldown.durationMs` — what a countdown runs before CDR. */
  specCoolDownMs: number;
}

/** A champion's basic-attack profile. Absent means core's default. */
export interface ChampionAttack {
  damage: number;
  attacksPerSecond: number;
  range: number;
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

/**
 * A map's cheap half: enough to list, name and describe a world to a picker.
 * `PackRegistry.maps()` returns exactly this, qualified — never the polygons.
 */
export interface MapSummary {
  id: string;
  name: string;
  /** Square edge length in world units. */
  size: number;
  factions: Faction[];
}

/**
 * A map's heavy half: terrain to route and collide against, and the slots
 * fountains, turrets, jungle camps and minions occupy. Fetched only once a
 * match is actually starting — see `MapGeometrySource`.
 */
export interface MapGeometry {
  terrain: {
    wall: { x: number; y: number }[][];
    bush: { x: number; y: number }[][];
    water: { x: number; y: number }[][];
  };
  slots: {
    spawn: SpawnSlot[];
    minion: MinionSlot[];
    structure: StructureSlot[];
    neutral: NeutralSlot[];
  };
  /** Absent on a map with no lanes — no waves, and PUSH falls through. */
  lanes?: LaneDefinition[];
}

/** A map's geometry that has not been fetched yet. Resolved at most once. */
export type MapGeometryLoader = () => Promise<MapGeometry>;

/**
 * How a pack hands over a map's heavy half.
 *
 * A plain object for a small map; a loader for one the size of Summoner's
 * Rift — 395 polygons a menu screen has no business downloading before it has
 * even drawn a picker. See `SpellSource`'s own doc comment; the shape and the
 * reason are identical, one level up.
 */
export type MapGeometrySource = MapGeometry | MapGeometryLoader;

/**
 * A map, as a pack declares it — the eager `MapSummary` a picker lists, plus
 * the (possibly lazy) `geometry` a match actually plays on.
 *
 * Split the way `SpellSource` already splits a spell class from its loader,
 * for the same reason: `size`/`name`/`factions` cost nothing to hold in the
 * menu's own chunk, and `geometry` — the terrain, the slots, the lanes — is
 * the one payload in the whole pack contract bigger than everything else in
 * it combined. See `src/content/maps/summonersRift.ts` for the worked
 * example: its own module holds only the summary, and `geometry` is
 * `() => import('./summonersRiftGeometry')`.
 */
export interface MapDefinition extends MapSummary {
  geometry: MapGeometrySource;
}

/**
 * A map with its geometry already resolved — what `Game` and `TerrainMap`
 * are actually handed once `PackRegistry.loadMapGeometry` has settled.
 * `GameScene.startGame()` is what guarantees that has happened before
 * `new Game(...)` runs; see its own doc comment.
 */
export type ActiveMap = MapSummary & MapGeometry;

/**
 * Everything about a pack that a picker can render without the engine: no
 * spell class, no `ContentApi`, nothing that needs `Spell`/`SpellObject` in
 * scope. `PackRegistry.installData` writes exactly this, and `contentCatalog()`
 * installs only this — see that module's own header for why that closure
 * matters.
 */
export interface ContentPackData {
  manifest: PackManifest;
  champions?: ChampionEntry[];
  /** Keyed by *local* spell id — the same keys as `ContentPackCode.spells`. */
  spellDisplay?: Record<string, SpellDisplayData>;
  monsters?: Record<string, MonsterDef>;
  maps?: MapDefinition[];
}

/**
 * The half of a pack that is real engine classes, and the only half a
 * `ContentPackFactory` ever hands back — see that type's own doc comment for
 * why it still needs the api even though the data half no longer does.
 */
export interface ContentPackCode {
  spells?: Record<string, SpellSource>;
}

/**
 * The whole pack, as every reader from before the split still names it —
 * `PackRegistry.install()` takes one, and both halves' fields stay optional
 * exactly as they were, since an intersection of two interfaces with only
 * optional fields is satisfied by either half alone.
 */
export type ContentPack = ContentPackData & ContentPackCode;

export const STRUCTURE_KINDS: readonly StructureKind[] = Object.freeze(['turret']);
