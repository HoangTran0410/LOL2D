import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, TargetingRequest } from '@moba2d/core/content/types';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Nautilus_R = InstanceType<ReturnType<typeof makeNautilus_R>>;
type Nautilus_R_Eruption = InstanceType<ReturnType<typeof makeNautilus_R_Eruption>>;
type Nautilus_R_Object = InstanceType<ReturnType<typeof makeNautilus_R_Object>>;
type Nautilus_R_Rim = InstanceType<ReturnType<typeof makeNautilus_R_Rim>>;



export const R_RANGE = 450;

export const R_DAMAGE = 45;

export const R_KNOCKUP_MS = 1_200;

export const R_PASS_DAMAGE = 18;

export const R_PASS_KNOCKUP_MS = 750;

export const R_BLAST_RADIUS = 200;

/** Pixels per frame — 450px in roughly 1.2s, slow enough that running matters. */
export const R_SPEED = 6.25;

export const R_WIDTH = 70;

export const R_RIM_MS = 640;

export const R_COLUMN_MS = 700;

export const R_COLUMN_REACH = 190;

export const R_JETS = 14;


const IRON: [number, number, number] = [120, 144, 156];

const RUST: [number, number, number] = [75, 101, 132];

const FOAM: [number, number, number] = [168, 230, 207];

const ABYSS: [number, number, number] = [30, 44, 66];


function __buildNautilus_R(api: ContentApi) {
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Nautilus_R_Object = makeNautilus_R_Object(api);
  class Nautilus_R extends Spell {
    targetingMode = 'UNIT' as const;
    image = api.asset('spell_nautilus_r');
    name = 'Thủy Lôi Tầm Nhiệt (Nautilus_R)';
    description =
      `Thả một quả thủy lôi chạy ngầm dưới đất, đuổi theo mục tiêu đã chọn. Ai bị nó đi qua ` +
      `nhận <span class="damage">${R_PASS_DAMAGE} sát thương</span> và bị hất tung. Tới đích, ` +
      `nó nổ trong bán kính ${R_BLAST_RADIUS}: <span class="damage">${R_DAMAGE} sát thương</span> ` +
      `và hất tung ${R_KNOCKUP_MS / 1000} giây.`;
    coolDown = 10_000;
    manaCost = 100;
    range = R_RANGE;

    get targetingRequest(): Readonly<TargetingRequest> {
      return { range: R_RANGE, targetTeam: 'ENEMY' };
    }

    onSpellCast(context?: CastContext): void {
      const target = context?.target as AttackableUnit | undefined;
      if (!target || target.isDead || target.toRemove) return;
      this.game.objectManager.addObject(new Nautilus_R_Object(this.owner, target));
    }
  }
  return Nautilus_R;
}
const __cacheNautilus_R = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_R>>();
export default function makeNautilus_R(api: ContentApi) {
  const cached = __cacheNautilus_R.get(api);
  if (cached) return cached;
  const built = __buildNautilus_R(api);
  __cacheNautilus_R.set(api, built);
  return built;
}


/**
 * The depth charge, travelling under the floor.
 *
 * Homing is hand-rolled rather than taken from `HomingMissileSpellObject` for one
 * reason the spec is explicit about: when the target dies mid-flight the charge
 * must *erupt where it is*, and both of that base's target-loss policies either
 * delete the object or fly it to a corpse's last coordinate and then delete it
 * without ever calling the arrival hook.
 *
 * Ground art — `zIndex = GROUND_Z_INDEX` — because the whole point of the travel is that it is
 * a telegraph the victim can read while standing on top of it.
 */
function __buildNautilus_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Airborne = api.buffs.Airborne;
  const Nautilus_R_Rim = makeNautilus_R_Rim(api);
  const Nautilus_R_Eruption = makeNautilus_R_Eruption(api);
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Nautilus_R_Object extends MissileSpellObject {
    zIndex = GROUND_Z_INDEX;
    speed = R_SPEED;
    size = R_WIDTH;
    maxHitCount = Infinity;
    removeOnArrive = false;

    target: AttackableUnit;
    age = 0;
    erupted = false;
    /** One pass per bystander, whatever the frame rate does to the collision query. */
    passed = new Set<AttackableUnit>();
    /** Seeded once in onAdded — clods of displaced earth, not a per-frame reroll. */
    clods: { along: number; offset: number }[] = [];

    constructor(owner: AttackableUnit, target: AttackableUnit) {
      super(owner);
      this.target = target;
      this.destination = target.position.copy();
    }

    onAdded(): void {
      super.onAdded();
      for (let i = 0; i < 9; i++) {
        this.clods.push({ along: random(0.1, 1), offset: random(-16, 16) });
      }
    }

    update(): void {
      if (this.toRemove) return;
      if (this.target.isDead || this.target.toRemove) {
        // Nothing left to chase: it goes off under its own feet rather than
        // following a corpse's last coordinate.
        this.erupt(this.position.copy(), null);
        return;
      }
      this.age += deltaTime;
      super.update();
    }

    onBeforeMove(): void {
      this.destination = this.target.position.copy();
    }

    protected hasArrived(_previousPosition: p5.Vector, position: p5.Vector): boolean {
      return position.dist(this.target.position) <= this.target.collisionRadius + this.size / 2;
    }

    protected shouldStopAfterArrival(): boolean {
      return true;
    }

    onArrive(): void {
      this.erupt(this.target.position.copy(), this.target);
    }

    onHit(enemy: AttackableUnit): void {
      // The chosen target is finished by the eruption, never brushed by the pass.
      if (enemy === this.target) return;
      if (this.passed.has(enemy)) return;
      this.passed.add(enemy);
      enemy.takeDamage(R_PASS_DAMAGE, this.owner);
      enemy.addBuff(new Airborne(R_PASS_KNOCKUP_MS, this.owner, enemy));
    }

    private erupt(at: p5.Vector, victim: AttackableUnit | null): void {
      if (this.erupted) return;
      this.erupted = true;
      this.toRemove = true;

      this.game.objectManager.addObject(new Nautilus_R_Rim(this.owner, at.copy()));
      this.game.objectManager.addObject(new Nautilus_R_Eruption(this.owner, at.copy()));

      const caught = new Set<AttackableUnit>();
      if (victim && !victim.isDead) {
        caught.add(victim);
        victim.takeDamage(R_DAMAGE, this.owner);
        victim.addBuff(new Airborne(R_KNOCKUP_MS, this.owner, victim));
      }

      const nearby = this.game.objectManager.queryObjects({
        area: new Circle({ x: at.x, y: at.y, r: R_BLAST_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const soaked of nearby) {
        if (caught.has(soaked)) continue;
        caught.add(soaked);
        soaked.takeDamage(R_DAMAGE, this.owner);
        soaked.addBuff(new Airborne(R_KNOCKUP_MS, this.owner, soaked));
      }
    }

    draw(): void {
      const heading = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      const swell = 0.78 + 0.22 * sin(this.age / 110);

      push();
      translate(this.position.x, this.position.y);
      rotate(heading);
      // The water shadow bulging along the floor.
      noStroke();
      fill(ABYSS[0], ABYSS[1], ABYSS[2], 120);
      ellipse(0, 0, this.size * 1.5 * swell, this.size * 0.95 * swell);
      // Earth heaped over it in a ridge.
      noFill();
      stroke(IRON[0], IRON[1], IRON[2], 210);
      strokeWeight(4);
      arc(0, 5, this.size * 1.15, this.size * 0.72, PI, TWO_PI);
      stroke(RUST[0], RUST[1], RUST[2], 190);
      strokeWeight(2);
      arc(0, 5, this.size * 0.72, this.size * 0.45, PI, TWO_PI);
      // Clods thrown off the back of the ridge.
      stroke(FOAM[0], FOAM[1], FOAM[2], 160);
      strokeWeight(3);
      for (const clod of this.clods) {
        const back = -this.size * 0.5 * clod.along;
        line(back, clod.offset * 0.4, back - 6, clod.offset * 0.7);
      }
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      return this.squareDisplayBoundingBox((this.size + 24) * 2);
    }
  }
  return Nautilus_R_Object;
}
const __cacheNautilus_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_R_Object>>();
export function makeNautilus_R_Object(api: ContentApi) {
  const cached = __cacheNautilus_R_Object.get(api);
  if (cached) return cached;
  const built = __buildNautilus_R_Object(api);
  __cacheNautilus_R_Object.set(api, built);
  return built;
}


/** The blast radius, drawn on the ground where it actually landed. */
function __buildNautilus_R_Rim(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Nautilus_R_Rim extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    lifeTime = R_RIM_MS;
    age = 0;

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
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
      stroke(FOAM[0], FOAM[1], FOAM[2], 200 * fade);
      strokeWeight(6 * fade + 1);
      circle(this.position.x, this.position.y, R_BLAST_RADIUS * 2 * opened);
      // The hard rim on the radius that really hit, not on the wash.
      stroke(RUST[0], RUST[1], RUST[2], 190 * fade + 30);
      strokeWeight(3);
      circle(this.position.x, this.position.y, R_BLAST_RADIUS * 2);
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      return this.squareDisplayBoundingBox((R_BLAST_RADIUS + 14) * 2);
    }
  }
  return Nautilus_R_Rim;
}
const __cacheNautilus_R_Rim = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_R_Rim>>();
export function makeNautilus_R_Rim(api: ContentApi) {
  const cached = __cacheNautilus_R_Rim.get(api);
  if (cached) return cached;
  const built = __buildNautilus_R_Rim(api);
  __cacheNautilus_R_Rim.set(api, built);
  return built;
}


/** The column, standing on the victim. Above the ground, unlike the mound. */
function __buildNautilus_R_Eruption(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Nautilus_R_Eruption extends SpellObject {
    lifeTime = R_COLUMN_MS;
    age = 0;
    /** Seeded once in onAdded — jets that reroll every frame are static, not water. */
    jets: { angle: number; reach: number; tall: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      for (let i = 0; i < R_JETS; i++) {
        this.jets.push({
          angle: random(0, TWO_PI),
          reach: random(16, 84),
          tall: random(70, R_COLUMN_REACH),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const risen = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);
      // The trunk of the column.
      noFill();
      stroke(FOAM[0], FOAM[1], FOAM[2], 230 * fade);
      strokeWeight(14 * fade + 3);
      line(0, 0, 0, -R_COLUMN_REACH * risen);
      stroke(IRON[0], IRON[1], IRON[2], 170 * fade);
      strokeWeight(6);
      line(0, 0, 0, -R_COLUMN_REACH * risen * 0.7);
      // The jets thrown off it, each falling back on its own arc.
      strokeWeight(3);
      for (const jet of this.jets) {
        const out = cos(jet.angle) * jet.reach * risen;
        const drift = sin(jet.angle) * jet.reach * 0.35 * risen;
        stroke(FOAM[0], FOAM[1], FOAM[2], 190 * fade);
        line(0, -8, out, drift - jet.tall * risen);
      }
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      return this.squareDisplayBoundingBox((R_COLUMN_REACH + 20) * 2);
    }
  }
  return Nautilus_R_Eruption;
}
const __cacheNautilus_R_Eruption = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_R_Eruption>>();
export function makeNautilus_R_Eruption(api: ContentApi) {
  const cached = __cacheNautilus_R_Eruption.get(api);
  if (cached) return cached;
  const built = __buildNautilus_R_Eruption(api);
  __cacheNautilus_R_Eruption.set(api, built);
  return built;
}