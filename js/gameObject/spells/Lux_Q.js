import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import RootBuff from '../buffs/Root.js';

export default class Lux_Q extends Spell {
  name = 'Khóa Ánh Sáng (Lux_Q)';
  image = ASSETS.Spells.lux_q;
  description =
    'Lux phóng ra một quả cầu ánh sáng theo đường thẳng (xa 300px), trói chân 2 kẻ địch đầu tiên trúng phải trong 2 giây.';
  coolDown = 5000;

  onSpellCast() {
    const range = 1000,
      buffTime = 2000;

    let worldMouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = worldMouse.sub(this.owner.position).normalize();
    let destination = this.owner.position.copy().add(direction.mult(range));

    let obj = new Lux_Q_Object(this.owner);
    obj.destination = destination;
    obj.buffTime = buffTime;
    obj.maxPlayersEffected = 2;

    this.game.objects.push(obj);
  }
}

export class Lux_Q_Buff extends RootBuff {
  image = ASSETS.Spells.lux_q;
  buffAddType = BuffAddType.RENEW_EXISTING;

  draw() {
    // draw buff on target unit
    let pos = this.targetUnit.position;
    let size = this.targetUnit.stats.size.value;

    push();
    noFill();
    stroke(255);
    strokeWeight(4);
    circle(pos.x, pos.y, size + random(-5, 10));
    pop();
  }
}

export class Lux_Q_Object extends SpellObject {
  playersEffected = [];
  maxPlayersEffected = 2;
  speed = 7;
  size = 15;
  buffTime = 2000;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();

  update() {
    // move
    let distance = this.destination.dist(this.position);
    if (distance < this.speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    } else {
      let direction = this.destination.copy().sub(this.position).setMag(this.speed);
      this.position.add(direction);
    }

    // check collision with enemy
    for (let champ of this.game.players) {
      if (champ == this.owner || this.playersEffected.includes(champ)) continue;

      let distance = this.position.dist(champ.position);
      if (distance < champ.stats.size.value) {
        champ.addBuff(new Lux_Q_Buff(this.buffTime, this.owner, champ));
        this.playersEffected.push(champ);

        if (this.playersEffected.length === this.maxPlayersEffected) {
          this.toRemove = true;
          break;
        }
      }
    }
  }

  draw() {
    push();
    stroke(255);
    strokeWeight(2);
    fill(255, 150);
    circle(this.position.x, this.position.y, this.size);
    pop();
  }
}
