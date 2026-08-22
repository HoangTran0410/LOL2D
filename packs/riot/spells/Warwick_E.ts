import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Fear = InstanceType<ContentApi['buffs']['Fear']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Warwick_E = InstanceType<ReturnType<typeof makeWarwick_E>>;



export const RADIUS = 300;

export const SHIELD_AMOUNT = 60;

export const SHIELD_DURATION = 2500;

export const FEAR_DURATION = 1200;


/** Primal Howl: brace, then scatter everything standing too close. */
function __buildWarwick_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const Fear = api.buffs.Fear;
  const Shield = api.buffs.Shield;
  class Warwick_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_warwick_e');
    name = 'Gầm Thét (Warwick_E)';
    description =
      `Nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span> trong <span class="time">${SHIELD_DURATION / 1000} giây</span>` +
      ` và <span class="buff">Khiếp Sợ</span> mọi kẻ địch trong <span>${RADIUS}px</span> trong` +
      ` <span class="time">${FEAR_DURATION / 1000} giây</span>`;
    coolDown = 10000;
    manaCost = 40;

    onSpellCast() {
      const shield = new Shield(SHIELD_DURATION, this.owner, this.owner);
      shield.stackId = 'warwick_e';
      shield.image = this.image;
      shield.amount = SHIELD_AMOUNT;
      shield.color = [255, 160, 140];
      this.owner.addBuff(shield);

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => {
        const fear = new Fear(FEAR_DURATION, this.owner, enemy);
        fear.sourcePosition = this.owner.position.copy();
        enemy.addBuff(fear);
      });

      const howl = new AoePulse(this.owner);
      howl.radius = RADIUS;
      howl.lifeTime = 520;
      howl.color = [255, 150, 130];
      howl.rings = 4;
      this.game.objectManager.addObject(howl);
    }

    drawPreview() {
      super.drawPreview(RADIUS);
    }
  }
  return Warwick_E;
}
const __cacheWarwick_E = new WeakMap<ContentApi, ReturnType<typeof __buildWarwick_E>>();
export default function makeWarwick_E(api: ContentApi) {
  const cached = __cacheWarwick_E.get(api);
  if (cached) return cached;
  const built = __buildWarwick_E(api);
  __cacheWarwick_E.set(api, built);
  return built;
}