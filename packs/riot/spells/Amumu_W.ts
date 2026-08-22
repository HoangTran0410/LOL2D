import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Amumu_W = InstanceType<ReturnType<typeof makeAmumu_W>>;
type Amumu_W_Object = InstanceType<ReturnType<typeof makeAmumu_W_Object>>;



export const RADIUS = 170;

export const DURATION = 5000;

export const DAMAGE_PER_TICK = 4;

export const TICK_INTERVAL = 500;


function __buildAmumu_W(api: ContentApi) {
  const Spell = api.Spell;
  const Amumu_W_Object = makeAmumu_W_Object(api);
  class Amumu_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_amumu_w');
    name = 'Tuyệt Vọng (Amumu_W)';
    description =
      `Tỏa ra nỗi buồn trong <span class="time">${DURATION / 1000} giây</span>, gây` +
      ` <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi <span class="time">${TICK_INTERVAL / 1000} giây</span>` +
      ` cho mọi kẻ địch trong <span>${RADIUS}px</span>`;
    coolDown = 10000;
    manaCost = 25;

    onSpellCast() {
      this.game.objectManager.addObject(new Amumu_W_Object(this.owner));
    }
  }
  return Amumu_W;
}
const __cacheAmumu_W = new WeakMap<ContentApi, ReturnType<typeof __buildAmumu_W>>();
export default function makeAmumu_W(api: ContentApi) {
  const cached = __cacheAmumu_W.get(api);
  if (cached) return cached;
  const built = __buildAmumu_W(api);
  __cacheAmumu_W.set(api, built);
  return built;
}


function __buildAmumu_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  class Amumu_W_Object extends SpellObject {
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = DURATION;
    age = 0;
    sinceTick = 0;
    seed = Math.random() * Math.PI * 2;

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
      push();
      translate(this.owner.position.x, this.owner.position.y);

      // A wavering blob rather than a circle: grief has no hard edge, and the
      // wobble is what tells it apart from the disciplined rings around it.
      noStroke();
      fill(90, 60, 140, 50);
      beginShape();
      for (let i = 0; i <= 28; i++) {
        const a = (i / 28) * TWO_PI;
        const wobble =
          1 + 0.08 * Math.sin(a * 3 + this.age / 260) + 0.05 * Math.sin(a * 5 - this.age / 190);
        vertex(cos(a) * this.radius * wobble, sin(a) * this.radius * wobble);
      }
      endShape(CLOSE);

      // tears falling all the way through it, each on its own clock
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TWO_PI + this.seed;
        const d = this.radius * (0.25 + (0.5 * ((i * 37) % 10)) / 10);
        const drop = ((this.age / 5 + i * 47) % (this.radius * 1.2)) - this.radius * 0.6;
        fill(170, 200, 255, 200);
        ellipse(cos(a) * d, sin(a) * d + drop, 5, 10);
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
  return Amumu_W_Object;
}
const __cacheAmumu_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAmumu_W_Object>>();
export function makeAmumu_W_Object(api: ContentApi) {
  const cached = __cacheAmumu_W_Object.get(api);
  if (cached) return cached;
  const built = __buildAmumu_W_Object(api);
  __cacheAmumu_W_Object.set(api, built);
  return built;
}