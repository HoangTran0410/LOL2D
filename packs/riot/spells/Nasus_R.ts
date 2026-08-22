import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Nasus_R = InstanceType<ReturnType<typeof makeNasus_R>>;
type Nasus_R_Object = InstanceType<ReturnType<typeof makeNasus_R_Object>>;



export const DURATION = 8000;

export const AURA_RADIUS = 200;

export const DAMAGE_PER_TICK = 3;

export const TICK_INTERVAL = 500;

export const BONUS_HEALTH = 40;


function __buildNasus_R(api: ContentApi) {
  const Spell = api.Spell;
  const StatAmp = api.buffs.StatAmp;
  const Nasus_R_Object = makeNasus_R_Object(api);
  class Nasus_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_nasus_r');
    name = 'Cơn Thịnh Nộ Sa Mạc (Nasus_R)';
    description =
      `Hóa khổng lồ trong <span class="time">${DURATION / 1000} giây</span>:` +
      ` <span class="buff">+${BONUS_HEALTH} máu tối đa</span> và thiêu đốt mọi kẻ địch trong <span>${AURA_RADIUS}px</span>` +
      ` <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi <span class="time">${TICK_INTERVAL / 1000} giây</span>`;
    coolDown = 10000;
    manaCost = 60;

    onSpellCast() {
      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = 'nasus_r_fury';
      amp.image = this.image;
      amp.name = 'Cơn Thịnh Nộ Sa Mạc';
      amp.bonuses = {
        maxHealth: { baseBonus: BONUS_HEALTH },
        size: { percentBaseBonus: 0.35 },
      };
      this.owner.addBuff(amp);

      // Granting the health is a heal, not a stat. `health` is a resource that
      // `takeDamage`/`takeHeal` move directly, so a modifier on it was never an
      // offset the way `maxHealth` is — and until Stats.update() stopped folding
      // its own read back into the base, `health: { baseBonus }` re-granted
      // itself every frame and made this ultimate literal immortality.
      //
      // After `addBuff`, so the larger maxHealth is already in place and the heal
      // is not clipped to the old ceiling.
      this.owner.takeHeal(BONUS_HEALTH, this.owner);

      const aura = new Nasus_R_Object(this.owner);
      // The storm is the buff's shadow: it ends when the buff does, wherever
      // Nasus happens to be standing by then.
      aura.attachTo(this.owner, amp);
      this.game.objectManager.addObject(aura);
    }
  }
  return Nasus_R;
}
const __cacheNasus_R = new WeakMap<ContentApi, ReturnType<typeof __buildNasus_R>>();
export default function makeNasus_R(api: ContentApi) {
  const cached = __cacheNasus_R.get(api);
  if (cached) return cached;
  const built = __buildNasus_R(api);
  __cacheNasus_R.set(api, built);
  return built;
}


function __buildNasus_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Rectangle = api.utils.Quadtree.Rectangle;
  class Nasus_R_Object extends SpellObject {
    radius = AURA_RADIUS;
    visionRadius = AURA_RADIUS;
    lifeTime = DURATION;
    age = 0;
    sinceTick = 0;

    update() {
      this.position = this.owner.position.copy();
      this.age += deltaTime;
      this.sinceTick += deltaTime;
      if (this.age >= this.lifeTime) {
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
      const spin = this.age / 420;
      push();
      translate(this.owner.position.x, this.owner.position.y);

      // A sandstorm reads as sweeping arcs, not as a ring of beads — the ring
      // is what every other aura in the game already is.
      noFill();
      for (let i = 0; i < 3; i++) {
        const a = spin + (i / 3) * TWO_PI;
        stroke(255, 190 - i * 20, 80, 170);
        strokeWeight(11 - i * 2.5);
        arc(0, 0, this.radius * (1.9 - i * 0.28), this.radius * (1.9 - i * 0.28), a, a + 1.5);
      }

      // heat haze pooling at his feet
      noStroke();
      fill(255, 150, 50, 30 + 12 * Math.sin(this.age / 200));
      circle(0, 0, this.radius * 1.1);
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
  return Nasus_R_Object;
}
const __cacheNasus_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildNasus_R_Object>>();
export function makeNasus_R_Object(api: ContentApi) {
  const cached = __cacheNasus_R_Object.get(api);
  if (cached) return cached;
  const built = __buildNasus_R_Object(api);
  __cacheNasus_R_Object.set(api, built);
  return built;
}