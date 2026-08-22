import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Root = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type ChoGath_W = InstanceType<ReturnType<typeof makeChoGath_W>>;
type ChoGath_W_Object = InstanceType<ReturnType<typeof makeChoGath_W_Object>>;



function __buildChoGath_W(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const Spell = api.Spell;
  const Root = api.buffs.Root;
  const ChoGath_W_Object = makeChoGath_W_Object(api);
  class ChoGath_W extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_chogath_w');
    name = "Tiếng Gầm Hoang Dã (Cho'Gath_W)";
    description =
      'Gầm vào hướng đã chọn theo <span>hình nón</span>, <span class="buff">Làm Choáng</span> <span class="time">1 giây</span> và gây <span class="damage">15 sát thương</span> cho các kẻ địch trong tầm.';
    coolDown = 5000;
    manaCost = 25;

    onSpellCast() {
      const lifeTime = 1000;
      const stunTime = 1000;
      const angleRange = PI / 2.5;
      const angle = this.aimPoint.sub(this.owner.position).heading();

      const obj = new ChoGath_W_Object(this.owner);
      obj.speed = 10;
      obj.position = this.owner.position; // follow owner
      obj.angleStart = angle - angleRange / 2;
      obj.angleEnd = angle + angleRange / 2;
      obj.stunTime = stunTime;
      obj.lifeTime = lifeTime;
      this.game.objectManager.addObject(obj);

      const rootBuff = new Root(lifeTime, this.owner, this.owner);
      rootBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      rootBuff.image = this.image;
      this.owner.addBuff(rootBuff);
    }
  }
  return ChoGath_W;
}
const __cacheChoGath_W = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_W>>();
export default function makeChoGath_W(api: ContentApi) {
  const cached = __cacheChoGath_W.get(api);
  if (cached) return cached;
  const built = __buildChoGath_W(api);
  __cacheChoGath_W.set(api, built);
  return built;
}


function __buildChoGath_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const CollideUtils = api.utils.CollideUtils;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Stun = api.buffs.Stun;
  class ChoGath_W_Object extends SpellObject {
    position: p5.Vector = createVector();
    speed = 4;
    range = 190;
    currentRange = 0;
    angleStart = 0;
    angleEnd = 0;

    stunTime = 1000;
    lifeTime = 1000;
    age = 0;

    playersEffected: any[] = [];

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;

      this.currentRange = constrain(this.currentRange + this.speed, 0, this.range);

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.currentRange,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.playersEffected),
          (o: any) => {
            return CollideUtils.circleArc(
              o.position.x,
              o.position.y,
              o.stats.size.value / 2,
              this.position.x,
              this.position.y,
              this.currentRange,
              this.angleStart,
              this.angleEnd
            );
          },
        ],
      });

      enemies.forEach((enemy: any) => {
        const stunBuff = new Stun(this.stunTime, this.owner, enemy);
        enemy.addBuff(stunBuff);

        enemy.takeDamage(20, this.owner);
        this.playersEffected.push(enemy);
      });
    }

    draw() {
      push();

      const alpha =
        this.age < this.lifeTime / 3
          ? map(this.age, 0, this.lifeTime / 3, 0, 200)
          : map(this.age, this.lifeTime / 3, this.lifeTime, 200, 0);

      noStroke();
      fill(200, Math.min(30, alpha));
      arc(
        this.position.x,
        this.position.y,
        this.currentRange * 2,
        this.currentRange * 2,
        this.angleStart,
        this.angleEnd,
        PIE
      );

      // draw arc waves, animation based on age, 5 waves, move from center to edge
      const arcWaves = 5;
      noStroke();
      fill(200, Math.min(alpha, 60));
      for (let i = 0; i < arcWaves; i++) {
        const r = ((i * this.currentRange) / arcWaves + this.age / 5) % this.currentRange;
        arc(this.position.x, this.position.y, r * 2, r * 2, this.angleStart, this.angleEnd, PIE);
      }

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.currentRange * 2);
    }
  }
  return ChoGath_W_Object;
}
const __cacheChoGath_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_W_Object>>();
export function makeChoGath_W_Object(api: ContentApi) {
  const cached = __cacheChoGath_W_Object.get(api);
  if (cached) return cached;
  const built = __buildChoGath_W_Object(api);
  __cacheChoGath_W_Object.set(api, built);
  return built;
}