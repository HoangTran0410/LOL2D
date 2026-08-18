import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange, withinRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Airborne from '../buffs/Airborne';
import Dash from '../buffs/Dash';
import Slow from '../buffs/Slow';
import Untargetable from '../buffs/Untargetable';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export const SETT_R_RANGE = 250;
export const SETT_R_CARRY = 300;
export const SETT_R_CARRY_MS = 450;
export const SETT_R_SLAM = 45;
export const SETT_R_BLAST = 30;
export const SETT_R_BLAST_RADIUS = 200;
export const SETT_R_SLOW = 0.5;
export const SETT_R_SLOW_MS = 1_500;
export const SETT_R_CRATER_MS = 2_000;
/** How high the carried body is held while it flies. */
export const SETT_R_LIFT = 70;
/** How far in front of him the body is planted on landing. */
export const SETT_R_DROP = 58;

const HOT: [number, number, number] = [225, 112, 85];
const BLOOD: [number, number, number] = [183, 21, 64];

/**
 * He picks one champion up and throws himself with them. The carry is owned by
 * Sett_R_Carry rather than the dash callbacks, so the landing fires on one clock
 * whether the dash arrived early, was walled off, or was cut short.
 */
export default class Sett_R extends Spell {
  image = AssetManager.get('spell_sett_r');
  name = 'Hủy Diệt Đấu Trường (Sett_R)';
  description =
    `Sett bốc một tướng địch lên đầu, lao ${SETT_R_CARRY} và giáng xuống đất: mục tiêu bị ném ` +
    `nhận <span class="damage">${SETT_R_SLAM} sát thương</span>, mọi kẻ địch khác trong bán kính ` +
    `${SETT_R_BLAST_RADIUS} nhận <span class="damage">${SETT_R_BLAST} sát thương</span> và bị ` +
    `làm chậm ${Math.round(SETT_R_SLOW * 100)}% trong ${SETT_R_SLOW_MS / 1000} giây.`;
  coolDown = 10_000;
  manaCost = 100;
  range = SETT_R_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  /** Caster-centred, and both bodies are wide, so Reach owns the number. */
  get targetingRequest() {
    return { ...super.targetingRequest, range: effectiveRange(this.range, this.owner) };
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(context: CastContext): void {
    const victim = context?.target as AttackableUnit | undefined;
    if (!victim || victim.isDead || victim.toRemove) return;
    if (!withinRange(SETT_R_RANGE, this.owner, victim)) return;

    const aim = this.firingDirection(context);
    const heading = Math.atan2(aim.y, aim.x);

    victim.stopMovement();
    victim.markDisplaced();
    const lifted = new Airborne(SETT_R_CARRY_MS, this.owner, victim);
    lifted.height = SETT_R_LIFT;
    victim.addBuff(lifted);
    const hidden = new Untargetable(SETT_R_CARRY_MS, this.owner, victim);
    victim.addBuff(hidden);

    const dash = new Dash(SETT_R_CARRY_MS, this.owner, this.owner);
    dash.dashDestination = createVector(
      this.owner.position.x + Math.cos(heading) * SETT_R_CARRY,
      this.owner.position.y + Math.sin(heading) * SETT_R_CARRY
    );
    dash.dashSpeed = 14;
    // He is carrying somebody: nothing short of death shakes him off, and the
    // slam's own stun-shaped effects must not cancel the carry that spawns them.
    dash.buffsToCheckCancel = [];
    this.owner.addBuff(dash);

    const carry = new Sett_R_Carry(this.owner, victim, heading, lifted, hidden);
    this.game.objectManager.addObject(carry);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The flight. It pins the carried body to Sett so the whole map can read who is
 * being thrown, and it is the thing that decides where the slam lands: his real
 * position when the carry ends, not the point the dash was aimed at.
 */
export class Sett_R_Carry extends SpellObject {
  age = 0;
  landed = false;
  /** Seeded once in onAdded — random() inside draw() flickers instead of animating. */
  sparks: { angle: number; reach: number }[] = [];

  private heading: number;
  private carried: AttackableUnit;
  private lifted: Airborne | null;
  private hidden: Untargetable | null;

  constructor(
    owner: AttackableUnit,
    carried: AttackableUnit,
    heading: number,
    lifted: Airborne | null,
    hidden: Untargetable | null
  ) {
    super(owner);
    this.carried = carried;
    this.heading = heading;
    this.lifted = lifted;
    this.hidden = hidden;
  }

  onAdded(): void {
    for (let i = 0; i < 7; i++) {
      this.sparks.push({ angle: random(TWO_PI), reach: random(14, 34) });
    }
  }

  update(): void {
    if (this.landed) {
      this.toRemove = true;
      return;
    }
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    const lost = this.carried.isDead || this.carried.toRemove;
    if (!lost) this.carried.teleportTo(this.owner.position.x, this.owner.position.y);
    if (this.age >= SETT_R_CARRY_MS || lost || this.owner.isDead) this.slam();
  }

  draw(): void {
    const t = constrain(this.age / SETT_R_CARRY_MS, 0, 1);
    const swept = 1 - (1 - t) * (1 - t);
    const body = this.owner.animatedValues.displaySize * 0.5 || 27;
    push();
    rectMode(CORNER);
    translate(this.position.x, this.position.y);
    // two slab arms braced overhead, holding the body up where everyone sees it
    noStroke();
    for (let side = -1; side <= 1; side += 2) {
      fill(BLOOD[0], BLOOD[1], BLOOD[2], 225);
      rect(side * body * 0.55 - 7, -SETT_R_LIFT * 0.55, 14, SETT_R_LIFT * 0.6, 3);
    }
    fill(HOT[0], HOT[1], HOT[2], 200);
    rect(-body * 0.8, -SETT_R_LIFT * 0.62, body * 1.6, 12, 3);
    // speed lines dragged behind the run
    stroke(HOT[0], HOT[1], HOT[2], 190);
    strokeWeight(3);
    for (const spark of this.sparks) {
      const back = -this.heading;
      const sx = cos(spark.angle) * body;
      const sy = sin(spark.angle) * body * 0.5;
      line(sx, sy, sx - cos(back) * spark.reach * swept, sy + sin(back) * spark.reach * swept);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((SETT_R_LIFT + 80) * 2);
  }

  private slam(): void {
    this.landed = true;
    this.toRemove = true;
    if (this.lifted && !this.lifted.toRemove) this.lifted.deactivateBuff();
    if (this.hidden && !this.hidden.toRemove) this.hidden.deactivateBuff();

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

/**
 * Ground art, so zIndex = 2: Z_INDEX_MAP is keyed by exact constructor and a
 * SpellObject subclass otherwise falls through to 99, over everyone's feet.
 */
export class Sett_R_Crater extends SpellObject {
  zIndex = 2;
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
