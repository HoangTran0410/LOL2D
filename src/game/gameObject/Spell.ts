import { uuidv4 } from '../../utils/index';
import EventType from '../enums/EventType';
import SpellState from '../enums/SpellState';
import { SpellRuntime, type SpellRuntimeDelegate } from '../spell/runtime/SpellRuntime';
import SpellVfx from '../vfx/SpellVfx';
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

  get aimPoint(): p5.Vector {
    const aim = this._castContext?.cursorWorld ?? this.game.worldMouse;
    return createVector(aim.x, aim.y);
  }

  update(): void {
    this.onUpdate();
    if (this.owner.isDead && !this.runtime.cancel('DEATH')) this.spellVfx?.dispose();
    this.runtime.update(deltaTime);
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
    this.syncVfxPhase();
    return accepted;
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
    this.resetCoolDown();
    this.spellVfx?.dispose();
  }

  onRemoved(): void { this.spellVfx?.dispose(); }

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

  protected get castSpec(): CastSpec {
    return legacyCastSpec(this.coolDown);
  }

  protected playImpactVfx(context: CastContext): void {
    this.spellVfx?.impact(context);
  }

  private get runtime(): SpellRuntime {
    if (!this.spellRuntime) {
      const spec = this.castSpec;
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
    this.owner.stats.mana.value -= this.manaCost;
    this.owner.stats.health.value -= this.healthCost;
    return true;
  }

  private refundResource(_context: CastContext, _reason: CancelReason): void {
    this.owner.stats.mana.value += this.manaCost;
    this.owner.stats.health.value += this.healthCost;
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
