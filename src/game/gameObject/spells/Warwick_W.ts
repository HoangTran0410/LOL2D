import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import Speedup from '../buffs/Speedup';
import StatAmp from '../buffs/StatAmp';
import { createReveal } from '../buffs/TrueSight';

export const DURATION = 6000;
export const SPEED_PERCENT = 0.4;
export const HUNT_RADIUS = 900;
export const WOUNDED_THRESHOLD = 0.5;
export const OMNIVAMP = 0.35;

/**
 * Blood Hunt. The wiki version keys off enemies below half health; this keeps
 * that — the speed is unconditional, but the *reveal* only lands on the wounded,
 * so the ability tells Warwick who to go after rather than just moving him.
 */
export default class Warwick_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_warwick_w');
  name = 'Săn Máu (Warwick_W)';
  description =
    `Đánh hơi trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+${SPEED_PERCENT * 100}% tốc chạy</span>` +
    `, <span class="buff">hút ${OMNIVAMP * 100}% máu từ mọi sát thương</span>,` +
    ` và <span class="buff">lộ diện</span> mọi kẻ địch dưới <span>${WOUNDED_THRESHOLD * 100}% máu</span>` +
    ` trong <span>${HUNT_RADIUS}px</span>`;
  coolDown = 10000;
  manaCost = 25;

  onSpellCast() {
    const haste = new Speedup(DURATION, this.owner, this.owner);
    haste.stackId = 'warwick_w';
    haste.image = this.image;
    haste.percent = SPEED_PERCENT;
    this.owner.addBuff(haste);

    const drink = new StatAmp(DURATION, this.owner, this.owner);
    drink.stackId = 'warwick_w_vamp';
    drink.image = this.image;
    drink.name = 'Săn Máu';
    drink.bonuses = { omnivamp: { baseBonus: OMNIVAMP } };
    this.owner.addBuff(drink);

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: HUNT_RADIUS,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    enemies.forEach((enemy: any) => {
      const max = enemy.stats?.maxHealth?.value ?? 0;
      if (!max || enemy.stats.health.value / max > WOUNDED_THRESHOLD) return;
      enemy.addBuff(
        createReveal({
          durationMs: DURATION,
          source: this.owner,
          target: enemy,
          stackId: 'warwick_w_scent',
        })
      );
    });
  }
}
