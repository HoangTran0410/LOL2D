import type { ContentApi } from '@moba2d/core/content/ContentApi';

type CombatText = InstanceType<ContentApi['helpers']['CombatText']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatModifier = InstanceType<ContentApi['units']['StatModifier']>;
type Heal = InstanceType<ReturnType<typeof makeHeal>>;
type Heal_Object = InstanceType<ReturnType<typeof makeHeal_Object>>;



const SPEEDUP_TIME = 3000;


function __buildHeal(api: ContentApi) {
  const Spell = api.Spell;
  const StatModifier = api.units.StatModifier;
  const Speedup = api.buffs.Speedup;
  const CombatText = api.helpers.CombatText;
  const Heal_Object = makeHeal_Object(api);
  class Heal extends Spell {
    targetingMode = 'SELF' as const;
    name = 'Hồi Máu (Heal)';
    image = api.asset('spell_heal');
    description = `<span class="buff">Hồi Máu</span> một lượng bằng <span>30% máu tối đa</span> và <span class="buff">Tăng Tốc 50%</span> trong <span class="time">${SPEEDUP_TIME / 1000} giây</span>`;
    coolDown = 10000;
    manaCost = 100;

    onSpellCast() {
      // heal 30% health
      let currentHeal = this.owner.stats.health.value;
      let maxHeal = this.owner.stats.maxHealth.value;
      let newHeal = Math.min(currentHeal + maxHeal * 0.3, maxHeal);

      let modifier = new StatModifier();
      modifier.baseValue = newHeal - currentHeal;
      this.owner.stats.health.addModifier(modifier);

      // heal effect
      let healObject = new Heal_Object(this.owner);
      this.game.objectManager.addObject(healObject);

      // ghost buff for 1s
      let speedBuff = new Speedup(SPEEDUP_TIME, this.owner, this.owner);
      speedBuff.image = this.image;
      speedBuff.percent = 0.5;
      this.owner.addBuff(speedBuff);

      // combat text
      if (newHeal > currentHeal) {
        CombatText.show(this.owner, 'heal', newHeal - currentHeal, [0, 255, 0]);
      }
    }
  }
  return Heal;
}
const __cacheHeal = new WeakMap<ContentApi, ReturnType<typeof __buildHeal>>();
export default function makeHeal(api: ContentApi) {
  const cached = __cacheHeal.get(api);
  if (cached) return cached;
  const built = __buildHeal(api);
  __cacheHeal.set(api, built);
  return built;
}


function __buildHeal_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Heal_Object extends SpellObject {
    age = 0;
    lifeTime = 1000;

    particleSystem = PredefinedParticleSystems.heal();

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
    }

    update() {
      this.age += deltaTime;
      if (this.age > this.lifeTime) this.toRemove = true;

      if (random() < 0.15) {
        let size = this.owner.stats.size.value / 2;
        this.particleSystem.addParticle({
          x: this.owner.position.x + random(-size, size),
          y: this.owner.position.y + random(-size, size),
        } as any);
      }
    }
  }
  return Heal_Object;
}
const __cacheHeal_Object = new WeakMap<ContentApi, ReturnType<typeof __buildHeal_Object>>();
export function makeHeal_Object(api: ContentApi) {
  const cached = __cacheHeal_Object.get(api);
  if (cached) return cached;
  const built = __buildHeal_Object(api);
  __cacheHeal_Object.set(api, built);
  return built;
}