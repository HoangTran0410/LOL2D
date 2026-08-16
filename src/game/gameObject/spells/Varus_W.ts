import AssetManager from '../../../managers/AssetManager';
import EventType from '../../enums/EventType';
import type { BasicAttackHit } from '../../combat/BasicAttack';
import Spell from '../Spell';
import DamageOverTime from '../buffs/DamageOverTime';
import StatAmp from '../buffs/StatAmp';
import type Buff from '../Buff';

export const DURATION = 8000;
export const BLIGHT_PER_TICK = 4;
export const BLIGHT_DURATION = 2000;
export const STACK_ID = 'varus_w';

/** Blighted Quiver: every arrow leaves rot behind it. */
export default class Varus_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_varus_w');
  name = 'Ống Tên Bệnh Dịch (Varus_W)';
  description =
    `Trong <span class="time">${DURATION / 1000} giây</span>, mỗi đòn đánh thường bám thêm` +
    ` <span class="damage">${BLIGHT_PER_TICK} sát thương mỗi nhịp</span> trong` +
    ` <span class="time">${BLIGHT_DURATION / 1000} giây</span>, kèm <span class="buff">+15% tốc độ đánh</span>`;
  coolDown = 10000;
  manaCost = 25;

  private stopWatching?: () => void;

  onUpdate(): void {
    if (this.stopWatching || !this.owner || !this.game?.eventManager) return;
    this.stopWatching = this.game.eventManager.on(
      EventType.ON_ATTACK_HIT,
      ({ attacker, victim }: BasicAttackHit) => {
        if (attacker !== this.owner || !victim || !this.isActive) return;
        const blight = new DamageOverTime(BLIGHT_DURATION, this.owner, victim);
        blight.stackId = 'varus_blight';
        blight.name = 'Bệnh Dịch';
        blight.damagePerTick = BLIGHT_PER_TICK;
        blight.tickInterval = 500;
        blight.flameColor = [200, 130, 255];
        blight.emberColor = [70, 20, 110];
        victim.addBuff(blight);
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
    amp.name = 'Ống Tên Bệnh Dịch';
    amp.bonuses = { attackSpeed: { percentBaseBonus: 0.15 } };
    this.owner.addBuff(amp);
  }
}
