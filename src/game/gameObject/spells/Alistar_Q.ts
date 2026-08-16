import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Airborne from '../buffs/Airborne';

export const RADIUS = 190;
export const DAMAGE = 22;
export const AIRBORNE_DURATION = 800;

export default class Alistar_Q extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_alistar_q');
  name = 'Nghiền Nát (Alistar_Q)';
  description =
    `Giậm đất, gây <span class="damage">${DAMAGE} sát thương</span> và <span class="buff">Hất Tung</span>` +
    ` mọi kẻ địch trong <span>${RADIUS}px</span> trong <span class="time">${AIRBORNE_DURATION / 1000} giây</span>`;
  coolDown = 10000;
  manaCost = 30;

  onSpellCast() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    enemies.forEach((enemy: any) => {
      enemy.takeDamage(DAMAGE, this.owner);
      enemy.addBuff(new Airborne(AIRBORNE_DURATION, this.owner, enemy));
    });

    const ring = new AoePulse(this.owner);
    ring.radius = RADIUS;
    ring.color = [255, 230, 160];
    ring.rings = 3;
    this.game.objectManager.addObject(ring);
  }

  drawPreview() {
    super.drawPreview(RADIUS);
  }
}
