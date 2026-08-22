import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Soraka_Q = InstanceType<ReturnType<typeof makeSoraka_Q>>;
type Soraka_Q_Object = InstanceType<ReturnType<typeof makeSoraka_Q_Object>>;



/**
 * Starcall. A star is called down onto a patch of ground; it takes a beat to
 * fall, so the ring on the floor is the telegraph and the impact is the payoff.
 *
 * Landing it on anyone gives Soraka *Rejuvenation* — the small self-heal and
 * burst of speed that, in the real kit, is what makes Astral Infusion sustainable.
 * This file owns that buff's identity because Q is where it comes from; W reads
 * it back through `hasRejuvenation` to discount its own health cost.
 */
// Exported so tests assert the wiring rather than a copy of the numbers.
export const COOLDOWN_MS = 6_000;

export const MANA_COST = 25;

export const CAST_RANGE = 430;

export const BLAST_RADIUS = 95;

export const DAMAGE = 24;

export const SLOW_PERCENT = 0.3;

export const SLOW_DURATION_MS = 1_500;

/** How long the star spends falling — the whole window to walk out of the ring. */
export const FALL_TIME_MS = 450;


export const REJUVENATION_STACK_ID = 'soraka_rejuvenation';

export const REJUVENATION_DURATION_MS = 2_500;

export const REJUVENATION_HEAL = 12;

export const REJUVENATION_SPEED_PERCENT = 0.25;


/** Whether star dust is still on this unit — read by Astral Infusion. */
export const hasRejuvenation = (unit: AttackableUnit): boolean =>
  unit.buffs.some(buff => buff.stackId === REJUVENATION_STACK_ID && !buff.toRemove);


/**
 * Star dust: a one-off heal plus decaying haste. Its own `stackId` because a
 * bare `Speedup` from anywhere else must not share the slot.
 */
function __buildgrantRejuvenation(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const AttackableUnit = api.units.AttackableUnit;
  const Speedup = api.buffs.Speedup;
  const grantRejuvenation = (source: AttackableUnit, target: AttackableUnit): void => {
    target.takeHeal(REJUVENATION_HEAL, source);

    const haste = new Speedup(REJUVENATION_DURATION_MS, source, target);
    haste.stackId = REJUVENATION_STACK_ID;
    haste.name = 'Hồi Phục Tinh Tú';
    haste.buffAddType = BuffAddType.RENEW_EXISTING;
    haste.percent = REJUVENATION_SPEED_PERCENT;
    target.addBuff(haste);
  };
  return grantRejuvenation;
}
const __cachegrantRejuvenation = new WeakMap<ContentApi, ReturnType<typeof __buildgrantRejuvenation>>();
export function makeGrantRejuvenation(api: ContentApi) {
  const cached = __cachegrantRejuvenation.get(api);
  if (cached) return cached;
  const built = __buildgrantRejuvenation(api);
  __cachegrantRejuvenation.set(api, built);
  return built;
}


function __buildSoraka_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Soraka_Q_Object = makeSoraka_Q_Object(api);
  class Soraka_Q extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_soraka_q');
    name = 'Vẫn Tinh (Soraka_Q)';
    description = `Gọi một vì sao rơi xuống vị trí chỉ định sau <span class="time">${FALL_TIME_MS / 1000} giây</span>, gây <span class="damage">${DAMAGE} sát thương</span> và <span class="buff">Làm Chậm ${Math.round(SLOW_PERCENT * 100)}%</span> trong <span class="time">${SLOW_DURATION_MS / 1000} giây</span>. Nếu trúng ít nhất một kẻ địch, bụi sao trở về với Soraka: <span class="buff">hồi ${REJUVENATION_HEAL} máu</span> và <span class="buff">+${Math.round(REJUVENATION_SPEED_PERCENT * 100)}% tốc chạy</span> trong <span class="time">${REJUVENATION_DURATION_MS / 1000} giây</span>.`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    castRange = CAST_RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.castRange
      );

      const star = new Soraka_Q_Object(this.owner);
      star.position = to;
      this.game.objectManager.addObject(star);
    }

    drawPreview() {
      super.drawPreview(this.castRange);
    }
  }
  return Soraka_Q;
}
const __cacheSoraka_Q = new WeakMap<ContentApi, ReturnType<typeof __buildSoraka_Q>>();
export default function makeSoraka_Q(api: ContentApi) {
  const cached = __cacheSoraka_Q.get(api);
  if (cached) return cached;
  const built = __buildSoraka_Q(api);
  __cacheSoraka_Q.set(api, built);
  return built;
}


interface DustMote {
  angle: number;
  distance: number;
  spin: number;
  size: number;
}


const MOTE_COUNT = 12;

/** How far above the impact the star starts, so it visibly falls in. */
const FALL_HEIGHT = 260;


function __buildSoraka_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const grantRejuvenation = makeGrantRejuvenation(api);
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Soraka_Q_Object extends SpellObject {
    /** Star dust settling on the floor: painted under the feet standing in it. */
    zIndex = GROUND_Z_INDEX;

    position: p5.Vector = this.owner.position.copy();

    radius = BLAST_RADIUS;
    fallTime = FALL_TIME_MS;
    bloomTime = 420;
    age = 0;

    damage = DAMAGE;
    hasLanded = false;

    _motes: DustMote[] = [];

    onAdded() {
      for (let i = 0; i < MOTE_COUNT; i++) {
        this._motes.push({
          angle: (TWO_PI * i) / MOTE_COUNT + random(-0.25, 0.25),
          distance: random(this.radius * 0.25, this.radius * 0.9),
          spin: random(0.0004, 0.0014) * (random() < 0.5 ? -1 : 1),
          size: random(4, 11),
        });
      }
    }

    update() {
      this.age += deltaTime;

      if (!this.hasLanded && this.age >= this.fallTime) {
        this.hasLanded = true;
        this._land();
      }

      if (this.age >= this.fallTime + this.bloomTime) this.toRemove = true;

      for (const mote of this._motes) mote.angle += mote.spin * deltaTime;
    }

    _land() {
      // An area effect hits everyone it overlaps, including whoever is hiding in
      // a bush — the vision gate belongs on picking a target, not on a blast.
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      for (const enemy of enemies) {
        enemy.takeDamage(this.damage, this.owner);

        const slow = new Slow(SLOW_DURATION_MS, this.owner, enemy);
        slow.buffAddType = BuffAddType.RENEW_EXISTING;
        slow.percent = SLOW_PERCENT;
        enemy.addBuff(slow);
      }

      if (enemies.length > 0 && !this.owner.isDead) {
        grantRejuvenation(this.owner, this.owner);
      }

      // The impact throws dust, so the hit reads even off the edge of the screen.
      const burst = PredefinedParticleSystems.smoke([200, 225, 255], 0.35, 7);
      this.useParticles(burst);
      for (let i = 0; i < 16; i++) {
        const angle = random(TWO_PI);
        const distance = random(this.radius);
        burst.addParticle({
          x: this.position.x + cos(angle) * distance,
          y: this.position.y + sin(angle) * distance,
          size: random(10, 24),
          opacity: 220,
        });
      }
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);

      if (!this.hasLanded) {
        const t = constrain(this.age / this.fallTime, 0, 1);
        // t*t: the star accelerates into the ground rather than gliding down
        const height = FALL_HEIGHT * (1 - t * t);

        // the target ring closes on the real blast radius, so the hitbox is read
        // off the screen instead of guessed
        noFill();
        stroke(30, 25, 60, 200);
        strokeWeight(6);
        circle(0, 0, this.radius * 2);
        stroke(190, 215, 255, 220);
        strokeWeight(2);
        circle(0, 0, this.radius * 2);
        stroke(255, 245, 200, 230);
        strokeWeight(3);
        circle(0, 0, this.radius * 2 * (1 - t * 0.72) + 8);

        // the falling star itself, trailing light
        noStroke();
        for (let i = 0; i < 4; i++) {
          const trail = height + i * 26;
          fill(150, 190, 255, 90 - i * 20);
          circle(0, -trail, 26 - i * 5);
        }
        fill(255, 250, 225, 245);
        circle(0, -height, 22);
        fill(190, 220, 255, 160);
        circle(0, -height, 40);
        pop();
        return;
      }

      const t = constrain((this.age - this.fallTime) / this.bloomTime, 0, 1);
      // 1-(1-t)^2: the bloom snaps out fast and then eases, like a struck bell
      const out = 1 - (1 - t) * (1 - t);
      const alpha = 255 * (1 - t);

      noStroke();
      fill(120, 150, 245, alpha * 0.35);
      circle(0, 0, this.radius * 2 * (0.7 + out * 0.35));

      // hard rim on the actual damage radius
      noFill();
      stroke(235, 240, 255, alpha);
      strokeWeight(4 * (1 - t) + 1);
      circle(0, 0, this.radius * 2);

      // a six-pointed star flashing out of the impact, gone in the first fifth
      if (t < 0.22) {
        const flash = 1 - t / 0.22;
        stroke(255, 252, 235, 240 * flash);
        strokeWeight(5 * flash + 1);
        for (let i = 0; i < 6; i++) {
          const a = (TWO_PI * i) / 6;
          const r = this.radius * (0.6 + flash * 1.1);
          line(0, 0, cos(a) * r, sin(a) * r);
        }
      }

      // dust settling outwards
      noStroke();
      for (const mote of this._motes) {
        const d = mote.distance * (0.5 + out * 0.7);
        fill(225, 235, 255, alpha * 0.8);
        circle(cos(mote.angle) * d, sin(mote.angle) * d, mote.size * (1 - t * 0.6));
      }

      pop();
    }

    getDisplayBoundingBox() {
      // the star starts a long way above the impact point, so the box has to hold
      // the whole descent or the effect pops in only once it has already landed
      const r = this.radius + FALL_HEIGHT + 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Soraka_Q_Object;
}
const __cacheSoraka_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildSoraka_Q_Object>>();
export function makeSoraka_Q_Object(api: ContentApi) {
  const cached = __cacheSoraka_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildSoraka_Q_Object(api);
  __cacheSoraka_Q_Object.set(api, built);
  return built;
}