import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Twitch_E = InstanceType<ReturnType<typeof makeTwitch_E>>;



export const RANGE = 500;

export const DAMAGE = 26;


function __buildTwitch_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const DamageOverTime = api.buffs.DamageOverTime;
  class Twitch_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_twitch_e');
    name = 'Nhiễm Khuẩn (Twitch_E)';
    description =
      `Kích nổ chất độc: mọi kẻ địch <span class="damage">đang nhiễm độc</span> trong <span>${RANGE}px</span>` +
      ` nhận <span class="damage">${DAMAGE} sát thương</span> và mất hiệu ứng độc`;
    coolDown = 10000;
    manaCost = 35;

    range = RANGE;

    checkCastCondition() {
      return this._poisonedEnemies().length > 0;
    }

    onSpellCast() {
      for (const enemy of this._poisonedEnemies()) {
        enemy.takeDamage(DAMAGE, this.owner);
        // Consumed, not merely expired: the poison is what paid for the burst.
        for (const buff of enemy.buffs) {
          if (buff.stackId === 'twitch_poison') buff.deactivateBuff();
        }

        const pop = new AoePulse(this.owner);
        pop.position = enemy.position.copy();
        pop.radius = 70;
        pop.lifeTime = 320;
        pop.color = [150, 230, 90];
        pop.style = 'shards';
        pop.spokes = 8;
        this.game.objectManager.addObject(pop);
      }
    }

    _poisonedEnemies() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: this.range }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      return enemies.filter((enemy: any) =>
        enemy.buffs.some((buff: DamageOverTime) => buff.stackId === 'twitch_poison' && !buff.toRemove)
      );
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Twitch_E;
}
const __cacheTwitch_E = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_E>>();
export default function makeTwitch_E(api: ContentApi) {
  const cached = __cacheTwitch_E.get(api);
  if (cached) return cached;
  const built = __buildTwitch_E(api);
  __cacheTwitch_E.set(api, built);
  return built;
}