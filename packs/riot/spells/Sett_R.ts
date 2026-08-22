import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type Untargetable = InstanceType<ContentApi['buffs']['Untargetable']>;
type Sett_R = InstanceType<ReturnType<typeof makeSett_R>>;
type Sett_R_Carry = InstanceType<ReturnType<typeof makeSett_R_Carry>>;
type Sett_R_Crater = InstanceType<ReturnType<typeof makeSett_R_Crater>>;



export const SETT_R_RANGE = 250;

export const SETT_R_CARRY = 340;

export const SETT_R_CARRY_MS = 550;

export const SETT_R_SLAM = 45;

export const SETT_R_BLAST = 30;

export const SETT_R_BLAST_RADIUS = 220;

export const SETT_R_SLOW = 0.5;

export const SETT_R_SLOW_MS = 1_500;

export const SETT_R_CRATER_MS = 2_000;

/** How high the carried body is held while it flies. */
export const SETT_R_LIFT = 70;

/** How far in front of him the body is planted on landing. */
export const SETT_R_DROP = 58;


const HOT: [number, number, number] = [255, 140, 0];

const GOLD: [number, number, number] = [255, 215, 0];

const BLOOD: [number, number, number] = [183, 21, 64];


/**
 * He picks one champion up and throws himself with them in a parabolic suplex.
 */
function __buildSett_R(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const TargetResolver = api.combat.TargetResolver;
  const AttackableUnit = api.units.AttackableUnit;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Untargetable = api.buffs.Untargetable;
  const Spell = api.Spell;
  const Sett_R_Carry = makeSett_R_Carry(api);
  class Sett_R extends Spell {
    image = api.asset('spell_sett_r');
    name = 'Hủy Diệt Đấu Trường (Sett_R)';
    description =
      `Sett bốc một tướng địch lên không trung (không thể bị chọn làm mục tiêu), bay vút lên ` +
      `và nện xuống đất: mục tiêu bị ném nhận <span class="damage">${SETT_R_SLAM} sát thương</span>, ` +
      `mọi kẻ địch khác trong bán kính ${SETT_R_BLAST_RADIUS} nhận <span class="damage">${SETT_R_BLAST} sát thương</span> ` +
      `và bị làm chậm ${Math.round(SETT_R_SLOW * 100)}% trong ${SETT_R_SLOW_MS / 1000} giây.`;
    coolDown = 10_000;
    manaCost = 100;
    range = SETT_R_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    /** Caster-centred, and both bodies are wide, so Reach owns the number. */
    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        ...super.targetingRequest,
        range: effectiveRange(this.range, this.owner),
        targetTeam: 'ENEMY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => this.isValidTarget(candidate),
        getTargetInfo: candidate =>
          this.isValidTarget(candidate)
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

    private isValidTarget(target?: unknown): target is AttackableUnit {
      return (
        target instanceof AttackableUnit &&
        !target.isDead &&
        !target.toRemove &&
        target !== this.owner &&
        target.teamId !== this.owner.teamId &&
        withinRange(SETT_R_RANGE, this.owner, target)
      );
    }

    checkCastCondition(): boolean {
      return Dash.CanDash(this.owner) && this.isValidTarget(this.castContext?.target);
    }

    press(context: CastContext): boolean {
      if (context.target !== undefined) {
        if (!this.isValidTarget(context.target as AttackableUnit)) return false;
        return super.press(context);
      }

      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    onSpellCast(context: CastContext): void {
      const victim = context?.target as AttackableUnit | undefined;
      if (!this.isValidTarget(victim)) return;

      const aim = this.firingDirection(context);
      const heading = Math.atan2(aim.y, aim.x);

      victim.stopMovement();
      victim.markDisplaced();
      const lifted = new Airborne(SETT_R_CARRY_MS, this.owner, victim);
      lifted.height = SETT_R_LIFT;
      victim.addBuff(lifted);

      const victimHidden = new Untargetable(SETT_R_CARRY_MS, this.owner, victim);
      victim.addBuff(victimHidden);

      const settHidden = new Untargetable(SETT_R_CARRY_MS, this.owner, this.owner);
      this.owner.addBuff(settHidden);

      const dash = new Dash(SETT_R_CARRY_MS, this.owner, this.owner);
      dash.dashDestination = createVector(
        this.owner.position.x + Math.cos(heading) * SETT_R_CARRY,
        this.owner.position.y + Math.sin(heading) * SETT_R_CARRY
      );
      dash.dashSpeed = 15;
      dash.buffsToCheckCancel = [];
      this.owner.addBuff(dash);

      const carry = new Sett_R_Carry(this.owner, victim, heading, lifted, victimHidden, settHidden);
      this.game.objectManager.addObject(carry);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Sett_R;
}
const __cacheSett_R = new WeakMap<ContentApi, ReturnType<typeof __buildSett_R>>();
export default function makeSett_R(api: ContentApi) {
  const cached = __cacheSett_R.get(api);
  if (cached) return cached;
  const built = __buildSett_R(api);
  __cacheSett_R.set(api, built);
  return built;
}


/**
 * The parabolic flight. Sett and victim leap in an arc through the air,
 * untargetable until the crater slam.
 */
function __buildSett_R_Carry(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Airborne = api.buffs.Airborne;
  const Slow = api.buffs.Slow;
  const Untargetable = api.buffs.Untargetable;
  const SpellObject = api.SpellObject;
  const Sett_R_Crater = makeSett_R_Crater(api);
  class Sett_R_Carry extends SpellObject {
    age = 0;
    landed = false;
    sparks: { angle: number; reach: number }[] = [];

    private heading: number;
    private carried: AttackableUnit;
    private lifted: Airborne | null;
    private victimHidden: Untargetable | null;
    private settHidden: Untargetable | null;

    constructor(
      owner: AttackableUnit,
      carried: AttackableUnit,
      heading: number,
      lifted: Airborne | null,
      victimHidden: Untargetable | null,
      settHidden: Untargetable | null
    ) {
      super(owner);
      this.carried = carried;
      this.heading = heading;
      this.lifted = lifted;
      this.victimHidden = victimHidden;
      this.settHidden = settHidden;
    }

    onAdded(): void {
      for (let i = 0; i < 9; i++) {
        this.sparks.push({ angle: random(TWO_PI), reach: random(20, 50) });
      }
    }

    update(): void {
      if (this.landed) {
        this.toRemove = true;
        return;
      }
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      const t = constrain(this.age / SETT_R_CARRY_MS, 0, 1);
      const leapZ = Math.sin(t * Math.PI) * 90;

      const lost = this.carried.isDead || this.carried.toRemove;
      if (!lost) {
        this.carried.teleportTo(this.owner.position.x, this.owner.position.y - leapZ);
      }
      if (this.age >= SETT_R_CARRY_MS || lost || this.owner.isDead) this.slam();
    }

    draw(): void {
      const t = constrain(this.age / SETT_R_CARRY_MS, 0, 1);
      const leapZ = Math.sin(t * Math.PI) * 90;
      const body = this.owner.animatedValues.displaySize * 0.5 || 27;
      const shadowScale = Math.max(0.4, 1 - leapZ / 150);

      push();
      translate(this.position.x, this.position.y);

      // 1. Ground drop shadow beneath leaping Sett and victim
      noStroke();
      fill(0, 0, 0, 100 * shadowScale);
      ellipse(0, 0, body * 3.2 * shadowScale, body * 1.6 * shadowScale);

      // 2. Fiery overhead grip & speed lines
      translate(0, -leapZ);
      rotate(this.heading);

      // Fiery overhead clamp arms
      for (let side = -1; side <= 1; side += 2) {
        fill(BLOOD[0], BLOOD[1], BLOOD[2], 235);
        rect(side * body * 0.6 - 7, -SETT_R_LIFT * 0.55, 14, SETT_R_LIFT * 0.6, 4);
      }
      fill(HOT[0], HOT[1], HOT[2], 220);
      rect(-body * 0.9, -SETT_R_LIFT * 0.65, body * 1.8, 14, 4);

      // Trailing fiery leap sparks
      stroke(GOLD[0], GOLD[1], GOLD[2], 220);
      strokeWeight(3.5);
      for (const spark of this.sparks) {
        const sx = cos(spark.angle) * body;
        const sy = sin(spark.angle) * body * 0.6;
        line(sx, sy, sx - spark.reach * (1 - t * 0.5), sy);
      }

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((SETT_R_LIFT + 140) * 2);
    }

    private slam(): void {
      this.landed = true;
      this.toRemove = true;
      if (this.lifted && !this.lifted.toRemove) this.lifted.deactivateBuff();
      if (this.victimHidden && !this.victimHidden.toRemove) this.victimHidden.deactivateBuff();
      if (this.settHidden && !this.settHidden.toRemove) this.settHidden.deactivateBuff();

      const atX = this.owner.position.x;
      const atY = this.owner.position.y;
      const dropX = atX + Math.cos(this.heading) * SETT_R_DROP;
      const dropY = atY + Math.sin(this.heading) * SETT_R_DROP;
      const thrown = this.carried;
      const alive = !thrown.isDead && !thrown.toRemove;
      if (alive) {
        thrown.teleportTo(dropX, dropY);
        thrown.takeDamage(SETT_R_SLAM, this.owner);
      }

      // The rim the crater paints is the radius the damage really used.
      const blast = effectiveRange(SETT_R_BLAST_RADIUS, this.owner);
      const shaken = this.game.objectManager.queryObjects({
        area: new Circle({ x: atX, y: atY, r: blast }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      // A plain loop: Array.prototype.filter cannot narrow here. The thrown body
      // pays the slam and nothing else — never both halves of one ultimate.
      const struck = new Set<AttackableUnit>();
      for (const unit of shaken) {
        if (unit === thrown || struck.has(unit)) continue;
        struck.add(unit);
        unit.takeDamage(SETT_R_BLAST, this.owner);
        const slow = new Slow(SETT_R_SLOW_MS, this.owner, unit);
        slow.percent = SETT_R_SLOW;
        slow.stackId = 'sett_r_arena_slow';
        unit.addBuff(slow);
      }

      const crater = new Sett_R_Crater(this.owner, atX, atY, blast, dropX, dropY);
      this.game.objectManager.addObject(crater);
    }
  }
  return Sett_R_Carry;
}
const __cacheSett_R_Carry = new WeakMap<ContentApi, ReturnType<typeof __buildSett_R_Carry>>();
export function makeSett_R_Carry(api: ContentApi) {
  const cached = __cacheSett_R_Carry.get(api);
  if (cached) return cached;
  const built = __buildSett_R_Carry(api);
  __cacheSett_R_Carry.set(api, built);
  return built;
}


/**
 * Ground art, so zIndex = GROUND_Z_INDEX: an un-overridden SpellObject subclass
 * resolves to SPELL_EFFECT_Z_INDEX instead, over everyone's feet.
 */
function __buildSett_R_Crater(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Sett_R_Crater extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    lifeTime = SETT_R_CRATER_MS;
    age = 0;
    radius: number;
    /** Seeded once in onAdded — random() inside draw() flickers instead of animating. */
    slabs: { angle: number; at: number; span: number; tilt: number }[] = [];

    private impactX: number;
    private impactY: number;

    constructor(
      owner: AttackableUnit,
      x: number,
      y: number,
      radius: number,
      impactX: number,
      impactY: number
    ) {
      super(owner);
      this.position = createVector(x, y);
      this.radius = radius;
      this.impactX = impactX;
      this.impactY = impactY;
    }

    onAdded(): void {
      for (let i = 0; i < 12; i++) {
        this.slabs.push({
          angle: random(TWO_PI),
          at: random(0.25, 1),
          span: random(22, 54),
          tilt: random(-0.5, 0.5),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const shock = constrain(this.age / 340, 0, 1);
      const opened = 1 - (1 - shock) * (1 - shock);
      const fade = 1 - t;
      push();
      rectMode(CORNER);
      translate(this.position.x, this.position.y);

      // cracked ground: heavy slabs, no thin arcs
      noStroke();
      fill(38, 24, 20, 150 * fade);
      circle(0, 0, this.radius * 1.5 * opened);
      fill(BLOOD[0], BLOOD[1], BLOOD[2], 120 * fade);
      for (const slab of this.slabs) {
        const rx = cos(slab.angle) * this.radius * slab.at * opened;
        const ry = sin(slab.angle) * this.radius * slab.at * opened;
        push();
        translate(rx, ry);
        rotate(slab.angle + slab.tilt);
        rect(-slab.span / 2, -5, slab.span, 10, 2);
        pop();
      }

      // the hard rim, on the real blast radius
      noFill();
      stroke(HOT[0], HOT[1], HOT[2], 240 * fade);
      strokeWeight(7 * fade + 2);
      circle(0, 0, this.radius * 2 * opened);

      // the impact itself, centred on the body he threw
      stroke(255, 244, 226, 245 * fade);
      strokeWeight(6 * fade + 2);
      const mark = 34 * opened;
      const cx = this.impactX - this.position.x;
      const cy = this.impactY - this.position.y;
      line(cx - mark, cy - mark, cx + mark, cy + mark);
      line(cx - mark, cy + mark, cx + mark, cy - mark);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 60) * 2);
    }
  }
  return Sett_R_Crater;
}
const __cacheSett_R_Crater = new WeakMap<ContentApi, ReturnType<typeof __buildSett_R_Crater>>();
export function makeSett_R_Crater(api: ContentApi) {
  const cached = __cacheSett_R_Crater.get(api);
  if (cached) return cached;
  const built = __buildSett_R_Crater(api);
  __cacheSett_R_Crater.set(api, built);
  return built;
}