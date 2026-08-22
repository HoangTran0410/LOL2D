import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { GameObjectRuntimeContext } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Thresh_E = InstanceType<ReturnType<typeof makeThresh_E>>;
type Thresh_E_Object = InstanceType<ReturnType<typeof makeThresh_E_Object>>;



/** Half the length of the sweep box, measured from Thresh outwards — it reaches behind him too. */
export const HALF_LENGTH = 220;

/** Half the width of the box, across the swing. */
export const HALF_WIDTH = 90;

export const DAMAGE = 18;

export const SWEEP_DISTANCE = 200;

export const SLOW_PERCENT = 0.4;

export const SLOW_DURATION = 1500;

/** How long the chain takes to cross the box, back to front. */
export const SWEEP_DURATION = 320;

/** Wisps hang in the swept air after the chain has gone through. */
export const SWING_LIFETIME = 470;

/** How long a spectral burst lives where the chain caught somebody. */
const MARK_LIFETIME = 300;


/**
 * The box, tested in Thresh's own frame: rotate each candidate back by the
 * heading and it is two comparisons. The circle query around it is only the
 * broad phase — a quadtree hands back candidates, never members.
 *
 * `maxAlong` is where the chain has got to. At `HALF_LENGTH` this is the whole
 * box, which is what the preview and the tests ask for; the swing itself walks
 * the value up from `-HALF_LENGTH` so the hit follows the art.
 *
 * `bow` is how far the ends of the chain trail the middle — the same number the
 * swing draws with. Without it the tested line would be straight while the drawn
 * one curves, and someone at the corner of the box would be flayed by a chain
 * still 26px short of them.
 */
function __buildenemiesInSweptBox(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  function enemiesInSweptBox(
    game: GameObjectRuntimeContext,
    origin: p5.Vector,
    teamId: string,
    heading: number,
    maxAlong: number,
    exclude: AttackableUnit[] = [],
    bow = 0
  ): AttackableUnit[] {
    const reach = Math.hypot(HALF_LENGTH, HALF_WIDTH);
    const candidates = game.objectManager.queryObjects({
      area: new Circle({ x: origin.x, y: origin.y, r: reach }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(teamId)],
    }) as AttackableUnit[];

    const cos = Math.cos(-heading);
    const sin = Math.sin(-heading);
    const inside: AttackableUnit[] = [];
    for (const enemy of candidates) {
      // Held locally rather than pushed into the query filters: this list is what
      // guarantees one hit per body whatever the query happens to return.
      if (exclude.includes(enemy)) continue;
      const dx = enemy.position.x - origin.x;
      const dy = enemy.position.y - origin.y;
      const along = dx * cos - dy * sin;
      const across = dx * sin + dy * cos;
      const body = enemy.collisionRadius ?? 0;
      if (Math.abs(along) > HALF_LENGTH + body) continue;
      if (Math.abs(across) > HALF_WIDTH + body) continue;
      // the links out at this width trail the middle by `lead`
      const lead = bow * Math.pow(Math.min(1, Math.abs(across) / HALF_WIDTH), 2);
      if (along - body > maxAlong - lead) continue; // the chain has not reached them yet
      inside.push(enemy);
    }
    return inside;
  }
  return enemiesInSweptBox;
}
const __cacheenemiesInSweptBox = new WeakMap<ContentApi, ReturnType<typeof __buildenemiesInSweptBox>>();
export function makeEnemiesInSweptBox(api: ContentApi) {
  const cached = __cacheenemiesInSweptBox.get(api);
  if (cached) return cached;
  const built = __buildenemiesInSweptBox(api);
  __cacheenemiesInSweptBox.set(api, built);
  return built;
}


/**
 * Flay.
 *
 * Three things this had wrong, and they are the whole ability:
 *
 *   - **The area was a circle around Thresh.** Flay is a *sweep*: the chain
 *     comes across in one direction, so the shape is a rectangle centred on
 *     him and turned to face the cursor. A circle catches the people standing
 *     behind him at right angles to the swing, who should be untouched.
 *   - **Everyone was shoved along the same vector, so a clump scattered.**
 *     They were, in fact, all given the same offset — but from *their own*
 *     positions, so the body-separation system pushed them apart on arrival
 *     and it read as a radial knock. They are swept to the far edge of the box
 *     now: one direction, one line, the way a chain across the shins works.
 *   - **Everybody in the box was hit on frame zero** while the chain took
 *     another 320ms to wipe across them, so the art was a replay of something
 *     already over. The swing owns the hit now: `Thresh_E_Object` walks its
 *     chain from the back of the box to the front and catches each body as the
 *     links reach it.
 */
function __buildThresh_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const enemiesInSweptBox = makeEnemiesInSweptBox(api);
  const Thresh_E_Object = makeThresh_E_Object(api);
  class Thresh_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_thresh_e');
    name = 'Lưỡi Hái Xoáy (Thresh_E)';
    description =
      `Quất xích thành một <span class="buff">vệt quét hình chữ nhật</span> dài <span>${HALF_LENGTH * 2}px</span>` +
      ` rộng <span>${HALF_WIDTH * 2}px</span>, tâm ở Thresh và xoay theo hướng con trỏ. Xích quét qua trong` +
      ` <span class="time">${SWEEP_DURATION / 1000} giây</span>, <i>chạm tới ai thì trúng người đó</i>:` +
      ` <span class="damage">${DAMAGE} sát thương</span>, <span class="buff">quét</span> kẻ địch` +
      ` <span>${SWEEP_DISTANCE}px</span> theo đúng hướng quất và <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>`;
    coolDown = 8000;
    manaCost = 30;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, HALF_LENGTH);
      const heading = Math.atan2(to.y - this.owner.position.y, to.x - this.owner.position.x);

      const swing = new Thresh_E_Object(this.owner);
      swing.heading = heading;
      this.game.objectManager.addObject(swing);
    }

    /** The full box, for the preview and for anything asking "what would this catch". */
    enemiesInBox(heading: number): AttackableUnit[] {
      return enemiesInSweptBox(
        this.game,
        this.owner.position,
        this.owner.teamId,
        heading,
        HALF_LENGTH
      );
    }

    drawPreview() {
      super.drawPreview(HALF_LENGTH);
    }
  }
  return Thresh_E;
}
const __cacheThresh_E = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_E>>();
export default function makeThresh_E(api: ContentApi) {
  const cached = __cacheThresh_E.get(api);
  if (cached) return cached;
  const built = __buildThresh_E(api);
  __cacheThresh_E.set(api, built);
  return built;
}


interface ChainMark {
  x: number;
  y: number;
  age: number;
}


/** The swing: a chain wiping across the box, hitting what it passes. */
function __buildThresh_E_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const Dash = api.buffs.Dash;
  const Slow = api.buffs.Slow;
  const AttackableUnit = api.units.AttackableUnit;
  const enemiesInSweptBox = makeEnemiesInSweptBox(api);
  class Thresh_E_Object extends SpellObject {
    // Frozen where he stood. A chain already in the air does not follow its owner
    // around, and freezing it is also what makes the hit match the telegraph the
    // player aimed.
    position = this.owner.position.copy();
    heading = 0;
    lifeTime = SWING_LIFETIME;
    age = 0;
    visionRadius = HALF_LENGTH;

    /** Flayed already — the chain passes each body once. */
    _hit: AttackableUnit[] = [];
    /** World-space spots the chain connected, for the burst drawn there. */
    _marks: ChainMark[] = [];

    /**
     * Where the links are, on the box's own along-axis: `-HALF_LENGTH` behind him
     * to `+HALF_LENGTH` in front. Eased so the chain leaves fast and follows
     * through, and read by both the hit test and `draw()` — one number, so the
     * bright line on screen is the line that damages.
     */
    get frontAlong(): number {
      const t = Math.min(1, this.age / SWEEP_DURATION);
      return -HALF_LENGTH + HALF_LENGTH * 2 * Math.pow(t, 0.75);
    }

    /**
     * How far the ends of the chain trail the middle. Thresh holds the middle, so
     * it leads; the curve straightens as the swing follows through. Read by the
     * hit test and by the drawing, so there is one chain, not two.
     */
    get chainBow(): number {
      return 26 * (1 - Math.min(1, this.age / SWEEP_DURATION) * 0.4);
    }

    update() {
      this.age += deltaTime;
      // Only while the chain is crossing: once it is out the far side it is a
      // trail of wisps, and someone who walks in afterwards has missed it.
      if (this.age <= SWEEP_DURATION) this._flay();
      for (const mark of this._marks) mark.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    _flay() {
      const caught = enemiesInSweptBox(
        this.game,
        this.position,
        this.owner.teamId,
        this.heading,
        this.frontAlong,
        this._hit,
        this.chainBow
      );
      if (caught.length === 0) return;

      const along = createVector(Math.cos(this.heading), Math.sin(this.heading));

      for (const enemy of caught) {
        this._hit.push(enemy);
        enemy.takeDamage(DAMAGE, this.owner);
        const slow = new Slow(SLOW_DURATION, this.owner, enemy);
        slow.percent = SLOW_PERCENT;
        enemy.addBuff(slow);

        // A Dash rather than a position write: walls, cancellation and the
        // travel are all the displacement system's job (see Singed E).
        const shove = new Dash(1000, this.owner, enemy);
        shove.dashDestination = enemy.position.copy().add(along.copy().mult(SWEEP_DISTANCE));
        shove.dashSpeed = 16;
        shove.cancelable = false;
        shove.showTrail = false;
        enemy.addBuff(shove);

        this._marks.push({ x: enemy.position.x, y: enemy.position.y, age: 0 });
      }
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const swing = constrain(this.age / SWEEP_DURATION, 0, 1);
      const live = 1 - swing;
      const wipe = this.frontAlong;

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);

      // the box that is actually tested — the player should be able to learn it
      noFill();
      stroke(120, 255, 205, 110 * fade);
      strokeWeight(2);
      rect(-HALF_LENGTH, -HALF_WIDTH, HALF_LENGTH * 2, HALF_WIDTH * 2, 6);

      // the air the chain has already been through, still cold with it
      noStroke();
      fill(90, 220, 175, 26 * fade);
      rect(-HALF_LENGTH, -HALF_WIDTH, wipe + HALF_LENGTH, HALF_WIDTH * 2, 6);

      // Ghosts of the chain a few frames back, so the swing has a direction even
      // in a single frame of video.
      for (let i = 1; i <= 3; i++) {
        const lag = wipe - i * 24;
        if (lag < -HALF_LENGTH) continue;
        this._drawChain(lag, (60 - i * 15) * fade * (0.3 + live));
      }

      // The chain itself. It bows backwards at the ends because Thresh holds the
      // middle: a taut straight line reads as a laser, not a swung weapon.
      this._drawChain(wipe, 245 * fade);

      // The hook on the leading end, the part of Thresh everyone is watching for.
      push();
      translate(wipe, -HALF_WIDTH * 0.98);
      rotate(swing * 5);
      stroke(210, 255, 235, 245 * fade);
      strokeWeight(4);
      noFill();
      arc(0, 0, 26, 26, -HALF_PI, PI);
      line(0, -13, 14, -20);
      pop();

      // Where it is sending them, on the leading edge.
      noStroke();
      fill(200, 255, 235, 200 * fade * (0.4 + live));
      for (let i = -1; i <= 1; i++) {
        const y = i * HALF_WIDTH * 0.55;
        triangle(wipe + 8, y - 7, wipe + 8, y + 7, wipe + 26, y);
      }
      pop();

      // Souls torn loose where the chain connected, drawn in world space so they
      // stay on the body rather than riding the swing.
      push();
      for (const mark of this._marks) {
        const m = constrain(mark.age / MARK_LIFETIME, 0, 1);
        if (m >= 1) continue;
        const out = 1 - m;
        noFill();
        stroke(150, 255, 215, 235 * out);
        strokeWeight(4 * out + 1);
        circle(mark.x, mark.y, 20 + 40 * m);
        // wisps lifting off, the lantern's colour
        noStroke();
        fill(198, 255, 232, 220 * out);
        for (let i = 0; i < 4; i++) {
          const a = i * 1.9;
          circle(
            mark.x + cos(a) * (10 + 16 * m),
            mark.y + sin(a) * (10 + 16 * m) - 26 * m,
            7 * out + 2
          );
        }
      }
      pop();
    }

    /**
     * One pass of links across the box at `along`, bowed back at the ends.
     * Called several times a frame for the ghosts, so it takes its own alpha.
     */
    _drawChain(along: number, alpha: number) {
      const bow = this.chainBow;

      // spectral glow first, links on top of it
      noFill();
      stroke(90, 235, 180, alpha * 0.45);
      strokeWeight(11);
      beginShape();
      for (let k = 0; k <= 8; k++) {
        const p = k / 8;
        const across = -HALF_WIDTH + HALF_WIDTH * 2 * p;
        const lead = Math.pow(across / HALF_WIDTH, 2) * bow;
        vertex(along - lead, across);
      }
      endShape();

      // the links themselves: beads on the same curve, so it reads as chain
      noStroke();
      fill(214, 255, 238, alpha);
      for (let k = 0; k <= 12; k++) {
        const p = k / 12;
        const across = -HALF_WIDTH + HALF_WIDTH * 2 * p;
        const lead = Math.pow(across / HALF_WIDTH, 2) * bow;
        const link = k % 2 === 0 ? 7 : 5;
        ellipse(along - lead, across, link * 1.5, link);
      }
    }

    getDisplayBoundingBox() {
      const span = Math.hypot(HALF_LENGTH, HALF_WIDTH) + 40;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Thresh_E_Object;
}
const __cacheThresh_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_E_Object>>();
export function makeThresh_E_Object(api: ContentApi) {
  const cached = __cacheThresh_E_Object.get(api);
  if (cached) return cached;
  const built = __buildThresh_E_Object(api);
  __cacheThresh_E_Object.set(api, built);
  return built;
}