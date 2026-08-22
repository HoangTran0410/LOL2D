import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Vayne_E = InstanceType<ReturnType<typeof makeVayne_E>>;
type Vayne_E_Object = InstanceType<ReturnType<typeof makeVayne_E_Object>>;
type Vayne_E_Pin = InstanceType<ReturnType<typeof makeVayne_E_Pin>>;
type Vayne_E_Slide = InstanceType<ReturnType<typeof makeVayne_E_Slide>>;



/** How far the heavy bolt flies. */
export const VAYNE_E_RANGE = 400;

/** Width of the bolt's hitbox — three times a normal one. */
export const VAYNE_E_WIDTH = 40;

/** What the bolt itself deals, before any wall. */
export const VAYNE_E_DAMAGE = 20;

/** How far the victim is knocked directly away from Vayne. */
export const VAYNE_E_PUSH = 280;

/** How long that knock takes. */
export const VAYNE_E_PUSH_MS = 350;

/** How long a victim driven into terrain is held there. */
export const VAYNE_E_STUN_MS = 1_400;

/** Extra damage for a victim who ran out of room. */
export const VAYNE_E_WALL_BONUS = 18;


/** One frame at 60fps, for turning a push duration into a per-frame step. */
const FRAME_MS = 16.67;

/** How far past its centre the bolt paints. */
const BOLT_REACH = 72;

/** How long the skid streak behind a cleanly-pushed victim reaches. */
const STREAK_LEN = 96;

/** How far past its centre the pin paints. */
const PIN_REACH = 90;

/** How many splinters burst out of the wall contact. */
const SPLINTERS = 9;


/**
 * Condemn — the signature, and the only ability of hers that is a skillshot.
 *
 * The wall question goes through `sweepToWall`, which answers for the map's own
 * polygons and for the ones spells are holding up at the same time: an ally's
 * ice wall or earthen slab is genuinely impassable but is a `SpellObject`, so
 * the raw map has holes exactly where somebody just built something, and a pin
 * that read the map would fire the victim straight through it.
 */
function __buildVayne_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Spell = api.Spell;
  const Vayne_E_Object = makeVayne_E_Object(api);
  class Vayne_E extends Spell {
    image = api.asset('spell_vayne_e');
    name = 'Kết Án (Vayne_E)';
    description = `Bắn một mũi sắt nặng gây
      <span class="damage">${VAYNE_E_DAMAGE} sát thương</span> và đẩy mục tiêu ra xa. Nếu bị ghim
      vào địa hình: choáng ${VAYNE_E_STUN_MS / 1000} giây và thêm
      <span class="damage">${VAYNE_E_WALL_BONUS} sát thương</span>.`;
    coolDown = 10_000;
    manaCost = 50;
    range = VAYNE_E_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: 180,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(): void {
      // getVectorWithRange randomises a zero-length aim, which is the (0,0) guard.
      const { to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        VAYNE_E_RANGE
      );
      const bolt = new Vayne_E_Object(this.owner);
      bolt.destination = to;
      this.game.objectManager.addObject(bolt);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Vayne_E;
}
const __cacheVayne_E = new WeakMap<ContentApi, ReturnType<typeof __buildVayne_E>>();
export default function makeVayne_E(api: ContentApi) {
  const cached = __cacheVayne_E.get(api);
  if (cached) return cached;
  const built = __buildVayne_E(api);
  __cacheVayne_E.set(api, built);
  return built;
}


/**
 * The heavy bolt. Stops on the first enemy it touches, then decides which of the
 * two outcomes happened before anything is drawn, so the art and the damage can
 * never disagree about whether the victim hit a wall.
 */
function __buildVayne_E_Object(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const Stun = api.buffs.Stun;
  const TrailSystem = api.helpers.TrailSystem;
  const sweepToWall = api.terrain.sweepToWall;
  const MissileSpellObject = api.MissileSpellObject;
  const Vayne_E_Slide = makeVayne_E_Slide(api);
  const Vayne_E_Pin = makeVayne_E_Pin(api);
  class Vayne_E_Object extends MissileSpellObject {
    speed = 15;
    size = VAYNE_E_WIDTH;
    maxHitCount = 1;
    age = 0;
    trailSystem = new TrailSystem({
      trailSize: VAYNE_E_WIDTH * 0.45,
      trailColor: '#8fa3b088',
      trailLifeTime: 220,
      maxLength: 14,
    });

    onAfterMove(): void {
      this.age += deltaTime;
    }

    onHit(enemy: AttackableUnit): void {
      enemy.takeDamage(VAYNE_E_DAMAGE, this.owner);

      // Directly away from Vayne, measured at the moment of impact. Asking for a
      // point `dist + push` from her along her own line to the victim gives the
      // pushed position exactly, and randomises a degenerate zero-length line.
      const gap = p5.Vector.dist(this.owner.position, enemy.position);
      const { to: full } = VectorUtils.getVectorWithRange(
        this.owner.position,
        enemy.position,
        gap + VAYNE_E_PUSH
      );
      const unitX = (full.x - enemy.position.x) / VAYNE_E_PUSH;
      const unitY = (full.y - enemy.position.y) / VAYNE_E_PUSH;

      // Where the wall stops the shove, if one does. Sampled every 20px before,
      // which put the pin up to a stride short of the wall and could step over
      // one thinner than a stride; `sweepToWall` lands the body against the
      // surface. The impact VFX wants the *wall*, not the resting body, so it
      // reads a radius on past the contact.
      const contact = sweepToWall(
        this.game,
        enemy.position.x,
        enemy.position.y,
        full.x,
        full.y,
        enemy.terrainRadius
      );
      const pinned = contact !== null;
      const travelled = contact ? contact.travelled : VAYNE_E_PUSH;
      const contactX = contact ? contact.x - contact.normalX * enemy.terrainRadius : full.x;
      const contactY = contact ? contact.y - contact.normalY * enemy.terrainRadius : full.y;

      const heading = Math.atan2(unitY, unitX);
      const shove = new Dash(VAYNE_E_PUSH_MS + 140, this.owner, enemy);
      shove.dashDestination = createVector(
        enemy.position.x + unitX * travelled,
        enemy.position.y + unitY * travelled
      );
      shove.dashSpeed = Math.max(2, travelled / Math.max(1, VAYNE_E_PUSH_MS / FRAME_MS));
      shove.showTrail = false;
      // A knockback is a displacement, not a cast: the stun this same hit applies
      // is in the default cancel list, so leaving it there would make the push
      // cancel itself on the frame it started.
      shove.buffsToCheckCancel = [];
      enemy.addBuff(shove);

      if (pinned) {
        enemy.takeDamage(VAYNE_E_WALL_BONUS, this.owner);
        enemy.addBuff(new Stun(VAYNE_E_STUN_MS, this.owner, enemy));
        this.game.objectManager.addObject(
          new Vayne_E_Pin(this.owner, createVector(contactX, contactY), heading)
        );
        return;
      }

      this.game.objectManager.addObject(new Vayne_E_Slide(this.owner, enemy, heading));
    }

    draw(): void {
      const spin = this.age / 400;
      const facing = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );

      push();
      translate(this.position.x, this.position.y);
      rotate(facing);
      noStroke();
      // Iron shaft: dark, heavy, and wide enough to read as three bolts' worth.
      fill(52, 73, 94, 245);
      rect(-26, -7, 52, 14, 3);
      // Silver head.
      fill(236, 240, 241, 250);
      triangle(40, 0, 22, -10, 22, 10);
      // Fletching, canted a touch by the flight so it does not read as a decal.
      stroke(236, 240, 241, 200);
      strokeWeight(3);
      line(-26, -8, -12, -3 + sin(spin) * 1.5);
      line(-26, 8, -12, 3 - sin(spin) * 1.5);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(BOLT_REACH * 2);
    }
  }
  return Vayne_E_Object;
}
const __cacheVayne_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildVayne_E_Object>>();
export function makeVayne_E_Object(api: ContentApi) {
  const cached = __cacheVayne_E_Object.get(api);
  if (cached) return cached;
  const built = __buildVayne_E_Object(api);
  __cacheVayne_E_Object.set(api, built);
  return built;
}


/**
 * The clean push: the victim slides and the bolt streak trails behind it. Ground
 * art — `zIndex = GROUND_Z_INDEX`, because an un-overridden subclass otherwise
 * resolves to `SPELL_EFFECT_Z_INDEX`, over the feet of everyone nearby.
 */
function __buildVayne_E_Slide(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Vayne_E_Slide extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    lifeTime = VAYNE_E_PUSH_MS;
    age = 0;
    private victim: AttackableUnit;
    private heading: number;

    constructor(owner: AttackableUnit, victim: AttackableUnit, heading: number) {
      super(owner);
      this.victim = victim;
      this.heading = heading;
      this.attachTo(victim);
      this.position.set(victim.position.x, victim.position.y);
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.victim.position.x, this.victim.position.y);
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const reach = STREAK_LEN * (1 - (1 - t) * (1 - t));

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);
      stroke(236, 240, 241, 200 * fade);
      strokeWeight(5 * fade + 1);
      // One streak back down the line it was pushed along. No burst, no ring —
      // this is the outcome that did *not* stop against anything.
      line(0, 0, -reach, 0);
      stroke(44, 62, 80, 150 * fade);
      strokeWeight(2);
      line(0, -6, -reach * 0.7, -6);
      line(0, 6, -reach * 0.7, 6);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((STREAK_LEN + 24) * 2);
    }
  }
  return Vayne_E_Slide;
}
const __cacheVayne_E_Slide = new WeakMap<ContentApi, ReturnType<typeof __buildVayne_E_Slide>>();
export function makeVayne_E_Slide(api: ContentApi) {
  const cached = __cacheVayne_E_Slide.get(api);
  if (cached) return cached;
  const built = __buildVayne_E_Slide(api);
  __cacheVayne_E_Slide.set(api, built);
  return built;
}


/**
 * The pin: the bolt driven through the victim into the wall, splinters bursting
 * out of the contact point, and the shaft left standing there for as long as the
 * hold lasts. Deliberately nothing like `Vayne_E_Slide` — the two outcomes of
 * one ability must not look like the same event.
 */
function __buildVayne_E_Pin(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Vayne_E_Pin extends SpellObject {
    lifeTime = VAYNE_E_STUN_MS;
    age = 0;
    /** Seeded once in onAdded: random() inside draw() flickers instead of animating. */
    splinters: { angle: number; length: number }[] = [];
    private heading: number;

    constructor(owner: AttackableUnit, at: p5.Vector, heading: number) {
      super(owner);
      this.position = at;
      this.heading = heading;
    }

    onAdded(): void {
      for (let i = 0; i < SPLINTERS; i++) {
        const fan = ((i - (SPLINTERS - 1) / 2) / SPLINTERS) * PI * 1.1;
        this.splinters.push({
          angle: this.heading + PI + fan + random(-0.12, 0.12),
          length: random(18, 46),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // Two phases off one clock: the burst is over fast, the shaft stays.
      const burst = constrain(t / 0.25, 0, 1);
      const thrown = 1 - (1 - burst) * (1 - burst);
      const fade = constrain((1 - t) * 4, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      if (burst < 1) {
        stroke(200, 210, 215, 235 * (1 - burst));
        strokeWeight(2);
        for (const chip of this.splinters) {
          const near = 4 + chip.length * thrown * 0.45;
          const far = near + chip.length * 0.5;
          line(
            cos(chip.angle) * near,
            sin(chip.angle) * near,
            cos(chip.angle) * far,
            sin(chip.angle) * far
          );
        }
      }

      // The shaft, still buried, pointing back the way it came.
      rotate(this.heading);
      noStroke();
      fill(52, 73, 94, 240 * fade);
      rect(-34, -6, 34, 12, 3);
      fill(236, 240, 241, 250 * fade);
      triangle(6, 0, -4, -9, -4, 9);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(PIN_REACH * 2);
    }
  }
  return Vayne_E_Pin;
}
const __cacheVayne_E_Pin = new WeakMap<ContentApi, ReturnType<typeof __buildVayne_E_Pin>>();
export function makeVayne_E_Pin(api: ContentApi) {
  const cached = __cacheVayne_E_Pin.get(api);
  if (cached) return cached;
  const built = __buildVayne_E_Pin(api);
  __cacheVayne_E_Pin.set(api, built);
  return built;
}