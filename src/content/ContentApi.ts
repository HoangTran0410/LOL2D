import AssetManager, { type AssetHandle } from '@/managers/AssetManager';

import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import AreaSpellObject from '@/game/gameObject/spellObjects/AreaSpellObject';
import BeamSpellObject from '@/game/gameObject/spellObjects/BeamSpellObject';
import HomingMissileSpellObject from '@/game/gameObject/spellObjects/HomingMissileSpellObject';
import AoePulse from '@/game/gameObject/spellObjects/AoePulse';

import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import Monster from '@/game/gameObject/attackableUnits/Monster';

import Airborne from '@/game/gameObject/buffs/Airborne';
import Charm from '@/game/gameObject/buffs/Charm';
import Chilled from '@/game/gameObject/buffs/Chilled';
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
import TrueSight from '@/game/gameObject/buffs/TrueSight';
import Untargetable from '@/game/gameObject/buffs/Untargetable';
import Buff from '@/game/gameObject/Buff';

import * as Reach from '@/game/combat/Reach';
import * as Vision from '@/game/combat/Vision';
import * as ExecuteTargeting from '@/game/combat/ExecuteTargeting';
import * as AttackTargeting from '@/game/combat/AttackTargeting';
import * as GlobalShot from '@/game/combat/GlobalShot';
import * as TargetResolver from '@/game/spell/targeting/TargetResolver';

import CastBar from '@/game/vfx/CastBar';
import CastTelegraph from '@/game/vfx/CastTelegraph';
import ChargeRangeTelegraph from '@/game/vfx/ChargeRangeTelegraph';
import VfxGroup from '@/game/vfx/VfxGroup';

import ParticleSystem from '@/game/gameObject/helpers/ParticleSystem';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import CombatText from '@/game/gameObject/helpers/CombatText';

import ActionState from '@/game/enums/ActionState';
import BuffAddType from '@/game/enums/BuffAddType';
import EventType from '@/game/enums/EventType';
import StatusFlags from '@/game/enums/StatusFlags';

import { wallOutlinesInArea } from '@/game/gameObject/map/DynamicTerrain';
import TerrainField from '@/game/gameObject/map/TerrainField';

import VectorUtils from '@/utils/vector.utils';
import CollideUtils from '@/utils/collide.utils';
import * as Quadtree from '@/libs/quadtree';
import SAT from '@/libs/SAT';

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
 */
export interface ContentApi {
  Spell: typeof Spell;
  SpellObject: typeof SpellObject;
  MissileSpellObject: typeof MissileSpellObject;
  AreaSpellObject: typeof AreaSpellObject;
  BeamSpellObject: typeof BeamSpellObject;
  HomingMissileSpellObject: typeof HomingMissileSpellObject;
  AoePulse: typeof AoePulse;

  units: {
    AttackableUnit: typeof AttackableUnit;
    Champion: typeof Champion;
    Pet: typeof Pet;
    Monster: typeof Monster;
  };
  buffs: Record<string, unknown> & { Buff: typeof Buff; Slow: typeof Slow; Dash: typeof Dash };
  combat: typeof COMBAT;
  vfx: typeof VFX;
  helpers: typeof HELPERS;
  enums: typeof ENUMS;
  terrain: typeof TERRAIN;
  utils: typeof UTILS;

  asset(key: string): AssetHandle;
}

const COMBAT = Object.freeze({
  Reach,
  Vision,
  ExecuteTargeting,
  AttackTargeting,
  GlobalShot,
  TargetResolver,
});
const VFX = Object.freeze({ CastBar, CastTelegraph, ChargeRangeTelegraph, VfxGroup });
const HELPERS = Object.freeze({ ParticleSystem, TrailSystem, CombatText });
const ENUMS = Object.freeze({ ActionState, BuffAddType, EventType, StatusFlags });
const TERRAIN = Object.freeze({ wallOutlinesInArea, TerrainField });
const UTILS = Object.freeze({ VectorUtils, CollideUtils, Quadtree, SAT });

// Every file in src/game/gameObject/buffs/ that has a default export — 24 of
// them, not the 23 an earlier draft of this list counted; TrueSight was the
// one missed. Buff itself is the base class, filed one directory up.
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
    HomingMissileSpellObject,
    AoePulse,
    units: Object.freeze({ AttackableUnit, Champion, Pet, Monster }),
    buffs: BUFFS,
    combat: COMBAT,
    vfx: VFX,
    helpers: HELPERS,
    enums: ENUMS,
    terrain: TERRAIN,
    utils: UTILS,
    asset: (key: string) => AssetManager.get(key as never),
  }) as ContentApi;
  return cached;
}
