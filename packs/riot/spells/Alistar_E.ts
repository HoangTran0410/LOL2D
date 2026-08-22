import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Alistar_E = InstanceType<ReturnType<typeof makeAlistar_E>>;
type Alistar_E_Object = InstanceType<ReturnType<typeof makeAlistar_E_Object>>;



export const RADIUS = 150;

export const DURATION = 4000;

export const DAMAGE_PER_TICK = 4;

export const TICK_INTERVAL = 500;


function __buildAlistar_E(api: ContentApi) {
  const Spell = api.Spell;
  const Speedup = api.buffs.Speedup;
  const Alistar_E_Object = makeAlistar_E_Object(api);
  class Alistar_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_alistar_e');
    name = 'Giày Xéo (Alistar_E)';
    description =
      `Lồng lên trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+30% tốc chạy</span>` +
      ` và gây <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi` +
      ` <span class="time">${TICK_INTERVAL / 1000} giây</span> cho kẻ địch trong <span>${RADIUS}px</span>`;
    coolDown = 10000;
    manaCost = 30;

    onSpellCast() {
      const speed = new Speedup(DURATION, this.owner, this.owner);
      speed.stackId = 'alistar_e';
      speed.image = this.image;
      speed.percent = 0.3;
      this.owner.addBuff(speed);

      this.game.objectManager.addObject(new Alistar_E_Object(this.owner));
    }

    drawPreview() {
      super.drawPreview(RADIUS);
    }
  }
  return Alistar_E;
}
const __cacheAlistar_E = new WeakMap<ContentApi, ReturnType<typeof __buildAlistar_E>>();
export default function makeAlistar_E(api: ContentApi) {
  const cached = __cacheAlistar_E.get(api);
  if (cached) return cached;
  const built = __buildAlistar_E(api);
  __cacheAlistar_E.set(api, built);
  return built;
}


function __buildAlistar_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  class Alistar_E_Object extends SpellObject {
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = DURATION;
    age = 0;
    sinceTick = 0;

    update() {
      this.position = this.owner.position.copy();
      this.age += deltaTime;
      this.sinceTick += deltaTime;
      if (this.age >= this.lifeTime || this.owner.isDead) {
        this.toRemove = true;
        return;
      }
      if (this.sinceTick < TICK_INTERVAL) return;
      this.sinceTick -= TICK_INTERVAL;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => enemy.takeDamage(DAMAGE_PER_TICK, this.owner));
    }

    draw() {
      const stamp = Math.abs(Math.sin(this.age / 150));
      push();
      translate(this.owner.position.x, this.owner.position.y);

      // A broken ring, stamping in time with the hooves — an unbroken circle is
      // what Amumu's aura and every ground effect already draws.
      noFill();
      stroke(220, 180, 110, 90 + 90 * stamp);
      strokeWeight(4 + 3 * stamp);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TWO_PI - this.age / 700;
        arc(0, 0, this.radius * 2, this.radius * 2, a, a + 0.45);
      }

      // hoofprints scuffed into the dirt inside it
      noStroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI + this.age / 1100;
        const d = this.radius * 0.62;
        push();
        translate(cos(a) * d, sin(a) * d);
        rotate(a);
        fill(150, 120, 80, 120);
        ellipse(-3, -4, 9, 7);
        ellipse(-3, 4, 9, 7);
        pop();
      }
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
  return Alistar_E_Object;
}
const __cacheAlistar_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAlistar_E_Object>>();
export function makeAlistar_E_Object(api: ContentApi) {
  const cached = __cacheAlistar_E_Object.get(api);
  if (cached) return cached;
  const built = __buildAlistar_E_Object(api);
  __cacheAlistar_E_Object.set(api, built);
  return built;
}