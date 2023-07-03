import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { StatModifier } from '../Stat.js';
import { Ghost_Buff, Ghost_Buff_Object } from './Ghost.js';

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

    if (newHeal > currentHeal) {
      let modifier = new StatModifier();
      modifier.baseValue = newHeal - currentHeal;
      this.owner.stats.health.addModifier(modifier);

      // heal effect
      let healObject = new Heal_Object(this.owner);
      this.game.objects.push(healObject);
    }

    // ghost buff for 1s
    let ghostBuff = new Ghost_Buff(1000, this.owner, this.owner);
    ghostBuff.image = this.image;
    this.owner.addBuff(ghostBuff);

    // ghost effect
    let ghostBuffObject = new Ghost_Buff_Object(this.owner);
    this.game.objects.push(ghostBuffObject);
    ghostBuff.addDeactivateListener(() => {
      ghostBuffObject.toRemove = true;
    });
  }
}

export class Heal_Object extends SpellObject {
  particles = [];
  age = 0;
  maxAge = 90;

  update() {
    if (this.age < this.maxAge && random() < 0.15) {
      let size = this.owner.stats.size.value / 2;
      this.particles.push({
        x: this.owner.position.x + random(-size, size),
        y: this.owner.position.y + random(-size, size),
        life: 60,
      });
    }

    this.particles.forEach(p => {
      p.y -= random(1);
      p.life--;
    });

    this.particles = this.particles.filter(p => p.life > 0);

    this.age++;
    if (this.age > 120 && this.particles.length === 0) {
      this.toRemove = true;
    }
  }

  draw() {
    push();
    this.particles.forEach(p => {
      let alpha = map(p.life, 0, 60, 0, 255);
      fill(0, 255, 0, alpha);
      stroke(0, 255, 0, alpha + 50);
      strokeWeight(2);

      // chữ thập
      rect(p.x - 5, p.y, 10, 1);
      rect(p.x, p.y - 5, 1, 10);
    });
    pop();
  }
}
