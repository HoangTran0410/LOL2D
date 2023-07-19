import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { StatModifier } from '../Stat.js';
import Speedup from '../buffs/Speedup.js';
import CombatText from '../helpers/CombatText.js';
import ParticleSystem, { PredefinedParticleSystems } from '../helpers/ParticleSystem.js';

export default class Heal extends Spell {
  name = 'Hồi Máu (Heal)';
  image = AssetManager.getAsset('spell_heal');
  description =
    '<span class="buff">Hồi Máu</span> một lượng bằng <span>30% máu tối đa</span> và <span class="buff">Tăng Tốc 50%</span> trong <span class="time">1 giây</span>';
  coolDown = 10000;
  manaCost = 100;

  onSpellCast() {
    // heal 50% health
    let currentHeal = this.owner.stats.health.value;
    let maxHeal = this.owner.stats.maxHealth.value;
    let newHeal = Math.min(currentHeal + maxHeal * 0.3, maxHeal);

    // if (newHeal > currentHeal) {
    let modifier = new StatModifier();
    modifier.baseValue = newHeal - currentHeal;
    this.owner.stats.health.addModifier(modifier);

    // heal effect
    let healObject = new Heal_Object(this.owner);
    this.game.objectManager.addObject(healObject);
    // }

    // ghost buff for 1s
    let speedBuff = new Speedup(1000, this.owner, this.owner);
    speedBuff.image = this.image;
    speedBuff.percent = 0.5;
    this.owner.addBuff(speedBuff);

    // combat text
    if (newHeal > currentHeal) {
      let combatText = new CombatText(this.owner);
      combatText.text = `+ ${~~(newHeal - currentHeal)}`;
      combatText.textColor = [0, 255, 0];
      this.game.objectManager.addObject(combatText);
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
      });
    }
  }
}
