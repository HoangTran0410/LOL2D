import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import Shield from '../buffs/Shield';
import StatAmp from '../buffs/StatAmp';

export const DURATION = 3000;
export const SHIELD_AMOUNT = 70;
export const OMNIVAMP = 0.2;

/**
 * Courage.
 *
 * League's version is a shield plus tenacity and lasting damage reduction.
 * There is no tenacity stat here, so the durability lands as a shield and the
 * staying power as omnivamp: Garen's whole identity is being the one who is
 * still standing at the end of the fight.
 */
export default class Garen_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_garen_w');
  name = 'Dũng Khí (Garen_W)';
  description =
    `Nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span> và <span class="buff">hút ${OMNIVAMP * 100}% máu</span>` +
    ` từ mọi sát thương gây ra, trong <span class="time">${DURATION / 1000} giây</span>`;
  coolDown = 9000;
  manaCost = 25;

  onSpellCast() {
    const shield = new Shield(DURATION, this.owner, this.owner);
    shield.stackId = 'garen_w';
    shield.amount = SHIELD_AMOUNT;
    shield.color = [230, 220, 170];
    this.owner.addBuff(shield);

    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'garen_w_vamp';
    amp.name = 'Dũng Khí';
    amp.bonuses = { omnivamp: { baseBonus: OMNIVAMP } };
    this.owner.addBuff(amp);
  }
}
