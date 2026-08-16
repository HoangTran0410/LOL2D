import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';

export const RADIUS = 200;
export const DAMAGE = 20;

export default class Amumu_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_amumu_e');
  name = 'Nổi Giận (Amumu_E)';
  description =
    `Đập xuống đất, gây <span class="damage">${DAMAGE} sát thương</span> cho mọi kẻ địch trong` +
    ` <span>${RADIUS}px</span> quanh mình`;
  coolDown = 6000;
  manaCost = 20;

  onSpellCast() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => enemy.takeDamage(DAMAGE, this.owner));

    const ring = new AoePulse(this.owner);
    ring.radius = RADIUS;
    ring.color = [200, 120, 90];
    ring.rings = 3;
    this.game.objectManager.addObject(ring);
  }

  drawPreview() {
    super.drawPreview(RADIUS);
  }
}
