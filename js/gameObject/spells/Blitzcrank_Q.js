import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Blitzcrank_Q extends Spell {
  image = ASSETS.Spells.blitzcrank_q;
  description =
    'Bắn bàn tay theo hướng con trỏ (max 400px), kéo kẻ địch đầu tiên trúng phải, gây sát thương và làm choáng chúng trong 0.5 giây';
  coolDown = 1;

  onSpellCast() {
    this.game.objects.push(new Blitzcrank_Q_Object(this.owner));
  }
}

export class Blitzcrank_Q_Object extends SpellObject {
  init() {
    this.range = 400;
    this.speed = 7;
    this.position = this.owner.position.copy();

    let worldMouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = worldMouse.sub(this.position).normalize();
    this.destination = this.position.copy().add(direction.mult(this.range));
  }

  update() {
    let distance = this.destination.dist(this.position);
    if (distance < this.speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    } else {
      let direction = this.destination.copy().sub(this.position).setMag(this.speed);
      this.position.add(direction);
    }
  }

  draw() {
    push();

    // draw line from hand to owner
    stroke(255);
    strokeWeight(2);
    line(this.owner.position.x, this.owner.position.y, this.position.x, this.position.y);

    // draw hand
    let handSize = 20;
    fill(255);
    circle(this.position.x, this.position.y, handSize);

    pop();
  }
}
