import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Varus_E = InstanceType<ReturnType<typeof makeVarus_E>>;
type Varus_E_Object = InstanceType<ReturnType<typeof makeVarus_E_Object>>;



export const MAX_RANGE = 500;

export const RADIUS = 180;

export const IMPACT_DAMAGE = 24;

export const DURATION = 3000;

export const SLOW_PERCENT = 0.45;

export const FALL_TIME = 400;


/** Hail of Arrows: a volley that lands, then a patch of ground nobody wants to stand on. */
function __buildVarus_E(api: ContentApi) {
  const Spell = api.Spell;
  const Varus_E_Object = makeVarus_E_Object(api);
  class Varus_E extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_varus_e');
    name = 'Mưa Tên (Varus_E)';
    description =
      `Bắn một loạt tên xuống vị trí chỉ định: <span class="damage">${IMPACT_DAMAGE} sát thương</span> khi chạm đất,` +
      ` sau đó vùng đất bị <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span> trong` +
      ` <span class="time">${DURATION / 1000} giây</span>`;
    coolDown = 9000;
    manaCost = 30;

    maxRange = MAX_RANGE;

    onSpellCast() {
      const aim = this.aimPoint;
      const landing = aim
        .copy()
        .sub(this.owner.position)
        .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
        .add(this.owner.position);

      const volley = new Varus_E_Object(this.owner);
      volley.position = landing;
      this.game.objectManager.addObject(volley);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Varus_E;
}
const __cacheVarus_E = new WeakMap<ContentApi, ReturnType<typeof __buildVarus_E>>();
export default function makeVarus_E(api: ContentApi) {
  const cached = __cacheVarus_E.get(api);
  if (cached) return cached;
  const built = __buildVarus_E(api);
  __cacheVarus_E.set(api, built);
  return built;
}


function __buildVarus_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  class Varus_E_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = FALL_TIME + DURATION;
    age = 0;
    sinceTick = 0;
    landed = false;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      if (this.age < FALL_TIME) return;

      const enemies = () =>
        this.game.objectManager.queryObjects({
          area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });

      if (!this.landed) {
        this.landed = true;
        enemies().forEach((enemy: any) => enemy.takeDamage(IMPACT_DAMAGE, this.owner));
        return;
      }

      this.sinceTick += deltaTime;
      if (this.sinceTick < 400) return;
      this.sinceTick -= 400;
      enemies().forEach((enemy: any) => {
        const slow = new Slow(700, this.owner, enemy);
        slow.percent = SLOW_PERCENT;
        enemy.addBuff(slow);
      });
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);

      if (!this.landed) {
        // the volley in the air: shafts converging on the circle
        const t = this.age / FALL_TIME;
        noFill();
        stroke(200, 170, 255, 200);
        strokeWeight(3);
        circle(0, 0, this.radius * 2);
        stroke(220, 200, 255, 240);
        strokeWeight(2);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TWO_PI;
          const d = this.radius * (1 - t) * 1.6;
          line(cos(a) * (d + 40), sin(a) * (d + 40) - 90 * (1 - t), cos(a) * d, sin(a) * d);
        }
        pop();
        return;
      }

      // arrows standing in the ground, thinning as the patch expires
      const left = 1 - (this.age - FALL_TIME) / DURATION;
      noStroke();
      fill(120, 80, 170, 40 * left);
      circle(0, 0, this.radius * 2);
      stroke(210, 190, 255, 200 * left);
      strokeWeight(2);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TWO_PI + i;
        const d = this.radius * (0.25 + (0.7 * ((i * 7) % 10)) / 10);
        const x = cos(a) * d;
        const y = sin(a) * d;
        line(x, y, x + 4, y - 14);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.position.x - this.radius - 60,
        y: this.position.y - this.radius - 100,
        w: this.radius * 2 + 120,
        h: this.radius * 2 + 160,
        data: this,
      });
    }
  }
  return Varus_E_Object;
}
const __cacheVarus_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildVarus_E_Object>>();
export function makeVarus_E_Object(api: ContentApi) {
  const cached = __cacheVarus_E_Object.get(api);
  if (cached) return cached;
  const built = __buildVarus_E_Object(api);
  __cacheVarus_E_Object.set(api, built);
  return built;
}