import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { StatModifier } from '../Stat.js';
import Speedup from '../buffs/Speedup.js';
import CombatText from '../helpers/CombatText.js';
import ParticleSystem from '../helpers/ParticleSystem.js';

export default class Heal extends Spell {
  name = 'Hồi Máu (Heal)';
  image = AssetManager.getAsset('spell_heal');
  description = 'Hồi phục 30% máu tối đa và tăng 50% tốc độ di chuyển trong 1s';
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
    this.game.addObject(healObject);
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
      this.game.addObject(combatText);
    }
  }
}

export class Heal_Object extends SpellObject {
  age = 0;
  maxAge = 90;

  particleSystem = new ParticleSystem({
    isDeadFn: p => p.life <= 0,
    updateFn: p => {
      p.x += random(-2, 2);
      p.y -= random(3);
      p.life--;
    },
    drawFn: p => {
      let alpha = map(p.life, 0, 60, 0, 255);
      stroke(0, 255, 0, alpha + 50);
      strokeWeight(3);

      // chữ thập
      line(p.x - 5, p.y, p.x + 5, p.y);
      line(p.x, p.y - 5, p.x, p.y + 5);
    },
  });

  update() {
    if (this.age < this.maxAge && random() < 0.15) {
      let size = this.owner.stats.size.value / 2;
      this.particleSystem.addParticle({
        x: this.owner.position.x + random(-size, size),
        y: this.owner.position.y + random(-size, size),
        life: 60,
      });
    }
    this.particleSystem.update();

    this.age++;
    if (this.age > 120 && this.particleSystem.toRemove) {
      this.toRemove = true;
    }
  }

  draw() {
    this.particleSystem.draw();
  }
}
