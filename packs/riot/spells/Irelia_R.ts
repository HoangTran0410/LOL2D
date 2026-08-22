import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BeamGeometry, CastContext, CastSpec, Vec2 } from '@moba2d/core/content/types';
import { makeApplyIreliaMark } from './Irelia_Q';
import { drawIreliaBlade, IRELIA_CREST, IRELIA_EDGE, IRELIA_RIM, IRELIA_STEEL } from './Irelia_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Irelia_R = InstanceType<ReturnType<typeof makeIrelia_R>>;
type Irelia_R_Volley = InstanceType<ReturnType<typeof makeIrelia_R_Volley>>;
type Irelia_R_Wall = InstanceType<ReturnType<typeof makeIrelia_R_Wall>>;



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

/** How often the cluster sheds an afterimage, and how long one lasts. */
const VOLLEY_GHOST_EVERY_MS = 34;

const VOLLEY_GHOST_LIFE_MS = 200;

/**
 * How far past the body it struck the vertex of the V stands.
 *
 * The blades do not stop *on* the champion they hit, they carry through and
 * open behind them — so the one the throw was aimed at ends up in the mouth of
 * the V, between the arms, which is where the picture says it should be. With
 * the vertex on the body instead, the primary target sits at the very tip with
 * an arm brushing past each shoulder.
 *
 * Sized against the geometry rather than picked: the perpendicular distance
 * from an arm's centre line is `overshoot * sin(R_ARM_SPREAD)` ≈ 46 here,
 * against an arm half-width of 26. So the body clears both arms by ~20px and
 * the opening sweep is what actually cuts it — which is the honest model,
 * because the blades reached the vertex by going *through* it.
 */
export const R_APEX_OVERSHOOT = 80;


/** The straight run of each arm, before it curls. */
export const R_ARM_LENGTH = 250;

/** Half-angle off the backward axis, in radians — how open the V sits. */
export const R_ARM_SPREAD = 0.62;

export const R_ARM_WIDTH = 52;


/**
 * The curled tail at each outer end.
 *
 * The two hooks are what turn a chevron into a trap. A bare V is two lines you
 * walk around the end of; with the tails bent back across the throw the shape
 * closes, and leaving it means crossing blades wherever you leave. It is also
 * the silhouette the ability actually has — the tips visibly bend.
 *
 * `R_HOOK_TURN` is deliberately larger than `R_ARM_SPREAD`, and has to be: the
 * tail only reads as curling *back* once it has turned past the backward axis
 * it set out from, and 0.62 of the turn is spent merely undoing the spread.
 */
export const R_HOOK_LENGTH = 105;

export const R_HOOK_TURN = 1.6;

/** How many straight pieces approximate one hook. Four is smooth at this size. */
const R_HOOK_SEGMENTS = 4;

/** How many blades stand along one arm, hook included. */
export const R_ARM_BLADES = 13;


/** The white at the heart of the burst, before anything has moved. */
export const R_FLASH_MS = 50;


/**
 * How long the blades take to travel from the body they struck out to the far
 * tips of both hooks.
 *
 * Long enough to watch, which is the whole point — the wall *spreads out of the
 * victim*, it does not switch on. `draw` runs one front along the whole path
 * and stands each blade as it passes; `update` refuses to charge the toll for
 * walking into the wall until that front has arrived, because a wall you can
 * see is still travelling must not already be hurting people.
 */
export const R_OPEN_MS = 300;


/** How long the blades stand once they are there. */
export const R_WALL_MS = 4000;

/** How long a segment takes to fall apart once its time is up. */
export const R_WALL_COLLAPSE_MS = 260;


/**
 * Vanguard's Edge.
 *
 * One thing goes out and a wall comes back, and the shape is the whole ability:
 * a **tight cluster** of blades thrown as a single object, which tears open
 * into a **V** the moment it reaches a body — apex where it struck, both arms
 * swept back along the throw — cutting and slowing everyone the opening
 * catches. The blades then *stay standing* in that shape for two and a half
 * seconds, and anyone who walks into them is cut and slowed again.
 *
 * So it is not a nuke, it is a wall she chooses the position of by choosing
 * whom to hit with it, and the counterplay is not being the body it opens on
 * and then not walking back through it.
 *
 * Three shapes have been tried and only this one states the ability. A fan of
 * five blades flying the full range separated at the *caster*, so nothing about
 * the throw said "this opens where it lands". A ring centred on the victim read
 * cleanly but is not what the ability is: a wall has a front and a back you can
 * be on opposite sides of, and a circle has neither. And a wall that *blocks*
 * is a different and much stronger ability than a wall that *hurts*.
 */
function __buildIrelia_R(api: ContentApi) {
  const Spell = api.Spell;
  const Irelia_R_Volley = makeIrelia_R_Volley(api);
  const Irelia_R_Wall = makeIrelia_R_Wall(api);
  class Irelia_R extends Spell {
    image = api.asset('spell_irelia_r');
    name = 'Thanh Kiếm Tiên Phong (Irelia_R)';
    description = `Ném một chùm kiếm về phía trước. Khi trúng kẻ địch — hoặc khi tới cuối tầm —
      chùm kiếm <span class="buff">bung ra thành hàng rào kiếm hình chữ V</span>, gây
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
      volley.onBurst = (at, along, struckBody) => this.openWall(at, along, struckBody);
      this.game.objectManager.addObject(volley);
    }

    /**
     * Called by the cluster when it stops, so the wall opens where it did — the
     * vertex past the body it struck, or exactly where it ran out of range when
     * it struck nobody. Pushing the vertex out on a whiff would be free reach
     * beyond `R_RANGE` with nothing to justify it.
     */
    openWall(impact: Vec2, heading: number, struckBody: boolean): void {
      const push = struckBody ? R_APEX_OVERSHOOT : 0;
      const apex = {
        x: impact.x + Math.cos(heading) * push,
        y: impact.y + Math.sin(heading) * push,
      };
      this.game.objectManager.addObject(new Irelia_R_Wall(this.owner, impact, apex, heading));
    }
  }
  return Irelia_R;
}
const __cacheIrelia_R = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_R>>();
export default function makeIrelia_R(api: ContentApi) {
  const cached = __cacheIrelia_R.get(api);
  if (cached) return cached;
  const built = __buildIrelia_R(api);
  __cacheIrelia_R.set(api, built);
  return built;
}


/**
 * The cluster in flight: every blade of the ultimate held together as one
 * object, which is why `maxHitCount` is 1 rather than Infinity. It does not
 * pierce and it does not cut on the way — it *stops* on the first body, and
 * stopping is what opens it.
 */
function __buildIrelia_R_Volley(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const MissileSpellObject = api.MissileSpellObject;
  class Irelia_R_Volley extends MissileSpellObject {
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
    onBurst?: (at: Vec2, heading: number, struckBody: boolean) => void;
    private burst = false;
    private readonly ghosts: { x: number; y: number; age: number }[] = [];
    private sinceGhost = 0;

    constructor(owner: AttackableUnit, heading: number) {
      super(owner);
      this.heading = heading;
    }

    onAfterMove(): void {
      this.age += deltaTime;

      this.sinceGhost += deltaTime;
      if (this.sinceGhost >= VOLLEY_GHOST_EVERY_MS) {
        this.sinceGhost = 0;
        this.ghosts.push({ x: this.position.x, y: this.position.y, age: 0 });
      }
      for (const ghost of this.ghosts) ghost.age += deltaTime;
      while (this.ghosts.length > 0 && this.ghosts[0].age >= VOLLEY_GHOST_LIFE_MS) {
        this.ghosts.shift();
      }
    }

    /**
     * A body: the wall opens *through* it, so the apex is the body and not
     * wherever the cluster happened to be standing when the quadtree noticed it.
     *
     * Those are not the same point and the difference is the whole hit. A query
     * circle of `R_VOLLEY_SIZE / 2` against a champion-sized box triggers a good
     * 30-40px early; with the arms swept back from *that* point, the one unit the
     * throw certainly struck ends up in front of the blades, and the ability's
     * primary target is the only thing in the fight it does not cut.
     */
    onHit(enemy: AttackableUnit): void {
      this.open({ x: enemy.position.x, y: enemy.position.y }, true);
    }

    /** Nobody in the way: it opens at the end of its reach instead. */
    onArrive(): void {
      this.open({ x: this.position.x, y: this.position.y }, false);
    }

    private open(impact: Vec2, struckBody: boolean): void {
      if (this.burst) return;
      this.burst = true;
      this.onBurst?.(impact, this.heading, struckBody);
      this.toRemove = true;
    }

    draw(): void {
      // The trail it has already covered, drawn before the cluster so the cluster
      // always sits on top of its own history.
      for (const ghost of this.ghosts) {
        const left = 1 - constrain(ghost.age / VOLLEY_GHOST_LIFE_MS, 0, 1);
        push();
        translate(ghost.x, ghost.y);
        rotate(this.heading);
        stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 150 * left);
        strokeWeight(2 + 3 * left);
        line(-16 * left, 0, 12 * left, 0);
        pop();
      }

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);

      // A wake behind it, so the cluster states which way it is travelling.
      noStroke();
      fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 90);
      quad(-52, -4, -10, -17, -10, 17, -52, 4);

      // Seven blades held in a chevron — the "chùm" the ability is named for. The
      // outer ones ride further back, so a tight bundle still reads as one object
      // travelling rather than as a spread that has already opened. That matters:
      // `maxHitCount` is 1 and it stops on the first body, so anything that looks
      // like a fan is promising a pierce the ability does not have.
      const fan = 7;
      for (let i = 0; i < fan; i++) {
        const across = (i / (fan - 1)) * 2 - 1;
        push();
        translate(-4 - Math.abs(across) * 11, across * 12);
        rotate(across * 0.17 + this.age / 300);
        drawIreliaBlade(34);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.size + 90) * 2);
    }
  }
  return Irelia_R_Volley;
}
const __cacheIrelia_R_Volley = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_R_Volley>>();
export function makeIrelia_R_Volley(api: ContentApi) {
  const cached = __cacheIrelia_R_Volley.get(api);
  if (cached) return cached;
  const built = __buildIrelia_R_Volley(api);
  __cacheIrelia_R_Volley.set(api, built);
  return built;
}


/** One piece of an arm, plus how far along the whole path its near end sits. */
interface WallPart {
  beam: BeamGeometry;
  at: number;
}


/**
 * The burst, and the wall it leaves standing.
 *
 * Each arm is a **chain**: a straight run swept back from the vertex, then a
 * hook curling across the throw. The same chain is the damage volume and the
 * drawing, which is the point — a player has to be able to look at it and know
 * where "inside the blades" is, because the ability charges for walking in
 * there.
 *
 * Everything on screen is placed by **distance along one path** that starts at
 * the body the cluster struck, runs forward to the vertex, then out to a tip.
 * One front travels that path over `R_OPEN_MS` and each blade stands as it goes
 * by, so the wall visibly grows out of the victim rather than appearing around
 * them. The toll waits for the same front — see `update`.
 *
 * `inside` is rebuilt every frame rather than accumulated, so leaving the wall
 * and stepping back into it is charged again. That is the ability the blades
 * are supposed to be: a thing you route around, not a thing you eat once and
 * then ignore.
 */
function __buildIrelia_R_Wall(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const SpellObject = api.SpellObject;
  const beamBoundingBox = api.beamBoundingBox;
  const intersectsBeam = api.intersectsBeam;
  const applyIreliaMark = makeApplyIreliaMark(api);
  class Irelia_R_Wall extends SpellObject {
    lifeTime = R_WALL_MS;
    age = 0;
    readonly heading: number;
    /** Where the cluster stopped — the body, when there was one. */
    readonly impact: Vec2;
    /** Two arms, each a chain of segments running vertex → straight run → hook. */
    readonly arms: readonly (readonly BeamGeometry[])[];
    /**
     * The stretch the blades covered getting from the body to the vertex, cut
     * once on the opening frame and then never again.
     *
     * It is not part of the standing wall, and that is the point: the blades were
     * *travelling* along it and then they were not. Without it the ability's
     * primary target is the one thing on the field it does not hit, because the
     * overshoot deliberately puts that body between the arms rather than on one.
     */
    private readonly sweep: BeamGeometry | null;
    /** Every arm segment flattened, each tagged with where the front reaches it. */
    private readonly parts: readonly WallPart[];
    private readonly blades: readonly { x: number; y: number; at: number }[];
    /** Impact to vertex to the far tip of a hook: what the front has to cover. */
    private readonly pathLength: number;
    /** Impact to vertex — where along the path each arm's own chain begins. */
    private readonly travelled: number;

    /** Who is standing in the blades *this* frame — rebuilt, never accumulated. */
    private inside = new Set<AttackableUnit>();
    /** The opening cut, which is worth more than the toll for stepping in later. */
    private opening = true;
    private collapsing = false;
    private collapseAge = 0;
    /** Recent cuts, drawn on the bodies they landed on. */
    private marks: { x: number; y: number; age: number }[] = [];

    constructor(owner: AttackableUnit, impact: Vec2, apex: Vec2, heading: number) {
      super(owner);
      this.position = createVector(apex.x, apex.y);
      this.heading = heading;
      this.impact = { x: impact.x, y: impact.y };

      const travelled = Math.hypot(apex.x - impact.x, apex.y - impact.y);
      this.sweep =
        travelled > 1
          ? { start: this.impact, end: { x: apex.x, y: apex.y }, width: R_ARM_WIDTH }
          : null;

      const back = heading + Math.PI;
      const arms = [-1, 1].map(side =>
        buildArm(apex, back + side * R_ARM_SPREAD, -side * R_HOOK_TURN)
      );
      this.arms = arms;

      const parts: WallPart[] = [];
      const blades: { x: number; y: number; at: number }[] = [];
      const spacing = (R_ARM_LENGTH + R_HOOK_LENGTH) / R_ARM_BLADES;

      for (const arm of arms) {
        let along = 0;
        for (const beam of arm) {
          parts.push({ beam, at: travelled + along });
          along += Math.hypot(beam.end.x - beam.start.x, beam.end.y - beam.start.y);
        }
        for (let i = 0; i < R_ARM_BLADES; i++) {
          const d = (i + 0.5) * spacing;
          const spot = pointAlong(arm, d);
          blades.push({ x: spot.x, y: spot.y, at: travelled + d });
        }
      }
      this.parts = parts;
      this.blades = blades;
      this.travelled = travelled;
      this.pathLength = travelled + R_ARM_LENGTH + R_HOOK_LENGTH;
    }

    private get segments(): BeamGeometry[] {
      return this.parts.map(part => part.beam);
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

      // The opening sweep covers the arms *and* the stretch the blades crossed to
      // reach the vertex; what stands afterwards is only the arms. Seeding
      // `inside` from the arms alone stops a body that was swept and is also
      // standing on an arm paying twice for one action.
      if (this.opening) {
        this.opening = false;
        const segments = this.segments;
        const swept = this.sweep ? [...segments, this.sweep] : segments;
        for (const unit of this.unitsInBeams(swept)) this.cut(unit, R_DAMAGE);
        this.inside = this.unitsInBeams(segments);
        return;
      }

      // The blades are still on their way out. Nothing is standing there to walk
      // into, so nothing is charged — the drawing is allowed to lag the volume on
      // the opening frame, which has to catch what the throw was aimed through,
      // but never afterwards.
      if (this.age < R_OPEN_MS) return;

      const present = this.unitsInBeams(this.segments);
      for (const unit of present) {
        if (this.inside.has(unit)) continue;
        this.cut(unit, R_WALL_DAMAGE);
      }
      this.inside = present;
    }

    private cut(unit: AttackableUnit, damage: number): void {
      unit.takeDamage(damage, this.owner);

      // No `slow.image`: a crowd-control buff keeps its own CC icon, so a slowed
      // unit shows "slowed" rather than an ultimate the player cannot read.
      const slow = new Slow(R_SLOW_MS, this.owner, unit);
      slow.percent = R_SLOW_PERCENT;
      slow.stackId = 'irelia_r_slow';
      unit.addBuff(slow);

      // Every cut marks, the opening one and the toll alike: the blades standing
      // on the field are what keeps the Q chain alive around them.
      applyIreliaMark(this.owner, unit);

      this.marks.push({ x: unit.position.x, y: unit.position.y, age: 0 });
    }

    /**
     * The part of one arm the front has reached, as a polyline from the vertex.
     *
     * Returned rather than drawn so the band and any later layer cannot disagree
     * about how much of the wall has arrived.
     */
    private revealedPath(arm: readonly BeamGeometry[], front: number): Vec2[] {
      const path: Vec2[] = [];
      let along = this.travelled;
      if (front <= along) return path;
      path.push(arm[0].start);

      for (const beam of arm) {
        const spanX = beam.end.x - beam.start.x;
        const spanY = beam.end.y - beam.start.y;
        const run = Math.hypot(spanX, spanY);
        const reached = front - along;
        if (reached >= run) {
          path.push(beam.end);
          along += run;
          continue;
        }
        const share = Math.max(0, reached) / run;
        path.push({ x: beam.start.x + spanX * share, y: beam.start.y + spanY * share });
        break;
      }
      return path;
    }

    /** Everyone standing in the given beams right now. */
    private unitsInBeams(beams: readonly BeamGeometry[]): Set<AttackableUnit> {
      const found = new Set<AttackableUnit>();
      for (const beam of beams) {
        const candidates = this.game.objectManager.queryObjects({
          area: beamBoundingBox(beam, undefined),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        }) as AttackableUnit[];
        for (const unit of candidates) {
          if (unit === this.owner || unit.isDead || unit.toRemove) continue;
          if (intersectsBeam(unit, beam)) found.add(unit);
        }
      }
      return found;
    }

    draw(): void {
      const opened = 1 - Math.pow(1 - constrain(this.age / R_OPEN_MS, 0, 1), 3);
      const front = opened * this.pathLength;
      const flash = 1 - constrain(this.age / R_FLASH_MS, 0, 1);
      const fade = this.collapsing
        ? constrain(1 - this.collapseAge / R_WALL_COLLAPSE_MS, 0, 1)
        : this.age > this.lifeTime - 400
          ? map(this.age, this.lifeTime - 400, this.lifeTime, 1, 0)
          : 1;

      push();
      translate(this.position.x, this.position.y);

      // The ground each arm covers — the "do not walk here" statement, and the
      // same volume `intersectsBeam` charges for. Drawn as **one** stroked
      // polyline per arm rather than a rectangle per segment: a capsule chain is
      // exactly what `intersectsBeam` tests, and per-segment rectangles left the
      // hook's short pieces sticking out as loose slabs across the row while the
      // translucent fills double-blended at every joint.
      //
      // Kept dim on purpose. The blades standing in it are the subject, and a
      // bright slab under them competes with what it is there to explain.
      strokeJoin(ROUND);
      strokeCap(ROUND);
      noFill();
      for (const arm of this.arms) {
        const path = this.revealedPath(arm, front);
        if (path.length < 2) continue;
        for (const pass of [0, 1]) {
          if (pass === 0) {
            stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 120 * fade);
            strokeWeight(R_ARM_WIDTH);
          } else {
            stroke(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 55 * fade);
            strokeWeight(R_ARM_WIDTH - 6);
          }
          beginShape();
          for (const spot of path) vertex(spot.x - this.position.x, spot.y - this.position.y);
          endShape();
        }
      }

      // The blades, each standing as the front reaches it. They are drawn upright
      // in world space rather than in their segment's frame, so a wall thrown at
      // any angle is still a row of swords planted in the ground instead of a row
      // lying on its side.
      for (const blade of this.blades) {
        const arrived = constrain((front - blade.at) / 55, 0, 1);
        if (arrived <= 0) continue;
        push();
        translate(blade.x - this.position.x, blade.y - this.position.y);
        rotate(-HALF_PI);
        drawIreliaBlade(R_ARM_WIDTH * 1.15 * arrived, fade);
        pop();
      }

      // The stretch the blades crossed to reach the vertex — the part that
      // explains why the body they struck is standing in the mouth of the V
      // rather than at its point. Gone as fast as they crossed it.
      if (this.sweep && opened < 1) {
        const gone = 1 - opened;
        const run = Math.hypot(
          this.sweep.end.x - this.sweep.start.x,
          this.sweep.end.y - this.sweep.start.y
        );
        push();
        translate(this.impact.x - this.position.x, this.impact.y - this.position.y);
        rotate(this.heading);
        noStroke();
        fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 110 * gone);
        quad(0, -4, run, -R_ARM_WIDTH * 0.34, run, R_ARM_WIDTH * 0.34, 0, 4);
        stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 240 * gone);
        strokeWeight(3);
        line(0, 0, run, 0);
        pop();
      }

      // The vertex: where it opened, and the only spot the two arms share.
      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 235 * flash);
        circle(0, 0, 52 * flash + 12);
      }
      noFill();
      stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 235 * fade);
      strokeWeight(4);
      circle(0, 0, 28);
      stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 200 * fade);
      strokeWeight(2);
      circle(0, 0, 28);
      pop();

      // One cut per body it charged, on the body. Drawn last so a hit taken deep
      // inside the wall is not buried under the arm it happened in.
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
      let minX = Math.min(this.position.x, this.impact.x);
      let minY = Math.min(this.position.y, this.impact.y);
      let maxX = Math.max(this.position.x, this.impact.x);
      let maxY = Math.max(this.position.y, this.impact.y);
      for (const part of this.parts) {
        minX = Math.min(minX, part.beam.start.x, part.beam.end.x);
        minY = Math.min(minY, part.beam.start.y, part.beam.end.y);
        maxX = Math.max(maxX, part.beam.start.x, part.beam.end.x);
        maxY = Math.max(maxY, part.beam.start.y, part.beam.end.y);
      }
      for (const mark of this.marks) {
        minX = Math.min(minX, mark.x);
        minY = Math.min(minY, mark.y);
        maxX = Math.max(maxX, mark.x);
        maxY = Math.max(maxY, mark.y);
      }
      const pad = R_ARM_WIDTH + 20;
      return new Rectangle({
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
        data: this,
      });
    }
  }
  return Irelia_R_Wall;
}
const __cacheIrelia_R_Wall = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_R_Wall>>();
export function makeIrelia_R_Wall(api: ContentApi) {
  const cached = __cacheIrelia_R_Wall.get(api);
  if (cached) return cached;
  const built = __buildIrelia_R_Wall(api);
  __cacheIrelia_R_Wall.set(api, built);
  return built;
}


/**
 * One arm: a straight run swept back from the vertex, then a hook of
 * `R_HOOK_SEGMENTS` short pieces each turning by an equal share of `turn`.
 *
 * Straight pieces rather than a real curve because the same chain has to serve
 * `intersectsBeam`, which only knows capsules. Four pieces over 105px leaves
 * well under a pixel of chord error at this width, and the blades standing on
 * it hide the joints entirely.
 */
function buildArm(apex: Vec2, armAngle: number, turn: number): BeamGeometry[] {
  const segments: BeamGeometry[] = [];
  let x = apex.x;
  let y = apex.y;
  let angle = armAngle;

  const runX = x + Math.cos(angle) * R_ARM_LENGTH;
  const runY = y + Math.sin(angle) * R_ARM_LENGTH;
  segments.push({ start: { x, y }, end: { x: runX, y: runY }, width: R_ARM_WIDTH });
  x = runX;
  y = runY;

  const step = R_HOOK_LENGTH / R_HOOK_SEGMENTS;
  for (let i = 0; i < R_HOOK_SEGMENTS; i++) {
    angle += turn / R_HOOK_SEGMENTS;
    const nextX = x + Math.cos(angle) * step;
    const nextY = y + Math.sin(angle) * step;
    segments.push({ start: { x, y }, end: { x: nextX, y: nextY }, width: R_ARM_WIDTH });
    x = nextX;
    y = nextY;
  }
  return segments;
}


/** The point `distance` along a chain, clamped to its far end. */
function pointAlong(segments: readonly BeamGeometry[], distance: number): Vec2 {
  let left = distance;
  for (const beam of segments) {
    const spanX = beam.end.x - beam.start.x;
    const spanY = beam.end.y - beam.start.y;
    const run = Math.hypot(spanX, spanY);
    if (left <= run || beam === segments[segments.length - 1]) {
      const share = run === 0 ? 0 : Math.min(1, left / run);
      return { x: beam.start.x + spanX * share, y: beam.start.y + spanY * share };
    }
    left -= run;
  }
  return { x: segments[0].start.x, y: segments[0].start.y };
}