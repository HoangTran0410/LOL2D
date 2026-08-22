import AssetManager, { type AssetHandle } from '@/managers/AssetManager';
import { packAsset } from '@/game/config/packAsset';

import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import AreaSpellObject from '@/game/gameObject/spellObjects/AreaSpellObject';
import BeamSpellObject, {
  beamBoundingBox,
  intersectsBeam,
} from '@/game/gameObject/spellObjects/BeamSpellObject';
import HomingMissileSpellObject from '@/game/gameObject/spellObjects/HomingMissileSpellObject';
import AoePulse from '@/game/gameObject/spellObjects/AoePulse';
import { isChargeActivation, requireChargeSpec } from '@/game/spell/runtime/types';
import { lazy } from '@/content/ContentPack';

import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion, { DEFAULT_CHAMPION_ATTACK } from '@/game/gameObject/attackableUnits/Champion';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import Monster from '@/game/gameObject/attackableUnits/Monster';
import { MAX_UNIT_SIZE, StatModifier, StatsModifier } from '@/game/gameObject/Stats';

import Airborne from '@/game/gameObject/buffs/Airborne';
import Charm from '@/game/gameObject/buffs/Charm';
import Chilled, { CHILL_DURATION_MS } from '@/game/gameObject/buffs/Chilled';
import DamageOverTime from '@/game/gameObject/buffs/DamageOverTime';
import DamageReflect from '@/game/gameObject/buffs/DamageReflect';
import Dash from '@/game/gameObject/buffs/Dash';
import Disarm from '@/game/gameObject/buffs/Disarm';
import Fear from '@/game/gameObject/buffs/Fear';
import Ground from '@/game/gameObject/buffs/Ground';
import Invisible from '@/game/gameObject/buffs/Invisible';
import Invulnerable from '@/game/gameObject/buffs/Invulnerable';
import Nearsight from '@/game/gameObject/buffs/Nearsight';
import Phasing from '@/game/gameObject/buffs/Phasing';
import Root from '@/game/gameObject/buffs/Root';
import Shield from '@/game/gameObject/buffs/Shield';
import Silence from '@/game/gameObject/buffs/Silence';
import Slow from '@/game/gameObject/buffs/Slow';
import Speedup from '@/game/gameObject/buffs/Speedup';
import Stasis from '@/game/gameObject/buffs/Stasis';
import StatAmp from '@/game/gameObject/buffs/StatAmp';
import Stun from '@/game/gameObject/buffs/Stun';
import Taunt from '@/game/gameObject/buffs/Taunt';
import TrueSight, { createReveal } from '@/game/gameObject/buffs/TrueSight';
import Untargetable from '@/game/gameObject/buffs/Untargetable';
import Buff from '@/game/gameObject/Buff';

import * as Reach from '@/game/combat/Reach';
import * as Vision from '@/game/combat/Vision';
import * as ExecuteTargeting from '@/game/combat/ExecuteTargeting';
import * as AttackTargeting from '@/game/combat/AttackTargeting';
import * as GlobalShot from '@/game/combat/GlobalShot';
import TargetResolver from '@/game/spell/targeting/TargetResolver';
import {
  PredefinedFilters,
  FOUNTAIN_Z_INDEX,
  TRAIL_Z_INDEX,
  PARTICLE_Z_INDEX,
  GROUND_Z_INDEX,
  UNIT_Z_INDEX,
  MINION_Z_INDEX,
  OBJECTIVE_Z_INDEX,
  CHAMPION_Z_INDEX,
  SPELL_EFFECT_Z_INDEX,
  COMBAT_TEXT_Z_INDEX,
} from '@/game/managers/ObjectManager';

import CastBar, { unitCastBarAnchor } from '@/game/vfx/CastBar';
import CastTelegraph from '@/game/vfx/CastTelegraph';
import ChargeRangeTelegraph from '@/game/vfx/ChargeRangeTelegraph';
import VfxGroup from '@/game/vfx/VfxGroup';

import ParticleSystem, {
  PredefinedParticleSystems,
} from '@/game/gameObject/helpers/ParticleSystem';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import CombatText from '@/game/gameObject/helpers/CombatText';

import ActionState from '@/game/enums/ActionState';
import BuffAddType from '@/game/enums/BuffAddType';
import EventType from '@/game/enums/EventType';
import StatusFlags from '@/game/enums/StatusFlags';
import { SpellForm } from '@/game/spell/runtime/CancelPolicy';
import { SpellRole } from '@/game/ai/SpellRole';

import { wallOutlinesInArea, slabVertices } from '@/game/gameObject/map/DynamicTerrain';
import TerrainField, { sweepToWall } from '@/game/gameObject/map/TerrainField';

import VectorUtils from '@/utils/vector.utils';
import CollideUtils from '@/utils/collide.utils';
import * as Quadtree from '@/libs/quadtree';
import SAT from '@/libs/SAT';
import { uuidv4, hasFlag, rectToVertices } from '@/utils/index';

/**
 * Everything a content pack is allowed to touch.
 *
 * The size is measured, not chosen: the 241 spell files import 72 distinct
 * core modules between them, 110 symbols in total. Eight namespaces is what
 * turns that into a surface someone can read.
 *
 * The reason this is achievable at all is that `GameObject.game` was already
 * typed as `GameObjectGameContext` — a structural interface, not the `Game`
 * class — so the transitive closure of everything here stops at 87 modules and
 * touches `Game`, `SceneManager` and every Vue component exactly zero times.
 * Half of this seam was built before anyone set out to build it.
 *
 * `asset` takes a plain string on purpose. Core keeps its generated `AssetKey`
 * union for its own art; a pack declares its keys in its own manifest and
 * type-checks them against its own generated union. Type safety does not
 * vanish, it stops at the boundary — which is exactly where `validate.ts`
 * takes over.
 *
 * **A module import is not the same thing as the symbols a real spell needs
 * from it.** The first cut of this file imported the *default* of every
 * module the measured import table named and stopped there — but 8 of those
 * modules also carry named exports real spells import alongside the default
 * (`PredefinedParticleSystems` beside `ParticleSystem`, `createReveal` beside
 * `TrueSight`, and six more), and three more modules — `ObjectManager`
 * (`PredefinedFilters`, 153 files), `CancelPolicy` (`SpellForm`) and
 * `ai/SpellRole` — were not carried at all. This was `coreSpellsApiSurface.test.ts`'s
 * job before batch 4 task 3 (it kept it from silently narrowing again by
 * scanning every `@/` import in `spells/` and `coreSpells/`); now that
 * `packs/riot/spells/` cannot name a `@/` core module at all (the
 * `pack-core-boundary` seam), that scan's real population is `coreSpells/`
 * alone — see its own header for the renamed, narrower guarantee.
 */
export interface ContentApi {
  Spell: typeof Spell;
  SpellObject: typeof SpellObject;
  MissileSpellObject: typeof MissileSpellObject;
  AreaSpellObject: typeof AreaSpellObject;
  BeamSpellObject: typeof BeamSpellObject;
  beamBoundingBox: typeof beamBoundingBox;
  intersectsBeam: typeof intersectsBeam;
  HomingMissileSpellObject: typeof HomingMissileSpellObject;
  AoePulse: typeof AoePulse;
  isChargeActivation: typeof isChargeActivation;
  requireChargeSpec: typeof requireChargeSpec;
  /**
   * Marks a `function`-expression spell loader as a loader rather than a
   * class. `lazy()` itself lives on `@/content/ContentPack`, but that module
   * is banned as a value import for a pack (the `pack-core-boundary` seam) — an
   * arrow-function loader never needs it (it structurally can never be a
   * class), so the gap stayed invisible until an author reached for an
   * ordinary `function () { return import('./X'); }` instead. It rides at
   * the top level, beside `isChargeActivation`, for the same reason: a real
   * value with no namespace of its own.
   */
  lazy: typeof lazy;
  /**
   * Not inside `buffs`: every entry there is a constructor (see
   * `contentApi.test.ts`'s "carries the 24 buffs as constructors" case), and
   * this is a plain duration in milliseconds, not a class. It rides at the
   * top level for the same reason `beamBoundingBox` does — a real symbol
   * whose module has no clean home among the eight namespaces.
   */
  CHILL_DURATION_MS: typeof CHILL_DURATION_MS;

  units: {
    AttackableUnit: typeof AttackableUnit;
    Champion: typeof Champion;
    Pet: typeof Pet;
    Monster: typeof Monster;
    DEFAULT_CHAMPION_ATTACK: typeof DEFAULT_CHAMPION_ATTACK;
    MAX_UNIT_SIZE: typeof MAX_UNIT_SIZE;
    StatModifier: typeof StatModifier;
    StatsModifier: typeof StatsModifier;
  };
  buffs: typeof BUFFS;
  combat: typeof COMBAT;
  /**
   * The draw-layer vocabulary, back to front — `ObjectManager`'s own ten
   * exported constants, under their own names so one `GROUND_Z_INDEX` grep
   * finds every site in core and in every pack at once.
   *
   * A pack needs these *more* than core does. `Z_INDEX_MAP` is keyed by class
   * and `classLayerOf` walks the `extends` chain, so a `SpellObject` subclass
   * with no `zIndex` of its own resolves to `SPELL_EFFECT_Z_INDEX` — above
   * the champions. Right for a missile, wrong for ground art, and the
   * difference is invisible from inside the spell file: about a dozen
   * ground-art spells each hardcoded a magic `2` with its own paragraph
   * explaining why, and the one that forgot painted a decal over the feet of
   * everyone standing on it. Naming the layer is how a content author states
   * that intent instead of restating the number.
   *
   * A value import of `@/game/managers/ObjectManager` is exactly what the
   * `pack-core-boundary` seam bans, so this namespace is the only door — the
   * same reason `PredefinedFilters` rides on `combat` rather than being
   * imported where it is used.
   */
  layers: typeof LAYERS;
  vfx: typeof VFX;
  helpers: typeof HELPERS;
  enums: typeof ENUMS;
  terrain: typeof TERRAIN;
  utils: typeof UTILS;

  /**
   * A bare local key (`'spell_ahri_e'`) resolves against whichever pack
   * registered it first — the shape every `packs/riot/spells/*.ts` file
   * already calls this with, unqualified, and keeps working unqualified.
   * `'<packId>:<localKey>'` resolves against exactly the named pack and no
   * other, for a caller (or a second pack whose own local keys collide with
   * the first's) that needs to say precisely which pack it means. Both
   * forms are the same `AssetManager.get` this function has always been —
   * see `AssetManager.resolveDescriptor`'s own doc comment for the full
   * three-try order, and `PackManifest.assets` for why `image`/`avatar`/
   * `iconKey` fields never have to be written pre-qualified by hand.
   */
  asset(key: string): AssetHandle;
  /**
   * `AssetManager.renderable`, for the two draw methods (a stage-shifting decoy and a tornado ability)
   * that resolve a handle to something `image()` can paint rather than just
   * looking one up by key — `asset()` above is `AssetManager.get`, a
   * different static method with a different shape, so it cannot stand in
   * for this one. `AssetManager` itself stays off the pack allow-list
   * (the `pack-core-boundary` seam); this is the same crossing `asset()` already
   * makes, for the other method a spell's `draw()` needs.
   *
   * Typed for what both real call sites actually do with it — feed it
   * straight into p5's `image()`, whose first parameter accepts
   * `p5.Image | p5.Element | p5.Framebuffer` — rather than the `unknown`
   * `AssetManager.renderable` itself returns (that method's own signature is
   * unrelated to this task and stays as it is; this is only the public type
   * this wrapper hands a pack author). `p5.Framebuffer` is dropped: neither
   * real call site resolves one, and the ambient `@types/p5` in this project
   * does not expose it as a cross-file-referenceable member of the `p5`
   * namespace, only inline within its own declaration file.
   */
  renderableAsset(
    handle: AssetHandle | undefined,
    label?: string
  ): p5.Image | p5.Element;
}

const COMBAT = Object.freeze({
  Reach,
  Vision,
  ExecuteTargeting,
  AttackTargeting,
  GlobalShot,
  TargetResolver,
  PredefinedFilters,
});
/**
 * Read the ordering rule off `ObjectManager`'s own header: **more important
 * paints later.** Every value here is that module's exported constant rather
 * than a copy, so retuning a layer moves core and every pack together and
 * cannot leave the two disagreeing.
 */
const LAYERS = Object.freeze({
  FOUNTAIN_Z_INDEX,
  TRAIL_Z_INDEX,
  PARTICLE_Z_INDEX,
  GROUND_Z_INDEX,
  UNIT_Z_INDEX,
  MINION_Z_INDEX,
  OBJECTIVE_Z_INDEX,
  CHAMPION_Z_INDEX,
  SPELL_EFFECT_Z_INDEX,
  COMBAT_TEXT_Z_INDEX,
});
/**
 * A beam ability's draw helper and an axe-throw ability's `drawAxeArc`/`drawAxe` used to live here,
 * and their presence was Batch 2's own whole-branch review flagging a bug:
 * they are champion-named drawing helpers, which is exactly what
 * `ContentApi` is not supposed to carry — a seam meant to keep core's surface
 * pack-neutral was requiring the opposite. Task 2 of the content-pack
 * extraction moved both into `packs/riot/vfx/`; the axe-throw kit's three
 * spells and
 * the beam ultimate's spell reached them by a relative path in the interim and moved into
 * `packs/riot/spells/` themselves in batch 4 task 3, where that relative
 * reach is now an ordinary sibling-pack import. See
 * `tests/content/coreSpellsApiSurface.test.ts`'s "carries no champion-named
 * symbol" rule, which is what would now catch a fourth one.
 */
const VFX = Object.freeze({
  CastBar,
  unitCastBarAnchor,
  CastTelegraph,
  ChargeRangeTelegraph,
  VfxGroup,
});
const HELPERS = Object.freeze({
  ParticleSystem,
  PredefinedParticleSystems,
  TrailSystem,
  CombatText,
});
const ENUMS = Object.freeze({
  ActionState,
  BuffAddType,
  EventType,
  StatusFlags,
  SpellForm,
  SpellRole,
});
const TERRAIN = Object.freeze({ wallOutlinesInArea, slabVertices, TerrainField, sweepToWall });
const UTILS = Object.freeze({
  VectorUtils,
  CollideUtils,
  Quadtree,
  SAT,
  uuidv4,
  hasFlag,
  rectToVertices,
});

// Every file in src/game/gameObject/buffs/ that has a default export — 24 of
// them, not the 23 an earlier draft of this list counted; TrueSight was the
// one missed. Buff itself is the base class, filed one directory up.
// createReveal is a named export real spells import alongside TrueSight's
// default; CHILL_DURATION_MS is Chilled's equivalent but is a plain number,
// not a constructor, so it lives at the top level instead (see its own
// interface doc comment) rather than breaking "every entry here is `new`-able".
const BUFFS = Object.freeze({
  Buff,
  Airborne,
  Charm,
  Chilled,
  DamageOverTime,
  DamageReflect,
  Dash,
  Disarm,
  Fear,
  Ground,
  Invisible,
  Invulnerable,
  Nearsight,
  Phasing,
  Root,
  Shield,
  Silence,
  Slow,
  Speedup,
  Stasis,
  StatAmp,
  Stun,
  Taunt,
  TrueSight,
  createReveal,
  Untargetable,
});

let cached: ContentApi | null = null;

/** Built once. Every pack in the process gets the same object identity. */
export function buildContentApi(): ContentApi {
  if (cached) return cached;
  cached = Object.freeze({
    Spell,
    SpellObject,
    MissileSpellObject,
    AreaSpellObject,
    BeamSpellObject,
    beamBoundingBox,
    intersectsBeam,
    HomingMissileSpellObject,
    AoePulse,
    isChargeActivation,
    requireChargeSpec,
    lazy,
    CHILL_DURATION_MS,
    units: Object.freeze({
      AttackableUnit,
      Champion,
      Pet,
      Monster,
      DEFAULT_CHAMPION_ATTACK,
      MAX_UNIT_SIZE,
      StatModifier,
      StatsModifier,
    }),
    buffs: BUFFS,
    combat: COMBAT,
    layers: LAYERS,
    vfx: VFX,
    helpers: HELPERS,
    enums: ENUMS,
    terrain: TERRAIN,
    utils: UTILS,
    asset: packAsset,
    renderableAsset: (handle: AssetHandle | undefined, label?: string) =>
      AssetManager.renderable(handle, label) as p5.Image | p5.Element,
  }) as ContentApi;
  return cached;
}
