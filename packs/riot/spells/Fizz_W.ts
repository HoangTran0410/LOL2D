import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Spell = InstanceType<ContentApi['Spell']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Fizz_W = InstanceType<ReturnType<typeof makeFizz_W>>;



export const DURATION = 8000;

export const BLEED_PER_TICK = 5;

export const BLEED_DURATION = 2000;

export const STACK_ID = 'fizz_w';


/** Seastone Trident: the trident keeps cutting after the swing has landed. */
function __buildFizz_W(api: ContentApi) {
  const EventType = api.enums.EventType;
  const Spell = api.Spell;
  const DamageOverTime = api.buffs.DamageOverTime;
  const StatAmp = api.buffs.StatAmp;
  const Buff = api.buffs.Buff;
  class Fizz_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_fizz_w');
    name = 'Đinh Ba Hải Thạch (Fizz_W)';
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
  return Fizz_W;
}
const __cacheFizz_W = new WeakMap<ContentApi, ReturnType<typeof __buildFizz_W>>();
export default function makeFizz_W(api: ContentApi) {
  const cached = __cacheFizz_W.get(api);
  if (cached) return cached;
  const built = __buildFizz_W(api);
  __cacheFizz_W.set(api, built);
  return built;
}