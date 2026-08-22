import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type ChoGath_Q = InstanceType<ReturnType<typeof makeChoGath_Q>>;
type ChoGath_Q_Object = InstanceType<ReturnType<typeof makeChoGath_Q_Object>>;



function __buildChoGath_Q(api: ContentApi) {
  const Spell = api.Spell;
  const ChoGath_Q_Object = makeChoGath_Q_Object(api);
  class ChoGath_Q extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_chogath_q');
    name = "Rạn Nứt (Cho'Gath_Q)";
    description =
      'Tạo một vụ địa chấn tại vùng đã chọn, gây <span class="damage">15 sát thương</span> và <span class="buff">Hất Tung</span> các kẻ địch trong <span class="time">1 giây</span> và <span class="buff">Làm Chậm 60%</span> chúng trong <span class="time">1.5 giây</span>';
    coolDown = 7000;
    manaCost = 30;

    maxRange = 400;

    onSpellCast() {
      const mouse = this.aimPoint;
      const position = mouse
        .copy()
        .sub(this.owner.position)
        .setMag(Math.min(this.maxRange, mouse.dist(this.owner.position)))
        .add(this.owner.position);

      const obj = new ChoGath_Q_Object(this.owner);
      obj.position = position;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return ChoGath_Q;
}
const __cacheChoGath_Q = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_Q>>();
export default function makeChoGath_Q(api: ContentApi) {
  const cached = __cacheChoGath_Q.get(api);
  if (cached) return cached;
  const built = __buildChoGath_Q(api);
  __cacheChoGath_Q.set(api, built);
  return built;
}


function __buildChoGath_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Airborne = api.buffs.Airborne;
  const Slow = api.buffs.Slow;
  class ChoGath_Q_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    size = 140;
    expandSize = 200;
    damage = 15;
    visionRadius = this.size;
    prepareTime = 700;
    lifeTime = 1100;
    age = 0;

    affected = false;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
      }

      if (this.age >= this.prepareTime) {
        if (!this.affected) {
          const enemies = this.game.objectManager.queryObjects({
            area: new Circle({
              x: this.position.x,
              y: this.position.y,
              r: this.size / 2,
            }),
            filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
          });

          enemies.forEach((enemy: any) => {
            const airborneBuff = new Airborne(1000, this.owner, enemy);
            enemy.addBuff(airborneBuff);

            const slowBuff = new Slow(1500, this.owner, enemy);
            slowBuff.percent = 0.6;
            enemy.addBuff(slowBuff);
            enemy.takeDamage(this.damage, this.owner);
          });

          this.affected = true;
        }

        this.size = Math.min(this.size + 3, this.expandSize);
      }
    }

    draw() {
      push();
      if (this.age < this.prepareTime) {
        // draw shaking circle
        const pos = this.position.copy().add(random(-5, 5), random(-5, 5));
        const alpha = map(this.age, 0, this.prepareTime, 0, 200);
        fill(200, 100, 80, alpha);
        stroke(200, 100, 80);
        circle(pos.x, pos.y, this.size);
      } else {
        // draw circle
        const alpha = map(this.age, this.prepareTime, this.lifeTime, 200, 50);
        fill(200, 100, 80, alpha);
        stroke(200, 100, 80, alpha + 50);
        circle(this.position.x, this.position.y, this.size);

        for (let i = 0; i < 3; i++) {
          const dir = p5.Vector.random2D();
          const pos = this.position.copy().add(dir.mult(random(0, this.size / 2)));
          const size = random(10, 30);
          stroke(150, alpha);
          circle(pos.x, pos.y, size);
        }
      }
      pop();
    }

    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.position.x - this.size / 2,
        y: this.position.y - this.size / 2,
        w: this.size,
        h: this.size,
        data: this,
      });
    }
  }
  return ChoGath_Q_Object;
}
const __cacheChoGath_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_Q_Object>>();
export function makeChoGath_Q_Object(api: ContentApi) {
  const cached = __cacheChoGath_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildChoGath_Q_Object(api);
  __cacheChoGath_Q_Object.set(api, built);
  return built;
}