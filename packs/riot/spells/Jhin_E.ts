import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastSpec } from '@moba2d/core/content/types';
import { makeApplyJhinMark } from './Jhin_Q';
import { JHIN_MARK_MS } from './Jhin_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Jhin_E = InstanceType<ReturnType<typeof makeJhin_E>>;
type Jhin_E_Bloom = InstanceType<ReturnType<typeof makeJhin_E_Bloom>>;
type Jhin_E_Grenade = InstanceType<ReturnType<typeof makeJhin_E_Grenade>>;
type Jhin_E_Trap = InstanceType<ReturnType<typeof makeJhin_E_Trap>>;



export const JHIN_E_DAMAGE = 18;

export const JHIN_E_RANGE = 400;

export const JHIN_E_ARM_MS = 750;

export const JHIN_E_LIFETIME_MS = 20_000;

export const JHIN_E_TRIGGER_RADIUS = 90;

export const JHIN_E_SLOW = 0.6;

export const JHIN_E_SLOW_MS = 2_000;

export const JHIN_E_MAX_TRAPS = 3;

/**
 * From tripping the trap to the detonation. The whole point of the delay is that
 * a slowed champion who reacts can clear `JHIN_E_BLAST_RADIUS` and take nothing;
 * one who stands on it cannot. Base move speed is 3px/frame, so at 60fps a 60%
 * slow carries a victim ~94px in this window — out from the trigger rim, not out
 * from dead centre.
 */
export const JHIN_E_FUSE_MS = 1_300;

/** The detonation is wider than the tripwire, so backing off has to be deliberate. */
export const JHIN_E_BLAST_RADIUS = 150;


const MAGENTA: [number, number, number] = [232, 67, 147];

const BONE: [number, number, number] = [245, 246, 250];

const TRAP_PETALS = 4;


/** Every live trap in the match, so one Jhin's fourth planting evicts his own oldest. */
const plantedTraps: Jhin_E_Trap[] = [];


function registerTrap(trap: Jhin_E_Trap): void {
  for (let i = plantedTraps.length - 1; i >= 0; i--) {
    const known = plantedTraps[i];
    if (!known || known.toRemove) plantedTraps.splice(i, 1);
  }
  plantedTraps.push(trap);

  const mine: Jhin_E_Trap[] = [];
  for (const known of plantedTraps) {
    if (known.owner === trap.owner) mine.push(known);
  }
  while (mine.length > JHIN_E_MAX_TRAPS) {
    const oldest = mine.shift();
    if (!oldest) break;
    oldest.toRemove = true;
    const at = plantedTraps.indexOf(oldest);
    if (at >= 0) plantedTraps.splice(at, 1);
  }
}


function releaseTrap(trap: Jhin_E_Trap): void {
  const at = plantedTraps.indexOf(trap);
  if (at >= 0) plantedTraps.splice(at, 1);
}


function __buildJhin_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Spell = api.Spell;
  const Jhin_E_Grenade = makeJhin_E_Grenade(api);
  class Jhin_E extends Spell {
    image = api.asset('spell_jhin_e');
    name = 'Cạm Bẫy Nghệ Thuật (Jhin_E)';
    description = `Đặt một bông sen bẫy <b>tàng hình</b> sau ${JHIN_E_ARM_MS / 1000} giây, chờ
      ${JHIN_E_LIFETIME_MS / 1000} giây. Kẻ địch bước vào bán kính ${JHIN_E_TRIGGER_RADIUS} bị làm chậm
      ${JHIN_E_SLOW * 100}% trong ${JHIN_E_SLOW_MS / 1000} giây và bị <b>đánh dấu</b>
      ${JHIN_MARK_MS / 1000} giây; bẫy lộ ra và <b>nở dần</b> trong ${JHIN_E_FUSE_MS / 1000} giây rồi
      nổ, gây <span class="damage">${JHIN_E_DAMAGE} sát thương</span> cho mọi kẻ địch còn đứng trong
      bán kính ${JHIN_E_BLAST_RADIUS} — chạy kịp thì thoát. Tối đa ${JHIN_E_MAX_TRAPS} bẫy cùng lúc.`;
    coolDown = 9_000;
    manaCost = 25;
    range = JHIN_E_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'POINT',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(): void {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        effectiveRange(this.range, this.owner)
      );
      this.game.objectManager.addObject(new Jhin_E_Grenade(this.owner, this.owner.position, to));
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Jhin_E;
}
const __cacheJhin_E = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_E>>();
export default function makeJhin_E(api: ContentApi) {
  const cached = __cacheJhin_E.get(api);
  if (cached) return cached;
  const built = __buildJhin_E(api);
  __cacheJhin_E.set(api, built);
  return built;
}


/**
 * The thrown lotus trap grenade. Arcs through the air from Jhin to the target location.
 */
function __buildJhin_E_Grenade(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const Jhin_E_Trap = makeJhin_E_Trap(api);
  class Jhin_E_Grenade extends SpellObject {
    lifeTime = 380;
    age = 0;
    start: p5.Vector;
    target: p5.Vector;

    constructor(owner: AttackableUnit, start: p5.Vector, target: p5.Vector) {
      super(owner);
      this.start = start.copy();
      this.target = target.copy();
      this.position = start.copy();
    }

    update(): void {
      this.age += deltaTime;
      const t = constrain(this.age / this.lifeTime, 0, 1);
      this.position.x = lerp(this.start.x, this.target.x, t);
      this.position.y = lerp(this.start.y, this.target.y, t);

      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        this.game.objectManager.addObject(new Jhin_E_Trap(this.owner, this.target.copy()));
      }
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // Parabolic arc height
      const height = sin(t * PI) * 110;
      const spin = (this.age / 50) * TWO_PI;

      push();
      // Shadow on the ground
      noStroke();
      fill(0, 0, 0, 80 * (1 - 0.5 * sin(t * PI)));
      ellipse(this.position.x, this.position.y + 4, 18, 7);

      // Flying grenade lotus in the air
      translate(this.position.x, this.position.y - height);
      rotate(spin);

      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 240);
      ellipse(0, 0, 14, 14);
      for (let i = 0; i < 4; i++) {
        push();
        rotate((i * TWO_PI) / 4);
        triangle(0, 0, 10, -3, 10, 3);
        pop();
      }
      fill(BONE[0], BONE[1], BONE[2], 255);
      circle(0, 0, 6);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(160);
    }
  }
  return Jhin_E_Grenade;
}
const __cacheJhin_E_Grenade = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_E_Grenade>>();
export function makeJhin_E_Grenade(api: ContentApi) {
  const cached = __cacheJhin_E_Grenade.get(api);
  if (cached) return cached;
  const built = __buildJhin_E_Grenade(api);
  __cacheJhin_E_Grenade.set(api, built);
  return built;
}


/**
 * Three states, three pictures: a bud folding shut while it arms, nothing at all once it is
 * concealed, and a lotus forcing itself open over the fuse. Only the last one is a threat the
 * enemy can see, and it draws the radius the detonation really uses so backing out is a
 * judgement rather than a guess.
 *
 * Hidden the way Shaco's box and Teemo's shrooms are hidden — the trap is a `SpellObject`, not
 * a unit, so it is never targetable and concealment is purely a question of who may draw it.
 * `Shaco_R_Clone` sets the precedent for owner-only art.
 */
function __buildJhin_E_Trap(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const SpellObject = api.SpellObject;
  const applyJhinMark = makeApplyJhinMark(api);
  const Jhin_E_Bloom = makeJhin_E_Bloom(api);
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Jhin_E_Trap extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    radius = JHIN_E_TRIGGER_RADIUS;
    age = 0;
    triggered = false;
    /** Time since something tripped it; -1 until then. The fuse is this clock. */
    fuseMs = -1;
    petals: { lean: number; curl: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
      registerTrap(this);
    }

    get armed(): boolean {
      return this.age >= JHIN_E_ARM_MS;
    }

    /** Armed, untripped, and therefore invisible to everyone but its owner. */
    get concealed(): boolean {
      return this.armed && !this.triggered;
    }

    /** How far the bloom has opened, 0 to 1. At 1 it detonates. */
    get fuseProgress(): number {
      if (this.fuseMs < 0) return 0;
      return constrain(this.fuseMs / JHIN_E_FUSE_MS, 0, 1);
    }

    onAdded(): void {
      for (let i = 0; i < TRAP_PETALS; i++) {
        this.petals.push({ lean: random(-0.16, 0.16), curl: random(0.85, 1.15) });
      }
    }

    onRemoved(): void {
      releaseTrap(this);
      super.onRemoved();
    }

    update(): void {
      this.age += deltaTime;

      // Once it is counting down, nothing else matters: it will go off wherever it was planted.
      if (this.triggered) {
        this.fuseMs += deltaTime;
        if (this.fuseMs >= JHIN_E_FUSE_MS) this.detonate();
        return;
      }

      if (this.age >= JHIN_E_ARM_MS + JHIN_E_LIFETIME_MS) {
        this.toRemove = true;
        return;
      }
      if (!this.armed) return;

      // A trap triggers on whoever stands on it, lit or not: proximity, not acquisition.
      const victims = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: JHIN_E_TRIGGER_RADIUS,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of victims) {
        this.spring(victim);
        return;
      }
    }

    /**
     * Someone stepped on it. They are slowed and marked *now* — that is the price of tripping it
     * — but the damage waits for the bloom, so it lands on whoever is still standing there.
     */
    spring(victim: AttackableUnit): void {
      if (this.triggered) return;
      this.triggered = true;
      this.fuseMs = 0;

      const slow = new Slow(JHIN_E_SLOW_MS, this.owner, victim);
      slow.percent = JHIN_E_SLOW;
      slow.stackId = 'jhin_trap_slow';
      victim.addBuff(slow);
      applyJhinMark(this.owner, victim);
    }

    /** The bloom reached full size. Everyone inside it at this instant pays, and nobody else. */
    detonate(): void {
      if (this.toRemove) return;

      const caught = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: JHIN_E_BLAST_RADIUS,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of caught) {
        victim.takeDamage(JHIN_E_DAMAGE, this.owner);
        applyJhinMark(this.owner, victim);
      }

      this.game.objectManager.addObject(new Jhin_E_Bloom(this.owner, this.position.copy()));
      this.toRemove = true;
    }

    draw(): void {
      // A concealed trap is Jhin's secret. His own side gets a faint ghost so he can play around
      // his own mines; anyone else is drawn nothing at all, which is what makes it a trap.
      if (this.concealed && this.owner !== this.game?.player) return;

      if (this.triggered) {
        this.drawBloom();
        return;
      }

      const planting = constrain(this.age / JHIN_E_ARM_MS, 0, 1);
      // It folds *shut* as it hides: petals lie flat while it is being planted, then curl in.
      const closed = planting * planting;

      push();
      translate(this.position.x, this.position.y);

      if (this.concealed) {
        // Owner-only, and deliberately dim — enough for Jhin to route a fight
        // through his own mines, nowhere near enough to read as a live effect.
        noFill();
        stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 80);
        strokeWeight(1.5);
        circle(0, 0, JHIN_E_TRIGGER_RADIUS * 2);
        noStroke();
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 85);
        circle(0, 0, 17);
        fill(BONE[0], BONE[1], BONE[2], 105);
        circle(0, 0, 7);
        pop();
        return;
      }

      noStroke();
      for (let i = 0; i < this.petals.length; i++) {
        const petal = this.petals[i];
        const reach = (30 - 17 * closed) * petal.curl;
        push();
        rotate((i * TWO_PI) / this.petals.length + petal.lean + closed * 0.7);
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 210 - 90 * closed);
        triangle(0, 0, reach, -reach * (0.4 - 0.2 * closed), reach, reach * (0.4 - 0.2 * closed));
        pop();
      }
      fill(BONE[0], BONE[1], BONE[2], 230 - 90 * closed);
      circle(0, 0, 10 - 3 * closed);
      pop();
    }

    /**
     * The fuse, and the only warning the enemy gets. The hard rim sits on
     * `JHIN_E_BLAST_RADIUS` and grows into it, so "am I still inside it?" is answerable at a
     * glance, and the flashing quickens as the bloom fills to say the time is nearly up.
     */
    private drawBloom(): void {
      const t = this.fuseProgress;
      const opened = 1 - (1 - t) * (1 - t);
      const reach = JHIN_E_BLAST_RADIUS * opened;
      // 3Hz at the start, 12Hz at the end — urgency the player hears without reading a number.
      const urgency = 0.5 + 0.5 * sin((this.fuseMs / 1000) * (3 + 9 * t) * TWO_PI);

      push();
      translate(this.position.x, this.position.y);

      // the filled danger zone, at the radius the damage really claims
      noStroke();
      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 30 + 45 * t);
      circle(0, 0, reach * 2);

      // the hard rim: this is the line to be outside of
      noFill();
      stroke(BONE[0], BONE[1], BONE[2], 150 + 105 * urgency);
      strokeWeight(2 + 2 * t);
      circle(0, 0, reach * 2);

      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 220);
      strokeWeight(3 + 3 * t);
      circle(0, 0, reach * 2 * 0.96);

      // petals forcing themselves open — the growth that says "not yet, but soon"
      noStroke();
      for (let i = 0; i < this.petals.length; i++) {
        const petal = this.petals[i];
        const blade = reach * 0.55 * petal.curl;
        push();
        rotate((i * TWO_PI) / this.petals.length + petal.lean + opened * 1.1);
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 235);
        triangle(0, 0, blade, -blade * 0.34, blade, blade * 0.34);
        pop();
      }

      // the core, brightening to white as it fills
      fill(255, 255, 255, 140 + 115 * t);
      circle(0, 0, 12 + 16 * t);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((JHIN_E_BLAST_RADIUS + 24) * 2);
    }
  }
  return Jhin_E_Trap;
}
const __cacheJhin_E_Trap = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_E_Trap>>();
export function makeJhin_E_Trap(api: ContentApi) {
  const cached = __cacheJhin_E_Trap.get(api);
  if (cached) return cached;
  const built = __buildJhin_E_Trap(api);
  __cacheJhin_E_Trap.set(api, built);
  return built;
}


/** The trap going off, on the body that stepped in it. */
function __buildJhin_E_Bloom(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Jhin_E_Bloom extends SpellObject {
    lifeTime = 460;
    age = 0;
    radius = JHIN_E_BLAST_RADIUS;
    petals: { angle: number; reach: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      for (let i = 0; i < TRAP_PETALS * 3; i++) {
        this.petals.push({
          angle: (i * TWO_PI) / (TRAP_PETALS * 3),
          reach: random(0.55, 1),
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
      noFill();
      stroke(BONE[0], BONE[1], BONE[2], 200 * fade);
      strokeWeight(2 * fade + 1);
      circle(this.position.x, this.position.y, this.radius * 2 * opened);
      noStroke();
      for (const petal of this.petals) {
        const reach = this.radius * petal.reach * opened;
        push();
        translate(
          this.position.x + cos(petal.angle) * reach,
          this.position.y + sin(petal.angle) * reach
        );
        rotate(petal.angle);
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 225 * fade);
        triangle(0, 0, 13 * fade + 3, -5, 13 * fade + 3, 5);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 22) * 2);
    }
  }
  return Jhin_E_Bloom;
}
const __cacheJhin_E_Bloom = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_E_Bloom>>();
export function makeJhin_E_Bloom(api: ContentApi) {
  const cached = __cacheJhin_E_Bloom.get(api);
  if (cached) return cached;
  const built = __buildJhin_E_Bloom(api);
  __cacheJhin_E_Bloom.set(api, built);
  return built;
}