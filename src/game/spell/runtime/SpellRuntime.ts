import { SpellForm, interruptSwitchFor, resolveInterrupts } from './CancelPolicy';
import type {
  CancelReason,
  CastContext,
  CastSpec,
  ResourceCommitPoint,
  SpellRuntimeState,
} from './types';

export interface SpellRuntimeDelegate {
  canStart(context: CastContext): boolean;
  commitResource(context: CastContext, point: ResourceCommitPoint): boolean;
  refundResource(context: CastContext, reason: CancelReason): void;
  onCastStart(context: CastContext): void;
  onChargeUpdate(context: CastContext, elapsedMs: number, ratio: number): void;
  onRelease(context: CastContext): void;
  onChannelTick(context: CastContext, tickIndex: number): void;
  onActivate(context: CastContext): void;
  onRecast(context: CastContext): void;
  onCancel(context: CastContext, reason: CancelReason): void;
  onComplete(context: CastContext): void;
  /**
   * The cooldown a countdown starting *now* should run, given the spec's own
   * number. Omitted means "the spec's number", which is what a runtime driven
   * by nothing but its spec wants.
   *
   * It exists because the spec is resolved once, on the first cast, and a
   * match-wide cooldown-reduction rule can change after that — see
   * `Spell.reducedCooldown`. A multiplier folded into `spec.cooldown.durationMs`
   * at construction would be the multiplier that spell keeps for the rest of
   * the match.
   */
  cooldownDurationMs?(specDurationMs: number): number;
}

const snapshotContext = (context: CastContext): CastContext =>
  Object.freeze({
    ...context,
    origin: Object.freeze({ ...context.origin }),
    cursorWorld: Object.freeze({ ...context.cursorWorld }),
    direction: Object.freeze({ ...context.direction }),
  });

const validateTickInterval = (field: string, value: number | undefined): void => {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${field} must be greater than 0`);
  }
};

const validateSpec = (spec: CastSpec): void => {
  validateTickInterval('channel.tickEveryMs', spec.channel?.tickEveryMs);
  if (spec.resource.commitAt === 'tick') {
    if (spec.resource.tickEveryMs === undefined) {
      throw new Error('resource.tickEveryMs is required when commitAt is tick');
    }
    validateTickInterval('resource.tickEveryMs', spec.resource.tickEveryMs);
  } else if (spec.resource.tickEveryMs !== undefined) {
    throw new Error('resource.tickEveryMs is only valid when commitAt is tick');
  }

  const recasts = spec.active?.recasts;
  if (recasts !== undefined && (!Number.isInteger(recasts) || recasts < 1)) {
    throw new Error('active.recasts must be a positive integer');
  }

  const acceptsCharge = spec.activation === 'HOLD_RELEASE' || spec.activation === 'TAP_OR_HOLD';
  if (acceptsCharge) {
    if (!spec.charge) throw new Error(`${spec.activation} activation requires charge`);
  } else if (spec.charge) {
    throw new Error(`${spec.activation} activation does not support charge`);
  }

  // A refund named for an interrupt the form refuses is dead configuration: the
  // reason can never arrive, so the refund reads as a promise the spell does not
  // keep. Caught here rather than left for a player to notice their mana gone.
  const interrupts = resolveInterrupts(spec.interrupts);
  for (const reason of spec.resource.refundOn) {
    const key = interruptSwitchFor(reason);
    if (key !== undefined && !interrupts[key]) {
      throw new Error(`resource.refundOn lists ${reason}, which this spell's form never fires`);
    }
  }
};

export class SpellRuntime {
  private _state: SpellRuntimeState = 'READY';
  private _cooldownRemainingMs = 0;
  private context?: CastContext;
  private elapsedMs = 0;
  private channelTickIndex = 0;
  private nextChannelTickMs = 0;
  private resourceElapsedMs = 0;
  private nextResourceTickMs = Number.POSITIVE_INFINITY;
  private resourceCommitted = false;
  private cooldownStarted = false;
  private released = false;
  private terminal = true;
  private recastsRemaining = 0;
  private lastRecastAtMs = 0;

  constructor(
    private readonly spec: CastSpec,
    private readonly delegate: SpellRuntimeDelegate
  ) {
    validateSpec(spec);
  }

  get state(): SpellRuntimeState {
    return this._state;
  }

  get cooldownRemainingMs(): number {
    return this._cooldownRemainingMs;
  }

  press(context: CastContext): boolean {
    if (this._state === 'ACTIVE') return this.recast(context);
    if (this._state !== 'READY' || !this.delegate.canStart(context)) return false;

    this.context = snapshotContext(context);
    this.elapsedMs = 0;
    this.channelTickIndex = 0;
    this.nextChannelTickMs = 0;
    this.resourceElapsedMs = 0;
    this.nextResourceTickMs = Number.POSITIVE_INFINITY;
    this.resourceCommitted = false;
    this.cooldownStarted = false;
    this.released = false;
    this.terminal = false;
    this.recastsRemaining = 0;
    this.lastRecastAtMs = 0;

    if (!this.commitResource('start')) return false;
    this.startCooldown('start');
    this.delegate.onCastStart(this.context);

    if (this.spec.activation === 'HOLD_RELEASE' || this.spec.activation === 'TAP_OR_HOLD') {
      this._state = 'CHARGING';
    } else if ((this.spec.castTimeMs ?? 0) > 0) {
      this._state = 'CASTING';
    } else {
      this.releaseCast();
    }

    return true;
  }

  hold(context: CastContext): boolean {
    void context;
    return this._state === 'CHARGING';
  }

  release(context?: CastContext): boolean {
    if (this._state !== 'CHARGING') return false;
    if (context) {
      this.context = snapshotContext(context);
    }
    return this.releaseCast();
  }

  cancel(reason: CancelReason): boolean {
    if (!this.context || this.terminal || !this.canInterrupt(reason)) return false;
    this.cancelActivation(reason);
    return true;
  }

  update(deltaMs: number): void {
    const elapsed = Math.max(0, deltaMs);
    this.updateCooldown(elapsed);

    if (!this.context || this.terminal) return;

    const previousElapsedMs = this.elapsedMs;
    this.elapsedMs += elapsed;
    switch (this._state) {
      case 'CASTING':
        if (this.elapsedMs >= (this.spec.castTimeMs ?? 0)) {
          if (!this.released) this.releaseCast();
          else this.afterCast();
        }
        break;
      case 'CHARGING':
        this.updateCharge();
        break;
      case 'CHANNELING':
        this.updateChannel(previousElapsedMs);
        break;
      case 'ACTIVE':
        this.updateActive(previousElapsedMs);
        break;
      default:
        break;
    }
  }

  /** @deprecated Legacy spells may still mutate state while they migrate. */
  setCompatibilityState(state: SpellRuntimeState): void {
    this._state = state;
  }

  /** @deprecated Legacy spells may still mutate cooldown while they migrate. */
  setCompatibilityCooldown(remainingMs: number): void {
    this._cooldownRemainingMs = Math.max(0, remainingMs);
    if (this._state === 'COOLDOWN' && this._cooldownRemainingMs === 0) this._state = 'READY';
  }

  private commitResource(point: ResourceCommitPoint): boolean {
    if (!this.context || this.spec.resource.commitAt !== point) return true;
    if (point !== 'tick' && this.resourceCommitted) return true;
    if (!this.delegate.commitResource(this.context, point)) {
      this.cancelActivation('OUT_OF_RESOURCE');
      return false;
    }
    this.resourceCommitted = true;
    return true;
  }

  private releaseCast(): boolean {
    if (!this.context || this.released || this.terminal) return false;
    if (!this.commitResource('release')) return false;

    this.released = true;
    this.startCooldown('release');
    this.delegate.onRelease(this.context);

    if ((this.spec.castTimeMs ?? 0) > 0 && this._state === 'CHARGING') {
      this._state = 'CASTING';
      this.elapsedMs = 0;
      return true;
    }

    this.afterCast();
    return true;
  }

  private afterCast(): void {
    if (!this.context || this.terminal) return;
    this.elapsedMs = 0;
    this.resourceElapsedMs = 0;
    this.nextResourceTickMs =
      this.spec.resource.commitAt === 'tick'
        ? this.spec.resource.tickEveryMs!
        : Number.POSITIVE_INFINITY;

    if (this.spec.channel) {
      this._state = 'CHANNELING';
      this.nextChannelTickMs = this.spec.channel.tickEveryMs;
    } else if (
      this.spec.active ||
      this.spec.activation === 'RECAST' ||
      this.spec.activation === 'TOGGLE'
    ) {
      this._state = 'ACTIVE';
      this.recastsRemaining = this.spec.active?.recasts ?? 1;
      this.lastRecastAtMs = 0;
      this.delegate.onActivate(this.context);
    } else {
      this.completeActivation();
    }
  }

  private updateCharge(): void {
    if (!this.context || !this.spec.charge) return;
    const ratio = Math.min(1, this.elapsedMs / this.spec.charge.maxDurationMs);
    this.delegate.onChargeUpdate(this.context, this.elapsedMs, ratio);
    if (ratio < 1) return;

    if (this.spec.charge.releaseAtMax) this.releaseCast();
    else this.cancelActivation('MAX_DURATION');
  }

  private updateChannel(previousElapsedMs: number): void {
    if (!this.context || !this.spec.channel) return;
    const boundedElapsedMs = Math.min(this.elapsedMs, this.spec.channel.durationMs);
    this.resourceElapsedMs += Math.max(0, boundedElapsedMs - previousElapsedMs);

    while (true) {
      const nextChannelTick =
        this.nextChannelTickMs <= boundedElapsedMs
          ? this.nextChannelTickMs
          : Number.POSITIVE_INFINITY;
      const nextResourceTick =
        this.spec.resource.commitAt === 'tick' && this.nextResourceTickMs <= this.resourceElapsedMs
          ? this.nextResourceTickMs
          : Number.POSITIVE_INFINITY;

      if (!Number.isFinite(Math.min(nextChannelTick, nextResourceTick))) break;
      if (nextResourceTick <= nextChannelTick) {
        if (!this.commitResource('tick')) return;
        this.nextResourceTickMs += this.spec.resource.tickEveryMs!;
      } else {
        this.channelTickIndex += 1;
        this.delegate.onChannelTick(this.context, this.channelTickIndex);
        this.nextChannelTickMs += this.spec.channel.tickEveryMs;
      }
    }
    if (this.elapsedMs >= this.spec.channel.durationMs) this.completeActivation();
  }

  private updateActive(previousElapsedMs: number): void {
    const maxDurationMs = this.spec.active?.maxDurationMs;
    const boundedElapsedMs =
      maxDurationMs === undefined ? this.elapsedMs : Math.min(this.elapsedMs, maxDurationMs);
    this.resourceElapsedMs += Math.max(0, boundedElapsedMs - previousElapsedMs);

    while (
      this.spec.resource.commitAt === 'tick' &&
      this.nextResourceTickMs <= this.resourceElapsedMs
    ) {
      if (!this.commitResource('tick')) return;
      this.nextResourceTickMs += this.spec.resource.tickEveryMs!;
    }

    if (maxDurationMs !== undefined && this.elapsedMs >= maxDurationMs) {
      this.completeActivation();
    }
  }

  /**
   * The activation ends on the last recast, not the first: `recasts` is a
   * budget. The gap is measured from the previous recast rather than from the
   * activation, so a spell with several of them spaces every shot instead of
   * only the first — at one recast the two are the same number, which is why
   * every spell that predates the budget is unaffected.
   *
   * **A recast is aimed by its own press.** `press()` is handed a fresh context
   * every time, and this used to drop it and hand the delegate `this.context` —
   * the snapshot taken when the window *opened*. So every recast fired at
   * wherever the cursor had been at activation: a pull-back recast threw its
   * payload back toward wherever it had been picked up rather than where the
   * second press aimed, and a directional recast flew along the direction the
   * first press opened with. One spell carried a local workaround for exactly
   * this and was the
   * only recast that aimed correctly. The snapshot is replaced rather than
   * passed alongside, the way `release()` already does it, so the `onComplete`
   * that follows the last recast describes the same press as the recast did.
   */
  private recast(context: CastContext): boolean {
    if (
      !this.context ||
      this.terminal ||
      (this.spec.activation !== 'RECAST' && this.spec.activation !== 'TOGGLE') ||
      this.elapsedMs - this.lastRecastAtMs < (this.spec.active?.recastDelayMs ?? 0)
    ) {
      return false;
    }

    this.lastRecastAtMs = this.elapsedMs;
    this.recastsRemaining -= 1;
    this.context = snapshotContext(context);
    this.delegate.onRecast(this.context);
    if (this.recastsRemaining <= 0) this.completeActivation();
    return true;
  }

  private completeActivation(): void {
    if (!this.context || this.terminal) return;
    this.terminal = true;
    this.startCooldown('end');
    this.delegate.onComplete(this.context);
    this._state = this._cooldownRemainingMs > 0 ? 'COOLDOWN' : 'READY';
  }

  private cancelActivation(reason: CancelReason): void {
    if (!this.context || this.terminal) return;
    this.terminal = true;
    if (this.resourceCommitted && this.spec.resource.refundOn.includes(reason)) {
      this.delegate.refundResource(this.context, reason);
    }
    this.startCooldown('end');
    this.delegate.onCancel(this.context, reason);
    this._state = this._cooldownRemainingMs > 0 ? 'COOLDOWN' : 'READY';
  }

  private canInterrupt(reason: CancelReason): boolean {
    const key = interruptSwitchFor(reason);
    return key === undefined || (this.spec.interrupts?.[key] ?? SpellForm.HELD[key]);
  }

  private startCooldown(point: CastSpec['cooldown']['startAt']): void {
    if (this.cooldownStarted || this.spec.cooldown.startAt !== point) return;
    this.cooldownStarted = true;
    const durationMs = this.spec.cooldown.durationMs;
    this._cooldownRemainingMs = Math.max(
      0,
      this.delegate.cooldownDurationMs?.(durationMs) ?? durationMs
    );
  }

  private updateCooldown(deltaMs: number): void {
    if (this._cooldownRemainingMs > 0) {
      this._cooldownRemainingMs = Math.max(0, this._cooldownRemainingMs - deltaMs);
    }
    if (this._state === 'READY' && this._cooldownRemainingMs > 0) this._state = 'COOLDOWN';
    if (this._state === 'COOLDOWN' && this._cooldownRemainingMs === 0) this._state = 'READY';
  }
}
