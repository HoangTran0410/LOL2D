import { Circle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import Spell from '@/game/gameObject/Spell';
import AoePulse from '@/game/gameObject/spellObjects/AoePulse';
import Fear from '@/game/gameObject/buffs/Fear';
import Shield from '@/game/gameObject/buffs/Shield';

export const RADIUS = 300;
export const SHIELD_AMOUNT = 60;
export const SHIELD_DURATION = 2500;
export const FEAR_DURATION = 1200;

/** Primal Howl: brace, then scatter everything standing too close. */
export default class Warwick_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_warwick_e');
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
