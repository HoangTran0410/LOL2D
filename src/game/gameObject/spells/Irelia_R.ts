import { Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type { CastContext, CastSpec, Vec2 } from '@/game/spell/runtime/types';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import Slow from '@/game/gameObject/buffs/Slow';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import {
  beamBoundingBox,
  intersectsBeam,
  type BeamGeometry,
} from '@/game/gameObject/spellObjects/BeamSpellObject';
import { drawIreliaBlade, IRELIA_CREST, IRELIA_EDGE, IRELIA_RIM, IRELIA_STEEL } from './Irelia_Q';

export const R_RANGE = 520;
/** What the blades do as they tear open. */
export const R_DAMAGE = 45;
/** What they charge afterwards for walking into them. */
export const R_WALL_DAMAGE = 18;
export const R_SLOW_PERCENT = 0.4;
export const R_SLOW_MS = 1_500;
export const R_VOLLEY_SPEED = 18;
/** The cluster is thrown as one thing, so its hitbox is one thing. */
export const R_VOLLEY_SIZE = 46;
/** Each backswept arm of the arrowhead. */
export const R_ARM_LENGTH = 190;
/** Half-angle off the backward axis, in radians — how open the arrowhead sits. */
export const R_ARM_SPREAD = 0.62;
export const R_ARM_WIDTH = 46;
/** How long the arms take to tear open, on screen. */
export const R_ARM_OPEN_MS = 150;
/** How long the blades stand once they have. */
export const R_WALL_MS = 2_500;
/** How long a segment takes to fall apart once its time is up. */
export const R_WALL_COLLAPSE_MS = 260;

/**
 * Vanguard's Edge.
 *
 * One thing goes out and two things come back, and the shape is the whole
 * ability: a **tight cluster** of blades thrown as a single object, which tears
 * open into an **arrowhead** the moment it reaches a body — apex where it
 * struck, both arms swept back along the throw — cutting and slowing everyone
 * the opening catches. The blades then *stay standing* in that shape for two
 * and a half seconds, and anyone who walks into them is cut and slowed again.
 *
 * So it is not a nuke, it is a wall she chooses the position of by choosing
 * whom to hit with it, and the counterplay is not being the body it opens on
 * and then not walking back through it.
 *
 * It used to be a fan of five independent blades that flew the full range and
 * then raised an impassable slab. Two things were wrong with that: the blades
 * separated at the caster rather than at the victim, so nothing about the throw
 * said "this opens where it lands", and a wall that *blocks* is a different and
 * much stronger ability than a wall that *hurts*.
 */
export default class Irelia_R extends Spell {
  image = AssetManager.get('spell_irelia_r');
  name = 'Thanh Kiếm Tiên Phong (Irelia_R)';
  description = `Ném một chùm kiếm về phía trước. Khi trúng kẻ địch — hoặc khi tới cuối tầm —
    chùm kiếm <span class="buff">tách ra thành hình mũi tên</span>, gây
    <span class="damage">${R_DAMAGE} sát thương</span> và
    <span class="buff">làm chậm ${Math.round(R_SLOW_PERCENT * 100)}%</span> trong
    <span class="time">${R_SLOW_MS / 1000} giây</span> cho mọi kẻ địch trúng phải.
    Hàng kiếm cắm lại <span class="time">${R_WALL_MS / 1000} giây</span>: ai bước vào cũng chịu
    thêm <span class="damage">${R_WALL_DAMAGE} sát thương</span> và bị làm chậm.`;
  coolDown = 10_000;
  manaCost = 100;
  range = R_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      resource: { commitAt: 'release', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const heading = Math.atan2(aim.y, aim.x);

    const volley = new Irelia_R_Volley(this.owner, heading);
    volley.destination = createVector(
      this.owner.position.x + aim.x * R_RANGE,
      this.owner.position.y + aim.y * R_RANGE
    );
    volley.onBurst = (at, along) => this.openArrowhead(at, along);
    this.game.objectManager.addObject(volley);
  }

  /** Called by the cluster when it stops, so the arrowhead opens where it did. */
  openArrowhead(at: Vec2, heading: number): void {
    this.game.objectManager.addObject(new Irelia_R_Arrow(this.owner, at, heading));
  }
}

/**
 * The cluster in flight: every blade of the ultimate held together as one
 * object, which is why `maxHitCount` is 1 rather than Infinity. It does not
 * pierce and it does not cut on the way — it *stops* on the first body, and
 * stopping is what opens it.
 */
export class Irelia_R_Volley extends MissileSpellObject {
  speed = R_VOLLEY_SPEED;
  size = R_VOLLEY_SIZE;
  maxHitCount = 1;
  age = 0;
  /**
   * Frozen at launch. Deriving it from `destination - position` would read
   * (0,0) on the frame it arrives — which is the one frame the arrowhead needs
   * a heading for.
   */
  readonly heading: number;
  onBurst?: (at: Vec2, heading: number) => void;
  private burst = false;

  constructor(owner: AttackableUnit, heading: number) {
    super(owner);
    this.heading = heading;
  }

  onAfterMove(): void {
    this.age += deltaTime;
  }

  /**
   * A body: the arrowhead opens *through* it, so the apex is the body and not
   * wherever the cluster happened to be standing when the quadtree noticed it.
   *
   * Those are not the same point and the difference is the whole hit. A query
   * circle of `R_VOLLEY_SIZE / 2` against a champion-sized box triggers a good
   * 30-40px early; with the arms swept back from *that* point, the one unit the
   * throw certainly struck ends up in front of the blades, and the ability's
   * primary target is the only thing in the fight it does not cut.
   */
  onHit(enemy: AttackableUnit): void {
    this.open({ x: enemy.position.x, y: enemy.position.y });
  }

  /** Nobody in the way: it opens at the end of its reach instead. */
  onArrive(): void {
    this.open({ x: this.position.x, y: this.position.y });
  }

  private open(apex: Vec2): void {
    if (this.burst) return;
    this.burst = true;
    this.onBurst?.(apex, this.heading);
    this.toRemove = true;
  }

  draw(): void {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);

    // A wake behind it, so the cluster states which way it is travelling.
    noStroke();
    fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 90);
    quad(-46, -4, -10, -16, -10, 16, -46, 4);

    // Four blades held close together — the "chùm" the ability is named for.
    // They already sit at the angles they will fly apart to, so the split reads
    // as the cluster opening rather than as a new object appearing.
    const packed = [-1.5, -0.5, 0.5, 1.5];
    for (const slot of packed) {
      push();
      translate(-4, slot * 7);
      rotate(slot * 0.12 + this.age / 260);
      drawIreliaBlade(38);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size + 60) * 2);
  }
}

/**
 * The arrowhead the cluster tears into, and then stands as.
 *
 * Two arms swept back from the apex along the throw. The same two capsules are
 * the damage volume and the drawing, which is the point — a player has to be
 * able to look at it and know where "inside the blades" is, because the ability
 * charges for walking in there.
 *
 * `inside` is rebuilt every frame rather than accumulated, so leaving the
 * arrowhead and stepping back into it is charged again. That is the ability the
 * blades are supposed to be: a thing you route around, not a thing you eat once
 * and then ignore.
 */
export class Irelia_R_Arrow extends SpellObject {
  lifeTime = R_WALL_MS;
  age = 0;
  readonly heading: number;
  readonly arms: readonly BeamGeometry[];
  /** Who is standing in the blades *this* frame — rebuilt, never accumulated. */
  private inside = new Set<AttackableUnit>();
  /** The opening cut, which is worth more than the toll for stepping in later. */
  private opening = true;
  private collapsing = false;
  private collapseAge = 0;
  /** Recent cuts, drawn on the bodies they landed on. */
  private marks: { x: number; y: number; age: number }[] = [];

  constructor(owner: AttackableUnit, apex: Vec2, heading: number) {
    super(owner);
    this.position = createVector(apex.x, apex.y);
    this.heading = heading;

    const back = heading + Math.PI;
    this.arms = [-1, 1].map(side => ({
      start: { x: apex.x, y: apex.y },
      end: {
        x: apex.x + Math.cos(back + side * R_ARM_SPREAD) * R_ARM_LENGTH,
        y: apex.y + Math.sin(back + side * R_ARM_SPREAD) * R_ARM_LENGTH,
      },
      width: R_ARM_WIDTH,
    }));
  }

  update(): void {
    this.age += deltaTime;

    for (const mark of this.marks) mark.age += deltaTime;
    this.marks = this.marks.filter(mark => mark.age < 360);

    if (this.collapsing) {
      this.collapseAge += deltaTime;
      if (this.collapseAge >= R_WALL_COLLAPSE_MS) this.toRemove = true;
      return;
    }
    if (this.age >= this.lifeTime) {
      this.collapsing = true;
      this.collapseAge = 0;
      return;
    }

    const present = this.unitsOnBlades();
    for (const unit of present) {
      if (this.inside.has(unit)) continue;
      this.cut(unit, this.opening ? R_DAMAGE : R_WALL_DAMAGE);
    }
    this.inside = present;
    this.opening = false;
  }

  private cut(unit: AttackableUnit, damage: number): void {
    unit.takeDamage(damage, this.owner);

    // No `slow.image`: a crowd-control buff keeps its own CC icon, so a slowed
    // unit shows "slowed" rather than an ultimate the player cannot read.
    const slow = new Slow(R_SLOW_MS, this.owner, unit);
    slow.percent = R_SLOW_PERCENT;
    slow.stackId = 'irelia_r_slow';
    unit.addBuff(slow);

    this.marks.push({ x: unit.position.x, y: unit.position.y, age: 0 });
  }

  /**
   * Everyone standing in either arm right now.
   *
   * The volume is the full arm from the first frame, while the drawing takes
   * `R_ARM_OPEN_MS` to reach it. That gap is deliberate and one-directional:
   * the opening cut is instantaneous and has to catch what the throw was aimed
   * through, and 150ms later the two agree for the whole 2.5s that matters.
   */
  private unitsOnBlades(): Set<AttackableUnit> {
    const found = new Set<AttackableUnit>();
    for (const arm of this.arms) {
      const candidates = this.game.objectManager.queryObjects({
        area: beamBoundingBox(arm, undefined),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
      for (const unit of candidates) {
        if (unit === this.owner || unit.isDead || unit.toRemove) continue;
        if (intersectsBeam(unit, arm)) found.add(unit);
      }
    }
    return found;
  }

  draw(): void {
    const opened = constrain(this.age / R_ARM_OPEN_MS, 0, 1);
    const fade = this.collapsing
      ? constrain(1 - this.collapseAge / R_WALL_COLLAPSE_MS, 0, 1)
      : this.age > this.lifeTime - 400
        ? map(this.age, this.lifeTime - 400, this.lifeTime, 1, 0)
        : 1;
    const back = this.heading + Math.PI;

    push();
    translate(this.position.x, this.position.y);

    for (const side of [-1, 1]) {
      push();
      rotate(back + side * R_ARM_SPREAD);
      const reach = R_ARM_LENGTH * opened;
      const half = R_ARM_WIDTH / 2;

      // The ground the arm covers — this is the "do not walk here" statement,
      // and it is the same rectangle `intersectsBeam` charges for.
      noStroke();
      fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 62 * fade);
      rectMode(CORNER);
      rect(0, -half, reach, R_ARM_WIDTH, 8);
      noFill();
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 165 * fade);
      strokeWeight(3);
      rect(0, -half, reach, R_ARM_WIDTH, 8);

      // The blades themselves, stood in a row along the arm. This is a row of
      // swords and it has to look like one at a glance, or it is just a
      // coloured rectangle on the floor.
      const blades = 5;
      for (let i = 0; i < blades; i++) {
        const along = ((i + 0.5) * reach) / blades;
        push();
        translate(along, 0);
        // Crest up, point down: each one planted the way E's blade is.
        rotate(HALF_PI - side * 0.22);
        drawIreliaBlade(R_ARM_WIDTH * 0.95 * opened, fade);
        pop();
      }
      pop();
    }

    // The apex: where it opened, and the only spot the two arms share.
    const flash = 1 - constrain(this.age / R_ARM_OPEN_MS, 0, 1);
    noStroke();
    fill(255, 255, 255, 230 * flash);
    circle(0, 0, 40 * flash + 10);
    noFill();
    stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 235 * fade);
    strokeWeight(4);
    circle(0, 0, 26);
    stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 200 * fade);
    strokeWeight(2);
    circle(0, 0, 26);
    pop();

    // One cut per body it charged, on the body. Drawn last so a hit taken deep
    // inside the arrowhead is not buried under the arm it happened in.
    for (const mark of this.marks) {
      const left = 1 - constrain(mark.age / 360, 0, 1);
      push();
      translate(mark.x, mark.y);
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 210 * left);
      strokeWeight(8);
      line(-16, -16, 16, 16);
      stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 245 * left);
      strokeWeight(3);
      line(-16, -16, 16, 16);
      pop();
    }
  }

  getDisplayBoundingBox(): Rectangle {
    let minX = this.position.x;
    let minY = this.position.y;
    let maxX = this.position.x;
    let maxY = this.position.y;
    for (const arm of this.arms) {
      minX = Math.min(minX, arm.end.x);
      minY = Math.min(minY, arm.end.y);
      maxX = Math.max(maxX, arm.end.x);
      maxY = Math.max(maxY, arm.end.y);
    }
    for (const mark of this.marks) {
      minX = Math.min(minX, mark.x);
      minY = Math.min(minY, mark.y);
      maxX = Math.max(maxX, mark.x);
      maxY = Math.max(maxY, mark.y);
    }
    const pad = R_ARM_WIDTH;
    return new Rectangle({
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
      data: this,
    });
  }
}
