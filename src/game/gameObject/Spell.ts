import { uuidv4 } from '../../utils/index';
import EventType from '../enums/EventType';
import SpellState from '../enums/SpellState';
import { SpellRuntime, type SpellRuntimeDelegate } from '../spell/runtime/SpellRuntime';
import SpellVfx from '../vfx/SpellVfx';
import StatusFlags from '../enums/StatusFlags';
import type { TargetingRequest } from '../spell/targeting/TargetResolver';
import type {
  CancelReason,
  CastContext,
  CastSpec,
  ResourceCommitPoint,
  SpellRuntimeState,
} from '../spell/runtime/types';

const legacyCastSpec = (durationMs: number): CastSpec => ({
  activation: 'PRESS',
  targeting: 'DIRECTION',
  castTimeMs: 0,
  resource: { commitAt: 'start', refundOn: [] },
  cooldown: { startAt: 'start', durationMs },
});

const snapshotContext = (context: CastContext): CastContext =>
  Object.freeze({
    ...context,
    origin: Object.freeze({ ...context.origin }),
    cursorWorld: Object.freeze({ ...context.cursorWorld }),
    direction: Object.freeze({ ...context.direction }),
  });

export default class Spell {
  // for display in HUD
  name = this.constructor.name;
  image: any = null;
  description: any = null;
  disabled = false;
  willDrawPreview = false;

  // for spell logic
  level = 0;
  coolDown = 0;
  manaCost = 0;
  healthCost = 0;

  id: string = uuidv4();
  owner: any;
  game: any;
  private spellRuntime?: SpellRuntime;
  private spellVfx?: SpellVfx;
  private _castContext?: CastContext;
  private ownerSnapshot?: {
    position: { x: number; y: number };
    destination?: { x: number; y: number };
    movementRevision?: number;
    displacementRevision?: number;
  };

  constructor(owner: any) {
    this.owner = owner;
    this.game = owner?.game;
  }

  /** @deprecated New and migrated spells must use lifecycle policies. */
  get state(): SpellRuntimeState {
    return this.runtime.state;
  }

  set state(state: SpellRuntimeState) {
    this.runtime.setCompatibilityState(state);
  }

  /** @deprecated New and migrated spells must use lifecycle policies. */
  get currentCooldown(): number {
    return this.runtime.cooldownRemainingMs;
  }

  set currentCooldown(remainingMs: number) {
    this.runtime.setCompatibilityCooldown(remainingMs);
  }

  get castContext(): CastContext | undefined {
    return this._castContext;
  }

  /**
   * A counter this spell accumulates across casts, e.g. Nasus Q's strikes. The
   * HUD badges the icon with it, so a stacking spell shows its progress instead
   * of only flashing a number at the moment it lands. `undefined` means the
   * spell has nothing to count and gets no badge.
   */
  get stackCount(): number | undefined {
    return undefined;
  }

  get aimPoint(): p5.Vector {
    const aim = this._castContext?.cursorWorld ?? this.game.worldMouse;
    return createVector(aim.x, aim.y);
  }

  update(): void {
    this.onUpdate();
    this.observeInterrupts();
    this.runtime.update(deltaTime);
    if (this.owner.isDead) {
      this.spellVfx?.dispose();
      return;
    }
    this.syncVfxPhase();
    this.spellVfx?.update(deltaTime);
  }

  drawVfx(): void {
    this.spellVfx?.draw();
  }

  cast(): void {
    if (this.state !== SpellState.READY) return;

    const origin = { x: this.owner.position.x, y: this.owner.position.y };
    const cursorWorld = {
      x: this.game.worldMouse.x,
      y: this.game.worldMouse.y,
    };
    const dx = cursorWorld.x - origin.x;
    const dy = cursorWorld.y - origin.y;
    const length = Math.hypot(dx, dy);
    this.press(
      Object.freeze({
        spellId: this.id,
        activationId: uuidv4(),
        startedAtMs: Date.now(),
        caster: this.owner,
        origin: Object.freeze(origin),
        cursorWorld: Object.freeze(cursorWorld),
        direction: Object.freeze({
          x: length === 0 ? 0 : dx / length,
          y: length === 0 ? 0 : dy / length,
        }),
      })
    );
  }

  press(context: CastContext): boolean {
    this._castContext = snapshotContext(context);
    this.game.eventManager.emit(EventType.ON_PRE_CAST_SPELL, this);
    const accepted = this.runtime.press(this._castContext);
    if (accepted) {
      this.snapshotOwner();
      // Casting is the third way to cancel a standing attack order, beside a
      // move order and crowd control: committing to an ability is a decision to
      // stop chasing.
      //
      // Here rather than on ON_PRE_CAST_SPELL because that event fires before
      // the runtime has ruled on the cast, so a listener cannot tell a real cast
      // from a key pressed into a cooldown. That distinction is not cosmetic:
      // an AI champion attempts a cast several times a second and is refused
      // almost every time, so cancelling on the attempt would leave the bots
      // unable to hold an attack order at all. `accepted` is the cast.
      if (this.cancelsAttackOrder) this.owner?.basicAttack?.clear();
    }
    this.syncVfxPhase();
    return accepted;
  }

  /**
   * Whether casting this spell drops the caster's standing attack order.
   *
   * True for every ability. BasicAttack overrides it, because casting that one
   * *is* the order — and note the ordering this relies on: a PRESS spell runs
   * `onSpellCast` inside `runtime.press` above, so an order placed there would
   * be wiped by the line below if the flag were not honoured.
   */
  protected get cancelsAttackOrder(): boolean {
    return true;
  }

  hold(context: CastContext): boolean {
    return this.runtime.hold(context);
  }

  release(context: CastContext): boolean {
    const released = this.runtime.release(context);
    this.syncVfxPhase();
    return released;
  }

  cancel(reason: CancelReason): boolean {
    return this.runtime.cancel(reason);
  }

  castCancelCheck(): boolean {
    if (
      this.disabled ||
      this.owner.isDead ||
      !this.owner.canCast ||
      this.owner.stats.mana.value < this.manaCost ||
      this.owner.stats.health.value < this.healthCost ||
      !this.checkCastCondition()
    ) {
      this.resetCoolDown();
      return true;
    }

    return false;
  }

  // Notes: Deactivate is never called as spell removal hasn't been added yet.
  deactivate(): void {
    this.runtime.cancel('SCENE_EXIT');
    this.resetCoolDown();
    this.spellVfx?.dispose();
  }

  onRemoved(): void {
    this.runtime.cancel('SCENE_EXIT');
    this.spellVfx?.dispose();
  }

  resetCoolDown(): void {
    this.currentCooldown = 0;
  }

  // for override
  checkCastCondition(): boolean {
    return true;
  }

  onSpellCast(_context: CastContext): void {}
  onUpdate(): void {}
  onCastStart(_context: CastContext): void {}
  onChargeUpdate(_context: CastContext, _elapsedMs: number, _ratio: number): void {}
  onRelease(_context: CastContext): void {}
  onChannelTick(_context: CastContext, _tickIndex: number): void {}
  onActivate(_context: CastContext): void {}
  onRecast(_context: CastContext): void {}
  onCancel(_context: CastContext, _reason: CancelReason): void {}
  onComplete(_context: CastContext): void {}

  protected ignoresOwnerInterrupts(): boolean {
    return false;
  }

  get castSpec(): Readonly<CastSpec> {
    return legacyCastSpec(this.coolDown);
  }

  get targetingRequest(): Readonly<TargetingRequest> { return {}; }

  protected playImpactVfx(context: CastContext): void {
    this.spellVfx?.impact(context);
  }

  /**
   * Moves the caster instantly — Flash, Zed's shadow swap, anything that blinks.
   *
   * The single place a champion may relocate itself, so grounding is enforced
   * once here instead of in each spell. Self-propelled dashes get the same rule
   * inside the Dash buff; between the two, a spell has to opt into neither and
   * a new one cannot forget. `tests/game/buffs/Ground.test.ts` fails the build
   * if a spell reaches for `owner.teleportTo` directly and bypasses this.
   *
   * Returns false when the blink was refused, so a recast can tell.
   */
  protected blinkOwnerTo(x: number, y: number): boolean {
    if (this.owner.grounded) return false;
    this.owner.teleportTo(x, y);
    return true;
  }

  private get runtime(): SpellRuntime {
    if (!this.spellRuntime) {
      const spec = this.castSpec as CastSpec;
      this.spellVfx = new SpellVfx(spec.vfx, spec.sfx);
      const delegate: SpellRuntimeDelegate = {
        canStart: (context) => this.canStart(context),
        commitResource: (context, point) => this.commitResource(context, point),
        refundResource: (context, reason) => this.refundResource(context, reason),
        onCastStart: (context) => {
          this.spellVfx?.castStart(context);
          this.onCastStart(context);
        },
        onChargeUpdate: (context, elapsedMs, ratio) =>
          this.onChargeUpdate(context, elapsedMs, ratio),
        onRelease: (context) => {
          this.spellVfx?.release(context);
          this.onRelease(context);
          this.onSpellCast(context);
          this.game.eventManager.emit(EventType.ON_POST_CAST_SPELL, this);
        },
        onChannelTick: (context, tickIndex) => this.onChannelTick(context, tickIndex),
        onActivate: (context) => {
          this.spellVfx?.activate(context);
          this.onActivate(context);
        },
        onRecast: (context) => this.onRecast(context),
        onCancel: (context, reason) => {
          this.spellVfx?.cancel(context);
          this.onCancel(context, reason);
        },
        onComplete: (context) => {
          this.spellVfx?.complete();
          this.onComplete(context);
        },
      };
      this.spellRuntime = new SpellRuntime(spec, delegate);
    }
    return this.spellRuntime;
  }

  private canStart(_context: CastContext): boolean {
    return !this.castCancelCheck();
  }

  private commitResource(_context: CastContext, _point: ResourceCommitPoint): boolean {
    if (
      this.owner.stats.mana.value < this.manaCost ||
      this.owner.stats.health.value < this.healthCost
    ) {
      return false;
    }
    this.changeResource(this.owner.stats.mana, -this.manaCost);
    this.changeResource(this.owner.stats.health, -this.healthCost);
    return true;
  }

  private refundResource(_context: CastContext, _reason: CancelReason): void {
    this.changeResource(this.owner.stats.mana, this.manaCost);
    this.changeResource(this.owner.stats.health, this.healthCost);
  }

  protected changeResource(
    resource: { value: number; baseValue?: number; current?: number },
    amount: number
  ): void {
    if (typeof resource.baseValue === 'number') resource.baseValue += amount;
    else if (typeof resource.current === 'number') resource.current += amount;
    else resource.value += amount;
  }

  private observeInterrupts(): void {
    if (!['CASTING', 'CHARGING', 'CHANNELING', 'ACTIVE'].includes(this.runtime.state)) return;
    if (this.ignoresOwnerInterrupts()) return;
    if (this.owner.isDead) {
      this.runtime.cancel('DEATH');
      return;
    }

    const status = typeof this.owner.status === 'number' ? this.owner.status : 0;
    if ((status & (StatusFlags.Stunned | StatusFlags.Suppressed)) !== 0) {
      this.runtime.cancel('STUN');
    } else if ((status & StatusFlags.Silenced) !== 0 || !this.owner.canCast) {
      this.runtime.cancel('SILENCE');
    } else if (this.ownerSnapshot) {
      const hasExplicitMovementSignals =
        typeof this.owner.movementRevision === 'number' &&
        typeof this.owner.displacementRevision === 'number';
      if (hasExplicitMovementSignals) {
        if (this.owner.displacementRevision !== this.ownerSnapshot.displacementRevision) {
          this.runtime.cancel('DISPLACEMENT');
        } else if (this.owner.movementRevision !== this.ownerSnapshot.movementRevision) {
          this.runtime.cancel('MOVE');
        }
        return;
      }
      const { position, destination } = this.ownerSnapshot;
      const currentPosition = this.owner.position;
      const currentDestination = this.owner.destination;
      const destinationChanged = destination && currentDestination &&
        (currentDestination.x !== destination.x || currentDestination.y !== destination.y);
      const positionChanged = currentPosition.x !== position.x || currentPosition.y !== position.y;
      if (destinationChanged || (positionChanged && destination &&
          (destination.x !== position.x || destination.y !== position.y))) {
        this.runtime.cancel('MOVE');
      } else if (positionChanged) {
        this.runtime.cancel('DISPLACEMENT');
      }
      if (destination && currentDestination) {
        destination.x = currentDestination.x;
        destination.y = currentDestination.y;
      }
      position.x = currentPosition.x;
      position.y = currentPosition.y;
    }
  }

  private snapshotOwner(): void {
    const position = this.owner.position;
    const destination = this.owner.destination;
    this.ownerSnapshot = {
      position: { x: position.x, y: position.y },
      ...(destination ? { destination: { x: destination.x, y: destination.y } } : {}),
      movementRevision: this.owner.movementRevision,
      displacementRevision: this.owner.displacementRevision,
    };
  }

  private syncVfxPhase(): void {
    if (this.runtime.state === 'CHANNELING' && this._castContext) {
      this.spellVfx?.channel(this._castContext);
    }
  }

  drawPreview(radius?: number): void {
    if (radius) {
      push();
      strokeWeight(2);
      stroke(200, 100);
      noFill();
      circle(this.owner.position.x, this.owner.position.y, radius * 2);
      pop();
    }
  }
}
