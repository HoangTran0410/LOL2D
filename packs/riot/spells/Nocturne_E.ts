import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Fear = InstanceType<ContentApi['buffs']['Fear']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Nocturne_E = InstanceType<ReturnType<typeof makeNocturne_E>>;
type Nocturne_E_Object = InstanceType<ReturnType<typeof makeNocturne_E_Object>>;



export const RANGE = 150;

export const DAMAGE = 22;

export const CHANNEL_MS = 1500;

export const FEAR_DURATION = 1500;

/** Past this the tether snaps and nobody is feared. */
export const LEASH_RANGE = 500;


/**
 * Unspeakable Horror. The fear is not instant — a tether goes up and *then*
 * pays out, so the victim gets the whole channel to break the leash by running.
 */
function __buildNocturne_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Nocturne_E_Object = makeNocturne_E_Object(api);
  class Nocturne_E extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_nocturne_e');
    name = 'Nỗi Kinh Hoàng Tột Độ (Nocturne_E)';
    description =
      `Nối một sợi xích với kẻ địch gần nhất trong <span>${RANGE}px</span>, gây` +
      ` <span class="damage">${DAMAGE} sát thương</span>. Nếu sau <span class="time">${CHANNEL_MS / 1000} giây</span>` +
      ` xích chưa đứt (xa hơn <span>${LEASH_RANGE}px</span>), mục tiêu bị <span class="buff">Khiếp Sợ</span>` +
      ` trong <span class="time">${FEAR_DURATION / 1000} giây</span>`;
    coolDown = 10000;
    manaCost = 35;

    range = RANGE;

    checkCastCondition() {
      return !!this._findTarget();
    }

    onSpellCast() {
      const target = this._findTarget();
      if (!target) return;

      target.takeDamage(DAMAGE, this.owner);

      const tether = new Nocturne_E_Object(this.owner);
      tether.victim = target;
      this.game.objectManager.addObject(tether);
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
  return Nocturne_E;
}
const __cacheNocturne_E = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_E>>();
export default function makeNocturne_E(api: ContentApi) {
  const cached = __cacheNocturne_E.get(api);
  if (cached) return cached;
  const built = __buildNocturne_E(api);
  __cacheNocturne_E.set(api, built);
  return built;
}


function __buildNocturne_E_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const Fear = api.buffs.Fear;
  const AttackableUnit = api.units.AttackableUnit;
  class Nocturne_E_Object extends SpellObject {
    victim: AttackableUnit | null = null;
    age = 0;

    update() {
      this.age += deltaTime;
      const victim = this.victim as any;
      if (!victim || victim.isDead || this.owner.isDead) {
        this.toRemove = true;
        return;
      }
      // Snapped: walking out of the leash is the counterplay, so it must end the
      // tether without paying anything out.
      if (this.owner.position.dist(victim.position) > LEASH_RANGE) {
        this.toRemove = true;
        return;
      }
      if (this.age < CHANNEL_MS) return;

      this.toRemove = true;
      const fear = new Fear(FEAR_DURATION, this.owner, victim);
      fear.sourcePosition = this.owner.position.copy();
      victim.addBuff(fear);
    }

    draw() {
      const victim = this.victim as any;
      if (!victim) return;

      const t = constrain(this.age / CHANNEL_MS, 0, 1);
      const from = this.owner.position;
      const to = victim.position;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const span = Math.hypot(dx, dy) || 1;
      // unit normal, for offsetting the strands off the centre line
      const nx = -dy / span;
      const ny = dx / span;

      push();
      noFill();

      /**
       * A channel, drawn as one.
       *
       * It was a single violet polyline that appeared complete on frame one, so
       * the ability read as "a line exists" rather than as a fear being wound up
       * — and the one number the victim needs, *how long until this lands*, was
       * nowhere on screen. Three strands now braid tighter and brighten as the
       * channel fills, dread crawls up the tether toward the victim, and the
       * victim wears a closing ring that is literally the countdown.
       */
      const SEGMENTS = 22;
      for (let strand = -1; strand <= 1; strand++) {
        // the braid closes onto the centre line as the channel completes
        const spread = (1 - t) * 16 + 3;
        stroke(120 + 60 * t, 60 + 40 * t, 200 + 40 * t, 90 + 140 * t);
        strokeWeight(1.5 + 2.5 * t);
        beginShape();
        for (let i = 0; i <= SEGMENTS; i++) {
          const p = i / SEGMENTS;
          // pinned at both ends, widest in the middle
          const belly = Math.sin(p * PI);
          const twist = Math.sin(p * 7 - this.age / 90 + strand * 2.1);
          const off = belly * spread * (strand + twist * 0.45);
          const sag = belly * (1 - t) * 22;
          vertex(from.x + dx * p + nx * off, from.y + dy * p + ny * off + sag);
        }
        endShape();
      }

      // dread crawling from Nocturne to the victim: the direction says who is
      // doing this to whom
      noStroke();
      for (let i = 0; i < 3; i++) {
        const crawl = (this.age / 620 + i / 3) % 1;
        fill(210, 170, 255, 200 * (1 - crawl) * (0.4 + 0.6 * t));
        circle(from.x + dx * crawl, from.y + dy * crawl, 5 + 6 * t);
      }

      // the countdown, worn by the victim rather than by the caster — they are
      // the one who has to decide whether to break it
      const size = victim.animatedValues?.displaySize ?? 40;
      noFill();
      stroke(40, 16, 70, 150);
      strokeWeight(3);
      circle(to.x, to.y, size * 1.25);
      stroke(200, 150, 255, 235);
      strokeWeight(3);
      arc(to.x, to.y, size * 1.25, size * 1.25, -HALF_PI, -HALF_PI + TWO_PI * t);

      // and a hard flare on the last fifth, so the landing is not a surprise
      if (t > 0.8) {
        const bite = (t - 0.8) / 0.2;
        noStroke();
        fill(190, 130, 255, 120 * bite);
        circle(to.x, to.y, size * (1.3 + bite * 0.7));
      }
      pop();
    }

    getDisplayBoundingBox() {
      const victim = this.victim as any;
      const other = victim?.position ?? this.owner.position;
      return new Rectangle({
        x: Math.min(this.owner.position.x, other.x) - 40,
        y: Math.min(this.owner.position.y, other.y) - 40,
        w: Math.abs(this.owner.position.x - other.x) + 80,
        h: Math.abs(this.owner.position.y - other.y) + 80,
        data: this,
      });
    }
  }
  return Nocturne_E_Object;
}
const __cacheNocturne_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_E_Object>>();
export function makeNocturne_E_Object(api: ContentApi) {
  const cached = __cacheNocturne_E_Object.get(api);
  if (cached) return cached;
  const built = __buildNocturne_E_Object(api);
  __cacheNocturne_E_Object.set(api, built);
  return built;
}