import AssetManager from '../../../managers/AssetManager';
import EventType from '../../enums/EventType';
import type { BasicAttackHit } from '../../combat/BasicAttack';
import Spell from '../Spell';
import DamageOverTime from '../buffs/DamageOverTime';
import StatAmp from '../buffs/StatAmp';
import type Buff from '../Buff';

export const DURATION = 8000;
export const BLEED_PER_TICK = 5;
export const BLEED_DURATION = 2000;
export const STACK_ID = 'fizz_w';

/** Seastone Trident: the trident keeps cutting after the swing has landed. */
export default class Fizz_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_fizz_w');
  name = 'Đinh Ba Biển Sâu (Fizz_W)';
  description =
    `Trong <span class="time">${DURATION / 1000} giây</span>, mỗi đòn đánh thường gây thêm` +
    ` <span class="damage">${BLEED_PER_TICK} sát thương mỗi nhịp</span> trong` +
    ` <span class="time">${BLEED_DURATION / 1000} giây</span>, kèm <span class="buff">+20% tốc độ đánh</span>`;
  coolDown = 10000;
  manaCost = 25;

  private stopWatching?: () => void;

  onUpdate(): void {
    if (this.stopWatching || !this.owner || !this.game?.eventManager) return;
    this.stopWatching = this.game.eventManager.on(
      EventType.ON_ATTACK_HIT,
      ({ attacker, victim }: BasicAttackHit) => {
        if (attacker !== this.owner || !victim || !this.isActive) return;
        const bleed = new DamageOverTime(BLEED_DURATION, this.owner, victim);
        bleed.stackId = 'fizz_w_bleed';
        bleed.name = 'Đinh Ba Biển Sâu';
        bleed.damagePerTick = BLEED_PER_TICK;
        bleed.tickInterval = 500;
        bleed.flameColor = [150, 230, 255];
        bleed.emberColor = [20, 70, 140];
        victim.addBuff(bleed);
      }
    );
  }

  get isActive(): boolean {
    return (
      this.owner?.buffs?.some((buff: Buff) => buff.stackId === STACK_ID && !buff.toRemove) ?? false
    );
  }

  onRemoved(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    super.onRemoved();
  }

  deactivate(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    super.deactivate();
  }

  onSpellCast() {
    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = STACK_ID;
    amp.image = this.image;
    amp.name = 'Đinh Ba Biển Sâu';
    amp.bonuses = { attackSpeed: { percentBaseBonus: 0.2 } };
    this.owner.addBuff(amp);
  }
}
