import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Fizz_Q = InstanceType<ReturnType<typeof makeFizz_Q>>;
type Fizz_Q_Slash = InstanceType<ReturnType<typeof makeFizz_Q_Slash>>;



export const RANGE = 380;

export const DAMAGE = 22;

export const DASH_SPEED = 24;

/** How far past the victim he ends up — the dash goes *through*, not up to. */
export const OVERSHOOT = 60;

/** Radius of the water thrown up where the trident goes in. */
export const SPLASH_RADIUS = 60;

/** How long the trident slash hangs after the pass. */
export const SLASH_MS = 340;

/** Fizz's water, reused by every piece of this ability so they read as one hit. */
export const WATER: [number, number, number] = [150, 220, 255];


/** Urchin Strike: a dash that goes through the target and out the other side. */
function __buildFizz_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const Dash = api.buffs.Dash;
  const Fizz_Q_Slash = makeFizz_Q_Slash(api);
  class Fizz_Q extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_fizz_q');
    name = 'Đâm Lao (Fizz_Q)';
    description =
      `Lướt xuyên qua kẻ địch gần nhất trong <span>${RANGE}px</span>, gây` +
      ` <span class="damage">${DAMAGE} sát thương</span> và dừng lại phía sau lưng chúng`;
    coolDown = 6000;
    manaCost = 25;

    range = RANGE;

    checkCastCondition() {
      return !!this._findTarget() && Dash.CanDash(this.owner);
    }

    onSpellCast() {
      const target = this._findTarget();
      if (!target) return;

      const through = target.position.copy().sub(this.owner.position);
      if (through.magSq() === 0) through.set(1, 0);
      const landing = target.position.copy().add(through.copy().setMag(OVERSHOOT));

      const dash = new Dash(1200, this.owner, this.owner);
      dash.image = this.image;
      dash.dashDestination = landing;
      dash.dashSpeed = DASH_SPEED;
      dash.showTrail = true;
      this.owner.addBuff(dash);

      target.takeDamage(DAMAGE, this.owner);

      // The trident goes in before the water comes up: a directional slash drawn
      // along the line of the dash, so the pass reads as *through* the victim
      // rather than as a burst that happened to be near them. It is a SpellObject
      // and not `castSpec.vfx` because it outlives the frame Fizz spends on top of
      // the target — a champion-drawn effect would be culled the moment he moves
      // off screen while the slash is still on the victim's body.
      const slash = new Fizz_Q_Slash(this.owner);
      slash.position = target.position.copy();
      slash.angle = Math.atan2(through.y, through.x);
      this.game.objectManager.addObject(slash);

      const spray = new AoePulse(this.owner);
      spray.position = target.position.copy();
      spray.radius = SPLASH_RADIUS;
      spray.lifeTime = 320;
      spray.color = WATER;
      // Water thrown up and falling back, not stone splinters. Fizz's whole kit is
      // wet — the shape has to be the one that arcs.
      spray.style = 'splash';
      spray.spokes = 7;
      this.game.objectManager.addObject(spray);
    }

    _findTarget() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      });
      let nearest = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = this.owner.position.dist(enemy.position);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = enemy;
        }
      }
      return nearest;
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Fizz_Q;
}
const __cacheFizz_Q = new WeakMap<ContentApi, ReturnType<typeof __buildFizz_Q>>();
export default function makeFizz_Q(api: ContentApi) {
  const cached = __cacheFizz_Q.get(api);
  if (cached) return cached;
  const built = __buildFizz_Q(api);
  __cacheFizz_Q.set(api, built);
  return built;
}


/** How far the three prong streaks run past the body. */
export const SLASH_REACH = 78;


/**
 * The trident going through: three prong wounds opening along the dash line,
 * a leading crescent of displaced water, and the white flash of the puncture.
 *
 * Every value hangs off `t = age / lifeTime`, so slowing the ability down slows
 * the picture instead of desynchronising it, and the geometry is *directional*
 * — a symmetric burst here would have said "an explosion happened at your feet"
 * when what happened is that something ran you through from a specific side.
 */
function __buildFizz_Q_Slash(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Fizz_Q_Slash extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    /** Direction of the pass, radians. Set by the spell. */
    angle = 0;
    lifeTime = SLASH_MS;
    age = 0;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // Eased out: the prongs cover most of their travel in the first third, which
      // is what a stab looks like — fast in, then the water catches up.
      const drive = 1 - Math.pow(1 - t, 3);
      const flash = 1 - constrain(t / 0.25, 0, 1);

      push();
      translate(this.position.x, this.position.y);
      rotate(this.angle);

      // Three prong streaks, spaced like the trident head, tapering as they go.
      strokeCap(ROUND);
      for (let i = -1; i <= 1; i++) {
        const offset = i * 13;
        const head = SLASH_REACH * drive;
        const tail = -SLASH_REACH * 0.45 * drive;
        stroke(35, 110, 150, 190 * fade);
        strokeWeight(9 * fade + 2);
        line(tail, offset * 0.6, head, offset);
        stroke(225, 250, 255, 245 * fade);
        strokeWeight(3.5 * fade + 1);
        line(tail, offset * 0.6, head, offset);
      }

      // The crescent of water shoved ahead of the prongs. Drawn as an arc rather
      // than a ring: only the leading edge is displaced by a thrust.
      noFill();
      stroke(WATER[0], WATER[1], WATER[2], 220 * fade);
      strokeWeight(7 * fade + 1.5);
      const bow = SLASH_REACH * (0.5 + 0.9 * drive);
      arc(0, 0, bow * 2, bow * 1.5, -0.85, 0.85);
      stroke(255, 255, 255, 170 * fade);
      strokeWeight(2.5 * fade + 1);
      arc(0, 0, bow * 1.8, bow * 1.35, -0.7, 0.7);

      // Droplets flung sideways off the blade edge, not forward — the water the
      // prongs pushed out of the way has nowhere to go but across the line.
      noStroke();
      for (let i = 0; i < 8; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const along = SLASH_REACH * drive * (0.15 + 0.75 * ((i * 3) % 5) * 0.25);
        const out = (18 + 26 * drive) * side * (0.5 + 0.5 * Math.sin(i * 2.1));
        fill(235, 252, 255, 210 * fade);
        circle(along, out, 8 * fade + 2);
      }

      // The puncture itself: gone in a quarter of the life, which is the whole
      // point of a flash — it marks the instant, it does not linger over it.
      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 230 * flash);
        circle(0, 0, 34 * flash + 10);
      }

      pop();
    }

    getDisplayBoundingBox() {
      // The prongs and the flung droplets both overshoot the body by SLASH_REACH.
      const span = SLASH_REACH * 2;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Fizz_Q_Slash;
}
const __cacheFizz_Q_Slash = new WeakMap<ContentApi, ReturnType<typeof __buildFizz_Q_Slash>>();
export function makeFizz_Q_Slash(api: ContentApi) {
  const cached = __cacheFizz_Q_Slash.get(api);
  if (cached) return cached;
  const built = __buildFizz_Q_Slash(api);
  __cacheFizz_Q_Slash.set(api, built);
  return built;
}