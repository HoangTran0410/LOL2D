import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BeamGeometry, CastContext, CastSpec, Vec2 } from '@moba2d/core/content/types';
import { makeApplyIreliaMark } from './Irelia_Q';
import { drawIreliaBlade, IRELIA_CREST, IRELIA_EDGE, IRELIA_RIM, IRELIA_STEEL } from './Irelia_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Irelia_E = InstanceType<ReturnType<typeof makeIrelia_E>>;
type Irelia_E_Blade = InstanceType<ReturnType<typeof makeIrelia_E_Blade>>;
type Irelia_E_Duet = InstanceType<ReturnType<typeof makeIrelia_E_Duet>>;
type Irelia_E_Throw = InstanceType<ReturnType<typeof makeIrelia_E_Throw>>;



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
 * How long the cut itself is on screen, once they have met.
 *
 * Short on purpose. The line used to hold for the whole life of the object and
 * it read as a laser someone had switched on — two swords striking each other
 * is an *instant*, and anything that outlives the strike by more than a few
 * frames stops being a strike.
 */
export const E_FLASH_MS = 80;


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
function __buildIrelia_E(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellForm = api.enums.SpellForm;
  const AttackableUnit = api.units.AttackableUnit;
  const Spell = api.Spell;
  const Stun = api.buffs.Stun;
  const beamBoundingBox = api.beamBoundingBox;
  const intersectsBeam = api.intersectsBeam;
  const applyIreliaMark = makeApplyIreliaMark(api);
  const Irelia_E_Throw = makeIrelia_E_Throw(api);
  const Irelia_E_Blade = makeIrelia_E_Blade(api);
  const Irelia_E_Duet = makeIrelia_E_Duet(api);
  class Irelia_E extends Spell {
    image = api.asset('spell_irelia_e');
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
        applyIreliaMark(this.owner, victim);
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
  return Irelia_E;
}
const __cacheIrelia_E = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_E>>();
export default function makeIrelia_E(api: ContentApi) {
  const cached = __cacheIrelia_E.get(api);
  if (cached) return cached;
  const built = __buildIrelia_E(api);
  __cacheIrelia_E.set(api, built);
  return built;
}


/**
 * A blade on its way to the ground.
 *
 * `maxHitCount = 0`: it cuts nobody in flight. All it does is take time, which
 * is the point — the flight is the reaction window the instant-plant version
 * never gave anyone, and it is what makes the second press a throw the enemy
 * can watch rather than a stun that has already happened.
 */
function __buildIrelia_E_Throw(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const MissileSpellObject = api.MissileSpellObject;
  class Irelia_E_Throw extends MissileSpellObject {
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
  return Irelia_E_Throw;
}
const __cacheIrelia_E_Throw = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_E_Throw>>();
export function makeIrelia_E_Throw(api: ContentApi) {
  const cached = __cacheIrelia_E_Throw.get(api);
  if (cached) return cached;
  const built = __buildIrelia_E_Throw(api);
  __cacheIrelia_E_Throw.set(api, built);
  return built;
}


/**
 * A blade standing in the ground, waiting.
 *
 * This is the piece of the kit the player has to *find*, so it is built to the
 * ground-art bar: ~50px of longest dimension, a dark rim under a pale body so
 * it survives grass, water and stone alike, and the rose crest — used nowhere
 * else in the kit at rest — marking it as hers.
 */
function __buildIrelia_E_Blade(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Irelia_E_Blade extends SpellObject {
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

      // The ring it is planted in, and the light coming off it. This is the part
      // that makes a blade in the grass *findable*: a flat blade seen from above
      // is a sliver, and the ring is what holds the spot at a glance.
      noFill();
      stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 215 * fade * planted);
      strokeWeight(3.5);
      ellipse(0, 6, this.length * (0.95 + 0.15 * sin(this.age / 300)), this.length * 0.42);
      noStroke();
      fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 70 * fade * planted);
      quad(-8, 6, 8, 6, 4, -62 * planted, -4, -62 * planted);

      // It stands, it does not spin. The turn was there to stop a waiting blade
      // reading as a floor decal, and the ring and the shaft now do that job far
      // better — with them, rotation reads as a blade *lying on* the ground and
      // turning, which is the opposite of what it is.
      rotate(sin(this.age / 520) * 0.07);
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
  return Irelia_E_Blade;
}
const __cacheIrelia_E_Blade = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_E_Blade>>();
export function makeIrelia_E_Blade(api: ContentApi) {
  const cached = __cacheIrelia_E_Blade.get(api);
  if (cached) return cached;
  const built = __buildIrelia_E_Blade(api);
  __cacheIrelia_E_Blade.set(api, built);
  return built;
}


/**
 * The pair meeting in the middle.
 *
 * The two blades actually travel toward each other along the line they cut, so
 * the animation moves the way the ability moves; the band between them states
 * the area that was hit, and each victim gets a spark on their own body rather
 * than a glow somewhere near it.
 */
function __buildIrelia_E_Duet(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const beamBoundingBox = api.beamBoundingBox;
  class Irelia_E_Duet extends SpellObject {
    lifeTime = 500;
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
      const closing = constrain(this.age / E_SNAP_MS, 0, 1);
      const sinceSnap = Math.max(0, this.age - E_SNAP_MS);
      // The strike: gone in 80ms, which is what makes it a strike.
      const flash = 1 - constrain(sinceSnap / E_FLASH_MS, 0, 1);
      // The area, brightening as they close and clearing shortly after they meet.
      const band = closing < 1 ? 0.3 + 0.7 * closing : 1 - constrain(sinceSnap / 200, 0, 1);
      const struck = 1 - constrain(sinceSnap / 220, 0, 1);

      const spanX = this.geometry.end.x - this.geometry.start.x;
      const spanY = this.geometry.end.y - this.geometry.start.y;
      const reach = Math.hypot(spanX, spanY);
      const half = this.geometry.width / 2;

      push();
      translate(this.geometry.start.x, this.geometry.start.y);
      rotate(Math.atan2(spanY, spanX));

      // The band the cut will cover. Deliberately faint — it is a corridor drawn
      // on the ground, not a lit floor: the two blades and the line between them
      // are the ability, and a bright slab under them was drowning both. Steel
      // rather than the edge teal, for the same reason.
      if (band > 0) {
        noStroke();
        fill(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 26 * band);
        rectMode(CORNER);
        rect(0, -half, reach, this.geometry.width);
        stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 90 * band);
        strokeWeight(1.5);
        noFill();
        rect(0, -half, reach, this.geometry.width);
      }

      // The two ends, each ringed and throwing a shaft of light: the same anchor
      // the waiting blade drew, so the pair reads as *those two blades* closing
      // rather than as a beam that appeared between two points.
      for (const end of [0, reach]) {
        push();
        translate(end, 0);
        rotate(-Math.atan2(spanY, spanX));
        noFill();
        stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 225 * band);
        strokeWeight(3.5);
        ellipse(0, 0, 52, 23);
        noStroke();
        fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 55 * band);
        quad(-7, 0, 7, 0, 4, -58, -4, -58);
        pop();
      }

      // CONVERGE: the two blades actually travelling toward each other along the
      // line they cut, so the animation moves the way the ability moves.
      const meet = reach / 2;
      if (closing < 1) {
        for (let i = 0; i < 2; i++) {
          const at = i === 0 ? meet * closing : reach - meet * closing;
          push();
          translate(at, 0);
          stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 240);
          strokeWeight(10);
          line(0, -24, 0, 24);
          stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 250);
          strokeWeight(4.5);
          line(0, -24, 0, 24);
          pop();
        }
      }

      // The cut: one hard white line down the whole corridor, and the clash where
      // the two of them actually met.
      if (flash > 0) {
        stroke(255, 255, 255, 195 * flash);
        strokeWeight(1.5 + 3.5 * flash);
        line(0, 0, reach, 0);

        noStroke();
        fill(255, 255, 255, 210 * flash);
        circle(meet, 0, 32 * flash + 8);
        noFill();
        stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 235 * flash);
        strokeWeight(4);
        circle(meet, 0, 96 * (1 - flash) + 20);
      }
      pop();

      // One mark per victim, on the victim, and gone about as fast as the cut.
      if (struck > 0) {
        for (const at of this.caught) {
          push();
          translate(at.x, at.y);
          stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 210 * struck);
          strokeWeight(8);
          line(-18, -18, 18, 18);
          line(-18, 18, 18, -18);
          stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 245 * struck);
          strokeWeight(3);
          line(-18, -18, 18, 18);
          line(-18, 18, 18, -18);
          pop();
        }
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
  return Irelia_E_Duet;
}
const __cacheIrelia_E_Duet = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_E_Duet>>();
export function makeIrelia_E_Duet(api: ContentApi) {
  const cached = __cacheIrelia_E_Duet.get(api);
  if (cached) return cached;
  const built = __buildIrelia_E_Duet(api);
  __cacheIrelia_E_Duet.set(api, built);
  return built;
}