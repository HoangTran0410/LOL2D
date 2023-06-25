import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import RootBuff from '../buffs/Root.js';

export default class Lux_Q extends Spell {
  name = 'Khóa Ánh Sáng (Lux_Q)';
  image = ASSETS.Spells.lux_q;
  description =
    'Lux phóng ra một quả cầu ánh sáng theo đường thẳng (xa 500px), trói chân 2 kẻ địch đầu tiên trúng phải trong 2 giây.';
  coolDown = 5000;

  onSpellCast() {
    const range = 500,
      stunTime = 2000;

    let worldMouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = worldMouse.sub(this.owner.position).normalize();
    let destination = this.owner.position.copy().add(direction.mult(range));

    let obj = new Lux_Q_Object(this.owner);
    obj.destination = destination;
    obj.stunTime = stunTime;
    obj.maxPlayersEffected = 2;

    this.game.objects.push(obj);
  }
}

export class Lux_Q_Object extends SpellObject {
  playersEffected = [];
  maxPlayersEffected = 2;
  speed = 7;
  size = 15;
  stunTime = 2000;
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
        let stunBuff = new RootBuff(this.stunTime, this.owner, champ);
        stunBuff.image = ASSETS.Spells.lux_q;
        champ.addBuff(stunBuff);

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

    // random 10 rays of light
    stroke(255, 200);
    strokeWeight(2);
    for (let i = 0; i < 10; i++) {
      let angle = random(0, 2 * PI);
      let len = random(this.size, this.size + 10);
      let x = this.position.x + len * cos(angle);
      let y = this.position.y + len * sin(angle);
      line(this.position.x, this.position.y, x, y);
    }
    pop();
  }
}
