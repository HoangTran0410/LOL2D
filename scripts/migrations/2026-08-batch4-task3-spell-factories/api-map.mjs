// Specifier -> ContentApi access mapping, built from src/content/ContentApi.ts's
// actual surface (read directly, not guessed).
//
// Each entry: { default?: 'apiPath', namespace?: 'apiPath', named?: { exportedName: 'apiPath' } }
// 'apiPath' is dot-path off `api`, e.g. 'buffs.Slow' or 'Spell'.

const buffPath = name => `buffs.${name}`;
const BUFF_NAMES = [
  'Airborne',
  'Charm',
  'DamageOverTime',
  'DamageReflect',
  'Dash',
  'Disarm',
  'Fear',
  'Ground',
  'Invisible',
  'Invulnerable',
  'Nearsight',
  'Phasing',
  'Root',
  'Shield',
  'Silence',
  'Slow',
  'Speedup',
  'Stasis',
  'StatAmp',
  'Stun',
  'Taunt',
  'Untargetable',
];

export const API_MAP = {
  '@/game/gameObject/Spell': { default: 'Spell' },
  '@/game/gameObject/SpellObject': { default: 'SpellObject' },
  '@/game/gameObject/MissileSpellObject': { default: 'MissileSpellObject' },
  '@/game/gameObject/spellObjects/AreaSpellObject': { default: 'AreaSpellObject' },
  '@/game/gameObject/spellObjects/BeamSpellObject': {
    default: 'BeamSpellObject',
    named: { beamBoundingBox: 'beamBoundingBox', intersectsBeam: 'intersectsBeam' },
  },
  '@/game/gameObject/spellObjects/HomingMissileSpellObject': {
    default: 'HomingMissileSpellObject',
  },
  '@/game/gameObject/spellObjects/AoePulse': { default: 'AoePulse' },
  '@/game/spell/runtime/types': {
    named: { isChargeActivation: 'isChargeActivation', requireChargeSpec: 'requireChargeSpec' },
  },
  '@/content/ContentPack': { named: { lazy: 'lazy' } },
  '@/game/gameObject/attackableUnits/AttackableUnit': { default: 'units.AttackableUnit' },
  '@/game/gameObject/attackableUnits/Champion': {
    default: 'units.Champion',
    named: { DEFAULT_CHAMPION_ATTACK: 'units.DEFAULT_CHAMPION_ATTACK' },
  },
  '@/game/gameObject/attackableUnits/Pet': { default: 'units.Pet' },
  '@/game/gameObject/attackableUnits/Monster': { default: 'units.Monster' },
  '@/game/gameObject/Stats': {
    named: {
      MAX_UNIT_SIZE: 'units.MAX_UNIT_SIZE',
      StatModifier: 'units.StatModifier',
      StatsModifier: 'units.StatsModifier',
    },
  },
  '@/game/gameObject/Buff': { default: 'buffs.Buff' },
  '@/game/gameObject/buffs/TrueSight': {
    default: 'buffs.TrueSight',
    named: { createReveal: 'buffs.createReveal' },
  },
  '@/game/gameObject/buffs/Chilled': {
    default: 'buffs.Chilled',
    named: { CHILL_DURATION_MS: 'CHILL_DURATION_MS' },
  },
  '@/game/combat/Reach': {
    namespace: 'combat.Reach',
    named: {
      DEFAULT_BODY_RADIUS: 'combat.Reach.DEFAULT_BODY_RADIUS',
      bodyRadiusOf: 'combat.Reach.bodyRadiusOf',
      bodyReachBonus: 'combat.Reach.bodyReachBonus',
      effectiveRange: 'combat.Reach.effectiveRange',
      withinRange: 'combat.Reach.withinRange',
    },
  },
  '@/game/combat/Vision': {
    namespace: 'combat.Vision',
    named: { hasLineOfSight: 'combat.Vision.hasLineOfSight', canSee: 'combat.Vision.canSee' },
  },
  '@/game/combat/ExecuteTargeting': {
    namespace: 'combat.ExecuteTargeting',
    named: {
      effectiveHealth: 'combat.ExecuteTargeting.effectiveHealth',
      isLethal: 'combat.ExecuteTargeting.isLethal',
      isExecuteSpell: 'combat.ExecuteTargeting.isExecuteSpell',
      lethalTargets: 'combat.ExecuteTargeting.lethalTargets',
      pickExecuteTarget: 'combat.ExecuteTargeting.pickExecuteTarget',
    },
  },
  '@/game/combat/AttackTargeting': {
    namespace: 'combat.AttackTargeting',
    named: {
      CURSOR_ACQUISITION_RADIUS: 'combat.AttackTargeting.CURSOR_ACQUISITION_RADIUS',
      FALLBACK_CHASE_MARGIN: 'combat.AttackTargeting.FALLBACK_CHASE_MARGIN',
      findAttackTargetNearPoint: 'combat.AttackTargeting.findAttackTargetNearPoint',
      findAttackTargetAlongRay: 'combat.AttackTargeting.findAttackTargetAlongRay',
    },
  },
  '@/game/combat/GlobalShot': {
    namespace: 'combat.GlobalShot',
    named: {
      enemyChampionsOnly: 'combat.GlobalShot.enemyChampionsOnly',
      travelRamp: 'combat.GlobalShot.travelRamp',
      acceleratedSpeed: 'combat.GlobalShot.acceleratedSpeed',
    },
  },
  '@/game/spell/targeting/TargetResolver': { default: 'combat.TargetResolver' },
  '@/game/managers/ObjectManager': { named: { PredefinedFilters: 'combat.PredefinedFilters' } },
  '@/game/vfx/CastBar': {
    default: 'vfx.CastBar',
    named: { unitCastBarAnchor: 'vfx.unitCastBarAnchor' },
  },
  '@/game/vfx/CastTelegraph': { default: 'vfx.CastTelegraph' },
  '@/game/vfx/ChargeRangeTelegraph': { default: 'vfx.ChargeRangeTelegraph' },
  '@/game/vfx/VfxGroup': { default: 'vfx.VfxGroup' },
  '@/game/gameObject/helpers/ParticleSystem': {
    default: 'helpers.ParticleSystem',
    named: { PredefinedParticleSystems: 'helpers.PredefinedParticleSystems' },
  },
  '@/game/gameObject/helpers/TrailSystem': { default: 'helpers.TrailSystem' },
  '@/game/gameObject/helpers/CombatText': { default: 'helpers.CombatText' },
  '@/game/enums/ActionState': { default: 'enums.ActionState' },
  '@/game/enums/BuffAddType': { default: 'enums.BuffAddType' },
  '@/game/enums/EventType': { default: 'enums.EventType' },
  '@/game/enums/StatusFlags': { default: 'enums.StatusFlags' },
  '@/game/spell/runtime/CancelPolicy': { named: { SpellForm: 'enums.SpellForm' } },
  '@/game/ai/SpellRole': { named: { SpellRole: 'enums.SpellRole' } },
  '@/game/gameObject/map/DynamicTerrain': {
    named: { wallOutlinesInArea: 'terrain.wallOutlinesInArea', slabVertices: 'terrain.slabVertices' },
  },
  '@/game/gameObject/map/TerrainField': {
    default: 'terrain.TerrainField',
    named: { sweepToWall: 'terrain.sweepToWall' },
  },
  '@/utils/vector.utils': { default: 'utils.VectorUtils' },
  '@/utils/collide.utils': { default: 'utils.CollideUtils' },
  '@/libs/quadtree': {
    namespace: 'utils.Quadtree',
    named: {
      Circle: 'utils.Quadtree.Circle',
      Rectangle: 'utils.Quadtree.Rectangle',
      Quadtree: 'utils.Quadtree.Quadtree',
    },
  },
  '@/libs/SAT': { default: 'utils.SAT' },
  '@/utils/index': {
    named: { uuidv4: 'utils.uuidv4', hasFlag: 'utils.hasFlag', rectToVertices: 'utils.rectToVertices' },
  },
  '@/utils': {
    named: { uuidv4: 'utils.uuidv4', hasFlag: 'utils.hasFlag', rectToVertices: 'utils.rectToVertices' },
  },
};

for (const name of BUFF_NAMES) {
  API_MAP[`@/game/gameObject/buffs/${name}`] = { default: buffPath(name) };
}

// Class-like symbols: get a module-level `type Name = InstanceType<ContentApi[...]>` alias.
export const CLASS_LIKE = new Set([
  'Spell',
  'SpellObject',
  'MissileSpellObject',
  'AreaSpellObject',
  'BeamSpellObject',
  'HomingMissileSpellObject',
  'AoePulse',
  'AttackableUnit',
  'Champion',
  'Pet',
  'Monster',
  'StatModifier',
  'StatsModifier',
  'Buff',
  'Airborne',
  'Charm',
  'Chilled',
  'DamageOverTime',
  'DamageReflect',
  'Dash',
  'Disarm',
  'Fear',
  'Ground',
  'Invisible',
  'Invulnerable',
  'Nearsight',
  'Phasing',
  'Root',
  'Shield',
  'Silence',
  'Slow',
  'Speedup',
  'Stasis',
  'StatAmp',
  'Stun',
  'Taunt',
  'TrueSight',
  'Untargetable',
  'CastBar',
  'CastTelegraph',
  'ChargeRangeTelegraph',
  'VfxGroup',
  'ParticleSystem',
  'TrailSystem',
  'CombatText',
  'TargetResolver',
  'TerrainField',
  'Circle',
  'Rectangle',
]);

// Specifiers whose type-only imports redirect to '@/content/types' unchanged (same names).
export const TYPES_BARREL_SPECIFIERS = new Set([
  '@/game/spell/runtime/types',
  '@/game/combat/BasicAttack',
  '@/game/combat/BasicAttackController',
  '@/game/gameObject/GameObject',
  '@/game/combat/MatchTally',
  '@/game/spell/targeting/TargetResolver',
  '@/game/combat/ExecuteTargeting',
  '@/game/gameObject/map/DynamicTerrain',
  '@/game/gameObject/spellObjects/BeamSpellObject',
  '@/game/gameObject/map/TerrainField',
  '@/managers/AssetManager',
]);

// Names @/content/types.ts needs to gain (all type-only), keyed by their real home module.
export const TYPES_BARREL_ADDITIONS = {
  '@/game/combat/BasicAttack': ['BasicAttackHit'],
  '@/game/combat/BasicAttackController': [{ name: 'BasicAttackController', isDefault: true }],
  '@/game/gameObject/GameObject': ['GameObjectRuntimeContext'],
  '@/game/combat/MatchTally': ['KillCredit'],
  '@/game/spell/targeting/TargetResolver': ['TargetingRequest'],
};

export const ASSET_MANAGER_SPECIFIER = '@/managers/AssetManager';
