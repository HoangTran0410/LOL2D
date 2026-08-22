import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Soraka_R = InstanceType<ReturnType<typeof makeSoraka_R>>;
type Soraka_R_Blessing = InstanceType<ReturnType<typeof makeSoraka_R_Blessing>>;



/**
 * Wish. The only map-crossing effect in Soraka's kit: everybody on her side is
 * healed wherever they are standing, and the ones who are nearly dead are healed
 * for half again as much.
 *
 * `teamId` resolves every champion and summon on Soraka's Blue/Red side. The
 * blessing is a `SpellObject` per recipient rather than caster VFX: an effect
 * landing on a body somewhere else on the map must not be drawn from
 * `Champion.draw()`, which is skipped whenever the caster is off camera.
 */
export const COOLDOWN_MS = 10_000;

export const MANA_COST = 60;

export const HEAL = 45;

/** Below this fraction of maximum health, the wish answers harder. */
export const LOW_HEALTH_RATIO = 0.4;

export const LOW_HEALTH_BONUS = 0.5;


function __buildSoraka_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Soraka_R_Blessing = makeSoraka_R_Blessing(api);
  class Soraka_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_soraka_r');
    name = 'Nguyện Ước (Soraka_R)';
    description = `Cầu xin các vì sao: hồi <span class="damage">${HEAL} máu</span> cho Soraka và toàn bộ đồng minh trên khắp bản đồ, tăng lên <span class="damage">${Math.round(HEAL * (1 + LOW_HEALTH_BONUS))} máu</span> với những ai đang dưới <span class="buff">${Math.round(LOW_HEALTH_RATIO * 100)}% máu tối đa</span>.`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    healAmount = HEAL;

    onSpellCast() {
      for (const ally of this.alliesOnTheMap()) {
        const max = ally.stats.maxHealth.value;
        const wounded = max > 0 && ally.stats.health.value < max * LOW_HEALTH_RATIO;
        const heal = wounded ? this.healAmount * (1 + LOW_HEALTH_BONUS) : this.healAmount;

        ally.takeHeal(heal, this.owner);

        const blessing = new Soraka_R_Blessing(this.owner, ally);
        blessing.wounded = wounded;
        this.game.objectManager.addObject(blessing);
      }
    }

    /**
     * Everyone on Soraka's side, anywhere. An allies-only query, so no vision gate:
     * `canSee` is a no-op for a friendly unit, and a wish is not an acquisition.
     */
    alliesOnTheMap(): AttackableUnit[] {
      const mapSize: number = this.game.mapSize;
      return this.game.objectManager.queryObjects({
        area: new Circle({ x: mapSize / 2, y: mapSize / 2, r: mapSize }),
        filters: [
          PredefinedFilters.type(AttackableUnit),
          PredefinedFilters.teamId(this.owner.teamId),
          PredefinedFilters.excludeDead,
        ],
      });
    }
  }
  return Soraka_R;
}
const __cacheSoraka_R = new WeakMap<ContentApi, ReturnType<typeof __buildSoraka_R>>();
export default function makeSoraka_R(api: ContentApi) {
  const cached = __cacheSoraka_R.get(api);
  if (cached) return cached;
  const built = __buildSoraka_R(api);
  __cacheSoraka_R.set(api, built);
  return built;
}


/** A shaft of starlight settling onto one healed ally. */
function __buildSoraka_R_Blessing(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Soraka_R_Blessing extends SpellObject {
    /** Light pooling on the ground around the ally's feet. */
    zIndex = GROUND_Z_INDEX;

    target: AttackableUnit;
    wounded = false;
    age = 0;
    lifeTime = 900;
    /** How far above the ally the shaft starts, so it visibly comes down. */
    fallHeight = 240;

    _sparks: { angle: number; radius: number; size: number; delay: number }[] = [];

    constructor(owner: AttackableUnit, target: AttackableUnit) {
      super(owner);
      this.target = target;
      this.position = target.position.copy();
    }

    onAdded() {
      for (let i = 0; i < 10; i++) {
        this._sparks.push({
          angle: random(TWO_PI),
          radius: random(18, 58),
          size: random(5, 12),
          delay: random(0, 0.35),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
      // the ally keeps walking; the blessing stays on them, not where they were
      this.position.set(this.target.position.x, this.target.position.y);
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // 1-(1-t)^2: the light arrives fast and lingers as it fades
      const arrive = 1 - (1 - constrain(t / 0.35, 0, 1)) * (1 - constrain(t / 0.35, 0, 1));
      const alpha = 255 * (1 - t) * (1 - t);
      const bodySize = this.target.animatedValues?.displaySize ?? 40;
      // the wounded get a warmer, heavier shaft: the bonus heal, made readable
      const tint: [number, number, number] = this.wounded ? [255, 220, 150] : [200, 225, 255];

      push();
      translate(this.position.x, this.position.y);

      // the shaft, descending
      noStroke();
      const top = -this.fallHeight * (1 - arrive);
      for (let i = 0; i < 3; i++) {
        const width = bodySize * (0.45 + i * 0.32);
        fill(tint[0], tint[1], tint[2], alpha * (0.16 - i * 0.04));
        quad(-width * 0.4, top, width * 0.4, top, width * 0.7, 0, -width * 0.7, 0);
      }

      // pool of light on the ground, the part that says "this one was healed"
      fill(tint[0], tint[1], tint[2], alpha * 0.3);
      ellipse(0, bodySize * 0.28, bodySize * 1.9 * arrive, bodySize * 0.8 * arrive);
      noFill();
      stroke(tint[0], tint[1], tint[2], alpha * 0.8);
      strokeWeight(3);
      ellipse(0, bodySize * 0.28, bodySize * 1.9 * arrive, bodySize * 0.8 * arrive);

      // motes rising off the ally
      noStroke();
      for (const spark of this._sparks) {
        const u = constrain((t - spark.delay) / (1 - spark.delay), 0, 1);
        if (u <= 0) continue;
        fill(255, 252, 235, alpha * (1 - u));
        circle(
          cos(spark.angle) * spark.radius,
          sin(spark.angle) * spark.radius * 0.5 - u * 46,
          spark.size * (1 - u * 0.6)
        );
      }

      // the star that grants it, gone in the first fifth of the life
      if (t < 0.2) {
        const flash = 1 - t / 0.2;
        stroke(255, 255, 245, 235 * flash);
        strokeWeight(3 * flash + 1);
        for (let i = 0; i < 4; i++) {
          const a = (PI * i) / 4 + PI / 8;
          const r = bodySize * (0.8 + flash * 0.9);
          line(cos(a) * -r, sin(a) * -r, cos(a) * r, sin(a) * r);
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      // the shaft starts well above the ally's head
      const r = this.fallHeight + 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Soraka_R_Blessing;
}
const __cacheSoraka_R_Blessing = new WeakMap<ContentApi, ReturnType<typeof __buildSoraka_R_Blessing>>();
export function makeSoraka_R_Blessing(api: ContentApi) {
  const cached = __cacheSoraka_R_Blessing.get(api);
  if (cached) return cached;
  const built = __buildSoraka_R_Blessing(api);
  __cacheSoraka_R_Blessing.set(api, built);
  return built;
}