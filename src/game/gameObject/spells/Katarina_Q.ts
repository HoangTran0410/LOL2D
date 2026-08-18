import { Circle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange } from '@/game/combat/Reach';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type { CastContext, CastSpec } from '@/game/spell/runtime/types';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';

/** Cold steel and blood — the only two colours Katarina is allowed. */
export const KATARINA_STEEL: [number, number, number] = [223, 230, 233];
export const KATARINA_BLOOD: [number, number, number] = [192, 57, 43];

// ─── the grounded dagger, shared by Q, W and E ────────────────────────────────
export const KATARINA_PICKUP_RADIUS = 150;
export const KATARINA_DAGGER_LIFETIME_MS = 4_500;
export const KATARINA_DAGGER_FADE_MS = 600;
export const KATARINA_DAGGER_LAND_MS = 200;
export const KATARINA_MAX_DAGGERS = 3;

// ─── Q ────────────────────────────────────────────────────────────────────────
export const KATARINA_Q_RANGE = 420;
export const KATARINA_Q_FIRST_DAMAGE = 18;
export const KATARINA_Q_BOUNCE_DAMAGE = 12;
export const KATARINA_Q_BOUNCE_RANGE = 250;
export const KATARINA_Q_MAX_TARGETS = 3;
export const KATARINA_Q_DAGGER_OFFSET = 60;
const WINDUP_MS = 160;

export default class Katarina_Q extends Spell {
  image = AssetManager.get('spell_katarina_q');
  name = 'Phi Dao (Katarina_Q)';
  description = `Phóng một lưỡi dao nảy tới <b>${KATARINA_Q_MAX_TARGETS}</b> mục tiêu, gây
    <span class="damage">${KATARINA_Q_FIRST_DAMAGE} sát thương</span> cho mục tiêu đầu và
    <span class="damage">${KATARINA_Q_BOUNCE_DAMAGE} sát thương</span> cho mỗi lần nảy.
    Dao cắm xuống đất phía sau mục tiêu cuối cùng.`;
  coolDown = 8_000;
  manaCost = 30;
  range = KATARINA_Q_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'POINT',
      castTimeMs: WINDUP_MS,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(context: CastContext): void {
    const reach = effectiveRange(this.range, this.owner);
    const aim = context?.cursorWorld ?? this.aimPoint;
    const origin = this.owner.position;
    let toX = aim.x - origin.x;
    let toY = aim.y - origin.y;
    const span = Math.hypot(toX, toY);
    if (span < 1) {
      // The cursor is standing on her: a thrown blade still needs somewhere to go.
      const heading = this.firingDirection(context);
      const length = Math.hypot(heading.x, heading.y) || 1;
      toX = (heading.x / length) * reach;
      toY = (heading.y / length) * reach;
    } else {
      const travel = Math.min(span, reach);
      toX = (toX / span) * travel;
      toY = (toY / span) * travel;
    }

    const dagger = new Katarina_Q_Object(this.owner);
    dagger.destination = createVector(origin.x + toX, origin.y + toY);
    this.game.objectManager.addObject(dagger);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The thrown blade. It bounces by re-pointing itself at the nearest unstruck
 * body, so `struck` is both the damage ledger (first hit is worth more) and the
 * one-hit-per-unit guard.
 */
export class Katarina_Q_Object extends MissileSpellObject {
  speed = 13;
  size = 22;
  maxHitCount = KATARINA_Q_MAX_TARGETS;
  removeOnArrive = true;
  age = 0;
  struck: AttackableUnit[] = [];
  chasing: AttackableUnit | null = null;
  planted = false;
  /** Last travel heading, kept so the dropped dagger lands *behind* the victim. */
  travelX = 1;
  travelY = 0;
  lastHitX: number | null = null;
  lastHitY: number | null = null;
  /** Seeded once — random() inside draw() flickers instead of animating. */
  glints: { offset: number; phase: number }[] = [];
  trailSystem = new TrailSystem({
    trailSize: this.size * 0.5,
    trailColor: '#c0392b66',
    trailLifeTime: 220,
    maxLength: 14,
  });

  onAdded(): void {
    super.onAdded();
    for (let i = 0; i < 4; i++) {
      this.glints.push({ offset: random(-8, 8), phase: random(0, TWO_PI) });
    }
    this.aimAtDestination();
  }

  private aimAtDestination(): void {
    const dx = this.destination.x - this.position.x;
    const dy = this.destination.y - this.position.y;
    const length = Math.hypot(dx, dy);
    if (length > 0.01) {
      this.travelX = dx / length;
      this.travelY = dy / length;
    }
  }

  onBeforeMove(): void {
    const chased = this.chasing;
    if (chased && !chased.isDead && !chased.toRemove) {
      this.destination = createVector(chased.position.x, chased.position.y);
    }
    this.aimAtDestination();
  }

  onAfterMove(): void {
    this.age += deltaTime;
  }

  onHit(enemy: AttackableUnit): void {
    if (this.struck.includes(enemy)) return;
    const isFirst = this.struck.length === 0;
    this.struck.push(enemy);
    this.lastHitX = enemy.position.x;
    this.lastHitY = enemy.position.y;

    const payload = isFirst ? KATARINA_Q_FIRST_DAMAGE : KATARINA_Q_BOUNCE_DAMAGE;
    enemy.takeDamage(payload, this.owner);
    this.game.objectManager.addObject(
      new Katarina_Blade_Impact(this.owner, enemy.position.x, enemy.position.y, isFirst ? 46 : 34)
    );

    if (this.struck.length >= KATARINA_Q_MAX_TARGETS) {
      this.finish();
      return;
    }
    const next = this.pickBounce(enemy.position.x, enemy.position.y);
    if (!next) {
      this.finish();
      return;
    }
    this.chasing = next;
    this.destination = createVector(next.position.x, next.position.y);
  }

  private pickBounce(x: number, y: number): AttackableUnit | null {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x, y, r: KATARINA_Q_BOUNCE_RANGE }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.visibleTo(this.owner),
      ],
    }) as AttackableUnit[];

    // A plain loop: Array.prototype.filter cannot narrow here.
    let chosen: AttackableUnit | null = null;
    let nearestDistance = Infinity;
    for (const candidate of candidates) {
      if (this.struck.includes(candidate)) continue;
      const gap = Math.hypot(candidate.position.x - x, candidate.position.y - y);
      if (gap < nearestDistance) {
        nearestDistance = gap;
        chosen = candidate;
      }
    }
    return chosen;
  }

  onArrive(): void {
    this.finish();
  }

  /** Idempotent: arrival, the third bounce and a dead chain all land here. */
  finish(): void {
    if (this.planted) return;
    this.planted = true;
    const anchorX = this.lastHitX ?? this.position.x;
    const anchorY = this.lastHitY ?? this.position.y;
    Katarina_Dagger.plant(
      this.owner,
      anchorX + this.travelX * KATARINA_Q_DAGGER_OFFSET,
      anchorY + this.travelY * KATARINA_Q_DAGGER_OFFSET
    );
    this.toRemove = true;
  }

  draw(): void {
    const spin = this.age / 90;
    const heading = Math.atan2(this.travelY, this.travelX);
    push();
    translate(this.position.x, this.position.y);
    rotate(heading + spin);
    noStroke();
    fill(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 240);
    triangle(this.size * 0.62, 0, -this.size * 0.34, -4.5, -this.size * 0.34, 4.5);
    fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 230);
    triangle(this.size * 0.62, 0, -this.size * 0.34, 4.5, -this.size * 0.18, 1.5);
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 170);
    strokeWeight(1.5);
    for (const glint of this.glints) {
      const swept = sin(glint.phase + spin) * 5;
      line(-this.size * 0.34, glint.offset * 0.35, -this.size * 0.8 + swept, glint.offset * 0.5);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size + 30) * 2);
  }
}

/**
 * The mark left on the body that took a blade. It is deliberately a cut and a
 * ring rather than seeded grit: the ring says "hit here", the cut says "steel".
 */
export class Katarina_Blade_Impact extends SpellObject {
  lifeTime = 260;
  age = 0;
  reach: number;
  /** Seeded once in the constructor; a draw()-time random() would flicker. */
  cuts: number[] = [];

  constructor(owner: AttackableUnit, x: number, y: number, reach = 46) {
    super(owner);
    this.position = createVector(x, y);
    this.reach = reach;
    for (let i = 0; i < 3; i++) this.cuts.push(random(0, TWO_PI));
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
    noFill();
    // The hard rim sits on the radius the hit actually used.
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 235 * fade);
    strokeWeight(3.5 * fade + 1);
    circle(this.position.x, this.position.y, this.reach * 2 * opened);
    stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 210 * fade);
    strokeWeight(2);
    for (const angle of this.cuts) {
      const inner = this.reach * 0.35 * opened;
      const outer = this.reach * 0.95 * opened;
      line(
        this.position.x + cos(angle) * inner,
        this.position.y + sin(angle) * inner,
        this.position.x + cos(angle) * outer,
        this.position.y + sin(angle) * outer
      );
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + 12) * 2);
  }
}

/**
 * A dagger stuck point-down in the floor. It is ground art (`zIndex = 2`), and
 * its pulsing ring is drawn at exactly `KATARINA_PICKUP_RADIUS` so E's snap
 * distance is never a guess.
 *
 * The living set is owned here rather than recounted from the object manager,
 * because a freshly planted dagger sits in `_objectToBeAdd` and would not be
 * visible to a query until the next update — and the cap has to hold on the
 * frame she plants the fourth.
 */
export class Katarina_Dagger extends SpellObject {
  zIndex = 2;
  age = 0;
  lifeTime = KATARINA_DAGGER_LIFETIME_MS;
  pickupRadius = KATARINA_PICKUP_RADIUS;
  /** Seeded once so the blade always sticks at its own slight angle. */
  tilt = 0;

  private static living = new WeakMap<AttackableUnit, Katarina_Dagger[]>();

  constructor(owner: AttackableUnit, x: number, y: number) {
    super(owner);
    this.position = createVector(x, y);
    this.tilt = random(-0.35, 0.35);
  }

  /** Her daggers that are still on the floor, oldest first. */
  static aliveFor(owner: AttackableUnit): Katarina_Dagger[] {
    const known = Katarina_Dagger.living.get(owner) ?? [];
    const kept: Katarina_Dagger[] = [];
    for (const dagger of known) if (!dagger.toRemove) kept.push(dagger);
    Katarina_Dagger.living.set(owner, kept);
    return kept;
  }

  static plant(owner: AttackableUnit, x: number, y: number): Katarina_Dagger {
    const dagger = new Katarina_Dagger(owner, x, y);
    const alive = Katarina_Dagger.aliveFor(owner);
    alive.push(dagger);
    while (alive.length > KATARINA_MAX_DAGGERS) {
      const oldest = alive.shift();
      if (oldest) oldest.toRemove = true;
    }
    owner.game.objectManager.addObject(dagger);
    return dagger;
  }

  /** The dagger she would snap to for a click at (x, y), if any is close enough. */
  static snapTarget(owner: AttackableUnit, x: number, y: number): Katarina_Dagger | null {
    let chosen: Katarina_Dagger | null = null;
    let closest = Infinity;
    for (const dagger of Katarina_Dagger.aliveFor(owner)) {
      const gap = Math.hypot(dagger.position.x - x, dagger.position.y - y);
      if (gap <= dagger.pickupRadius && gap < closest) {
        closest = gap;
        chosen = dagger;
      }
    }
    return chosen;
  }

  consume(): void {
    this.toRemove = true;
  }

  update(): void {
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const landed = constrain(this.age / KATARINA_DAGGER_LAND_MS, 0, 1);
    const settled = 1 - (1 - landed) * (1 - landed);
    const fadeFrom = 1 - KATARINA_DAGGER_FADE_MS / this.lifeTime;
    const fade = t <= fadeFrom ? 1 : constrain(1 - (t - fadeFrom) / (1 - fadeFrom), 0, 1);
    const pulse = 0.5 + 0.5 * sin(this.age / 240);
    const hover = (1 - settled) * 34;
    const bounce = sin(landed * PI) * 3.5;

    push();
    // The pickup ring, on exactly the radius E will snap from.
    noFill();
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], (55 + 70 * pulse) * fade);
    strokeWeight(2);
    circle(this.position.x, this.position.y, this.pickupRadius * 2);

    // Shadow: it grows as the blade comes down, which is what reads as "landing".
    noStroke();
    fill(0, 0, 0, 70 * settled * fade);
    ellipse(this.position.x, this.position.y + 3, 22 * settled, 7 * settled);

    translate(this.position.x, this.position.y - hover - bounce);
    rotate(this.tilt + (1 - settled) * TWO_PI * 2);
    fill(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 245 * fade);
    triangle(0, 16, -4.5, -10, 4.5, -10);
    fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 235 * fade);
    triangle(0, 16, 1.6, -10, 4.5, -10);
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 235 * fade);
    strokeWeight(3);
    line(-7, -12, 7, -12);
    line(0, -12, 0, -20);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.pickupRadius + 24) * 2);
  }
}
