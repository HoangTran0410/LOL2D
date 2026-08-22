import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Lux_E = InstanceType<ReturnType<typeof makeLux_E>>;
type Lux_E_Object = InstanceType<ReturnType<typeof makeLux_E_Object>>;



function __buildLux_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Lux_E_Object = makeLux_E_Object(api);
  class Lux_E extends Spell {
    targetingMode = 'POINT' as const;
    name = 'Quả Cầu Ánh Sáng (Lux_E)';
    image = api.asset('spell_lux_e');
    description =
      'Phóng ra 1 xoáy ánh sáng tới vị trí chỉ định, <span class="buff">Làm Chậm 50%</span> các kẻ địch đi vào. Tái kích hoạt hoặc sau <span class="time">5 giây</span> sẽ phát nổ, gây <span class="damage">20 sát thương</span> cho các kẻ địch trong vùng';
    coolDown = 5000;
    manaCost = 20;

    luxEObject: Lux_E_Object | null = null;

    onSpellCast() {
      if (!this.luxEObject) {
        const range = 400;
        const size = 200;

        const { from, to: destination } = VectorUtils.getVectorWithMaxRange(
          this.owner.position,
          this.aimPoint,
          range
        );

        this.luxEObject = new Lux_E_Object(this.owner, destination, size);
        this.game.objectManager.addObject(this.luxEObject);
      } else if (this.luxEObject.phase === Lux_E_Object.PHASES.STATIC) {
        this.luxEObject.phase = Lux_E_Object.PHASES.EXPLODE;
        this.luxEObject = null;
      }
    }

    onUpdate() {
      if (this.luxEObject?.phase === Lux_E_Object.PHASES.STATIC) {
        this.resetCoolDown();
      }

      if (this.luxEObject?.phase === Lux_E_Object.PHASES.EXPLODE || this.luxEObject?.toRemove) {
        this.luxEObject = null;
      }
    }
  }
  return Lux_E;
}
const __cacheLux_E = new WeakMap<ContentApi, ReturnType<typeof __buildLux_E>>();
export default function makeLux_E(api: ContentApi) {
  const cached = __cacheLux_E.get(api);
  if (cached) return cached;
  const built = __buildLux_E(api);
  __cacheLux_E.set(api, built);
  return built;
}


function __buildLux_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  class Lux_E_Object extends SpellObject {
    isMissile = true;

    static PHASES = {
      MOVE: 0,
      STATIC: 1,
      EXPLODE: 2,
    } as const;
    phase: (typeof Lux_E_Object.PHASES)[keyof typeof Lux_E_Object.PHASES] = Lux_E_Object.PHASES.MOVE;

    moveSpeed = 7;
    moveSize = 30;
    position = this.owner.position.copy();
    destination = this.owner.position.copy();

    lifeTimeWhenStatic = 5000;
    timeSinceStatic = 0;
    staticSize = 100;
    visionRadius = this.staticSize * 2;

    explodeSize = 100;
    explodeMaxSize = 200;
    explodeSpeed = 5;

    size = 0;
    takedDamage = false;
    originalDistance!: number;

    constructor(owner: any, destination: p5.Vector, size: number) {
      super(owner);
      this.destination = destination;
      this.staticSize = size;
      this.explodeSize = size;
      this.explodeMaxSize = size + 50;
    }

    update() {
      if (this.phase === Lux_E_Object.PHASES.MOVE) {
        VectorUtils.moveVectorToVector(this.position, this.destination, this.moveSpeed);

        const distance = this.destination.dist(this.position);
        if (distance < this.moveSpeed) {
          this.position = this.destination.copy();
          this.phase = Lux_E_Object.PHASES.STATIC;
        }

        if (!this.originalDistance) this.originalDistance = distance;

        this.size = lerp(this.size, this.moveSize, 0.1);
      } else if (this.phase === Lux_E_Object.PHASES.STATIC) {
        this.timeSinceStatic += deltaTime;

        this.size = lerp(this.size, this.staticSize, 0.3);

        const enemies = this._getEnemisInRange();
        enemies.forEach((enemy: any) => {
          const slowBuff = new Slow(200, this.owner, enemy);
          slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
          slowBuff.percent = 0.5;
          enemy.addBuff(slowBuff);
        });

        if (this.timeSinceStatic > this.lifeTimeWhenStatic) {
          this.phase = Lux_E_Object.PHASES.EXPLODE;
        }
      } else if (this.phase === Lux_E_Object.PHASES.EXPLODE) {
        if (!this.takedDamage) {
          this.takedDamage = true;

          const enemies = this._getEnemisInRange();
          enemies.forEach((enemy: any) => {
            enemy.takeDamage(20, this.owner);
          });
        }

        this.explodeSize += this.explodeSpeed;

        this.size = lerp(this.size, this.explodeSize, 0.1);

        if (this.explodeSize > this.explodeMaxSize) {
          this.toRemove = true;
        }
      }
    }

    _getEnemisInRange() {
      return this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.staticSize / 2,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
    }

    draw() {
      push();

      if (this.phase === Lux_E_Object.PHASES.MOVE) {
        stroke(255, 100);
        fill(255, 100);
        circle(this.position.x, this.position.y, this.size);

        stroke(255, 200);
        strokeWeight(3);
        for (let i = 0; i < 5; i++) {
          const angle = random(0, 2 * PI);
          const r = random(this.size);
          const x1 = this.position.x;
          const y1 = this.position.y;
          const x2 = this.position.x + r * cos(angle);
          const y2 = this.position.y + r * sin(angle);
          line(x1, y1, x2, y2);
        }
      } else if (this.phase === Lux_E_Object.PHASES.STATIC) {
        stroke(255, 100);
        fill(255, 100);
        circle(this.position.x, this.position.y, this.size);

        stroke(255, 200);
        strokeWeight(3);
        for (let i = 0; i < 10; i++) {
          const angle = random(0, 2 * PI);
          const r1 = random(this.staticSize / 2);
          const r2 = random(this.staticSize / 2);
          const x1 = this.position.x + r1 * cos(angle);
          const y1 = this.position.y + r1 * sin(angle);
          const x2 = this.position.x + r2 * cos(angle);
          const y2 = this.position.y + r2 * sin(angle);
          line(x1, y1, x2, y2);
        }
      } else if (this.phase === Lux_E_Object.PHASES.EXPLODE) {
        const opacity = map(this.explodeSize, this.staticSize, this.explodeMaxSize, 100, 0);
        stroke(255, opacity);
        fill(255, opacity);
        circle(this.position.x, this.position.y, this.size);
      }

      pop();
    }
  }
  return Lux_E_Object;
}
const __cacheLux_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildLux_E_Object>>();
export function makeLux_E_Object(api: ContentApi) {
  const cached = __cacheLux_E_Object.get(api);
  if (cached) return cached;
  const built = __buildLux_E_Object(api);
  __cacheLux_E_Object.set(api, built);
  return built;
}