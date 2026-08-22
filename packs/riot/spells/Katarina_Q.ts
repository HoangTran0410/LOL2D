import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Katarina_Blade_Impact = InstanceType<ReturnType<typeof makeKatarina_Blade_Impact>>;
type Katarina_Dagger = InstanceType<ReturnType<typeof makeKatarina_Dagger>>;
type Katarina_Dagger_Slash = InstanceType<ReturnType<typeof makeKatarina_Dagger_Slash>>;
type Katarina_Q = InstanceType<ReturnType<typeof makeKatarina_Q>>;
type Katarina_Q_Object = InstanceType<ReturnType<typeof makeKatarina_Q_Object>>;



/** Cold steel and blood — the only two colours Katarina is allowed. */
export const KATARINA_STEEL: [number, number, number] = [223, 230, 233];

export const KATARINA_BLOOD: [number, number, number] = [192, 57, 43];

/** The dark rim every blade is drawn over. Steel on a pale floor has no edge without it. */
const KATARINA_INK: [number, number, number] = [18, 10, 14];


/**
 * Tip to pommel, in world units. A champion body is roughly 40 across, so a dagger
 * at 46 reads as a weapon lying on the floor rather than a speck of grit.
 *
 * It was 26 with no outline: a pale grey sliver on a pale grey map, which made the
 * one thing Katarina's whole kit is about — where her daggers are — genuinely hard
 * to find in a fight.
 */
export const KATARINA_DAGGER_LENGTH = 46;


/**
 * Katarina's dagger, point-down from the origin, in one place so Q's missile, the
 * grounded pickup and R's volley are recognisably the same weapon.
 *
 * Caller owns the transform: translate and rotate first, then call this. The dark
 * outline is not decoration — it is what makes the blade legible over bush, water
 * and stone alike, and it is drawn under every piece rather than around the whole
 * silhouette so the crossguard keeps its own edge.
 */
export function drawKatarinaDagger(length: number, alpha: number): void {
  const tip = length * 0.54;
  const guard = -length * 0.14;
  const pommel = -length * 0.46;
  const halfWidth = length * 0.13;
  const rim = Math.max(2, length * 0.065);

  strokeJoin(ROUND);
  stroke(KATARINA_INK[0], KATARINA_INK[1], KATARINA_INK[2], alpha);
  strokeWeight(rim);

  // blade
  fill(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], alpha);
  triangle(0, tip, -halfWidth, guard, halfWidth, guard);

  // the blood groove down one half, so the blade has a lit side and a dark one
  noStroke();
  fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], alpha * 0.95);
  triangle(0, tip, 0, guard, halfWidth * 0.8, guard);

  // crossguard and grip
  stroke(KATARINA_INK[0], KATARINA_INK[1], KATARINA_INK[2], alpha);
  strokeWeight(rim);
  fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], alpha);
  rect(-halfWidth * 1.8, guard - length * 0.055, halfWidth * 3.6, length * 0.11, length * 0.035);
  rect(-halfWidth * 0.45, pommel, halfWidth * 0.9, guard - pommel, length * 0.03);

  // the glint: a hard white sliver, which is what the eye actually catches
  noStroke();
  fill(255, 255, 255, alpha * 0.85);
  triangle(0, tip * 0.82, -halfWidth * 0.34, guard * 0.3, -halfWidth * 0.05, guard * 0.3);
}


// ─── the grounded dagger, shared by Q, W and E ────────────────────────────────
export const KATARINA_PICKUP_RADIUS = 150;

export const KATARINA_DAGGER_LIFETIME_MS = 4_500;

export const KATARINA_DAGGER_FADE_MS = 600;

export const KATARINA_DAGGER_LAND_MS = 200;

export const KATARINA_MAX_DAGGERS = 3;

export const KATARINA_DAGGER_SLASH_RADIUS = 300;

export const KATARINA_DAGGER_SLASH_DAMAGE = 22;

export const KATARINA_DAGGER_E_REFUND_MS = 7_000;


// ─── Q ────────────────────────────────────────────────────────────────────────
export const KATARINA_Q_RANGE = 450;

export const KATARINA_Q_FIRST_DAMAGE = 18;

export const KATARINA_Q_BOUNCE_DAMAGE = 14;

export const KATARINA_Q_BOUNCE_RANGE = 280;

export const KATARINA_Q_MAX_TARGETS = 3;

export const KATARINA_Q_DAGGER_OFFSET = 240;

/** The blade is still in her hand for this long. Exported so a test can wait it out. */
export const KATARINA_Q_WINDUP_MS = 140;


function __buildKatarina_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Spell = api.Spell;
  const Katarina_Q_Object = makeKatarina_Q_Object(api);
  class Katarina_Q extends Spell {
    image = api.asset('spell_katarina_q');
    name = 'Phi Dao (Katarina_Q)';
    description = `Phóng một lưỡi dao nảy tới <b>${KATARINA_Q_MAX_TARGETS}</b> mục tiêu, gây
      <span class="damage">${KATARINA_Q_FIRST_DAMAGE} sát thương</span> cho mục tiêu đầu và
      <span class="damage">${KATARINA_Q_BOUNCE_DAMAGE} sát thương</span> cho mỗi lần nảy.
      Sau đó dao cắm xuống đất phía sau mục tiêu đầu tiên. Đi vào dao sẽ <b>xoay kiếm</b> gây sát thương diện rộng.`;
    coolDown = 8_000;
    manaCost = 0;
    range = KATARINA_Q_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'POINT',
        castTimeMs: KATARINA_Q_WINDUP_MS,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context: CastContext): void {
      const reach = effectiveRange(this.range, this.owner);
      const aim = context?.cursorWorld ?? this.aimPoint;
      const origin = this.owner.position;

      // Find enemy closest to cursor within reach
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: aim.x, y: aim.y, r: 160 }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];

      let primaryTarget: AttackableUnit | null = null;
      let closestDistance = Infinity;
      for (const enemy of enemies) {
        const distToOwner = Math.hypot(enemy.position.x - origin.x, enemy.position.y - origin.y);
        if (distToOwner <= reach + 60) {
          const distToAim = Math.hypot(enemy.position.x - aim.x, enemy.position.y - aim.y);
          if (distToAim < closestDistance) {
            closestDistance = distToAim;
            primaryTarget = enemy;
          }
        }
      }

      let toX = aim.x - origin.x;
      let toY = aim.y - origin.y;
      const span = Math.hypot(toX, toY);
      if (span < 1) {
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
      if (primaryTarget) {
        dagger.chasing = primaryTarget;
        dagger.destination = createVector(primaryTarget.position.x, primaryTarget.position.y);
      } else {
        dagger.destination = createVector(origin.x + toX, origin.y + toY);
      }
      this.game.objectManager.addObject(dagger);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Katarina_Q;
}
const __cacheKatarina_Q = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_Q>>();
export default function makeKatarina_Q(api: ContentApi) {
  const cached = __cacheKatarina_Q.get(api);
  if (cached) return cached;
  const built = __buildKatarina_Q(api);
  __cacheKatarina_Q.set(api, built);
  return built;
}


/**
 * The thrown blade. Slower, highly visible, with clear bounce arcs and planting behind first target.
 */
function __buildKatarina_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const TrailSystem = api.helpers.TrailSystem;
  const MissileSpellObject = api.MissileSpellObject;
  const Katarina_Blade_Impact = makeKatarina_Blade_Impact(api);
  const Katarina_Dagger = makeKatarina_Dagger(api);
  class Katarina_Q_Object extends MissileSpellObject {
    speed = 8.5;
    size = 24;
    maxHitCount = KATARINA_Q_MAX_TARGETS;
    removeOnArrive = true;
    age = 0;
    struck: AttackableUnit[] = [];
    chasing: AttackableUnit | null = null;
    primaryTarget: AttackableUnit | null = null;
    planted = false;
    travelX = 1;
    travelY = 0;
    lastHitX: number | null = null;
    lastHitY: number | null = null;
    trailSystem = new TrailSystem({
      trailSize: KATARINA_DAGGER_LENGTH * 0.4,
      trailColor: '#e74c3ccc',
      trailLifeTime: 280,
      maxLength: 18,
    });

    onAdded(): void {
      super.onAdded();
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
      if (isFirst) {
        this.primaryTarget = enemy;
      }
      this.struck.push(enemy);
      this.lastHitX = enemy.position.x;
      this.lastHitY = enemy.position.y;

      const payload = isFirst ? KATARINA_Q_FIRST_DAMAGE : KATARINA_Q_BOUNCE_DAMAGE;
      enemy.takeDamage(payload, this.owner);
      this.game.objectManager.addObject(
        new Katarina_Blade_Impact(this.owner, enemy.position.x, enemy.position.y, isFirst ? 50 : 38)
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

    /** Plants dagger behind the primary target (or last hit unit) with slight drop flight. */
    finish(): void {
      if (this.planted) return;
      this.planted = true;

      const target = this.primaryTarget;
      let plantX: number;
      let plantY: number;

      if (target) {
        const dx = target.position.x - this.owner.position.x;
        const dy = target.position.y - this.owner.position.y;
        const len = Math.hypot(dx, dy) || 1;
        plantX = target.position.x + (dx / len) * KATARINA_Q_DAGGER_OFFSET;
        plantY = target.position.y + (dy / len) * KATARINA_Q_DAGGER_OFFSET;
      } else {
        const anchorX = this.lastHitX ?? this.position.x;
        const anchorY = this.lastHitY ?? this.position.y;
        plantX = anchorX + this.travelX * KATARINA_Q_DAGGER_OFFSET;
        plantY = anchorY + this.travelY * KATARINA_Q_DAGGER_OFFSET;
      }

      Katarina_Dagger.plant(this.owner, plantX, plantY, 300);
      this.toRemove = true;
    }

    draw(): void {
      const spin = this.age / 55;
      const heading = Math.atan2(this.travelY, this.travelX);
      push();
      translate(this.position.x, this.position.y);

      // A halo behind the blade, so a thrown dagger is still findable against a
      // crowded fight rather than being one more grey sliver among the bodies.
      noStroke();
      fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 70);
      circle(0, 0, KATARINA_DAGGER_LENGTH * 0.95);

      // `- HALF_PI` because the shared blade points down its own +y and this one
      // has to point where it is flying.
      rotate(heading + spin - HALF_PI);
      drawKatarinaDagger(KATARINA_DAGGER_LENGTH, 255);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((KATARINA_DAGGER_LENGTH + 35) * 2);
    }
  }
  return Katarina_Q_Object;
}
const __cacheKatarina_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_Q_Object>>();
export function makeKatarina_Q_Object(api: ContentApi) {
  const cached = __cacheKatarina_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildKatarina_Q_Object(api);
  __cacheKatarina_Q_Object.set(api, built);
  return built;
}


/**
 * The 360-degree blade spin (Sinister Steel / Dagger Slash) triggered when
 * Katarina picks up a dagger by walking into it or Shunpos (E) onto it.
 */
function __buildKatarina_Dagger_Slash(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const Katarina_Blade_Impact = makeKatarina_Blade_Impact(api);
  class Katarina_Dagger_Slash extends SpellObject {
    lifeTime = 320;
    age = 0;
    radius = KATARINA_DAGGER_SLASH_RADIUS;
    bladeAngles: number[] = [0, HALF_PI, PI, PI + HALF_PI];

    constructor(owner: AttackableUnit, x: number, y: number) {
      super(owner);
      this.position = createVector(x, y);
      this.dealSlashDamage();
    }

    private dealSlashDamage(): void {
      const victims = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      const struck = new Set<AttackableUnit>();
      for (const victim of victims) {
        if (struck.has(victim)) continue;
        struck.add(victim);
        victim.takeDamage(KATARINA_DAGGER_SLASH_DAMAGE, this.owner);
        this.game.objectManager.addObject(
          new Katarina_Blade_Impact(this.owner, victim.position.x, victim.position.y, 45)
        );
      }
    }

    update(): void {
      if (this.owner && !this.owner.isDead && !this.owner.toRemove) {
        this.position.set(this.owner.position.x, this.owner.position.y);
      }
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const spin = (this.age / 40) * TWO_PI;
      const fade = 1 - t;
      const expand = 1 - (1 - t) * (1 - t);

      push();
      translate(this.position.x, this.position.y);

      // Outer crimson slash wave
      noFill();
      stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 235 * fade);
      strokeWeight(4 * fade + 1.5);
      circle(0, 0, this.radius * 2 * expand);

      // Inner blade whirlwind
      stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 255 * fade);
      strokeWeight(3.5);
      for (let i = 0; i < 4; i++) {
        const baseAngle = this.bladeAngles[i] + spin;
        const rInner = this.radius * 0.2 * expand;
        const rOuter = this.radius * 0.95 * expand;
        arc(0, 0, rOuter * 2, rOuter * 2, baseAngle, baseAngle + PI * 0.45);
        line(
          cos(baseAngle) * rInner,
          sin(baseAngle) * rInner,
          cos(baseAngle + 0.3) * rOuter,
          sin(baseAngle + 0.3) * rOuter
        );
      }

      // Blood mist burst
      noStroke();
      fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 90 * fade);
      circle(0, 0, this.radius * 1.4 * expand);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 30) * 2);
    }
  }
  return Katarina_Dagger_Slash;
}
const __cacheKatarina_Dagger_Slash = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_Dagger_Slash>>();
export function makeKatarina_Dagger_Slash(api: ContentApi) {
  const cached = __cacheKatarina_Dagger_Slash.get(api);
  if (cached) return cached;
  const built = __buildKatarina_Dagger_Slash(api);
  __cacheKatarina_Dagger_Slash.set(api, built);
  return built;
}


/**
 * The mark left on the body that took a blade.
 */
function __buildKatarina_Blade_Impact(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Katarina_Blade_Impact extends SpellObject {
    lifeTime = 260;
    age = 0;
    reach: number;
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
  return Katarina_Blade_Impact;
}
const __cacheKatarina_Blade_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_Blade_Impact>>();
export function makeKatarina_Blade_Impact(api: ContentApi) {
  const cached = __cacheKatarina_Blade_Impact.get(api);
  if (cached) return cached;
  const built = __buildKatarina_Blade_Impact(api);
  __cacheKatarina_Blade_Impact.set(api, built);
  return built;
}


/**
 * A dagger stuck point-down in the floor, or dropping from the air.
 * Stepping into pickup radius or Shunpo (E) into it retrieves the dagger
 * and triggers a 360-degree Dagger Slash!
 */
function __buildKatarina_Dagger(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const Spell = api.Spell;
  const SpellObject = api.SpellObject;
  const Katarina_Dagger_Slash = makeKatarina_Dagger_Slash(api);
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Katarina_Dagger extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    age = 0;
    lifeTime = KATARINA_DAGGER_LIFETIME_MS;
    pickupRadius = KATARINA_PICKUP_RADIUS;
    dropDelayMs = 0;
    landed = false;
    tilt = 0;

    private static living = new WeakMap<AttackableUnit, Katarina_Dagger[]>();

    constructor(owner: AttackableUnit, x: number, y: number, dropDelayMs = 0) {
      super(owner);
      this.position = createVector(x, y);
      this.dropDelayMs = dropDelayMs;
      this.landed = dropDelayMs <= 0;
      this.tilt = random(-0.35, 0.35);
    }

    /** Her daggers that are still active or dropping, oldest first. */
    static aliveFor(owner: AttackableUnit): Katarina_Dagger[] {
      const known = Katarina_Dagger.living.get(owner) ?? [];
      const kept: Katarina_Dagger[] = [];
      for (const dagger of known) if (!dagger.toRemove) kept.push(dagger);
      Katarina_Dagger.living.set(owner, kept);
      return kept;
    }

    static plant(owner: AttackableUnit, x: number, y: number, dropDelayMs = 0): Katarina_Dagger {
      const dagger = new Katarina_Dagger(owner, x, y, dropDelayMs);
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

    consumeAndSlash(): void {
      if (this.toRemove) return;
      this.toRemove = true;

      // Trigger Dagger Slash around Katarina
      this.game.objectManager.addObject(
        new Katarina_Dagger_Slash(this.owner, this.owner.position.x, this.owner.position.y)
      );

      // Refund E cooldown
      const spells = (this.owner as any)?.spells as Spell[] | undefined;
      if (spells) {
        for (const spell of spells) {
          if (spell.name.includes('Katarina_E')) {
            spell.currentCooldown = Math.max(0, spell.currentCooldown - KATARINA_DAGGER_E_REFUND_MS);
            break;
          }
        }
      }
    }

    consume(): void {
      this.consumeAndSlash();
    }

    update(): void {
      if (this.owner.isDead || this.owner.toRemove) {
        this.toRemove = true;
        return;
      }
      this.age += deltaTime;

      if (!this.landed && this.age >= this.dropDelayMs) {
        this.landed = true;
      }

      // Walking over a landed dagger triggers Dagger Slash
      if (this.landed) {
        const dist = Math.hypot(
          this.owner.position.x - this.position.x,
          this.owner.position.y - this.position.y
        );
        if (dist <= this.pickupRadius) {
          this.consumeAndSlash();
          return;
        }
      }

      if (this.age >= this.lifeTime + this.dropDelayMs) {
        this.toRemove = true;
      }
    }

    draw(): void {
      const isDropping = !this.landed;
      const dropProgress = this.dropDelayMs > 0 ? constrain(this.age / this.dropDelayMs, 0, 1) : 1;
      const groundedAge = Math.max(0, this.age - this.dropDelayMs);
      const t = constrain(groundedAge / this.lifeTime, 0, 1);
      const fadeFrom = 1 - KATARINA_DAGGER_FADE_MS / this.lifeTime;
      const fade = t <= fadeFrom ? 1 : constrain(1 - (t - fadeFrom) / (1 - fadeFrom), 0, 1);
      const pulse = 0.5 + 0.5 * sin(this.age / 240);

      push();

      if (isDropping) {
        // Falling: the shadow tightens under it, so where it will land is readable
        // before it gets there.
        const height = (1 - dropProgress) * (1 - dropProgress) * 150;
        const spinAir = (this.age / 80) * TWO_PI;

        noStroke();
        fill(0, 0, 0, 110 * dropProgress);
        ellipse(this.position.x, this.position.y + 3, 26 * dropProgress, 10 * dropProgress);

        noFill();
        stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 150 * dropProgress);
        strokeWeight(2);
        circle(this.position.x, this.position.y, this.pickupRadius * 2 * (0.6 + 0.4 * dropProgress));

        translate(this.position.x, this.position.y - height);
        rotate(spinAir);
        drawKatarinaDagger(KATARINA_DAGGER_LENGTH, 255);
      } else {
        // Landed. The ring is the pickup radius exactly, because walking inside it
        // is the whole interaction — the player has to be able to see the edge.
        noStroke();
        fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], (16 + 12 * pulse) * fade);
        circle(this.position.x, this.position.y, this.pickupRadius * 2);

        noFill();
        stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], (150 + 90 * pulse) * fade);
        strokeWeight(3);
        circle(this.position.x, this.position.y, this.pickupRadius * 2);

        stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], (70 + 60 * pulse) * fade);
        strokeWeight(1.5);
        circle(this.position.x, this.position.y, this.pickupRadius * 1.2);

        // a bloom around the blade itself: the eye lands here first, then reads the ring
        noStroke();
        fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], (60 + 45 * pulse) * fade);
        circle(this.position.x, this.position.y, (34 + 8 * pulse) * fade + 26);

        fill(0, 0, 0, 120 * fade);
        ellipse(this.position.x, this.position.y + 5, 30, 11);

        translate(this.position.x, this.position.y);
        rotate(this.tilt);
        drawKatarinaDagger(KATARINA_DAGGER_LENGTH, 250 * fade);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.pickupRadius + 24) * 2);
    }
  }
  return Katarina_Dagger;
}
const __cacheKatarina_Dagger = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_Dagger>>();
export function makeKatarina_Dagger(api: ContentApi) {
  const cached = __cacheKatarina_Dagger.get(api);
  if (cached) return cached;
  const built = __buildKatarina_Dagger(api);
  __cacheKatarina_Dagger.set(api, built);
  return built;
}