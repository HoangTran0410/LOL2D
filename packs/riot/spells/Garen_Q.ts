import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Silence = InstanceType<ContentApi['buffs']['Silence']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Garen_Q = InstanceType<ReturnType<typeof makeGaren_Q>>;



export const SPEED_DURATION = 3000;

export const SPEED_PERCENT = 0.35;

/** Wiki: the empowered swing has 4.5s to land. */
export const WINDOW_MS = 4500;

export const BONUS_DAMAGE = 24;

export const SILENCE_MS = 1500;

export const STACK_ID = 'garen_q';


/**
 * Decisive Strike.
 *
 * `docs/abilities/garen/q.json`: cleanses **slows**, grants 35% move speed, and
 * empowers the *next* basic attack within 4.5s to deal bonus damage and silence
 * for 1.5s. Three separate things, and the empowered swing is the one that
 * needed `onHitDamage` to be a stat before it could be written at all.
 */
function __buildGaren_Q(api: ContentApi) {
  const EventType = api.enums.EventType;
  const Spell = api.Spell;
  const Buff = api.buffs.Buff;
  const Silence = api.buffs.Silence;
  const Slow = api.buffs.Slow;
  const Speedup = api.buffs.Speedup;
  const StatAmp = api.buffs.StatAmp;
  class Garen_Q extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_garen_q');
    name = 'Đòn Quyết Định (Garen_Q)';
    description =
      `<span class="buff">Gỡ mọi hiệu ứng làm chậm</span> và nhận <span class="buff">+${SPEED_PERCENT * 100}% tốc chạy</span>` +
      ` trong <span class="time">${SPEED_DURATION / 1000} giây</span>. Đòn đánh thường tiếp theo trong` +
      ` <span class="time">${WINDOW_MS / 1000} giây</span> gây thêm <span class="damage">${BONUS_DAMAGE} sát thương</span>` +
      ` và <span class="buff">Câm Lặng</span> mục tiêu <span class="time">${SILENCE_MS / 1000} giây</span>`;
    coolDown = 8000;
    manaCost = 20;

    private stopWatching?: () => void;

    onUpdate(): void {
      if (this.stopWatching || !this.owner || !this.game?.eventManager) return;
      this.stopWatching = this.game.eventManager.on(
        EventType.ON_ATTACK_HIT,
        ({ attacker, victim }: BasicAttackHit) => {
          if (attacker !== this.owner || !victim || !this.isArmed) return;
          // Spent on the first swing that lands, which is what "next basic
          // attack" means — deactivating the buff is what takes the bonus
          // damage back off, so this cannot double-dip.
          for (const buff of this.owner.buffs) {
            if (buff.stackId === STACK_ID) buff.deactivateBuff();
          }
          victim.addBuff(new Silence(SILENCE_MS, this.owner, victim));
        }
      );
    }

    get isArmed(): boolean {
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
      // Slows only — Garen walks out of a slow, not out of a stun.
      for (const buff of this.owner.buffs) {
        if (buff instanceof Slow) buff.deactivateBuff();
      }

      const haste = new Speedup(SPEED_DURATION, this.owner, this.owner);
      haste.stackId = 'garen_q_haste';
      haste.image = this.image;
      haste.percent = SPEED_PERCENT;
      this.owner.addBuff(haste);

      // The empowered swing as `onHitDamage`, so it goes through the same
      // pipeline as every other on-hit effect and crits with it.
      const strike = new StatAmp(WINDOW_MS, this.owner, this.owner);
      strike.stackId = STACK_ID;
      strike.image = this.image;
      strike.name = 'Đòn Quyết Định';
      strike.bonuses = { onHitDamage: { baseBonus: BONUS_DAMAGE } };
      this.owner.addBuff(strike);
    }
  }
  return Garen_Q;
}
const __cacheGaren_Q = new WeakMap<ContentApi, ReturnType<typeof __buildGaren_Q>>();
export default function makeGaren_Q(api: ContentApi) {
  const cached = __cacheGaren_Q.get(api);
  if (cached) return cached;
  const built = __buildGaren_Q(api);
  __cacheGaren_Q.set(api, built);
  return built;
}