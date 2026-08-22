import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Singed_Q = InstanceType<ReturnType<typeof makeSinged_Q>>;
type Singed_Q_Cloud = InstanceType<ReturnType<typeof makeSinged_Q_Cloud>>;
type Singed_Q_Trail = InstanceType<ReturnType<typeof makeSinged_Q_Trail>>;



export const DURATION = 6000;

export const CLOUD_RADIUS = 90;

export const CLOUD_LIFETIME = 1800;

export const DROP_INTERVAL = 220;

export const POISON_PER_TICK = 3;


function __buildSinged_Q(api: ContentApi) {
  const Spell = api.Spell;
  const Singed_Q_Trail = makeSinged_Q_Trail(api);
  class Singed_Q extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_singed_q');
    name = 'Phun Khói Độc (Singed_Q)';
    description =
      `Rải khí độc phía sau trong <span class="time">${DURATION / 1000} giây</span>. Kẻ địch đi qua vệt độc bị` +
      ` <span class="damage">nhiễm độc ${POISON_PER_TICK} sát thương</span> mỗi nhịp`;
    coolDown = 10000;
    manaCost = 30;

    onSpellCast() {
      this.game.objectManager.addObject(new Singed_Q_Trail(this.owner));
    }
  }
  return Singed_Q;
}
const __cacheSinged_Q = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_Q>>();
export default function makeSinged_Q(api: ContentApi) {
  const cached = __cacheSinged_Q.get(api);
  if (cached) return cached;
  const built = __buildSinged_Q(api);
  __cacheSinged_Q.set(api, built);
  return built;
}


/** The emitter, not the gas: it walks with Singed and drops clouds behind him. */
function __buildSinged_Q_Trail(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const Singed_Q_Cloud = makeSinged_Q_Cloud(api);
  class Singed_Q_Trail extends SpellObject {
    lifeTime = DURATION;
    age = 0;
    sinceDrop = DROP_INTERVAL;

    update() {
      this.position = this.owner.position.copy();
      this.age += deltaTime;
      this.sinceDrop += deltaTime;
      if (this.age >= this.lifeTime || this.owner.isDead) {
        this.toRemove = true;
        return;
      }
      if (this.sinceDrop < DROP_INTERVAL) return;
      this.sinceDrop = 0;

      const cloud = new Singed_Q_Cloud(this.owner);
      cloud.position = this.owner.position.copy();
      this.game.objectManager.addObject(cloud);
    }

    draw() {}

    getDisplayBoundingBox() {
      return new Rectangle({ x: this.position.x, y: this.position.y, w: 1, h: 1, data: this });
    }
  }
  return Singed_Q_Trail;
}
const __cacheSinged_Q_Trail = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_Q_Trail>>();
export function makeSinged_Q_Trail(api: ContentApi) {
  const cached = __cacheSinged_Q_Trail.get(api);
  if (cached) return cached;
  const built = __buildSinged_Q_Trail(api);
  __cacheSinged_Q_Trail.set(api, built);
  return built;
}


function __buildSinged_Q_Cloud(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const DamageOverTime = api.buffs.DamageOverTime;
  class Singed_Q_Cloud extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = CLOUD_RADIUS;
    visionRadius = CLOUD_RADIUS;
    lifeTime = CLOUD_LIFETIME;
    age = 0;
    sinceTick = 0;
    seed = Math.random() * 1000;

    update() {
      this.age += deltaTime;
      this.sinceTick += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      if (this.sinceTick < 400) return;
      this.sinceTick -= 400;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => {
        const poison = new DamageOverTime(1200, this.owner, enemy);
        poison.stackId = 'singed_q_poison';
        poison.name = 'Độc Dược';
        poison.damagePerTick = POISON_PER_TICK;
        poison.tickInterval = 400;
        poison.flameColor = [200, 140, 255];
        poison.emberColor = [70, 30, 120];
        enemy.addBuff(poison);
      });
    }

    draw() {
      const t = this.age / this.lifeTime;
      const fade = 1 - t;
      push();
      translate(this.position.x, this.position.y);
      noStroke();
      for (let i = 0; i < 4; i++) {
        const a = this.seed + i * 1.6 + this.age / 600;
        fill(160, 110, 210, 70 * fade);
        circle(cos(a) * 18, sin(a) * 18, this.radius * (1.1 + 0.2 * i * t));
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.radius * 2);
    }
  }
  return Singed_Q_Cloud;
}
const __cacheSinged_Q_Cloud = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_Q_Cloud>>();
export function makeSinged_Q_Cloud(api: ContentApi) {
  const cached = __cacheSinged_Q_Cloud.get(api);
  if (cached) return cached;
  const built = __buildSinged_Q_Cloud(api);
  __cacheSinged_Q_Cloud.set(api, built);
  return built;
}