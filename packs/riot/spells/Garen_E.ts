import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Disarm = InstanceType<ContentApi['buffs']['Disarm']>;
type Phasing = InstanceType<ContentApi['buffs']['Phasing']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Garen_E = InstanceType<ReturnType<typeof makeGaren_E>>;
type Garen_E_Object = InstanceType<ReturnType<typeof makeGaren_E_Object>>;



export const RADIUS = 180;

export const DURATION = 3000;

export const HITS = 7;

export const DAMAGE_PER_HIT = 7;


/**
 * Judgment.
 *
 * `docs/abilities/garen/e.json`: he spins for 3 seconds, **cannot declare
 * basic attacks** while doing it, and strikes 7 times over the duration. The
 * self-disarm is not flavour — it is the cost that makes the spin a commitment
 * rather than free extra damage stapled onto his auto-attacks.
 */
function __buildGaren_E(api: ContentApi) {
  const Spell = api.Spell;
  const Disarm = api.buffs.Disarm;
  const Phasing = api.buffs.Phasing;
  const Garen_E_Object = makeGaren_E_Object(api);
  class Garen_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_garen_e');
    name = 'Phán Quyết (Garen_E)';
    description =
      `Xoay kiếm quanh mình <span class="time">${DURATION / 1000} giây</span>, chém` +
      ` <span>${HITS} lần</span> × <span class="damage">${DAMAGE_PER_HIT} sát thương</span> cho kẻ địch trong` +
      ` <span>${RADIUS}px</span>. Trong lúc xoay, Garen <span class="buff">đi xuyên qua kẻ địch</span> nhưng` +
      ` <span class="damage">không thể đánh thường</span>`;
    coolDown = 9000;
    manaCost = 30;

    onSpellCast() {
      // The cost, stated as the crowd control it is: Judgment disarms its own
      // caster for its whole duration.
      const spinLock = new Disarm(DURATION, this.owner, this.owner);
      spinLock.image = this.image;
      this.owner.addBuff(spinLock);

      // A man turning himself into a blender walks through a minion wave rather
      // than politely queueing behind it. Bodies only — three seconds of terrain
      // phasing would let him spin out of the map, which is why `Phasing` exists
      // separately from the `Ghosted` a dash uses.
      const phase = new Phasing(DURATION, this.owner, this.owner);
      phase.image = this.image;
      this.owner.addBuff(phase);

      this.game.objectManager.addObject(new Garen_E_Object(this.owner));
    }

    drawPreview() {
      super.drawPreview(RADIUS);
    }
  }
  return Garen_E;
}
const __cacheGaren_E = new WeakMap<ContentApi, ReturnType<typeof __buildGaren_E>>();
export default function makeGaren_E(api: ContentApi) {
  const cached = __cacheGaren_E.get(api);
  if (cached) return cached;
  const built = __buildGaren_E(api);
  __cacheGaren_E.set(api, built);
  return built;
}


function __buildGaren_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  class Garen_E_Object extends SpellObject {
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = DURATION;
    age = 0;
    hitsLanded = 0;

    get interval(): number {
      return DURATION / HITS;
    }

    update() {
      this.position = this.owner.position.copy();
      this.age += deltaTime;
      if (this.age >= this.lifeTime || this.owner.isDead) {
        this.toRemove = true;
        return;
      }

      // Driven off the count rather than an accumulator: 7 hits over 3 seconds
      // has to be 7 hits whatever the frame rate does.
      const due = Math.floor(this.age / this.interval);
      if (due <= this.hitsLanded) return;
      this.hitsLanded = Math.min(HITS, due);

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => enemy.takeDamage(DAMAGE_PER_HIT, this.owner));
    }

    /** One turn every 260ms. Fast enough to blur, slow enough to read as a sword. */
    get spin(): number {
      return (this.age / 260) * TWO_PI;
    }

    draw() {
      const spin = this.spin;
      // A beat of brightness on each of the seven strikes, so the damage ticks
      // are visible rather than implied.
      const sinceHit = (this.age % this.interval) / this.interval;
      const flash = Math.max(0, 1 - sinceHit * 4);

      push();
      translate(this.owner.position.x, this.owner.position.y);

      // the ground the spin covers
      noStroke();
      fill(200, 215, 255, 22 + 26 * flash);
      circle(0, 0, this.radius * 2);
      noFill();
      stroke(210, 225, 255, 70 + 80 * flash);
      strokeWeight(2);
      circle(0, 0, this.radius * 2);

      // Motion blur: wedges of the circle trailing the blade, each fainter and
      // further back. This is what was missing — three straight lines from the
      // centre read as a fan, not as one thing going round.
      noStroke();
      for (let i = 1; i <= 5; i++) {
        const trail = spin - i * 0.3;
        fill(225, 238, 255, 70 - i * 12);
        arc(0, 0, this.radius * 2, this.radius * 2, trail - 0.26, trail, PIE);
      }

      // the sword itself, held out at arm's length and swept round
      push();
      rotate(spin);
      // arm
      stroke(180, 150, 110, 200);
      strokeWeight(5);
      line(this.radius * 0.18, 0, this.radius * 0.42, 0);
      // blade — a long tapered quad, bright edge on the leading side
      noStroke();
      fill(235, 243, 255);
      quad(
        this.radius * 0.42,
        -7,
        this.radius * 0.99,
        -3,
        this.radius * 0.99,
        3,
        this.radius * 0.42,
        7
      );
      fill(255, 255, 255, 220);
      quad(
        this.radius * 0.42,
        -7,
        this.radius * 0.99,
        -3,
        this.radius * 0.99,
        -1,
        this.radius * 0.42,
        -3
      );
      // crossguard and pommel, so the near end reads as a hilt
      fill(215, 175, 90);
      rect(this.radius * 0.38, -11, 7, 22, 2);
      circle(this.radius * 0.2, 0, 10);
      pop();

      // the tip's path, a bright arc right on the rim
      noFill();
      stroke(255, 255, 255, 200);
      strokeWeight(3);
      arc(0, 0, this.radius * 1.98, this.radius * 1.98, spin - 0.5, spin);
      pop();
    }

    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.owner.position.x - this.radius,
        y: this.owner.position.y - this.radius,
        w: this.radius * 2,
        h: this.radius * 2,
        data: this,
      });
    }
  }
  return Garen_E_Object;
}
const __cacheGaren_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildGaren_E_Object>>();
export function makeGaren_E_Object(api: ContentApi) {
  const cached = __cacheGaren_E_Object.get(api);
  if (cached) return cached;
  const built = __buildGaren_E_Object(api);
  __cacheGaren_E_Object.set(api, built);
  return built;
}