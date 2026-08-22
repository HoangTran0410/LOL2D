import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type {
  BeamGeometry,
  CancelReason,
  CastContext,
  CastSpec,
  Vec2,
} from '@moba2d/core/content/types';
import { drawIreliaBlade, IRELIA_CREST, IRELIA_EDGE, IRELIA_RIM, IRELIA_STEEL } from './Irelia_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Irelia_W = InstanceType<ReturnType<typeof makeIrelia_W>>;
type Irelia_W_Charge = InstanceType<ReturnType<typeof makeIrelia_W_Charge>>;
type Irelia_W_Guard = InstanceType<ReturnType<typeof makeIrelia_W_Guard>>;
type Irelia_W_Slash = InstanceType<ReturnType<typeof makeIrelia_W_Slash>>;



export const W_CHARGE_MS = 1_200;

export const W_MIN_REACH = 220;

export const W_MAX_REACH = 420;

export const W_WIDTH = 120;

export const W_MIN_DAMAGE = 14;

export const W_MAX_DAMAGE = 32;

export const W_SLOW_PERCENT = 0.3;

export const W_SLOW_MS = 1_000;

/** What the guard eats while she is winding the blades up. */
export const W_DAMAGE_REDUCTION = 0.35;

export const W_HEAL_PER_HIT = 6;


/**
 * Defiance.
 *
 * A commitment, not a poke: she plants her feet, the blades gather, and every
 * extra tenth of a second buys reach and damage. The trade is stated in both
 * directions — she genuinely cannot walk while she holds it, and she is harder
 * to kill while she does (`Irelia_W_Guard` does both).
 *
 * **Rooted, not cancelled-on-a-step.** The charge used to run on the default
 * `SpellForm.HELD`, whose `move: true` ends it the moment the caster's
 * `movementRevision` ticks — and that counter is bumped by the *order*, not by
 * the step, since `canMove` is only consulted later in `AttackableUnit.update`.
 * So a right click ended the charge whether or not she was able to go anywhere,
 * which is the worst of both worlds once she is rooted: unable to move and
 * punished for asking. `AIMED` is the form whose interrupt table says exactly
 * what is wanted here — death, crowd control and displacement still take it,
 * a move order does not. The name reads oddly for a spell that plants her feet;
 * the table is what a form is.
 *
 * `releaseAtMax` is on because a fully wound Defiance firing itself is what the
 * player expects from the telegraph: the bar filling *is* the promise that it
 * goes off, and cancelling there would be the ability punishing the player for
 * holding it exactly as long as it asked.
 */
function __buildIrelia_W(api: ContentApi) {
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellForm = api.enums.SpellForm;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const Spell = api.Spell;
  const beamBoundingBox = api.beamBoundingBox;
  const intersectsBeam = api.intersectsBeam;
  const Irelia_W_Guard = makeIrelia_W_Guard(api);
  const Irelia_W_Charge = makeIrelia_W_Charge(api);
  const Irelia_W_Slash = makeIrelia_W_Slash(api);
  class Irelia_W extends Spell {
    image = api.asset('spell_irelia_w');
    name = 'Vũ Điệu Thách Thức (Irelia_W)';
    description = `Giữ phím để tích lực — <span class="buff">giảm ${Math.round(
      W_DAMAGE_REDUCTION * 100
    )}% sát thương phải chịu</span> trong lúc tích. Thả ra để quét kiếm về phía con trỏ,
      gây <span class="damage">${W_MIN_DAMAGE}–${W_MAX_DAMAGE} sát thương</span> tuỳ mức tích lực,
      <span class="buff">làm chậm ${Math.round(W_SLOW_PERCENT * 100)}%</span> trong
      <span class="time">${W_SLOW_MS / 1000} giây</span> và hồi ${W_HEAL_PER_HIT} máu mỗi mục tiêu trúng.`;
    coolDown = 9_000;
    manaCost = 40;
    range = W_MAX_REACH;

    private chargeMs = 0;
    private aimContext?: CastContext;
    private guard?: Irelia_W_Guard;
    private telegraph?: Irelia_W_Charge;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'HOLD_RELEASE',
        targeting: 'DIRECTION',
        charge: { maxDurationMs: W_CHARGE_MS, releaseAtMax: true },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
        interrupts: SpellForm.AIMED,
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

      const guard = new Irelia_W_Guard(W_CHARGE_MS, this.owner, this.owner);
      guard.image = this.image;
      this.guard = guard;
      this.owner.addBuff(guard);

      // The telegraph reaches well past her body, so it is a SpellObject rather
      // than something drawn out of the champion — art drawn from `Champion.draw`
      // disappears the moment the object manager culls the caster, while the
      // sweep it promised still lands.
      const telegraph = new Irelia_W_Charge(this.owner);
      this.telegraph = telegraph;
      this.game.objectManager.addObject(telegraph);
      this.aimTelegraph();
    }

    onChargeUpdate(_context: CastContext, elapsedMs: number): void {
      this.chargeMs = elapsedMs;
      this.aimTelegraph();
    }

    onUpdate(): void {
      if (this.state !== 'CHARGING') return;
      if (this.owner.isDead) this.cancel('DEATH');
      else if (!this.owner.canCast) this.cancel('SILENCE');
    }

    onRelease(context: CastContext): void {
      this.endCharge();

      const geometry = this.sweepAt(this.chargeMs, this.aimContext ?? context);
      const damage = this.damageAt(this.chargeMs);

      const found = this.game.objectManager.queryObjects({
        area: beamBoundingBox(geometry, undefined),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      let struck = 0;
      for (const victim of found) {
        if (victim === this.owner || victim.isDead || victim.toRemove) continue;
        if (!intersectsBeam(victim, geometry)) continue;
        struck += 1;
        victim.takeDamage(damage, this.owner);

        // No `slow.image = this.image`: a crowd-control buff keeps its own CC
        // icon, so a slowed unit shows "slowed" rather than a spinning W.
        const slow = new Slow(W_SLOW_MS, this.owner, victim);
        slow.percent = W_SLOW_PERCENT;
        slow.stackId = 'irelia_w_slow';
        victim.addBuff(slow);
      }

      if (struck > 0) this.owner.takeHeal(W_HEAL_PER_HIT * struck, this.owner);

      this.game.objectManager.addObject(
        new Irelia_W_Slash(this.owner, geometry, this.chargeRatio(this.chargeMs))
      );
    }

    onCancel(_context: CastContext, _reason: CancelReason): void {
      this.endCharge();
    }

    onComplete(): void {
      this.endCharge();
    }

    /** Idempotent: death, a step, a silence and a normal release all land here. */
    private endCharge(): void {
      this.guard?.deactivateBuff();
      this.guard = undefined;
      if (this.telegraph) this.telegraph.toRemove = true;
      this.telegraph = undefined;
    }

    private aimTelegraph(): void {
      const telegraph = this.telegraph;
      if (!telegraph) return;
      const aim = this.aimDirection;
      telegraph.ratio = this.chargeRatio(this.chargeMs);
      telegraph.reach = this.reachAt(this.chargeMs);
      telegraph.dirX = aim.x;
      telegraph.dirY = aim.y;
    }

    private chargeRatio(elapsedMs: number): number {
      return Math.min(1, elapsedMs / W_CHARGE_MS);
    }

    private reachAt(elapsedMs: number): number {
      return W_MIN_REACH + (W_MAX_REACH - W_MIN_REACH) * this.chargeRatio(elapsedMs);
    }

    private damageAt(elapsedMs: number): number {
      return W_MIN_DAMAGE + (W_MAX_DAMAGE - W_MIN_DAMAGE) * this.chargeRatio(elapsedMs);
    }

    /** The capsule the sweep occupies: her body out to the charged reach. */
    private sweepAt(elapsedMs: number, context: CastContext): BeamGeometry {
      const aim = this.directionTo(context);
      const reach = this.reachAt(elapsedMs);
      return {
        start: { x: this.owner.position.x, y: this.owner.position.y },
        end: {
          x: this.owner.position.x + aim.x * reach,
          y: this.owner.position.y + aim.y * reach,
        },
        width: W_WIDTH,
      };
    }

    private get aimDirection(): Vec2 {
      const aim = this.aimContext;
      return aim ? this.directionTo(aim) : { x: 1, y: 0 };
    }

    /**
     * Live aim off the cursor, falling back to a direction that is never (0,0) —
     * `context.direction` is itself (0,0) whenever the aim landed on her own feet,
     * which is where a bot with no cursor aims everything.
     */
    private directionTo(context: CastContext): Vec2 {
      const dx = context.cursorWorld.x - this.owner.position.x;
      const dy = context.cursorWorld.y - this.owner.position.y;
      const span = Math.hypot(dx, dy);
      if (span === 0) return this.firingDirection(context);
      return { x: dx / span, y: dy / span };
    }
  }
  return Irelia_W;
}
const __cacheIrelia_W = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_W>>();
export default function makeIrelia_W(api: ContentApi) {
  const cached = __cacheIrelia_W.get(api);
  if (cached) return cached;
  const built = __buildIrelia_W(api);
  __cacheIrelia_W.set(api, built);
  return built;
}


/**
 * The guard she holds while the blades wind up.
 *
 * A modifier rather than a reaction: it changes what reaches her health, which
 * is exactly what `modifyIncomingDamage` is for. It stacks multiplicatively
 * with whatever else is on her, because every buff hands the next what is left.
 */
function __buildIrelia_W_Guard(api: ContentApi) {
  const StatusFlags = api.enums.StatusFlags;
  const Buff = api.buffs.Buff;
  class Irelia_W_Guard extends Buff {
    name = 'Thế Thủ';
    percent = W_DAMAGE_REDUCTION;

    /**
     * The planted feet, and the only lever that actually works for it:
     * `Stats.updateActionState` derives `CAN_MOVE` from the *flags* — Charmed,
     * Feared, Immovable, Rooted, Stunned, Suppressed — so a buff that only listed
     * `statusFlagsToDisable = StatusFlags.CanMove` would read as if it rooted her
     * and would not.
     *
     * It rides the guard rather than being a separate `Root`, because the two are
     * the same fact: this buff *is* the charge, it is created and dropped by
     * `onCastStart`/`endCharge` together, and a second buff would be a second
     * lifetime to keep in step for no gain. It is also not enemy crowd control —
     * it is her own commitment — so it keeps the W icon rather than the root one.
     */
    statusFlagsToEnable = StatusFlags.Rooted;

    modifyIncomingDamage(damage: number): number {
      // A guard dropped this frame stops guarding this frame. `takeDamage` walks
      // `unit.buffs`, which still holds a deactivated buff until the next
      // `updateBuffs()` prunes it — so without this she keeps the reduction for
      // one more frame after letting go, which is a frame she is not holding it.
      if (this.toRemove) return damage;
      return damage * (1 - this.percent);
    }

    draw(): void {
      const at = this.targetUnit.position;
      const size = this.targetUnit.animatedValues.displaySize;

      push();
      noFill();
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 200);
      strokeWeight(6);
      circle(at.x, at.y, size + 16);
      stroke(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 220);
      strokeWeight(3);
      circle(at.x, at.y, size + 16);
      pop();
    }
  }
  return Irelia_W_Guard;
}
const __cacheIrelia_W_Guard = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_W_Guard>>();
export function makeIrelia_W_Guard(api: ContentApi) {
  const cached = __cacheIrelia_W_Guard.get(api);
  if (cached) return cached;
  const built = __buildIrelia_W_Guard(api);
  __cacheIrelia_W_Guard.set(api, built);
  return built;
}


/**
 * The wind-up telegraph: the corridor the sweep will cover, growing as she
 * holds it. Both the length and the fill say how far along the charge is, so
 * the enemy standing in it can read how much is coming, not only that something
 * is.
 */
function __buildIrelia_W_Charge(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Irelia_W_Charge extends SpellObject {
    ratio = 0;
    reach = W_MIN_REACH;
    dirX = 1;
    dirY = 0;
    age = 0;

    /** Seeded once: `random()` called from `draw` flickers instead of animating. */
    private motes: { around: number; away: number; sway: number }[] = [];

    constructor(owner: AttackableUnit) {
      super(owner);
      this.position = owner.position.copy();
      this.attachTo(owner);
    }

    onAdded(): void {
      for (let i = 0; i < 10; i++) {
        this.motes.push({
          around: random(0, TWO_PI),
          away: random(58, 108),
          sway: random(0.6, 1.4),
        });
      }
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    draw(): void {
      const heading = Math.atan2(this.dirY, this.dirX);
      const half = W_WIDTH / 2;

      push();
      translate(this.position.x, this.position.y);
      rotate(heading);

      // The corridor: a dark rim first so it survives pale ground, then a fill
      // that brightens with the charge.
      noFill();
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 190);
      strokeWeight(4);
      rectMode(CORNER);
      rect(0, -half, this.reach, W_WIDTH, 10);
      noStroke();
      fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 40 + 70 * this.ratio);
      rect(0, -half, this.reach, W_WIDTH, 10);

      // Motes drawn in tight around her body, not out on the floor: the corridor
      // already owns the ground, and this layer is only allowed to say one thing
      // the corridor cannot — that the charge is being *gathered inward*.
      const pull = 1 - this.ratio;
      noStroke();
      fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 90 + 140 * this.ratio);
      for (const mote of this.motes) {
        const away = 10 + mote.away * pull;
        const around = mote.around + this.ratio * mote.sway * 2.4;
        circle(cos(around) * away, sin(around) * away, 3 + 2 * this.ratio);
      }

      // Her blades leaving the orbit and coming to guard in front of her. Fully
      // wound they shiver, which is the only cue that holding longer buys nothing.
      const shiver = this.ratio >= 1 ? sin(this.age / 22) * 2.5 : 0;
      for (let i = -1; i <= 1; i += 2) {
        push();
        translate(lerp(2, 34 + shiver, this.ratio), lerp(i * 30, i * 8, this.ratio));
        rotate(lerp(HALF_PI * i, 0, this.ratio));
        drawIreliaBlade(26);
        pop();
      }

      // A hard bar at the far end: where it stops is the part the enemy needs.
      stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 150 + 100 * this.ratio);
      strokeWeight(5);
      line(this.reach, -half, this.reach, half);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((W_MAX_REACH + W_WIDTH) * 2);
    }
  }
  return Irelia_W_Charge;
}
const __cacheIrelia_W_Charge = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_W_Charge>>();
export function makeIrelia_W_Charge(api: ContentApi) {
  const cached = __cacheIrelia_W_Charge.get(api);
  if (cached) return cached;
  const built = __buildIrelia_W_Charge(api);
  __cacheIrelia_W_Charge.set(api, built);
  return built;
}


/**
 * The sweep itself: a blade dragged across the corridor the telegraph promised,
 * ending on a hard edge at the same reach the damage used.
 */
function __buildIrelia_W_Slash(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const beamBoundingBox = api.beamBoundingBox;
  class Irelia_W_Slash extends SpellObject {
    lifeTime = 320;
    age = 0;
    readonly geometry: BeamGeometry;
    readonly power: number;

    constructor(owner: AttackableUnit, geometry: BeamGeometry, power: number) {
      super(owner);
      this.geometry = geometry;
      this.power = power;
      this.position = createVector(geometry.start.x, geometry.start.y);
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const swept = 1 - (1 - t) * (1 - t);
      const spanX = this.geometry.end.x - this.geometry.start.x;
      const spanY = this.geometry.end.y - this.geometry.start.y;
      const reach = Math.hypot(spanX, spanY);
      const half = this.geometry.width / 2;

      push();
      translate(this.geometry.start.x, this.geometry.start.y);
      rotate(Math.atan2(spanY, spanX));

      // The swept ground, retreating as it fades so the eye follows the blade out.
      noStroke();
      fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 110 * fade);
      quad(0, -half * 0.35, reach * swept, -half, reach * swept, half, 0, half * 0.35);

      // Five blade streaks fanning out across the corridor: the cut, not a glow.
      // Rim under body, both passes over the same five lines, so each streak keeps
      // its silhouette instead of the pale layer smearing over the dark one.
      const streaks = 5;
      for (const pass of [0, 1]) {
        if (pass === 0) {
          stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 200 * fade);
          strokeWeight(8 * fade + 2);
        } else {
          stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 250 * fade);
          strokeWeight(3.5 * fade + 1);
        }
        for (let i = 0; i < streaks; i++) {
          const across = (i / (streaks - 1)) * 2 - 1;
          line(reach * 0.1, across * half * 0.4, reach * swept, across * half * 0.92);
        }
      }

      // The far edge, keyed to how hard it was wound.
      stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], (140 + 110 * this.power) * fade);
      strokeWeight(5 * fade + 1);
      line(reach * swept, -half, reach * swept, half);
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      return beamBoundingBox(this.geometry, this);
    }
  }
  return Irelia_W_Slash;
}
const __cacheIrelia_W_Slash = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_W_Slash>>();
export function makeIrelia_W_Slash(api: ContentApi) {
  const cached = __cacheIrelia_W_Slash.get(api);
  if (cached) return cached;
  const built = __buildIrelia_W_Slash(api);
  __cacheIrelia_W_Slash.set(api, built);
  return built;
}