import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CancelReason, CastContext, CastSpec } from '@moba2d/core/content/types';

type CastBar = InstanceType<ContentApi['vfx']['CastBar']>;
type ChargeRangeTelegraph = InstanceType<ContentApi['vfx']['ChargeRangeTelegraph']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type VfxGroup = InstanceType<ContentApi['vfx']['VfxGroup']>;
type Varus_Q = InstanceType<ReturnType<typeof makeVarus_Q>>;
type Varus_Q_Arrow = InstanceType<ReturnType<typeof makeVarus_Q_Arrow>>;



export const MAX_CHARGE_MS = 4_000;

export const RANGE_CHARGE_MS = 1_500;

export const DAMAGE_CHARGE_MS = 1_250;

export const MIN_CENTER_TRAVEL = 100;

export const MAX_CENTER_TRAVEL = 700;

// Damage scales linearly with charge, same MIN + (MAX - MIN) * ratio shape as
// the range growth below. Exported so the suite asserts the wiring, not a copy
// of the numbers — retuning a value should not mean editing the test.
export const MIN_DAMAGE = 20;

export const MAX_DAMAGE = 30;

export const SELF_SLOW_PERCENT = 0.2;

export const MANA_COST = 50;

export const ARROW_SPEED = 1_200 / 60;

export const ARROW_SIZE = 36;

export const ARROW_VISUAL_WIDTH = 90;

export const ARROW_VISUAL_HEIGHT = 32;


function __buildVarus_Q(api: ContentApi) {
  const SpellForm = api.enums.SpellForm;
  const Spell = api.Spell;
  const Slow = api.buffs.Slow;
  const CastBar = api.vfx.CastBar;
  const unitCastBarAnchor = api.vfx.unitCastBarAnchor;
  const ChargeRangeTelegraph = api.vfx.ChargeRangeTelegraph;
  const VfxGroup = api.vfx.VfxGroup;
  const Varus_Q_Arrow = makeVarus_Q_Arrow(api);
  class Varus_Q extends Spell {
    image = api.asset('spell_varus_q');
    name = 'Mũi Tên Xuyên Phá (Varus_Q)';
    description = 'Giữ để tích lực rồi bắn một mũi tên xuyên theo hướng con trỏ.';
    coolDown = 5_000;
    manaCost = MANA_COST;

    private chargeMs = 0;
    private aimContext?: CastContext;
    private chargeSlow?: Slow;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'HOLD_RELEASE',
        targeting: 'DIRECTION',
        charge: { maxDurationMs: MAX_CHARGE_MS, releaseAtMax: false },
        resource: { commitAt: 'start', refundOn: ['MAX_DURATION', 'DEATH', 'SILENCE', 'STUN'] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        // Drawing the bow: Varus keeps walking while he aims, but every piece of
        // crowd control takes the shot away.
        interrupts: SpellForm.AIMED,
        vfx: {
          castLoop: context =>
            new VfxGroup([
              new CastBar(
                context,
                () => this.chargeMs / MAX_CHARGE_MS,
                undefined,
                () => unitCastBarAnchor(this.owner)
              ),
              new ChargeRangeTelegraph(
                () => this.owner.position,
                () => this.aimDirection,
                () => this.currentRange,
                () => this.chargeMs / RANGE_CHARGE_MS
              ),
            ]),
        },
      };
    }

    hold(context: CastContext): boolean {
      this.aimContext = context;
      return super.hold(context);
    }

    release(context: CastContext): boolean {
      this.aimContext = context;
      return super.release(context);
    }

    onCastStart(context: CastContext): void {
      this.chargeMs = 0;
      this.aimContext = context;
      this.chargeSlow = new Slow(MAX_CHARGE_MS, this.owner, this.owner);
      this.chargeSlow.percent = SELF_SLOW_PERCENT;
      this.chargeSlow.stackId = 'varus_q_charge_slow';
      this.owner.addBuff(this.chargeSlow);
    }

    onChargeUpdate(_context: CastContext, elapsedMs: number): void {
      this.chargeMs = elapsedMs;
    }

    onUpdate(): void {
      if (this.state !== 'CHARGING') return;
      if (this.owner.isDead) this.cancel('DEATH');
      else if (!this.owner.canCast) this.cancel('SILENCE');
    }

    onRelease(context: CastContext): void {
      this.removeChargeSlow();
      const aim = this.aimContext ?? context;
      const range = this.rangeAt(this.chargeMs);
      const origin = this.owner.position;
      const direction = this.directionTo(aim, origin.x, origin.y);
      const arrow = new Varus_Q_Arrow(this.owner);
      arrow.destination = createVector(
        origin.x + direction.x * range,
        origin.y + direction.y * range
      );
      arrow.damage = this.damageAt(this.chargeMs);
      arrow.chargeRatio = Math.min(1, this.chargeMs / RANGE_CHARGE_MS);
      this.game.objectManager.addObject(arrow);
    }

    onCancel(_context: CastContext, reason: CancelReason): void {
      this.removeChargeSlow();
      if (
        reason === 'MAX_DURATION' ||
        reason === 'DEATH' ||
        reason === 'SILENCE' ||
        reason === 'STUN'
      ) {
        this.changeResource(this.owner.stats.mana, -this.effectiveManaCost / 2);
      }
    }

    private rangeAt(elapsedMs: number): number {
      return (
        MIN_CENTER_TRAVEL +
        (MAX_CENTER_TRAVEL - MIN_CENTER_TRAVEL) * Math.min(1, elapsedMs / RANGE_CHARGE_MS)
      );
    }

    get currentRange(): number {
      return this.rangeAt(this.chargeMs);
    }

    private get aimDirection(): { x: number; y: number } {
      const aim = this.aimContext;
      return aim
        ? this.directionTo(aim, this.owner.position.x, this.owner.position.y)
        : { x: 0, y: 0 };
    }

    private damageAt(elapsedMs: number): number {
      return MIN_DAMAGE + (MAX_DAMAGE - MIN_DAMAGE) * Math.min(1, elapsedMs / DAMAGE_CHARGE_MS);
    }

    /**
     * Live aim off the cursor, falling back to a direction that is never (0,0).
     *
     * The old fallback was `context.direction`, which is itself (0,0) whenever
     * the aim landed on Varus — a cursor on top of him, or a bot with no cursor
     * at all aiming at a `destination` parked on its own feet. That loosed an
     * arrow whose destination was its origin, which is a shot that never
     * happened. `firingDirection` resolves it off his own heading, which is the
     * rule `Game.facing()` states for the touch layer.
     */
    private directionTo(context: CastContext, x: number, y: number): { x: number; y: number } {
      const dx = context.cursorWorld.x - x;
      const dy = context.cursorWorld.y - y;
      const length = Math.hypot(dx, dy);
      if (length === 0) return this.firingDirection(context);
      return { x: dx / length, y: dy / length };
    }

    private removeChargeSlow(): void {
      this.chargeSlow?.deactivateBuff();
      this.chargeSlow = undefined;
    }
  }
  return Varus_Q;
}
const __cacheVarus_Q = new WeakMap<ContentApi, ReturnType<typeof __buildVarus_Q>>();
export default function makeVarus_Q(api: ContentApi) {
  const cached = __cacheVarus_Q.get(api);
  if (cached) return cached;
  const built = __buildVarus_Q(api);
  __cacheVarus_Q.set(api, built);
  return built;
}


function __buildVarus_Q_Arrow(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  class Varus_Q_Arrow extends MissileSpellObject {
    speed = ARROW_SPEED;
    size = ARROW_SIZE;
    visualWidth = ARROW_VISUAL_WIDTH;
    visualHeight = ARROW_VISUAL_HEIGHT;
    maxHitCount = Infinity;
    damage = MIN_DAMAGE;
    /** 0..1 — how far the shot was drawn, so a full charge reads as a heavier bolt. */
    chargeRatio = 0;

    trailSystem = new TrailSystem({
      trailColor: '#A4FA',
      trailSize: this.visualHeight * 0.45,
      trailLifeTime: 320,
    });

    draw(): void {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      const half = this.visualWidth / 2;
      const barb = this.visualHeight * 0.44;
      const charge = this.chargeRatio;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      // Corruption bleeding off the shaft — heavier the longer the shot was drawn.
      // Square caps and a glow that stops short of the head keep this reading as a
      // streak behind the arrow instead of a capsule wrapped around it.
      blendMode(ADD);
      strokeCap(SQUARE);
      noFill();
      stroke(120, 40, 190, 45 + 45 * charge);
      strokeWeight(6 + 6 * charge);
      line(-half * 0.95, 0, half * 0.5, 0);
      stroke(200, 120, 255, 80);
      strokeWeight(2 + 2 * charge);
      line(-half * 0.95, 0, half * 0.5, 0);
      blendMode(BLEND);
      strokeCap(ROUND);

      // shaft: dark body with a lit top edge so it reads over pale terrain
      stroke(46, 20, 66, 240);
      strokeWeight(4);
      line(-half * 0.95, 0, half * 0.55, 0);
      stroke(196, 150, 240, 200);
      strokeWeight(1.2);
      line(-half * 0.95, -1.1, half * 0.55, -1.1);

      // Fletching: two feathers swept back along the shaft. Drawn as slanted quads
      // rather than triangles meeting at the tail, which read as a second arrowhead.
      noStroke();
      fill(126, 58, 176, 235);
      quad(-half * 0.5, -1.6, -half * 0.86, -barb * 0.85, -half, -barb * 0.85, -half * 0.72, -1.6);
      quad(-half * 0.5, 1.6, -half * 0.86, barb * 0.85, -half, barb * 0.85, -half * 0.72, 1.6);

      // barbed head, notched at the back so the barbs stay legible in motion
      fill(238, 224, 255, 250);
      beginShape();
      vertex(half, 0);
      vertex(half * 0.45, -barb);
      vertex(half * 0.63, 0);
      vertex(half * 0.45, barb);
      endShape(CLOSE);

      fill(150, 60, 210, 220);
      triangle(half * 0.92, 0, half * 0.6, -barb * 0.28, half * 0.6, barb * 0.28);

      pop();
    }

    onHit(enemy: { takeDamage(damage: number, owner: unknown): void }): void {
      const reduction = Math.min(
        0.67,
        this.hitTargets.length > 1 ? (this.hitTargets.length - 1) * 0.15 : 0
      );
      enemy.takeDamage(this.damage * (1 - reduction), this.owner);
    }
  }
  return Varus_Q_Arrow;
}
const __cacheVarus_Q_Arrow = new WeakMap<ContentApi, ReturnType<typeof __buildVarus_Q_Arrow>>();
export function makeVarus_Q_Arrow(api: ContentApi) {
  const cached = __cacheVarus_Q_Arrow.get(api);
  if (cached) return cached;
  const built = __buildVarus_Q_Arrow(api);
  __cacheVarus_Q_Arrow.set(api, built);
  return built;
}