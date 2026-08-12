export type ActivationPattern = 'PRESS' | 'HOLD_RELEASE' | 'RECAST' | 'TOGGLE' | 'TAP_OR_HOLD';
export type SpellRuntimeState =
  | 'READY'
  | 'CASTING'
  | 'CHARGING'
  | 'CHANNELING'
  | 'ACTIVE'
  | 'COOLDOWN';
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

export interface ChargeSpec {
  maxDurationMs: number;
  releaseAtMax: boolean;
}

export interface ChannelSpec {
  durationMs: number;
  tickEveryMs: number;
}

export interface ActiveSpec {
  maxDurationMs?: number;
  recastDelayMs?: number;
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
  interrupts?: Partial<InterruptPolicy>;
}
