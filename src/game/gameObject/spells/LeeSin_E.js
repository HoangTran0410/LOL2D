import AssetManager from '../../../managers/AssetManager.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { StatsModifier } from '../Stats.js';

export default class LeeSin_E extends Spell {
  image = AssetManager.getAsset('spell_leesin_e');
  name = 'Địa Chấn / Dư Chấn (LeeSin_E)';
  description =
    'Dẫm xuống đất, gây 20 sát thương lên kẻ địch xung quanh. Làm chậm chúng đi 50% trong 2s';
  coolDown = 5000;

  range = 150;

  onSpellCast() {
    let enemies = this.game.queryPlayerInRange({
      position: this.owner.position,
      range: 200,
      excludePlayers: [this.owner],
      includePlayerSize: true,
    });

    enemies.forEach(enemy => {
      enemy.addBuff(new LeeSin_E_Buff(2000, this.owner, enemy));
      enemy.takeDamage(20, this.owner);
    });

    let obj = new LeeSin_E_Object(this.owner);
    obj.range = this.range;
    obj.enemies = enemies;
    this.game.objects.push(obj);
  }

  onUpdate() {}
}

export class LeeSin_E_Buff extends Buff {
  image = AssetManager.getAsset('spell_leesin_e');
  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.baseValue = -this.targetUnit.stats.speed.baseValue * 0.5;
  }
  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }
  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}

export class LeeSin_E_Object extends SpellObject {
  position = this.owner.position.copy();
  range = 200;
  lifeTime = 800;
  age = 0;

  size = 0;

  enemies = [];

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    push();
    this.size = Math.min(this.size + 30, this.range * 2);

    let alpha = map(this.age, 0, this.lifeTime, 180, 10);
    fill(255, 190, 30, alpha);
    stroke(190, 190, 30, alpha + 50);
    strokeWeight(2);
    circle(this.position.x, this.position.y, this.size);

    fill(255, 190, 30, alpha + 100);
    let sizeIncrease = map(this.age, 0, this.lifeTime, 0, 40);
    this.enemies.forEach(enemy => {
      circle(enemy.position.x, enemy.position.y, enemy.stats.size.value + sizeIncrease);
    });
    pop();
  }
}
