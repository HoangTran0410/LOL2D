import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Cassiopeia_Q = InstanceType<ReturnType<typeof makeCassiopeia_Q>>;
type Cassiopeia_Q_Object = InstanceType<ReturnType<typeof makeCassiopeia_Q_Object>>;



export const MAX_RANGE = 550;

export const RADIUS = 110;

export const IMPACT_DAMAGE = 16;

export const POISON_PER_TICK = 4;

export const POISON_DURATION = 2500;

export const DELAY_MS = 400;


/** Noxious Blast: a small, fast circle that poisons — and speeds Cassiopeia up when it lands. */
function __buildCassiopeia_Q(api: ContentApi) {
  const Spell = api.Spell;
  const Cassiopeia_Q_Object = makeCassiopeia_Q_Object(api);
  class Cassiopeia_Q extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_cassiopeia_q');
    name = 'Vụ Nổ Độc Hại (Cassiopeia_Q)';
    description =
      `Nổ một đám độc bán kính <span>${RADIUS}px</span> sau <span class="time">${DELAY_MS / 1000} giây</span>:` +
      ` <span class="damage">${IMPACT_DAMAGE} sát thương</span> và <span class="damage">nhiễm độc</span>` +
      ` trong <span class="time">${POISON_DURATION / 1000} giây</span>. Trúng mục tiêu thì Cassiopeia` +
      ` <span class="buff">+30% tốc chạy</span>`;
    coolDown = 5000;
    manaCost = 20;

    maxRange = MAX_RANGE;

    onSpellCast() {
      const aim = this.aimPoint;
      const spot = aim
        .copy()
        .sub(this.owner.position)
        .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
        .add(this.owner.position);

      const blast = new Cassiopeia_Q_Object(this.owner);
      blast.position = spot;
      this.game.objectManager.addObject(blast);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Cassiopeia_Q;
}
const __cacheCassiopeia_Q = new WeakMap<ContentApi, ReturnType<typeof __buildCassiopeia_Q>>();
export default function makeCassiopeia_Q(api: ContentApi) {
  const cached = __cacheCassiopeia_Q.get(api);
  if (cached) return cached;
  const built = __buildCassiopeia_Q(api);
  __cacheCassiopeia_Q.set(api, built);
  return built;
}


function __buildCassiopeia_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const DamageOverTime = api.buffs.DamageOverTime;
  const Speedup = api.buffs.Speedup;
  class Cassiopeia_Q_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = DELAY_MS + 250;
    age = 0;
    detonated = false;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      if (this.detonated || this.age < DELAY_MS) return;
      this.detonated = true;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        enemy.takeDamage(IMPACT_DAMAGE, this.owner);
        const poison = new DamageOverTime(POISON_DURATION, this.owner, enemy);
        poison.stackId = 'cassiopeia_poison';
        poison.name = 'Nọc Độc';
        poison.damagePerTick = POISON_PER_TICK;
        poison.tickInterval = 500;
        poison.flameColor = [170, 255, 130];
        poison.emberColor = [30, 100, 40];
        enemy.addBuff(poison);
      });

      if (enemies.length === 0) return;
      const haste = new Speedup(1500, this.owner, this.owner);
      haste.stackId = 'cassiopeia_q_haste';
      haste.percent = 0.3;
      this.owner.addBuff(haste);
    }

    draw() {
      const t = constrain(this.age / DELAY_MS, 0, 1);
      push();
      translate(this.position.x, this.position.y);
      if (!this.detonated) {
        noFill();
        stroke(150, 240, 120, 220);
        strokeWeight(2);
        circle(0, 0, this.radius * 2);
        noStroke();
        fill(120, 220, 90, 90 * t);
        circle(0, 0, this.radius * 2 * t);
        pop();
        return;
      }
      const after = 1 - (this.age - DELAY_MS) / 250;
      noStroke();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TWO_PI;
        fill(160, 255, 120, 200 * after);
        circle(cos(a) * this.radius * 0.6, sin(a) * this.radius * 0.6, 34 * after + 8);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.radius * 2);
    }
  }
  return Cassiopeia_Q_Object;
}
const __cacheCassiopeia_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildCassiopeia_Q_Object>>();
export function makeCassiopeia_Q_Object(api: ContentApi) {
  const cached = __cacheCassiopeia_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildCassiopeia_Q_Object(api);
  __cacheCassiopeia_Q_Object.set(api, built);
  return built;
}