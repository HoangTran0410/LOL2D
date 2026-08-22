import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Root = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Amumu_R = InstanceType<ReturnType<typeof makeAmumu_R>>;



export const RADIUS = 260;

export const DAMAGE = 30;

export const ROOT_DURATION = 1500;


function __buildAmumu_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const Root = api.buffs.Root;
  class Amumu_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_amumu_r');
    name = 'Lời Nguyền Xác Ướp U Sầu (Amumu_R)';
    description =
      `Băng quấn bung ra <span>${RADIUS}px</span>, gây <span class="damage">${DAMAGE} sát thương</span>` +
      ` và <span class="buff">Trói Chân</span> mọi kẻ địch trúng phải trong` +
      ` <span class="time">${ROOT_DURATION / 1000} giây</span>`;
    coolDown = 10000;
    manaCost = 60;

    onSpellCast() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        enemy.takeDamage(DAMAGE, this.owner);
        enemy.addBuff(new Root(ROOT_DURATION, this.owner, enemy));
      });

      const ring = new AoePulse(this.owner);
      ring.radius = RADIUS;
      ring.lifeTime = 650;
      ring.color = [235, 225, 185];
      ring.style = 'bandage';
      ring.spokes = 16;
      this.game.objectManager.addObject(ring);
    }

    drawPreview() {
      super.drawPreview(RADIUS);
    }
  }
  return Amumu_R;
}
const __cacheAmumu_R = new WeakMap<ContentApi, ReturnType<typeof __buildAmumu_R>>();
export default function makeAmumu_R(api: ContentApi) {
  const cached = __cacheAmumu_R.get(api);
  if (cached) return cached;
  const built = __buildAmumu_R(api);
  __cacheAmumu_R.set(api, built);
  return built;
}