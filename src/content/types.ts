/**
 * Everything a content pack may import as a type.
 *
 * Types and values leave core by different doors, and the reason is what a
 * pack becomes: its own package, compiled against core's `.d.ts` and handed
 * core's runtime objects. A type-only import survives that intact — it is
 * erased before anything runs, so it creates no second copy of a class and no
 * `instanceof` that answers wrong. A *value* import would create exactly
 * those, which is why `ContentApi` exists and why nothing here is a value.
 *
 * So: `import type { CastContext } from '@/content/types'` is correct and
 * always will be; `import { Slow } from '@/game/gameObject/buffs/Slow'` is
 * not, and `tests/content/packBoundary.test.ts` fails the build over it.
 */
export type {
  ActivationPattern,
  ActiveSpec,
  AttackOrderPolicy,
  CancelReason,
  CastContext,
  CastSpec,
  ChannelSpec,
  ChargeActivation,
  ChargeCastSpec,
  ChargeSpec,
  CooldownPolicy,
  CooldownStartPoint,
  InterruptPolicy,
  ResourceCommitPoint,
  ResourcePolicy,
  SpellRuntimeState,
  TargetingMode,
  Vec2,
} from '@/game/spell/runtime/types';

export type { ContentApi } from './ContentApi';
export type {
  ChampionAttack,
  ChampionEntry,
  ContentPack,
  ContentPackCode,
  ContentPackData,
  ContentPackFactory,
  Faction,
  LaneDefinition,
  MapDefinition,
  MapGeometry,
  MapGeometryLoader,
  MapGeometrySource,
  MapSummary,
  MinionSlot,
  MonsterAbility,
  MonsterDef,
  NeutralSlot,
  PackManifest,
  SpawnSlot,
  SpellClass,
  SpellDisplayData,
  SpellLoader,
  SpellSource,
  StructureKind,
  StructureSlot,
} from './ContentPack';
