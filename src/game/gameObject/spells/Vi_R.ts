import { Circle, Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange, withinRange } from '@/game/combat/Reach';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type { TargetingRequest } from '@/game/spell/targeting/TargetResolver';
import type { CastContext } from '@/game/spell/runtime/types';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Airborne from '@/game/gameObject/buffs/Airborne';
import Dash from '@/game/gameObject/buffs/Dash';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';

export const R_RANGE = 450;
export const R_DAMAGE = 45;
export const R_KNOCKUP_MS = 1_000;
export const R_PASS_DAMAGE = 15;
export const R_PASS_KNOCKUP_MS = 500;
/** How close a body has to be to the charge to be knocked out of the way. */
export const R_PASS_RADIUS = 60;
/** The blast at the end of the charge, centred where she stopped. */
export const R_BLAST_RADIUS = 90;
export const R_DASH_SPEED = 20;
/** A ceiling, not a duration: the charge ends the frame it arrives. */
export const R_DASH_MAX_MS = 2_000;
/** She stops a fist's length short instead of standing inside the target. */
export const R_ARRIVAL_GAP = 45;
export const R_IMPACT_REACH = 120;

const BRASS: [number, number, number] = [225, 177, 44];
const HEXTECH: [number, number, number] = [0, 168, 255];

/**
 * The unstoppable charge.
 *
 * Two things make it an ultimate rather than a longer Q. It cannot be stopped:
 * `buffsToCheckCancel` is emptied for the flight, which says "ignore the crowd
 * control that would end an ordinary dash" in the dash's own words instead of
 * opting out of the buff layer wholesale. And it cannot be blocked by a body:
 * anything in the way is knocked aside and the charge keeps going, so the only
 * answer to it is not being where it lands.
 */
export default class Vi_R extends Spell {
  targetingMode = 'UNIT' as const;
  image = AssetManager.get('spell_vi_r');
  name = 'Tả Xung Hữu Đột (Vi_R)';
  description = `Lao tới một mục tiêu và không gì cản được:
    <span class="damage">${R_DAMAGE} sát thương</span> và hất tung
    ${R_KNOCKUP_MS / 1000} giây khi tới. Kẻ địch trên đường bị gạt sang bên,
    chịu <span class="damage">${R_PASS_DAMAGE} sát thương</span>.`;
  coolDown = 10_000;
  manaCost = 100;
  range = R_RANGE;

  get targetingRequest(): Readonly<TargetingRequest> {
    return { range: R_RANGE };
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(context?: CastContext): void {
    const target = context?.target as AttackableUnit | undefined;
    if (!target || target.isDead || target.toRemove) return;
    if (!withinRange(R_RANGE, this.owner, target)) return;

    // One ledger for the whole ultimate: nobody takes both the pass-through and
    // the blast, and nobody takes either twice.
    const punched = new Set<AttackableUnit>();
    const launch = this.owner.position.copy();
    let lastSeen = target.position.copy();
    let landed = false;

    const charge = new Dash(R_DASH_MAX_MS, this.owner, this.owner);
    charge.dashSpeed = R_DASH_SPEED;
    charge.dashDestination = this.stopShortOf(lastSeen);
    charge.image = this.image;
    charge.showTrail = false;
    // Unstoppable, stated where a dash states it.
    charge.buffsToCheckCancel = [];

    charge.onDashUpdate = () => {
      if (this.stillReachable(target)) {
        lastSeen = target.position.copy();
        charge.dashDestination = this.stopShortOf(lastSeen);
      }
      this.knockAside(punched, target);
    };

    // Arrival and expiry are the same landing, so it lives on the one hook that
    // runs exactly once either way.
    charge.onDeactivate = () => {
      if (landed) return;
      landed = true;
      this.land(punched, target);
    };

    this.owner.addBuff(charge);
    this.game.objectManager.addObject(new Vi_R_Streak(this.owner, launch, charge));
  }

  /** A point a fist short of the body, so she arrives beside it rather than in it. */
  private stopShortOf(at: p5.Vector): p5.Vector {
    const dx = at.x - this.owner.position.x;
    const dy = at.y - this.owner.position.y;
    const span = Math.hypot(dx, dy);
    if (span <= R_ARRIVAL_GAP) return createVector(this.owner.position.x, this.owner.position.y);
    const keep = (span - R_ARRIVAL_GAP) / span;
    return createVector(this.owner.position.x + dx * keep, this.owner.position.y + dy * keep);
  }

  private stillReachable(target: AttackableUnit): boolean {
    return !target.isDead && !target.toRemove && target.targetable;
  }

  /**
   * Bodies she runs through. A collision, not an acquisition — an area sweep of
   * the ground she has just covered, so it does not narrow to a chosen unit and
   * the fog has no say in what her shoulder hits.
   */
  private knockAside(punched: Set<AttackableUnit>, target: AttackableUnit): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(R_PASS_RADIUS, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of found) {
      if (victim === this.owner || victim === target) continue;
      if (punched.has(victim)) continue;
      punched.add(victim);
      victim.takeDamage(R_PASS_DAMAGE, this.owner);
      victim.addBuff(new Airborne(R_PASS_KNOCKUP_MS, this.owner, victim));
    }
  }

  /**
   * The blast, centred where she actually stopped. Reading the position rather
   * than the intended destination is what makes the "target died mid-charge"
   * case land somewhere real instead of on a corpse's old coordinates.
   */
  private land(punched: Set<AttackableUnit>, target: AttackableUnit): void {
    const at = this.owner.position.copy();
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: at.x,
        y: at.y,
        r: effectiveRange(R_BLAST_RADIUS, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of found) {
      if (victim === this.owner) continue;
      if (punched.has(victim)) continue;
      punched.add(victim);
      victim.takeDamage(R_DAMAGE, this.owner);
      victim.addBuff(new Airborne(R_KNOCKUP_MS, this.owner, victim));
    }

    const towards = this.stillReachable(target) ? target.position : at;
    const heading = Math.atan2(towards.y - at.y, towards.x - at.x);
    this.game.objectManager.addObject(new Vi_R_Impact(this.owner, at, heading));
  }
}

/**
 * The streak: a straight brass-and-blue bar from where she launched to where she
 * is this frame. It spans two points that are up to a screen apart, so the box
 * is built by hand around both ends — a square around her centre would cull the
 * half of it that is behind her.
 */
export class Vi_R_Streak extends SpellObject {
  age = 0;
  launch: p5.Vector;
  private pad = 34;

  constructor(owner: AttackableUnit, launch: p5.Vector, charge: Dash) {
    super(owner);
    this.launch = launch;
    this.position = owner.position.copy();
    this.attachTo(owner, charge);
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);
  }

  draw(): void {
    const spanX = this.position.x - this.launch.x;
    const spanY = this.position.y - this.launch.y;
    const flown = Math.hypot(spanX, spanY);
    if (flown < 1) return;
    const heading = Math.atan2(spanY, spanX);
    const pulse = 0.75 + 0.25 * sin(this.age / 90);

    push();
    translate(this.launch.x, this.launch.y);
    rotate(heading);
    noStroke();
    // Widening toward her, so the bar reads as a direction and not a rope.
    fill(HEXTECH[0], HEXTECH[1], HEXTECH[2], 90 * pulse);
    quad(0, -5, flown, -15, flown, 15, 0, 5);
    fill(BRASS[0], BRASS[1], BRASS[2], 200 * pulse);
    quad(0, -2, flown, -6, flown, 6, 0, 2);
    stroke(255, 255, 255, 150 * pulse);
    strokeWeight(2);
    line(flown * 0.55, -3, flown, 0);
    line(flown * 0.55, 3, flown, 0);
    pop();
  }

  getDisplayBoundingBox() {
    const left = Math.min(this.launch.x, this.position.x) - this.pad;
    const top = Math.min(this.launch.y, this.position.y) - this.pad;
    return new Rectangle({
      x: left,
      y: top,
      w: Math.abs(this.position.x - this.launch.x) + this.pad * 2,
      h: Math.abs(this.position.y - this.launch.y) + this.pad * 2,
      data: this,
    });
  }
}

/** The wedge that lands on the target: brass cone, white vent flash, fracture fan. */
export class Vi_R_Impact extends SpellObject {
  lifeTime = 460;
  age = 0;
  radius = R_IMPACT_REACH;
  heading: number;
  private fractures: { spread: number; length: number; kink: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector, heading: number) {
    super(owner);
    this.position = at;
    this.heading = heading;
  }

  onAdded(): void {
    for (let i = 0; i < 10; i++) {
      this.fractures.push({
        spread: random(-1.4, 1.4),
        length: random(0.5, 1),
        kink: random(-0.35, 0.35),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const opened = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);

    noStroke();
    fill(HEXTECH[0], HEXTECH[1], HEXTECH[2], 165 * fade);
    const cone = this.radius * 0.8 * opened;
    quad(-18, 0, cone * 0.45, -44 * opened - 10, cone, 0, cone * 0.45, 44 * opened + 10);

    stroke(BRASS[0], BRASS[1], BRASS[2], 240 * fade);
    strokeWeight(4 * fade + 1);
    for (const fracture of this.fractures) {
      const reach = this.radius * fracture.length * opened;
      const bend = fracture.spread + fracture.kink * opened;
      line(
        Math.cos(fracture.spread) * 14,
        Math.sin(fracture.spread) * 14,
        Math.cos(bend) * reach,
        Math.sin(bend) * reach
      );
    }

    noFill();
    stroke(255, 255, 255, 250 * fade * fade);
    strokeWeight(6 * fade + 1);
    circle(0, 0, 26 + 58 * opened);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 40) * 2);
  }
}
