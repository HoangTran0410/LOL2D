import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Ignite = InstanceType<ReturnType<typeof makeIgnite>>;
type Ignite_Bolt = InstanceType<ReturnType<typeof makeIgnite_Bolt>>;



function __buildIgnite(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const DamageOverTime = api.buffs.DamageOverTime;
  const Ignite_Bolt = makeIgnite_Bolt(api);
  class Ignite extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_ignite');
    name = 'Thiêu Đốt (Ignite)';
    description =
      'Thiêu đốt kẻ địch gần nhất trong phạm vi <span>350px</span>, gây <span class="damage">6 sát thương</span> mỗi <span class="time">0.5 giây</span> trong <span class="time">5 giây</span> (tổng <span class="damage">60 sát thương</span>)';
    coolDown = 6000;

    range = 350;
    duration = 5000;
    damagePerTick = 6;
    tickInterval = 500;

    checkCastCondition() {
      return !!this._findNearestEnemy();
    }

    onSpellCast() {
      const target = this._findNearestEnemy();
      if (!target) return;

      const burn = new DamageOverTime(this.duration, this.owner, target);
      burn.stackId = 'ignite_burn';
      burn.image = this.image;
      burn.damagePerTick = this.damagePerTick;
      burn.tickInterval = this.tickInterval;
      target.addBuff(burn);

      // the burn itself is well telegraphed, but nothing showed WHO cast it or on
      // whom — a bolt from the caster to the victim answers both
      const bolt = new Ignite_Bolt(this.owner);
      bolt.target = target;
      bolt.range = this.range;
      this.game.objectManager.addObject(bolt);
    }

    _findNearestEnemy() {
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
  return Ignite;
}
const __cacheIgnite = new WeakMap<ContentApi, ReturnType<typeof __buildIgnite>>();
export default function makeIgnite(api: ContentApi) {
  const cached = __cacheIgnite.get(api);
  if (cached) return cached;
  const built = __buildIgnite(api);
  __cacheIgnite.set(api, built);
  return built;
}


/** The ember thrown from the caster onto the target when Ignite goes off. */
function __buildIgnite_Bolt(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Ignite_Bolt extends SpellObject {
    target: any = null;
    range = 350;
    age = 0;
    travelTime = 260;
    lifeTime = 700;

    _embers: { x: number; y: number; age: number; size: number; vx: number; vy: number }[] = [];

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime || !this.target) {
        if (this._embers.length === 0) this.toRemove = true;
      }

      const t = constrain(this.age / this.travelTime, 0, 1);
      if (t < 1 && this.target) {
        const x = lerp(this.owner.position.x, this.target.position.x, t);
        const y = lerp(this.owner.position.y, this.target.position.y, t);
        this.position.set(x, y);
        if (this._embers.length < 22) {
          this._embers.push({
            x: x + random(-4, 4),
            y: y + random(-4, 4),
            age: 0,
            size: random(5, 11),
            vx: random(-0.3, 0.3),
            vy: random(-0.8, -0.2),
          });
        }
      }

      let i = 0;
      while (i < this._embers.length) {
        const e = this._embers[i];
        e.age += deltaTime;
        e.x += e.vx;
        e.y += e.vy;
        if (e.age >= 420) this._embers.splice(i, 1);
        else i++;
      }
    }

    draw() {
      const t = constrain(this.age / this.travelTime, 0, 1);
      const life = constrain(this.age / this.lifeTime, 0, 1);

      push();

      // the trail of embers left along the way
      blendMode(ADD);
      noStroke();
      for (const e of this._embers) {
        const et = e.age / 420;
        fill(255, 150 - 90 * et, 40, 170 * (1 - et));
        circle(e.x, e.y, e.size * (1 - et * 0.5));
      }
      blendMode(BLEND);

      // the ember in flight
      if (t < 1) {
        blendMode(ADD);
        noStroke();
        fill(255, 190, 90, 150);
        circle(this.position.x, this.position.y, 26);
        fill(255, 245, 200, 220);
        circle(this.position.x, this.position.y, 11);
        blendMode(BLEND);
      } else if (this.target) {
        // scorch ring settling on the victim, right where the fire starts
        const b = constrain((this.age - this.travelTime) / 260, 0, 1);
        const size = this.target.animatedValues?.displaySize ?? 50;
        noFill();
        stroke(255, 150, 50, 220 * (1 - b));
        strokeWeight(5 * (1 - b) + 1);
        circle(this.target.position.x, this.target.position.y, size * 0.6 + 70 * b);
      }

      // the caster's own hand flaring, so the source of the burn is never a mystery
      if (life < 0.35) {
        const f = 1 - life / 0.35;
        blendMode(ADD);
        noStroke();
        fill(255, 160, 60, 120 * f);
        circle(this.owner.position.x, this.owner.position.y, 40 + 30 * (1 - f));
        blendMode(BLEND);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const tx = this.target ? this.target.position.x : this.position.x;
      const ty = this.target ? this.target.position.y : this.position.y;
      const pad = 80;
      return new Rectangle({
        x: Math.min(this.owner.position.x, tx) - pad,
        y: Math.min(this.owner.position.y, ty) - pad,
        w: Math.abs(this.owner.position.x - tx) + pad * 2,
        h: Math.abs(this.owner.position.y - ty) + pad * 2,
        data: this,
      });
    }
  }
  return Ignite_Bolt;
}
const __cacheIgnite_Bolt = new WeakMap<ContentApi, ReturnType<typeof __buildIgnite_Bolt>>();
export function makeIgnite_Bolt(api: ContentApi) {
  const cached = __cacheIgnite_Bolt.get(api);
  if (cached) return cached;
  const built = __buildIgnite_Bolt(api);
  __cacheIgnite_Bolt.set(api, built);
  return built;
}