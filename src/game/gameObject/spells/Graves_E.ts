import AssetManager from '@/managers/AssetManager';
import VectorUtils from '@/utils/vector.utils';
import Spell from '@/game/gameObject/Spell';
import Dash from '@/game/gameObject/buffs/Dash';
import StatAmp from '@/game/gameObject/buffs/StatAmp';

export const DASH_DISTANCE = 250;
export const DASH_SPEED = 20;
export const BUFF_DURATION = 4000;
export const ATTACK_SPEED_PERCENT = 0.4;
export const CRIT_CHANCE = 0.35;

/** Quickdraw: the reposition, and the reload that follows it. */
export default class Graves_E extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_graves_e');
  name = 'Rút Súng Nhanh (Graves_E)';
  description =
    `Lướt <span>${DASH_DISTANCE}px</span> theo hướng chỉ định và nhận` +
    ` <span class="buff">+${ATTACK_SPEED_PERCENT * 100}% tốc độ đánh</span> và` +
    ` <span class="buff">${CRIT_CHANCE * 100}% tỉ lệ chí mạng</span> trong` +
    ` <span class="time">${BUFF_DURATION / 1000} giây</span>`;
  coolDown = 8000;
  manaCost = 25;

  checkCastCondition() {
    return Dash.CanDash(this.owner);
  }

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      DASH_DISTANCE
    );

    const dash = new Dash(1500, this.owner, this.owner);
    dash.image = this.image;
    dash.dashDestination = to;
    dash.dashSpeed = DASH_SPEED;
    dash.showTrail = true;
    this.owner.addBuff(dash);

    const amp = new StatAmp(BUFF_DURATION, this.owner, this.owner);
    amp.stackId = 'graves_e';
    amp.image = this.image;
    amp.name = 'Rút Súng Nhanh';
    amp.bonuses = {
      attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT },
      critChance: { baseBonus: CRIT_CHANCE },
    };
    this.owner.addBuff(amp);
  }

  drawPreview() {
    super.drawPreview(DASH_DISTANCE);
  }
}
