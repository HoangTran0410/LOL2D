import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Amumu_E = InstanceType<ReturnType<typeof makeAmumu_E>>;
type Amumu_E_Object = InstanceType<ReturnType<typeof makeAmumu_E_Object>>;



export const RADIUS = 200;

export const DAMAGE = 20;

/** How long the grief wave and its tears stay on the ground. */
export const TANTRUM_MS = 520;

/** Tears flung out by the slam. Cosmetic only. */
export const TEAR_COUNT = 12;

/** Dirty linen, the same weave Amumu_Q throws — one champion, one material. */
export const LINEN: [number, number, number] = [235, 222, 172];


function __buildAmumu_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const Amumu_E_Object = makeAmumu_E_Object(api);
  class Amumu_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_amumu_e');
    name = 'Giận Dữ (Amumu_E)';
    description =
      `Đập xuống đất, gây <span class="damage">${DAMAGE} sát thương</span> cho mọi kẻ địch trong` +
      ` <span>${RADIUS}px</span> quanh mình`;
    coolDown = 6000;
    manaCost = 20;

    onSpellCast() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => enemy.takeDamage(DAMAGE, this.owner));

      // The grief half of the tantrum: a dark wave and the tears it throws. Its
      // own object, because it reaches 200 units past Amumu's body and outlives
      // the frame he is standing still in — painted from his `draw()` it would
      // vanish the instant he walked off camera.
      const grief = new Amumu_E_Object(this.owner);
      grief.position = this.owner.position.copy();
      grief.radius = RADIUS;
      this.game.objectManager.addObject(grief);

      // Bandages, which is Amumu and nobody else. He was sharing `shards` with
      // Fizz, Graves, Cassiopeia and Jinx — a mummy's tantrum has to throw linen,
      // and Amumu_Q already taught the player that this shape means him.
      const wrap = new AoePulse(this.owner);
      wrap.radius = RADIUS;
      wrap.color = LINEN;
      wrap.style = 'bandage';
      wrap.spokes = 14;
      wrap.lifeTime = 420;
      this.game.objectManager.addObject(wrap);
    }

    drawPreview() {
      super.drawPreview(RADIUS);
    }
  }
  return Amumu_E;
}
const __cacheAmumu_E = new WeakMap<ContentApi, ReturnType<typeof __buildAmumu_E>>();
export default function makeAmumu_E(api: ContentApi) {
  const cached = __cacheAmumu_E.get(api);
  if (cached) return cached;
  const built = __buildAmumu_E(api);
  __cacheAmumu_E.set(api, built);
  return built;
}


interface Tear {
  angle: number;
  /** Fraction of the radius this one reaches. */
  reach: number;
  size: number;
  /** Tears arc up off the slam and come back down, so each carries a hop. */
  hop: number;
}


/**
 * Tantrum, as the ground sees it: a dark wave of misery running out to the hit
 * radius, with tears thrown off the impact and landing in little rings.
 *
 * Everything is driven by `t = age / lifeTime` so retuning `TANTRUM_MS` retimes
 * the whole picture at once. The palette is deliberately cold and low — Amumu's
 * area damage is sadness, not fire, and the last thing this game needs is a
 * sixth orange circle.
 */
function __buildAmumu_E_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Amumu_E_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = RADIUS;
    lifeTime = TANTRUM_MS;
    age = 0;

    _tears: Tear[] = [];

    onAdded() {
      for (let i = 0; i < TEAR_COUNT; i++) {
        this._tears.push({
          angle: (TWO_PI * i) / TEAR_COUNT + random(-0.2, 0.2),
          reach: random(0.55, 1),
          size: random(7, 14),
          hop: random(12, 30),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // Eased out: the wave leaves fast and then slumps, which is the difference
      // between a tantrum and a steady pulse.
      const wave = 1 - Math.pow(1 - t, 2.2);
      const flash = 1 - constrain(t / 0.2, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // The misery pooling under him — dark, so the linen strips above it read.
      noStroke();
      fill(58, 40, 78, 95 * fade);
      circle(0, 0, this.radius * 2 * (0.35 + 0.65 * wave));

      // Hard rim exactly on the hit radius: whoever took damage was inside this,
      // and can see that they were.
      noFill();
      stroke(40, 28, 56, 210 * fade);
      strokeWeight(9 * fade + 2);
      circle(0, 0, this.radius * 2);
      stroke(180, 160, 210, 200 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, this.radius * 2);

      // The wave itself racing out to that rim.
      stroke(150, 130, 190, 230 * fade);
      strokeWeight(11 * fade + 2);
      circle(0, 0, this.radius * 2 * (0.15 + 0.85 * wave));

      // Tears: up on a parabola, then down into a small ring where each lands.
      for (const tear of this._tears) {
        const d = this.radius * wave * tear.reach;
        const lift = sin(constrain(t, 0, 1) * PI) * tear.hop;
        const x = cos(tear.angle) * d;
        const y = sin(tear.angle) * d;

        // the ring it will land in, drawn under it and only once it is falling
        if (t > 0.5) {
          const land = (t - 0.5) / 0.5;
          noFill();
          stroke(190, 215, 245, 170 * (1 - land));
          strokeWeight(2);
          circle(x, y, tear.size * 2 * land + 4);
        }

        noStroke();
        fill(205, 230, 255, 235 * fade);
        // teardrop, not a bead: a circle with a point pulled up towards the arc
        circle(x, y - lift, tear.size * (1 - t * 0.5));
        triangle(
          x - tear.size * 0.24,
          y - lift,
          x + tear.size * 0.24,
          y - lift,
          x,
          y - lift - tear.size * 0.8
        );
      }

      // The fists going in. A pair of low prints, gone almost immediately — this
      // marks the instant of the slam rather than sitting on top of the wave.
      if (flash > 0) {
        noStroke();
        fill(235, 225, 255, 210 * flash);
        ellipse(
          -this.radius * 0.09,
          this.radius * 0.03,
          this.radius * 0.2 * flash + 10,
          this.radius * 0.13 * flash + 8
        );
        ellipse(
          this.radius * 0.09,
          this.radius * 0.03,
          this.radius * 0.2 * flash + 10,
          this.radius * 0.13 * flash + 8
        );
        fill(255, 255, 255, 180 * flash);
        circle(0, 0, this.radius * 0.7 * flash + 16);
      }

      pop();
    }

    getDisplayBoundingBox() {
      // The tears hop above the rim, so the box is a little wider than the radius.
      const span = this.radius + 60;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Amumu_E_Object;
}
const __cacheAmumu_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAmumu_E_Object>>();
export function makeAmumu_E_Object(api: ContentApi) {
  const cached = __cacheAmumu_E_Object.get(api);
  if (cached) return cached;
  const built = __buildAmumu_E_Object(api);
  __cacheAmumu_E_Object.set(api, built);
  return built;
}