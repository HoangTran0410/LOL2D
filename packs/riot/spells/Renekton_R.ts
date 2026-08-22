import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Renekton_R = InstanceType<ReturnType<typeof makeRenekton_R>>;
type Renekton_R_Object = InstanceType<ReturnType<typeof makeRenekton_R_Object>>;



export const DURATION_MS = 8_000;

export const BONUS_HEALTH = 45;

export const SIZE_BONUS = 0.2;

export const BONUS_ATTACK_RANGE = 25;

export const AURA_RADIUS = 175;

export const DAMAGE_PER_TICK = 3;

export const TICK_MS = 500;

/** 8s of standing in it, which nobody does — the ceiling, not the expectation. */
export const MAX_AURA_DAMAGE = (DURATION_MS / TICK_MS) * DAMAGE_PER_TICK;


/**
 * The buff every other Renekton ability asks about.
 *
 * Renekton's real resource is Fury, and this game has no second resource bar to
 * put it in. Rather than invent one, Reign of Anger is expressed as the thing it
 * actually gates: while Dominus is up, Q, W and E all use their empowered
 * numbers. One buff, one flag, and the empowered window is something the player
 * chose rather than something that accumulated off screen.
 */
export const RAGE_STACK_ID = 'renekton_r_rage';


/** Whether `unit` is in Reign of Anger right now. */
export function isEnraged(unit: AttackableUnit | null | undefined): boolean {
  if (!unit) return false;
  for (const buff of unit.buffs) {
    if (buff.stackId === RAGE_STACK_ID && !buff.toRemove) return true;
  }
  return false;
}


/**
 * Dominus: he swells, and everything near him cooks.
 *
 * The aura is a `SpellObject` rather than caster VFX because it reaches well
 * past his body — `Champion.draw` is skipped whenever the camera culls him, and
 * an aura painted from there would deal its damage invisibly.
 */
function __buildRenekton_R(api: ContentApi) {
  const Spell = api.Spell;
  const StatAmp = api.buffs.StatAmp;
  const Renekton_R_Object = makeRenekton_R_Object(api);
  class Renekton_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_renekton_r');
    name = 'Thần Cá Sấu (Renekton_R)';
    description =
      `Hóa thân trong <span class="time">${DURATION_MS / 1000} giây</span>:` +
      ` <span class="buff">+${BONUS_HEALTH} máu tối đa</span>, to lớn hơn ${SIZE_BONUS * 100}%,` +
      ` <span class="buff">+${BONUS_ATTACK_RANGE} tầm đánh</span>, và thiêu đốt kẻ địch trong <span>${AURA_RADIUS}px</span>` +
      ` <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi <span class="time">${TICK_MS / 1000} giây</span>.` +
      ` Trong lúc này Q, W và E đều được <span class="buff">Cuồng Nộ cường hóa</span>`;
    coolDown = 10_000;
    manaCost = 60;

    onSpellCast(): void {
      const rage = new StatAmp(DURATION_MS, this.owner, this.owner);
      rage.stackId = RAGE_STACK_ID;
      rage.image = this.image;
      rage.name = 'Cuồng Nộ';
      rage.bonuses = {
        maxHealth: { baseBonus: BONUS_HEALTH },
        size: { percentBaseBonus: SIZE_BONUS },
        attackRange: { baseBonus: BONUS_ATTACK_RANGE },
      };
      this.owner.addBuff(rage);

      // Granting the health is a heal, not a stat. `health` is a resource that
      // `takeDamage`/`takeHeal` move directly, so a modifier on it was never an
      // offset the way `maxHealth` is — and until Stats.update() stopped folding
      // its own read back into the base, `health: { baseBonus }` re-granted
      // itself every frame and made this ultimate literal immortality.
      //
      // After `addBuff`, so the larger maxHealth is already in place and the heal
      // is not clipped to the old ceiling.
      this.owner.takeHeal(BONUS_HEALTH, this.owner);

      const aura = new Renekton_R_Object(this.owner);
      // The aura is the buff's shadow: it ends when the transformation does,
      // wherever he happens to be standing by then.
      aura.attachTo(this.owner, rage);
      this.game.objectManager.addObject(aura);
    }

    drawPreview() {
      super.drawPreview(AURA_RADIUS);
    }
  }
  return Renekton_R;
}
const __cacheRenekton_R = new WeakMap<ContentApi, ReturnType<typeof __buildRenekton_R>>();
export default function makeRenekton_R(api: ContentApi) {
  const cached = __cacheRenekton_R.get(api);
  if (cached) return cached;
  const built = __buildRenekton_R(api);
  __cacheRenekton_R.set(api, built);
  return built;
}


/** Serrated plates riding the rim — a crocodile's back, not a storm. */
const TOOTH_COUNT = 18;


function __buildRenekton_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Renekton_R_Object extends SpellObject {
    radius = AURA_RADIUS;
    visionRadius = AURA_RADIUS;
    lifeTime = DURATION_MS;
    age = 0;
    sinceTick = 0;
    /** Counts up on each damage tick so the ring can beat with it. */
    ticks = 0;

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }

      this.sinceTick += deltaTime;
      if (this.sinceTick < TICK_MS) return;
      this.sinceTick -= TICK_MS;
      this.ticks++;

      // No vision filter, deliberately: this is an area effect, not a choice of
      // target. Someone standing in it inside a bush is still standing in it.
      const scorched = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
      for (const victim of scorched) victim.takeDamage(DAMAGE_PER_TICK, this.owner);
    }

    draw(): void {
      // grows into place over the first fifth of a second rather than popping in
      const open = constrain(this.age / 220, 0, 1);
      const swell = 1 - (1 - open) * (1 - open);
      // a beat on every damage tick, so the ticks are visible rather than implied
      const beat = Math.max(0, 1 - (this.sinceTick / TICK_MS) * 4);
      const crawl = this.age / 900;

      push();
      translate(this.owner.position.x, this.owner.position.y);

      // the ground he has claimed: dark, thick blood rather than fire
      noStroke();
      fill(120, 14, 20, (26 + 22 * beat) * swell);
      circle(0, 0, this.radius * 2 * swell);

      // hard rim on the real damage radius — the hitbox is never a guess
      noFill();
      stroke(230, 70, 50, (150 + 90 * beat) * swell);
      strokeWeight(3 + 3 * beat);
      circle(0, 0, this.radius * 2 * swell);

      // serrated scutes standing along the rim, crawling slowly round
      noStroke();
      for (let i = 0; i < TOOTH_COUNT; i++) {
        const a = crawl + (i / TOOTH_COUNT) * TWO_PI;
        const base = this.radius * swell;
        const height = (16 + 10 * sin(this.age / 300 + i)) * swell;
        fill(198, 60, 44, 220 * swell);
        const left = a - 0.06;
        const right = a + 0.06;
        beginShape();
        vertex(cos(left) * base, sin(left) * base);
        vertex(cos(a) * (base + height), sin(a) * (base + height));
        vertex(cos(right) * base, sin(right) * base);
        endShape(CLOSE);
      }

      // his own silhouette burning through, so the transformation reads on him
      // and not only on the floor
      noFill();
      stroke(255, 150, 90, 190 * swell);
      strokeWeight(4);
      const body = this.owner.stats.size.value * 0.75;
      circle(0, 0, body * 2 + 8 * beat);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius + 40;
      return new Rectangle({
        x: this.owner.position.x - r,
        y: this.owner.position.y - r,
        w: r * 2,
        h: r * 2,
        data: this,
      });
    }
  }
  return Renekton_R_Object;
}
const __cacheRenekton_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildRenekton_R_Object>>();
export function makeRenekton_R_Object(api: ContentApi) {
  const cached = __cacheRenekton_R_Object.get(api);
  if (cached) return cached;
  const built = __buildRenekton_R_Object(api);
  __cacheRenekton_R_Object.set(api, built);
  return built;
}