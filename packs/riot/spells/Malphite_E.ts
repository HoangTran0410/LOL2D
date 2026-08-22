import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CancelReason, CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Malphite_E = InstanceType<ReturnType<typeof makeMalphite_E>>;
type Malphite_E_Object = InstanceType<ReturnType<typeof makeMalphite_E_Object>>;



/**
 * Ground Slam. Malphite slams the ground beneath him: an instant, self-centred
 * burst rather than a lingering area, so it is built the way `Anivia_Q_Blast`
 * and `Malphite_R_Object` are — a plain `SpellObject` that pays its damage
 * once on its first update and then spends a few hundred ms fading out.
 *
 * The Wiki's payload is a "cripple" — an attack-speed slow. There is now an
 * attackSpeed stat to bind that to, so this applies it. It also keeps the
 * movement slow it was written with: basic attacks are one small part of a
 * fight here and most damage still comes from abilities, so a pure attack-speed
 * debuff would read as almost nothing on the receiving end.
 */
export const COOLDOWN_MS = 7_000;

export const MANA_COST = 50;

export const CAST_TIME_MS = 0;

// Exported so the suite asserts wiring against the real tuning, not a copy of
// the numbers — retuning a value should not mean editing a test.
export const RADIUS = 175;

export const DAMAGE = 25;

export const SLOW_PERCENT = 0.3;

/** Attack-speed cut, the Wiki's actual payload for this ability. */
export const CRIPPLE_PERCENT = 0.35;

export const SLOW_DURATION_MS = 3_000;

export const FADE_MS = 450;


type SlamTarget = AttackableUnit;


function __buildMalphite_E(api: ContentApi) {
  const Spell = api.Spell;
  const Malphite_E_Object = makeMalphite_E_Object(api);
  class Malphite_E extends Spell {
    image = api.asset('spell_malphite_e');
    name = 'Dậm Đất (Malphite_E)';
    description = `Malphite đập tay xuống đất, gây <span class="damage">${DAMAGE} sát thương</span> cho kẻ địch trong bán kính <span>${RADIUS}px</span> quanh mình, <span class="buff">Làm Chậm ${Math.round(SLOW_PERCENT * 100)}%</span> và <span class="buff">Giảm ${Math.round(CRIPPLE_PERCENT * 100)}% tốc độ đánh</span> trong <span class="time">${SLOW_DURATION_MS / 1000} giây</span>.`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    radius = RADIUS;
    damage = DAMAGE;
    slowPercent = SLOW_PERCENT;
    slowDuration = SLOW_DURATION_MS;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        castTimeMs: CAST_TIME_MS,
        resource: { commitAt: 'start', refundOn: ['DEATH', 'SILENCE', 'STUN'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(_context: CastContext): void {
      const slam = new Malphite_E_Object(this.owner);
      slam.radius = this.radius;
      slam.damage = this.damage;
      slam.slowPercent = this.slowPercent;
      slam.slowDuration = this.slowDuration;
      this.game.objectManager.addObject(slam);
    }

    onCancel(_context: CastContext, _reason: CancelReason): void {
      // Half-refund on the imported cancel set, matching Varus Q/Pantheon Q.
      this.changeResource(this.owner.stats.mana, -this.effectiveManaCost / 2);
    }

    drawPreview(): void {
      super.drawPreview(this.radius);
    }
  }
  return Malphite_E;
}
const __cacheMalphite_E = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_E>>();
export default function makeMalphite_E(api: ContentApi) {
  const cached = __cacheMalphite_E.get(api);
  if (cached) return cached;
  const built = __buildMalphite_E(api);
  __cacheMalphite_E.set(api, built);
  return built;
}


/** The slam itself: one instant burst of damage and slow, then a fading shockwave. */
function __buildMalphite_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const StatAmp = api.buffs.StatAmp;
  class Malphite_E_Object extends SpellObject {
    position = this.owner.position.copy();
    radius = RADIUS;
    damage = DAMAGE;
    slowPercent = SLOW_PERCENT;
    slowDuration = SLOW_DURATION_MS;

    age = 0;
    lifeTime = FADE_MS;
    hasDealtDamage = false;

    _rocks: { a: number; speed: number; size: number }[] = [];

    onAdded(): void {
      for (let i = 0; i < 10; i++) {
        this._rocks.push({
          a: (i / 10) * TWO_PI + (i % 2) * 0.15,
          speed: 0.7 + (i % 4) * 0.18,
          size: 6 + (i % 3) * 3,
        });
      }
    }

    update(): void {
      if (!this.hasDealtDamage) {
        this.hasDealtDamage = true;

        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });

        for (const enemy of enemies as SlamTarget[]) {
          if (
            Math.hypot(enemy.position.x - this.position.x, enemy.position.y - this.position.y) >
            this.radius + enemy.collisionRadius
          ) {
            continue;
          }

          enemy.takeDamage(this.damage, this.owner);

          const slow = new Slow(this.slowDuration, this.owner, enemy);
          slow.percent = this.slowPercent;
          // Its own pool: Q's shard already applies a Slow, and the two should
          // not renew or evict each other's instance.
          slow.stackId = 'malphite_e_cripple';
          enemy.addBuff(slow);

          const cripple = new StatAmp(this.slowDuration, this.owner, enemy);
          cripple.name = 'Tê Liệt';
          cripple.image = api.asset('buff_slow');
          cripple.stackId = 'malphite_e_attack_cripple';
          cripple.bonuses = { attackSpeed: { percentBonus: -CRIPPLE_PERCENT } };
          enemy.addBuff(cripple);
        }
      }

      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const flash = 1 - constrain(this.age / 150, 0, 1);
      const ringT = constrain(this.age / 260, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // impact flash at the moment of landing
      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(210, 195, 235, 160 * flash);
        circle(0, 0, this.radius * 0.9 * flash + this.radius * 0.3);
        blendMode(BLEND);
      }

      // the actual hit area, filled so the reach of the slam is unmistakable
      noStroke();
      fill(150, 140, 175, 60 * fade);
      circle(0, 0, this.radius * 2);

      // shockwave ring racing out to the true radius, then holding while it fades
      noFill();
      stroke(60, 52, 78, 210 * fade);
      strokeWeight(7 * (1 - ringT) + 2);
      circle(0, 0, this.radius * 2 * (0.3 + ringT * 0.7));
      stroke(226, 218, 245, 220 * fade);
      strokeWeight(2.5);
      circle(0, 0, this.radius * 2 * (0.3 + ringT * 0.7));

      // ground cracks radiating from the impact point
      stroke(40, 34, 54, 200 * fade);
      strokeWeight(2.5 * fade + 1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TWO_PI + 0.3;
        const reach = this.radius * (0.35 + 0.5 * ringT);
        const wobble = sin(i * 3.7) * this.radius * 0.08;
        line(0, 0, cos(a) * reach + wobble, sin(a) * reach - wobble);
      }

      // rock debris thrown outward from the slam
      stroke(30, 26, 42, 220 * fade);
      strokeWeight(2);
      fill(140, 130, 168, 230 * fade);
      for (const rock of this._rocks) {
        const d = this.radius * 0.15 + this.age * rock.speed * 0.4;
        const rx = cos(rock.a) * d;
        const ry = sin(rock.a) * d * 0.6 - t * 14;
        push();
        translate(rx, ry);
        rotate(rock.a + this.age / 120);
        triangle(0, -rock.size, rock.size * 0.8, rock.size * 0.6, -rock.size * 0.8, rock.size * 0.6);
        pop();
      }

      pop();
    }

    // the shockwave and debris both reach out to the true radius
    getDisplayBoundingBox(): Rectangle {
      const r = this.radius + 30;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Malphite_E_Object;
}
const __cacheMalphite_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_E_Object>>();
export function makeMalphite_E_Object(api: ContentApi) {
  const cached = __cacheMalphite_E_Object.get(api);
  if (cached) return cached;
  const built = __buildMalphite_E_Object(api);
  __cacheMalphite_E_Object.set(api, built);
  return built;
}