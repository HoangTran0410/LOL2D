import AssetManager from '@/managers/AssetManager';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import { StatModifier } from '@/game/gameObject/Stats';
import Speedup from '@/game/gameObject/buffs/Speedup';
import CombatText from '@/game/gameObject/helpers/CombatText';
import { PredefinedParticleSystems } from '@/game/gameObject/helpers/ParticleSystem';

const SPEEDUP_TIME = 3000;

export default class Heal extends Spell {
  targetingMode = 'SELF' as const;
  name = 'Hồi Máu (Heal)';
  image = AssetManager.get('spell_heal');
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

export class Heal_Object extends SpellObject {
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
