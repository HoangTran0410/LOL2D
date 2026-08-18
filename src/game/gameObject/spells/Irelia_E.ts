import { Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange } from '@/game/combat/Reach';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import { SpellForm } from '@/game/spell/runtime/CancelPolicy';
import type { CastContext, CastSpec, Vec2 } from '@/game/spell/runtime/types';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import Stun from '@/game/gameObject/buffs/Stun';
import {
  beamBoundingBox,
  intersectsBeam,
  type BeamGeometry,
} from '@/game/gameObject/spellObjects/BeamSpellObject';
import { drawIreliaBlade, IRELIA_CREST, IRELIA_EDGE, IRELIA_RIM, IRELIA_STEEL } from './Irelia_Q';

export const E_RANGE = 420;
export const E_DAMAGE = 24;
export const E_STUN_MS = 850;
/** How long the first blade will wait for its partner. */
export const E_WINDOW_MS = 3_000;
/** How fast a thrown blade crosses the ground, in pixels per frame. */
export const E_THROW_SPEED = 26;
/**
 * The lockout between the two presses.
 *
 * Not merely "long enough that one keypress is not read as both": it is sized
 * so the *first blade has landed* before a second press is legal, which is what
 * lets `closeDuet` treat "there is a blade standing here" as the normal case
 * rather than a race. A throw to the far edge of `E_RANGE` covers
 * `E_RANGE / E_THROW_SPEED` frames — ~17 of them, ~280ms at 60fps — and this
 * clears that with room. `Irelia.test.ts` pins the relationship.
 */
export const E_RECAST_DELAY_MS = 340;
/** How wide the corridor between the two blades cuts. */
export const E_BAND_WIDTH = 70;
/** How long the two blades take to meet in the middle, on screen. */
export const E_SNAP_MS = 260;

/**
 * Flawless Duet.
 *
 * The script, in the order the player sees it:
 *
 *   press once            → she throws a blade at the cursor; it flies, lands,
 *                           and stands there waiting
 *   press again           → she throws the second blade; when *that* one lands
 *                           the pair snap together, and everyone caught on the
 *                           line between them takes 24 and is stunned 0.85s
 *   let the window lapse  → the first blade pulls out and nothing happens
 *
 * **The flight is the ability, not decoration.** The blades used to appear at
 * the cursor the frame the key went down, which reads as a point-and-click
 * stun with no travel to react to; the throw is the window in which an enemy
 * can see where the second blade is going and step off the line.
 *
 * `TETHERED` rather than the default `HELD`: the blade is standing out in the
 * world rather than in her hands, so walking between the two presses is the
 * whole point of the ability and must not end it. Losing control of herself
 * still does — a stunned Irelia cannot call the second blade.
 */
export default class Irelia_E extends Spell {
  image = AssetManager.get('spell_irelia_e');
  name = 'Bước Nhảy Hoàn Vũ (Irelia_E)';
  description = `Ném một lưỡi kiếm tới vị trí chỉ định; kiếm cắm xuống đất và chờ ở đó.
    Bấm lần nữa để ném lưỡi thứ hai — khi nó cắm xuống, hai lưỡi kiếm lao vào nhau,
    gây <span class="damage">${E_DAMAGE} sát thương</span> và
    <span class="buff">làm choáng</span> <span class="time">${E_STUN_MS / 1000} giây</span>
    mọi kẻ địch nằm giữa chúng.`;
  coolDown = 10_000;
  manaCost = 50;
  range = E_RANGE;

  /** The blade already standing, so the second press knows where to cut from. */
  firstBlade: Irelia_E_Blade | null = null;
  /** The first blade while it is still in the air. */
  private firstThrow: Irelia_E_Throw | null = null;
  /** Latched once the pair has fired, so the window closing cannot fire it again. */
  private spent = false;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'POINT',
      active: { maxDurationMs: E_WINDOW_MS, recastDelayMs: E_RECAST_DELAY_MS },
      resource: { commitAt: 'start', refundOn: [] },
      // On the first press, not when the pair fires: holding a blade out must
      // not also hold the cooldown.
      cooldown: { startAt: 'release', durationMs: this.coolDown },
      interrupts: SpellForm.TETHERED,
    };
  }

  onActivate(context: CastContext): void {
    this.spent = false;
    this.retractFirstBlade();

    const to = this.plantPoint(context.cursorWorld);
    const flight = new Irelia_E_Throw(this.owner, to, at => this.plantFirst(at));
    this.firstThrow = flight;
    this.game.objectManager.addObject(flight);
  }

  /**
   * The second blade. Aimed with `this.aimPoint` rather than the context
   * argument: `onRecast` is handed the *opening* press's context, so reading
   * that would throw both blades at the same spot.
   *
   * Nothing happens here but the throw — the cut waits for it to land.
   */
  onRecast(): void {
    if (this.spent) return;
    if (!this.firstBlade && !this.firstThrow) return;

    this.spent = true;
    const aim = this.aimPoint;
    const to = this.plantPoint({ x: aim.x, y: aim.y });
    this.game.objectManager.addObject(new Irelia_E_Throw(this.owner, to, at => this.closeDuet(at)));
  }

  /**
   * The window closed. `spent` is the second press, which completes the
   * activation the instant it happens — while that blade is still in the air
   * and still owes a duet, so this must not tear the first one out from under
   * it.
   */
  onComplete(): void {
    if (this.spent) return;
    this.retractFirstBlade();
  }

  onCancel(): void {
    if (this.spent) return;
    this.retractFirstBlade();
  }

  /** The first blade landing: it stands in the ground and waits for its partner. */
  private plantFirst(at: Vec2): void {
    this.firstThrow = null;
    const blade = new Irelia_E_Blade(this.owner, createVector(at.x, at.y));
    this.firstBlade = blade;
    this.game.objectManager.addObject(blade);
  }

  /** The second blade landing: the pair snap together across whatever is between. */
  private closeDuet(at: Vec2): void {
    // Normally already standing, because E_RECAST_DELAY_MS outlasts the longest
    // throw. A frame slow enough to break that must not leave the pair with
    // nothing to snap to, so the first throw finishes where it was aimed.
    this.firstThrow?.landNow();

    const first = this.firstBlade;
    if (!first || first.toRemove) return;

    first.toRemove = true;
    this.firstBlade = null;
    this.duet({ x: first.position.x, y: first.position.y }, at);
  }

  private retractFirstBlade(): void {
    this.firstThrow?.abort();
    this.firstThrow = null;
    if (this.firstBlade) this.firstBlade.retract();
    this.firstBlade = null;
  }

  /** Both blades snapping together, and the line they cut on the way. */
  private duet(from: Vec2, to: Vec2): void {
    const geometry: BeamGeometry = { start: from, end: to, width: E_BAND_WIDTH };

    const found = this.game.objectManager.queryObjects({
      area: beamBoundingBox(geometry, undefined),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const caught: Vec2[] = [];
    for (const victim of found) {
      if (victim === this.owner || victim.isDead || victim.toRemove) continue;
      if (!intersectsBeam(victim, geometry)) continue;
      caught.push({ x: victim.position.x, y: victim.position.y });
      victim.takeDamage(E_DAMAGE, this.owner);
      victim.addBuff(new Stun(E_STUN_MS, this.owner, victim));
    }

    this.game.objectManager.addObject(new Irelia_E_Duet(this.owner, geometry, caught));
  }

  /** The cursor, clamped to how far she can throw a blade. */
  private plantPoint(cursor: Vec2): p5.Vector {
    const dx = cursor.x - this.owner.position.x;
    const dy = cursor.y - this.owner.position.y;
    const reach = effectiveRange(this.range, this.owner);
    const away = Math.hypot(dx, dy);
    if (away <= reach || away < 1e-4) return createVector(cursor.x, cursor.y);
    return createVector(
      this.owner.position.x + (dx / away) * reach,
      this.owner.position.y + (dy / away) * reach
    );
  }
}

/**
 * A blade on its way to the ground.
 *
 * `maxHitCount = 0`: it cuts nobody in flight. All it does is take time, which
 * is the point — the flight is the reaction window the instant-plant version
 * never gave anyone, and it is what makes the second press a throw the enemy
 * can watch rather than a stun that has already happened.
 */
export class Irelia_E_Throw extends MissileSpellObject {
  speed = E_THROW_SPEED;
  size = 54;
  maxHitCount = 0;
  age = 0;
  /** Frozen at launch: on arrival `destination - position` is (0,0). */
  readonly heading: number;
  private landed = false;
  private readonly onLand: (at: Vec2) => void;

  constructor(owner: AttackableUnit, to: p5.Vector, onLand: (at: Vec2) => void) {
    super(owner);
    this.destination = to;
    this.onLand = onLand;
    this.heading = Math.atan2(to.y - this.position.y, to.x - this.position.x);
  }

  onAfterMove(): void {
    this.age += deltaTime;
  }

  onArrive(): void {
    this.land();
  }

  /** Finish now, where it was aimed, rather than where it happens to be. */
  landNow(): void {
    this.position.set(this.destination.x, this.destination.y);
    this.land();
    this.toRemove = true;
  }

  /** Thrown away without planting: the window closed while it was still up. */
  abort(): void {
    this.landed = true;
    this.toRemove = true;
  }

  private land(): void {
    if (this.landed) return;
    this.landed = true;
    this.onLand({ x: this.position.x, y: this.position.y });
  }

  draw(): void {
    push();
    translate(this.position.x, this.position.y);

    // A shadow that shrinks as it comes down, so the blade reads as being in
    // the air rather than sliding along the floor.
    const drop = constrain(this.position.dist(this.destination) / 90, 0, 1);
    noStroke();
    fill(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 110);
    ellipse(0, 10 + 8 * drop, 30 - 8 * (1 - drop), 11);

    // Flat-on along the throw, spinning: a thrown blade, not a floating icon.
    rotate(this.heading + this.age / 40);
    drawIreliaBlade(50);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size + 40) * 2);
  }
}

/**
 * A blade standing in the ground, waiting.
 *
 * This is the piece of the kit the player has to *find*, so it is built to the
 * ground-art bar: ~50px of longest dimension, a dark rim under a pale body so
 * it survives grass, water and stone alike, and the rose crest — used nowhere
 * else in the kit at rest — marking it as hers.
 */
export class Irelia_E_Blade extends SpellObject {
  age = 0;
  length = 50;
  /** Pulling out of the ground after the window lapsed. */
  retracting = false;
  retractAge = 0;
  retractMs = 220;

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  /** The window closed: it comes out of the ground instead of vanishing. */
  retract(): void {
    if (this.retracting) return;
    this.retracting = true;
    this.retractAge = 0;
  }

  update(): void {
    this.age += deltaTime;
    if (!this.retracting) return;
    this.retractAge += deltaTime;
    if (this.retractAge >= this.retractMs) this.toRemove = true;
  }

  draw(): void {
    const planted = constrain(this.age / 180, 0, 1);
    const leaving = this.retracting ? constrain(this.retractAge / this.retractMs, 0, 1) : 0;
    const fade = 1 - leaving;
    const lift = -planted * 6 - leaving * 26;
    const half = (this.length / 2) * (0.5 + 0.5 * planted);

    push();
    translate(this.position.x, this.position.y);

    // A shadow under it, so it reads as standing in the ground rather than
    // painted on it.
    noStroke();
    fill(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 130 * fade);
    ellipse(0, 6, this.length * 0.75, this.length * 0.28);

    // A slow turn, so a waiting blade is never mistaken for a floor decal.
    rotate(this.age / 420);
    translate(0, lift);

    // Point down, crest up: stuck in the ground, hilt where a hand would take
    // it. `drawIreliaBlade` lays a blade along +X, so quarter-turn it.
    rotate(HALF_PI);
    drawIreliaBlade(half * 2, fade);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.length + 40) * 2);
  }
}

/**
 * The pair meeting in the middle.
 *
 * The two blades actually travel toward each other along the line they cut, so
 * the animation moves the way the ability moves; the band between them states
 * the area that was hit, and each victim gets a spark on their own body rather
 * than a glow somewhere near it.
 */
export class Irelia_E_Duet extends SpellObject {
  lifeTime = 520;
  age = 0;
  readonly geometry: BeamGeometry;
  readonly caught: Vec2[];

  constructor(owner: AttackableUnit, geometry: BeamGeometry, caught: Vec2[]) {
    super(owner);
    this.geometry = geometry;
    this.caught = caught;
    this.position = createVector(
      (geometry.start.x + geometry.end.x) / 2,
      (geometry.start.y + geometry.end.y) / 2
    );
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const closing = constrain(this.age / E_SNAP_MS, 0, 1);
    const fade = 1 - t;
    const spanX = this.geometry.end.x - this.geometry.start.x;
    const spanY = this.geometry.end.y - this.geometry.start.y;
    const reach = Math.hypot(spanX, spanY);
    const half = this.geometry.width / 2;

    push();
    translate(this.geometry.start.x, this.geometry.start.y);
    rotate(Math.atan2(spanY, spanX));

    // The band the cut covered, over a dark rim so its edges are readable.
    noStroke();
    fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 90 * fade);
    rectMode(CORNER);
    rect(0, -half, reach, this.geometry.width);
    stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 170 * fade);
    strokeWeight(3);
    noFill();
    rect(0, -half, reach, this.geometry.width);

    // The blades themselves, converging on the middle.
    const meet = reach / 2;
    for (let i = 0; i < 2; i++) {
      const at = i === 0 ? meet * closing : reach - meet * closing;
      push();
      translate(at, 0);
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 240 * fade);
      strokeWeight(10);
      line(0, -24, 0, 24);
      stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 250 * fade);
      strokeWeight(4.5);
      line(0, -24, 0, 24);
      pop();
    }

    // The clash where they meet, once they have actually met.
    if (closing >= 1) {
      const flash = 1 - constrain((this.age - E_SNAP_MS) / 220, 0, 1);
      noStroke();
      fill(255, 255, 255, 220 * flash);
      circle(meet, 0, 34 * flash + 8);
      noFill();
      stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 230 * flash);
      strokeWeight(4);
      circle(meet, 0, 90 * (1 - flash) + 20);
    }
    pop();

    // One mark per victim, on the victim.
    for (const at of this.caught) {
      push();
      translate(at.x, at.y);
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 210 * fade);
      strokeWeight(8);
      line(-18, -18, 18, 18);
      line(-18, 18, 18, -18);
      stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 245 * fade);
      strokeWeight(3);
      line(-18, -18, 18, 18);
      line(-18, 18, 18, -18);
      pop();
    }
  }

  getDisplayBoundingBox(): Rectangle {
    const box = beamBoundingBox(this.geometry, this);
    let minX = box.x;
    let minY = box.y;
    let maxX = box.x + box.w;
    let maxY = box.y + box.h;
    for (const at of this.caught) {
      minX = Math.min(minX, at.x - 30);
      minY = Math.min(minY, at.y - 30);
      maxX = Math.max(maxX, at.x + 30);
      maxY = Math.max(maxY, at.y + 30);
    }
    return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
  }
}
