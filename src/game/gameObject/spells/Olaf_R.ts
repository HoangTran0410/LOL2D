import AssetManager from '@/managers/AssetManager';
import Spell from '@/game/gameObject/Spell';
import AoePulse from '@/game/gameObject/spellObjects/AoePulse';
import StatAmp from '@/game/gameObject/buffs/StatAmp';
import Airborne from '@/game/gameObject/buffs/Airborne';
import Charm from '@/game/gameObject/buffs/Charm';
import Fear from '@/game/gameObject/buffs/Fear';
import Root from '@/game/gameObject/buffs/Root';
import Silence from '@/game/gameObject/buffs/Silence';
import Slow from '@/game/gameObject/buffs/Slow';
import Stun from '@/game/gameObject/buffs/Stun';

export const DURATION = 7000;
export const BONUS_DAMAGE = 10;

/** Every buff Ragnarok tears off. Anything that takes Olaf's turn away from him. */
const CROWD_CONTROL = [Stun, Root, Slow, Silence, Fear, Charm, Airborne];

/**
 * Ragnarok: not a stat line but an escape. It strips the crowd control already
 * on Olaf the instant it is pressed — the point of the ultimate is being the
 * one champion a stun does not stop, so it has to *undo* one.
 */
export default class Olaf_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_olaf_r');
  name = 'Tận Thế Ragnarok (Olaf_R)';
  description =
    `Gỡ bỏ <span class="buff">mọi hiệu ứng khống chế</span> đang dính, và trong` +
    ` <span class="time">${DURATION / 1000} giây</span> nhận <span class="buff">+${BONUS_DAMAGE} sát thương đánh thường</span>` +
    ` cùng <span class="buff">+25% tốc chạy</span>`;
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    for (const buff of this.owner.buffs) {
      if (CROWD_CONTROL.some(kind => buff instanceof kind)) buff.deactivateBuff();
    }

    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'olaf_r';
    amp.image = this.image;
    amp.name = 'Ragnarok';
    amp.bonuses = {
      attackDamage: { baseBonus: BONUS_DAMAGE },
      speed: { percentBaseBonus: 0.25 },
    };
    this.owner.addBuff(amp);

    const burst = new AoePulse(this.owner);
    burst.radius = 120;
    burst.lifeTime = 500;
    burst.color = [255, 120, 60];
    burst.style = 'shards';
    burst.spokes = 12;
    this.game.objectManager.addObject(burst);
  }
}
