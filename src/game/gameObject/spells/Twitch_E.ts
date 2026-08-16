import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import DamageOverTime from '../buffs/DamageOverTime';

export const RANGE = 500;
export const DAMAGE = 26;

export default class Twitch_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_twitch_e');
  name = 'Kích Độc (Twitch_E)';
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
        if (buff.stackId === 'twitch_poison') buff.deactivate();
      }

      const pop = new AoePulse(this.owner);
      pop.position = enemy.position.copy();
      pop.radius = 70;
      pop.lifeTime = 320;
      pop.color = [150, 230, 90];
      this.game.objectManager.addObject(pop);
    }
  }

  _poisonedEnemies() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: this.range }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    return enemies.filter((enemy: any) =>
      enemy.buffs.some(
        (buff: DamageOverTime) => buff.stackId === 'twitch_poison' && !buff.toRemove
      )
    );
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}
