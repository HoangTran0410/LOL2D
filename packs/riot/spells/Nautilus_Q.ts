import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Nautilus_Q = InstanceType<ReturnType<typeof makeNautilus_Q>>;
type Nautilus_Q_Impact = InstanceType<ReturnType<typeof makeNautilus_Q_Impact>>;
type Nautilus_Q_Object = InstanceType<ReturnType<typeof makeNautilus_Q_Object>>;



export const Q_DAMAGE = 20;

export const Q_RANGE = 420;

export const Q_WIDTH = 40;

export const Q_STUN_MS = 600;

export const Q_SPEED = 15;

/** How far the victim is dragged back along the chain. */
export const Q_VICTIM_PULL = 70;

/** Where Nautilus stops: a body's width short of whoever he hooked. */
export const Q_LAND_GAP = 55;

/** Where he stops when the anchor bit rock instead of a rib cage. */
export const Q_WALL_GAP = 45;

export const Q_DASH_SPEED = 18;

export const Q_HAUL_MS = 700;

/** How long the chain takes to wind back in once the anchor has done its work. */
export const Q_REEL_MS = 320;

export const Q_CHAIN_LINKS = 12;


const WINDUP_MS = 200;

const IRON: [number, number, number] = [120, 144, 156];

const RUST: [number, number, number] = [75, 101, 132];

const FOAM: [number, number, number] = [168, 230, 207];


/**
 * Hauls `unit` to `destination` under `source`'s power.
 *
 * A displacement the victim did not ask for is not cancelable — the stun that
 * arrives with it is applied by the same caster, and a pull that argued with its
 * own crowd control would drop half its victims on the spot.
 */
function __buildhaul(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  function haul(
    source: AttackableUnit,
    unit: AttackableUnit,
    destination: p5.Vector,
    cancelable: boolean
  ): void {
    if (source === unit && !Dash.CanDash(unit)) return;
    const travel = new Dash(Q_HAUL_MS, source, unit);
    travel.dashDestination = destination;
    travel.dashSpeed = Q_DASH_SPEED;
    travel.cancelable = cancelable;
    travel.showTrail = false;
    unit.addBuff(travel);
  }
  return haul;
}
const __cachehaul = new WeakMap<ContentApi, ReturnType<typeof __buildhaul>>();
export function makeHaul(api: ContentApi) {
  const cached = __cachehaul.get(api);
  if (cached) return cached;
  const built = __buildhaul(api);
  __cachehaul.set(api, built);
  return built;
}


function __buildNautilus_Q(api: ContentApi) {
  const Spell = api.Spell;
  const Nautilus_Q_Object = makeNautilus_Q_Object(api);
  class Nautilus_Q extends Spell {
    image = api.asset('spell_nautilus_q');
    name = 'Phóng Mỏ Neo (Nautilus_Q)';
    description =
      `Phóng mỏ neo về phía trước và móc vào thứ đầu tiên nó gặp. ` +
      `Trúng địch: <span class="damage">${Q_DAMAGE} sát thương</span>, choáng ` +
      `${Q_STUN_MS / 1000} giây rồi kéo cả hai lại gần nhau. ` +
      `Trúng vách đá: Nautilus tự kéo mình tới đó.`;
    coolDown = 10_000;
    manaCost = 30;
    range = Q_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: WINDUP_MS,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context: CastContext): void {
      const heading = this.firingDirection(context);
      const length = Math.hypot(heading.x, heading.y) || 1;
      const anchor = new Nautilus_Q_Object(this.owner);
      anchor.destination = createVector(
        this.owner.position.x + (heading.x / length) * Q_RANGE,
        this.owner.position.y + (heading.y / length) * Q_RANGE
      );
      this.game.objectManager.addObject(anchor);
    }
  }
  return Nautilus_Q;
}
const __cacheNautilus_Q = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_Q>>();
export default function makeNautilus_Q(api: ContentApi) {
  const cached = __cacheNautilus_Q.get(api);
  if (cached) return cached;
  const built = __buildNautilus_Q(api);
  __cacheNautilus_Q.set(api, built);
  return built;
}


type ChainPhase = 'flight' | 'return';


/**
 * The anchor, and the chain behind it.
 *
 * The chain is the whole point of the art: the player has to see the leash form
 * before the pull happens, and see it contract while it happens. That makes the
 * bounding box a hand-built span between the caster and the anchor rather than a
 * square around either — `squareDisplayBoundingBox` memoises on the object's own
 * position and would not notice the caster's end moving.
 */
function __buildNautilus_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Stun = api.buffs.Stun;
  const sweepToWall = api.terrain.sweepToWall;
  const haul = makeHaul(api);
  const Nautilus_Q_Impact = makeNautilus_Q_Impact(api);
  class Nautilus_Q_Object extends MissileSpellObject {
    speed = Q_SPEED;
    size = Q_WIDTH;
    maxHitCount = 1;
    removeOnArrive = false;
    removeOnMaxHit = false;

    phase: ChainPhase = 'flight';
    age = 0;
    returnAge = 0;
    anchorPoint: p5.Vector | null = null;
    /** Seeded once in onAdded — random() inside draw() flickers instead of swaying. */
    linkSway: number[] = [];

    onAdded(): void {
      super.onAdded();
      for (let i = 0; i < Q_CHAIN_LINKS; i++) this.linkSway.push(random(-3, 3));
    }

    update(): void {
      this.age += deltaTime;

      if (this.phase === 'flight') {
        super.update();
        return;
      }

      this.returnAge += deltaTime;
      const wound = constrain(this.returnAge / Q_REEL_MS, 0, 1);
      const anchor = this.anchorPoint ?? this.position;
      this.position.set(
        lerp(anchor.x, this.owner.position.x, wound),
        lerp(anchor.y, this.owner.position.y, wound)
      );
      if (wound >= 1) this.toRemove = true;
    }

    private previousX = 0;
    private previousY = 0;

    onBeforeMove(): void {
      this.previousX = this.position.x;
      this.previousY = this.position.y;
    }

    onAfterMove(): void {
      if (this.phase !== 'flight') return;
      // The step, not the landing spot. Testing the head's own position once a
      // frame answers "is it inside the wall yet", so the anchor was set up to a
      // frame's travel past the surface and the chain visibly went into the rock
      // before it caught. `sweepToWall` also answers for spell-made walls, which
      // is what a hook flying through an Anivia wall used to be missing.
      const contact = sweepToWall(
        this.game,
        this.previousX,
        this.previousY,
        this.position.x,
        this.position.y
      );
      if (!contact) return;
      this.position.set(contact.x, contact.y);
      this.anchorOnWall();
    }

    checkCollision(): void {
      if (this.phase !== 'flight') return;
      super.checkCollision();
    }

    onArrive(): void {
      // Nothing to bite at full extension: the chain comes back empty.
      if (this.phase === 'flight') this.beginReturn();
    }

    onHit(enemy: AttackableUnit): void {
      enemy.takeDamage(Q_DAMAGE, this.owner);
      enemy.addBuff(new Stun(Q_STUN_MS, this.owner, enemy));
      this.game.objectManager.addObject(new Nautilus_Q_Impact(this.owner, enemy.position.copy()));
      this.beginReturn();
      this.dragTogether(enemy);
    }

    private anchorOnWall(): void {
      const anchor = this.beginReturn();
      const dx = anchor.x - this.owner.position.x;
      const dy = anchor.y - this.owner.position.y;
      const span = Math.hypot(dx, dy);
      if (span <= Q_WALL_GAP) return;
      haul(
        this.owner,
        this.owner,
        createVector(anchor.x - (dx / span) * Q_WALL_GAP, anchor.y - (dy / span) * Q_WALL_GAP),
        true
      );
      this.game.objectManager.addObject(new Nautilus_Q_Impact(this.owner, anchor.copy()));
    }

    /** Both ends of the chain come toward each other, the victim the shorter way. */
    private dragTogether(enemy: AttackableUnit): void {
      const from = this.owner.position;
      const dx = enemy.position.x - from.x;
      const dy = enemy.position.y - from.y;
      const span = Math.hypot(dx, dy) || 1;
      const ux = dx / span;
      const uy = dy / span;

      const pulled = Math.min(Q_VICTIM_PULL, Math.max(0, span - Q_LAND_GAP));
      const victimSpot = createVector(enemy.position.x - ux * pulled, enemy.position.y - uy * pulled);
      haul(this.owner, enemy, victimSpot, false);

      if (span > Q_LAND_GAP) {
        haul(
          this.owner,
          this.owner,
          createVector(victimSpot.x - ux * Q_LAND_GAP, victimSpot.y - uy * Q_LAND_GAP),
          true
        );
      }
    }

    private beginReturn(): p5.Vector {
      this.phase = 'return';
      this.returnAge = 0;
      this.anchorPoint = this.position.copy();
      return this.anchorPoint;
    }

    draw(): void {
      const from = this.owner.position;
      const reeling = this.phase === 'return';
      const bright = reeling ? 1 - constrain(this.returnAge / Q_REEL_MS, 0, 1) : 1;
      const heading = Math.atan2(this.position.y - from.y, this.position.x - from.x);

      push();
      // Every link, so the leash reads before the pull does; the sway flattens as
      // the chain goes taut, which is the motion agreeing with the effect.
      for (let i = 1; i <= Q_CHAIN_LINKS; i++) {
        const along = i / Q_CHAIN_LINKS;
        const swayed = (this.linkSway[i - 1] ?? 0) * sin(this.age / 90 + i) * (reeling ? 0.3 : 1);
        const lx = lerp(from.x, this.position.x, along);
        const ly = lerp(from.y, this.position.y, along) + swayed;
        noFill();
        stroke(IRON[0], IRON[1], IRON[2], 90 + 150 * bright);
        strokeWeight(4);
        circle(lx, ly, 9);
        stroke(RUST[0], RUST[1], RUST[2], 230);
        strokeWeight(1.5);
        circle(lx, ly, 9);
      }

      translate(this.position.x, this.position.y);
      rotate(heading);
      stroke(IRON[0], IRON[1], IRON[2], 245);
      strokeWeight(6);
      line(-14, 0, 14, 0);
      strokeWeight(4);
      line(-14, -9, -14, 9);
      noFill();
      strokeWeight(5);
      arc(10, 0, 28, 28, HALF_PI * 0.5, PI - HALF_PI * 0.5);
      stroke(FOAM[0], FOAM[1], FOAM[2], 180 + 60 * bright);
      strokeWeight(2);
      circle(-18, 0, 9);
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const from = this.owner.position;
      const pad = Q_WIDTH;
      return new Rectangle({
        x: Math.min(from.x, this.position.x) - pad,
        y: Math.min(from.y, this.position.y) - pad,
        w: Math.abs(this.position.x - from.x) + pad * 2,
        h: Math.abs(this.position.y - from.y) + pad * 2,
        data: this,
      });
    }
  }
  return Nautilus_Q_Object;
}
const __cacheNautilus_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_Q_Object>>();
export function makeNautilus_Q_Object(api: ContentApi) {
  const cached = __cacheNautilus_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildNautilus_Q_Object(api);
  __cacheNautilus_Q_Object.set(api, built);
  return built;
}


/** The bite, on the body (or the rock) that took it. */
function __buildNautilus_Q_Impact(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Nautilus_Q_Impact extends SpellObject {
    lifeTime = 300;
    age = 0;
    radius = 46;

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
      push();
      noFill();
      stroke(FOAM[0], FOAM[1], FOAM[2], 230 * (1 - t));
      strokeWeight(4 * (1 - t) + 1);
      circle(this.position.x, this.position.y, 16 + this.radius * 2 * opened);
      stroke(RUST[0], RUST[1], RUST[2], 200 * (1 - t));
      strokeWeight(2);
      circle(this.position.x, this.position.y, 16 + this.radius * opened);
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      return this.squareDisplayBoundingBox((this.radius + 14) * 2);
    }
  }
  return Nautilus_Q_Impact;
}
const __cacheNautilus_Q_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_Q_Impact>>();
export function makeNautilus_Q_Impact(api: ContentApi) {
  const cached = __cacheNautilus_Q_Impact.get(api);
  if (cached) return cached;
  const built = __buildNautilus_Q_Impact(api);
  __cacheNautilus_Q_Impact.set(api, built);
  return built;
}