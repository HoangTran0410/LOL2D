import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type CastBar = InstanceType<ContentApi['vfx']['CastBar']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type Malzahar_R = InstanceType<ReturnType<typeof makeMalzahar_R>>;
type Malzahar_R_Grasp = InstanceType<ReturnType<typeof makeMalzahar_R_Grasp>>;
type Malzahar_R_Zone = InstanceType<ReturnType<typeof makeMalzahar_R_Zone>>;



// Exported so the suite asserts the grasp's wiring rather than a copy of the
// numbers — retuning a value must not mean editing a test.
export const RANGE = 400;

export const CHANNEL_DURATION_MS = 2_000;

export const TICK_EVERY_MS = 250;

/** Eight ticks: 40 on the pinned target, before the zone under them. */
export const DAMAGE_PER_TICK = 5;

export const ZONE_RADIUS = 170;

export const ZONE_DURATION_MS = 4_000;

export const ZONE_TICK_MS = 500;

export const ZONE_DAMAGE_PER_TICK = 2;

export const COOLDOWN_MS = 10_000;

export const MANA_COST = 100;


const VOID_DEEP: [number, number, number] = [40, 8, 62];

const VOID: [number, number, number] = [142, 66, 218];

const VOID_BRIGHT: [number, number, number] = [206, 255, 140];


function __buildisGraspTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isGraspTarget = (target: unknown): target is AttackableUnit =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove;
  return isGraspTarget;
}
const __cacheisGraspTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisGraspTarget>>();
export function makeIsGraspTarget(api: ContentApi) {
  const cached = __cacheisGraspTarget.get(api);
  if (cached) return cached;
  const built = __buildisGraspTarget(api);
  __cacheisGraspTarget.set(api, built);
  return built;
}


/**
 * Âm Ti Trói Buộc. He pins one body and pours the Void into it.
 *
 * Suppression is `Stun`, exactly the way Warwick R already spells it: the
 * catalogue has no separate suppress, and a stun is what a suppress *is* here —
 * held, unable to act, unable to walk out of the zone opening underneath.
 *
 * The channel is `SpellForm.HELD` (the default), so killing Malzahar or landing
 * any crowd control on him cuts the pin short — which is what makes the
 * ultimate a team fight rather than a button. The Null Zone deliberately
 * outlives the channel; it is already on the ground by then.
 */
function __buildMalzahar_R(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const TargetResolver = api.combat.TargetResolver;
  const CastBar = api.vfx.CastBar;
  const unitCastBarAnchor = api.vfx.unitCastBarAnchor;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Stun = api.buffs.Stun;
  const canSee = api.combat.Vision.canSee;
  const isGraspTarget = makeIsGraspTarget(api);
  const Malzahar_R_Grasp = makeMalzahar_R_Grasp(api);
  const Malzahar_R_Zone = makeMalzahar_R_Zone(api);
  class Malzahar_R extends Spell {
    image = api.asset('spell_malzahar_r');
    name = 'Âm Ti Trói Buộc (Malzahar_R)';
    description =
      `Trói một kẻ địch, <span class="buff">Choáng</span> và gây` +
      ` <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi` +
      ` <span class="time">${TICK_EVERY_MS / 1000} giây</span> suốt` +
      ` <span class="time">${CHANNEL_DURATION_MS / 1000} giây</span>. Một` +
      ` <span class="buff">Vùng Hư Vô</span> mở ra dưới chân nạn nhân, gây` +
      ` <span class="damage">${ZONE_DAMAGE_PER_TICK} sát thương</span> mỗi nhịp trong` +
      ` <span class="time">${ZONE_DURATION_MS / 1000} giây</span> và tồn tại kể cả khi kênh bị ngắt`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    range = RANGE;

    _channelElapsedMs = 0;
    _grasp: Malzahar_R_Grasp | null = null;
    _victim: AttackableUnit | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        channel: { durationMs: CHANNEL_DURATION_MS, tickEveryMs: TICK_EVERY_MS },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        vfx: {
          channelLoop: context =>
            new CastBar(
              context,
              () => this._channelElapsedMs / CHANNEL_DURATION_MS,
              undefined,
              () => unitCastBarAnchor(this.owner)
            ),
        },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: this.range,
        targetTeam: 'ENEMY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => isGraspTarget(candidate),
        getTargetInfo: candidate =>
          isGraspTarget(candidate)
            ? {
                position: candidate.position,
                teamId: candidate.teamId,
                selectionRadius: candidate.animatedValues?.displaySize
                  ? candidate.animatedValues.displaySize / 2
                  : candidate.collisionRadius,
              }
            : null,
      };
    }

    checkCastCondition(): boolean {
      return this.isValidTarget(this.castContext?.target);
    }

    press(context: CastContext): boolean {
      if (context.target !== undefined) return super.press(context);
      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    onSpellCast(context: CastContext): void {
      if (!isGraspTarget(context.target)) return;
      const victim = context.target;

      this._channelElapsedMs = 0;
      this._victim = victim;
      this.owner.stopMovement?.();

      victim.addBuff(new Stun(CHANNEL_DURATION_MS, this.owner, victim));

      const grasp = new Malzahar_R_Grasp(this.owner);
      grasp.victim = victim;
      grasp.attachTo(victim);
      this.game.objectManager.addObject(grasp);
      this._grasp = grasp;

      // The zone is opened at the *cast* position and stays there, so the victim
      // being dragged out of it later by a knock-up is a real escape.
      const zone = new Malzahar_R_Zone(this.owner);
      zone.center.set(victim.position.x, victim.position.y);
      this.game.objectManager.addObject(zone);
    }

    onChannelTick(): void {
      const victim = this._victim;
      if (!victim || victim.isDead || victim.toRemove) return;
      victim.takeDamage(DAMAGE_PER_TICK, this.owner);
      this._grasp?.pulse();
    }

    onUpdate(): void {
      if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
        this.cancel('TARGET_INVALID');
        return;
      }
      if (this.state !== 'CHANNELING') return;
      this._channelElapsedMs += deltaTime;
      // Nothing to hold: the pin ends rather than channelling into a corpse.
      if (!this._victim || this._victim.isDead || this._victim.toRemove) {
        this.cancel('TARGET_INVALID');
      }
    }

    onCancel(): void {
      this.endChannel();
    }

    onComplete(): void {
      this.endChannel();
    }

    /** Idempotent: death, interruption and a clean finish all arrive here. */
    endChannel(): void {
      if (this._grasp) this._grasp.toRemove = true;
      this._grasp = null;
      this._victim = null;
      this._channelElapsedMs = 0;
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    isValidTarget(target: unknown): target is AttackableUnit {
      return (
        isGraspTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Malzahar_R;
}
const __cacheMalzahar_R = new WeakMap<ContentApi, ReturnType<typeof __buildMalzahar_R>>();
export default function makeMalzahar_R(api: ContentApi) {
  const cached = __cacheMalzahar_R.get(api);
  if (cached) return cached;
  const built = __buildMalzahar_R(api);
  __cacheMalzahar_R.set(api, built);
  return built;
}


/**
 * The tether and the claws holding the victim in place.
 *
 * Rides the victim's body, and draws all the way back to Malzahar, so its
 * display box has to span both ends — a box sized to the victim alone would
 * cut the tether off the moment the caster left the camera.
 */
function __buildMalzahar_R_Grasp(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Malzahar_R_Grasp extends SpellObject {
    victim: AttackableUnit | null = null;
    age = 0;
    /** Counts down from a damage tick, so the claws clench on the beat. */
    _tickFlash = 0;
    /** Seeded once so the claws do not jitter to new angles every frame. */
    _clawLean: number[] = [];

    onAdded(): void {
      for (let i = 0; i < 5; i++) this._clawLean.push(random(-0.22, 0.22));
    }

    pulse(): void {
      this._tickFlash = TICK_EVERY_MS;
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      if (this._tickFlash > 0) this._tickFlash -= deltaTime;

      const victim = this.victim;
      if (!victim || this.owner.isDead || this.age >= CHANNEL_DURATION_MS) {
        this.toRemove = true;
        return;
      }
      this.position.set(victim.position.x, victim.position.y);
    }

    draw(): void {
      const victim = this.victim;
      if (!victim) return;
      const size = victim.animatedValues?.displaySize ?? 40;
      const left = constrain(1 - this.age / CHANNEL_DURATION_MS, 0, 1);
      const beat = constrain(this._tickFlash / TICK_EVERY_MS, 0, 1);
      const entry = constrain(this.age / 180, 0, 1);
      const grown = 1 - (1 - entry) * (1 - entry);
      const [dr, dg, db] = VOID_DEEP;
      const [vr, vg, vb] = VOID;
      const [br, bg, bb] = VOID_BRIGHT;

      push();

      // the tether: a cable of void, sagging and snapping taut on every tick
      const mx = (this.owner.position.x + victim.position.x) / 2;
      const my = (this.owner.position.y + victim.position.y) / 2;
      const sag = 26 * (1 - beat);
      noFill();
      stroke(dr, dg, db, 220);
      strokeWeight(7 * grown);
      beginShape();
      vertex(this.owner.position.x, this.owner.position.y);
      vertex(mx, my + sag);
      vertex(victim.position.x, victim.position.y);
      endShape();
      stroke(vr, vg, vb, 200 + 55 * beat);
      strokeWeight(3 * grown);
      beginShape();
      vertex(this.owner.position.x, this.owner.position.y);
      vertex(mx, my + sag);
      vertex(victim.position.x, victim.position.y);
      endShape();

      translate(victim.position.x, victim.position.y);

      // five claws closing on the body, leaning the way they were seeded
      const clench = 1 - beat * 0.5;
      stroke(dr, dg, db, 240);
      strokeWeight(4);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TWO_PI + (this._clawLean[i] ?? 0);
        const outer = (size * 0.95 + 16) * clench * grown;
        const inner = size * 0.45 * grown;
        line(cos(a) * outer, sin(a) * outer, cos(a) * inner, sin(a) * inner);
        noFill();
        stroke(br, bg, bb, 190);
        strokeWeight(1.6);
        line(cos(a) * outer * 0.95, sin(a) * outer * 0.95, cos(a) * inner, sin(a) * inner);
        stroke(dr, dg, db, 240);
        strokeWeight(4);
      }

      // how long they are held: the victim's team is reading this
      noFill();
      stroke(vr, vg, vb, 150);
      strokeWeight(3);
      circle(0, 0, size + 30);
      stroke(br, bg, bb, 235);
      strokeWeight(3);
      arc(0, 0, size + 30, size + 30, -HALF_PI, -HALF_PI + TWO_PI * left);

      // the tick itself
      if (beat > 0) {
        noStroke();
        fill(br, bg, bb, 160 * beat);
        circle(0, 0, size * 0.7 * beat + 8);
      }

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const at = this.victim?.position ?? this.position;
      const pad = 80;
      const minX = Math.min(at.x, this.owner.position.x) - pad;
      const minY = Math.min(at.y, this.owner.position.y) - pad;
      const maxX = Math.max(at.x, this.owner.position.x) + pad;
      const maxY = Math.max(at.y, this.owner.position.y) + pad;
      return new Rectangle({
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        data: this,
      });
    }
  }
  return Malzahar_R_Grasp;
}
const __cacheMalzahar_R_Grasp = new WeakMap<ContentApi, ReturnType<typeof __buildMalzahar_R_Grasp>>();
export function makeMalzahar_R_Grasp(api: ContentApi) {
  const cached = __cacheMalzahar_R_Grasp.get(api);
  if (cached) return cached;
  const built = __buildMalzahar_R_Grasp(api);
  __cacheMalzahar_R_Grasp.set(api, built);
  return built;
}


/**
 * The Null Zone: a hole in the floor that keeps eating whoever stands in it,
 * long after the pin is over.
 *
 * Ground art, so `zIndex = GROUND_Z_INDEX` — the slot `Singed_W_Object`
 * established. Left at the ordinary `SPELL_EFFECT_Z_INDEX` it would paint
 * over the feet of everyone fighting in it.
 */
function __buildMalzahar_R_Zone(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Malzahar_R_Zone extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    center: p5.Vector = createVector();
    age = 0;
    sinceTick = 0;
    /** Seeded once: the cracks in the floor do not re-roll every frame. */
    _crackLength: number[] = [];

    onAdded(): void {
      for (let i = 0; i < 9; i++) this._crackLength.push(random(0.55, 1));
      this.position.set(this.center.x, this.center.y);
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= ZONE_DURATION_MS) {
        this.toRemove = true;
        return;
      }

      this.sinceTick += deltaTime;
      if (this.sinceTick < ZONE_TICK_MS) return;
      this.sinceTick -= ZONE_TICK_MS;

      // Everything standing in it, fog or no fog: a zone is damage application,
      // never target acquisition.
      const targets = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.center.x, y: this.center.y, r: ZONE_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
      for (const target of targets) target.takeDamage(ZONE_DAMAGE_PER_TICK, this.owner);
    }

    draw(): void {
      const entry = constrain(this.age / 320, 0, 1);
      const grown = 1 - (1 - entry) * (1 - entry);
      const left = constrain(1 - this.age / ZONE_DURATION_MS, 0, 1);
      const beat = constrain(1 - this.sinceTick / ZONE_TICK_MS, 0, 1);
      const radius = ZONE_RADIUS * grown;
      const [dr, dg, db] = VOID_DEEP;
      const [vr, vg, vb] = VOID;
      const [br, bg, bb] = VOID_BRIGHT;

      push();
      translate(this.center.x, this.center.y);

      // the hole
      noStroke();
      fill(dr, dg, db, 130 * (0.4 + 0.6 * left));
      circle(0, 0, radius * 2);

      // the rim sits on the real damage radius, so the hitbox is not a guess
      noFill();
      stroke(vr, vg, vb, 150 + 70 * beat);
      strokeWeight(3 + 2 * beat);
      circle(0, 0, radius * 2);

      // cracks radiating out of the middle, each its own seeded length
      stroke(br, bg, bb, 120 * left);
      strokeWeight(2);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TWO_PI + this.age / 2600;
        const reach = radius * (this._crackLength[i] ?? 0.8);
        line(cos(a) * radius * 0.18, sin(a) * radius * 0.18, cos(a) * reach, sin(a) * reach);
      }

      // the pull: a ring collapsing inward on every damage tick
      noFill();
      stroke(br, bg, bb, 190 * beat);
      strokeWeight(2 + 2 * beat);
      circle(0, 0, radius * 2 * (1 - beat) + 12);

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const r = ZONE_RADIUS + 40;
      return new Rectangle({
        x: this.center.x - r,
        y: this.center.y - r,
        w: r * 2,
        h: r * 2,
        data: this,
      });
    }
  }
  return Malzahar_R_Zone;
}
const __cacheMalzahar_R_Zone = new WeakMap<ContentApi, ReturnType<typeof __buildMalzahar_R_Zone>>();
export function makeMalzahar_R_Zone(api: ContentApi) {
  const cached = __cacheMalzahar_R_Zone.get(api);
  if (cached) return cached;
  const built = __buildMalzahar_R_Zone(api);
  __cacheMalzahar_R_Zone.set(api, built);
  return built;
}