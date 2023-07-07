import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import RootBuff from '../buffs/Root.js';

export default class Lux_Q extends Spell {
  name = 'Khóa Ánh Sáng (Lux_Q)';
  image = AssetManager.getAsset('spell_lux_q');
  description =
    'Lux phóng ra một quả cầu ánh sáng theo đường thẳng, gây 20 sát thương và trói chân 2 kẻ địch đầu tiên trúng phải trong 2 giây.';
  coolDown = 5000;
  manaCost = 20;

  onSpellCast() {
    const range = 500,
      stunTime = 2000;

    let { from, to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      range
    );

    let obj = new Lux_Q_Object(this.owner);
    obj.destination = destination;
    obj.stunTime = stunTime;
    obj.maxPlayersEffected = 2;

    this.game.addSpellObject(obj);
  }
}

export class Lux_Q_Object extends SpellObject {
  isMissile = true;
  playersEffected = [];
  maxPlayersEffected = 2;
  speed = 7;
  size = 15;
  stunTime = 2000;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();

  update() {
    // move
    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

    if (this.destination.dist(this.position) < this.speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    }

    if (this.playersEffected.length === this.maxPlayersEffected) {
      this.toRemove = true;
    }

    // check collision with enemy
    else {
      let enemy = this.game.queryPlayerInRange({
        position: this.position,
        range: this.size,
        includePlayerSize: true,
        excludePlayers: [this.owner, ...this.playersEffected],
        getOnlyOne: true,
      });

      if (enemy) {
        let stunBuff = new RootBuff(this.stunTime, this.owner, enemy);
        stunBuff.image = AssetManager.getAsset('spell_lux_q');
        enemy.addBuff(stunBuff);
        enemy.takeDamage(20, this.owner);

        this.playersEffected.push(enemy);
      }
    }
  }

  draw() {
    let alpha = Math.min(255, this.position.dist(this.destination) + 50);

    push();
    stroke(255, alpha);
    strokeWeight(2);
    fill(255, Math.max(50, alpha / 3));
    circle(this.position.x, this.position.y, this.size);

    // random 10 rays of light
    stroke(255, alpha);
    strokeWeight(2);
    for (let i = 0; i < 5; i++) {
      let angle = random(0, 2 * PI);
      let len = random(this.size, this.size + 10);
      let x = this.position.x + len * cos(angle);
      let y = this.position.y + len * sin(angle);
      line(this.position.x, this.position.y, x, y);
    }
    pop();
  }
}
