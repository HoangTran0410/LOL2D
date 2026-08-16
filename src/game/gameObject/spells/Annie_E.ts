import AssetManager from '../../../managers/AssetManager';
import EventType from '../../enums/EventType';
import type { BasicAttackHit } from '../../combat/BasicAttack';
import Spell from '../Spell';
import type Buff from '../Buff';
import Shield from '../buffs/Shield';
import Speedup from '../buffs/Speedup';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const DURATION = 3000;
export const SHIELD_AMOUNT = 55;
export const SPEED_PERCENT = 0.35;
export const RETURN_DAMAGE = 14;
export const STACK_ID = 'annie_e';

/**
 * Molten Shield.
 *
 * `docs/abilities/annie/e.json`: a shield plus decaying move speed, and
 * *"enemies that deal damage to it take magic damage — once per enemy per
 * cast"*. That last clause is the ability: it is a shield that punishes the
 * people hitting it, not one that just absorbs.
 *
 * The burn rides `ON_ATTACK_HIT` rather than the damage pipeline, because
 * "damaged the shield" needs an attacker, and the attack event is the one
 * place this engine hands one over with the victim.
 */
export default class Annie_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_annie_e');
  name = 'Khiên Dung Nham (Annie_E)';
  description =
    `Nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span> và <span class="buff">+${SPEED_PERCENT * 100}% tốc chạy</span>` +
    ` trong <span class="time">${DURATION / 1000} giây</span>. Kẻ nào đánh vào khiên sẽ bị đốt` +
    ` <span class="damage">${RETURN_DAMAGE} sát thương</span> — <span class="buff">mỗi kẻ chỉ một lần</span> mỗi lần dùng`;
  coolDown = 10000;
  manaCost = 30;

  private stopWatching?: () => void;
  /** Who has already been burned by the shield that is up right now. */
  private burned = new Set<AttackableUnit>();

  onUpdate(): void {
    if (this.stopWatching || !this.owner || !this.game?.eventManager) return;
    this.stopWatching = this.game.eventManager.on(
      EventType.ON_ATTACK_HIT,
      ({ attacker, victim }: BasicAttackHit) => {
        if (victim !== this.owner || !attacker || !this.isActive) return;
        if (this.burned.has(attacker)) return;
        this.burned.add(attacker);
        attacker.takeDamage(RETURN_DAMAGE, this.owner);
      }
    );
  }

  get isActive(): boolean {
    return this.owner?.buffs?.some((buff: Buff) => buff.stackId === STACK_ID && !buff.toRemove) ?? false;
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
    // "Once per enemy per cast" — the ledger is per shield, so it clears here
    // rather than when the shield ends.
    this.burned.clear();

    const shield = new Shield(DURATION, this.owner, this.owner);
    shield.stackId = STACK_ID;
    shield.image = this.image;
    shield.amount = SHIELD_AMOUNT;
    shield.color = [255, 160, 70];
    this.owner.addBuff(shield);

    const haste = new Speedup(DURATION, this.owner, this.owner);
    haste.stackId = 'annie_e_haste';
    haste.image = this.image;
    haste.percent = SPEED_PERCENT;
    this.owner.addBuff(haste);
  }
}
