import type { SpellSfxSpec, SpellVfxSpec } from '@/game/vfx/SpellVfx';
import type { BuffConstructor } from '@/game/gameObject/Buff';

export type ActivationPattern = 'PRESS' | 'HOLD_RELEASE' | 'RECAST' | 'TOGGLE' | 'TAP_OR_HOLD';
export type SpellRuntimeState =
  'READY' | 'CASTING' | 'CHARGING' | 'CHANNELING' | 'ACTIVE' | 'COOLDOWN';
export type TargetingMode = 'SELF' | 'DIRECTION' | 'POINT' | 'UNIT';
export type ResourceCommitPoint = 'start' | 'release' | 'tick';
export type CooldownStartPoint = 'start' | 'release' | 'end';
export type CancelReason =
  | 'PLAYER_CANCEL'
  | 'DEATH'
  | 'STUN'
  | 'SILENCE'
  | 'DISPLACEMENT'
  | 'MOVE'
  | 'TARGET_INVALID'
  | 'OUT_OF_RANGE'
  | 'OUT_OF_RESOURCE'
  | 'MAX_DURATION'
  /** The effect the spell put into the world finished on its own terms. */
  | 'EFFECT_ENDED'
  | 'SCENE_EXIT';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface CastContext {
  readonly spellId: string;
  readonly activationId: string;
  readonly startedAtMs: number;
  readonly caster: unknown;
  readonly origin: Vec2;
  readonly cursorWorld: Vec2;
  readonly direction: Vec2;
  readonly target?: unknown;
}

export interface ResourcePolicy {
  commitAt: ResourceCommitPoint;
  refundOn: readonly CancelReason[];
  tickEveryMs?: number;
}

export interface CooldownPolicy {
  startAt: CooldownStartPoint;
  durationMs: number;
}

export interface InterruptPolicy {
  death: boolean;
  stun: boolean;
  silence: boolean;
  displacement: boolean;
  move: boolean;
}

/**
 * What casting this spell does to a standing basic attack order.
 *
 * `drop` for every ability: committing to a cast is a decision to stop chasing.
 * `keep` only for the basic attack itself, where casting *is* the order.
 */
export type AttackOrderPolicy = 'drop' | 'keep';

export interface ChargeSpec {
  maxDurationMs: number;
  releaseAtMax: boolean;
}

export type ChargeActivation = 'HOLD_RELEASE' | 'TAP_OR_HOLD';

export interface ChannelSpec {
  durationMs: number;
  tickEveryMs: number;
}

export interface ActiveSpec {
  maxDurationMs?: number;
  recastDelayMs?: number;
  /**
   * How many times the key may be pressed again before the activation ends.
   * Defaults to 1, which is every recast spell here bar one: Ziggs W detonates,
   * Riven R slashes, Renekton E dashes a second time and that is the end of it.
   *
   * Jhin R is the shape that needs more — one press raises the curtain and the
   * next four are his four rounds — and without this the runtime completed the
   * activation on the first recast, so the stage closed after a single shot.
   * `recastDelayMs` is then the gap between *consecutive* recasts rather than a
   * one-off wait after the activation begins.
   */
  recasts?: number;
}

export interface CastSpec {
  activation: ActivationPattern;
  targeting: TargetingMode;
  castTimeMs?: number;
  charge?: ChargeSpec;
  channel?: ChannelSpec;
  active?: ActiveSpec;
  resource: ResourcePolicy;
  cooldown: CooldownPolicy;
  /** One `SpellForm` from `CancelPolicy`. Omitted means `SpellForm.HELD`. */
  interrupts?: Partial<InterruptPolicy>;
  /**
   * Buffs on the caster that suspend the interrupt watcher rather than ending
   * what it guards — Stasis, and nothing else so far. See `CancelPolicy`.
   */
  suspendedBy?: readonly BuffConstructor[];
  /** Defaults to `drop`. */
  attackOrder?: AttackOrderPolicy;
  vfx?: SpellVfxSpec;
  sfx?: SpellSfxSpec;
}

export type ChargeCastSpec = CastSpec & { activation: ChargeActivation };

export const isChargeActivation = (activation: ActivationPattern): activation is ChargeActivation =>
  activation === 'HOLD_RELEASE' || activation === 'TAP_OR_HOLD';

export const requireChargeSpec = (spec: Pick<CastSpec, 'activation' | 'charge'>): ChargeSpec => {
  if (!isChargeActivation(spec.activation)) {
    throw new Error(`${spec.activation} activation does not support charge`);
  }
  if (!spec.charge) throw new Error(`${spec.activation} activation requires charge`);
  return spec.charge;
};
