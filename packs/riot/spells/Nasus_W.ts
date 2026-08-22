import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Nasus_W = InstanceType<ReturnType<typeof makeNasus_W>>;



export const RANGE = 260;

export const SLOW_PERCENT = 0.6;

export const DURATION = 2500;


function __buildNasus_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const Slow = api.buffs.Slow;
  const StatAmp = api.buffs.StatAmp;
  class Nasus_W extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_nasus_w');
    name = 'Lão Hóa (Nasus_W)';
    description =
      `Nguyền rủa kẻ địch gần nhất trong <span>${RANGE}px</span>, <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>` +
      ` và giảm tốc độ đánh của chúng trong <span class="time">${DURATION / 1000} giây</span>`;
    coolDown = 9000;
    manaCost = 25;

    range = RANGE;

    checkCastCondition() {
      return !!this._findTarget();
    }

    onSpellCast() {
      const target = this._findTarget();
      if (!target) return;

      const slow = new Slow(DURATION, this.owner, target);
      slow.percent = SLOW_PERCENT;
      target.addBuff(slow);

      // The attack-speed half of Wither. Its own stack slot so a second Nasus
      // (or a later cast) renews this rather than stacking with an unrelated
      // stat buff sitting on the same victim.
      const wither = new StatAmp(DURATION, this.owner, target);
      wither.stackId = 'nasus_w_wither';
      wither.image = this.image;
      wither.bonuses = { attackSpeed: { percentBaseBonus: -0.4 } };
      target.addBuff(wither);

      const ring = new AoePulse(this.owner);
      ring.position = target.position.copy();
      ring.radius = 60;
      ring.lifeTime = 600;
      ring.color = [150, 120, 190];
      this.game.objectManager.addObject(ring);
    }

    _findTarget() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      });

      let nearest = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = this.owner.position.dist(enemy.position);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = enemy;
        }
      }
      return nearest;
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Nasus_W;
}
const __cacheNasus_W = new WeakMap<ContentApi, ReturnType<typeof __buildNasus_W>>();
export default function makeNasus_W(api: ContentApi) {
  const cached = __cacheNasus_W.get(api);
  if (cached) return cached;
  const built = __buildNasus_W(api);
  __cacheNasus_W.set(api, built);
  return built;
}