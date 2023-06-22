import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Blitzcrank_Q extends Spell {
  image = ASSETS.Spells.blitzcrank_q;
  description =
    'Bắn bàn tay theo hướng con trỏ (max 400px), kéo kẻ địch đầu tiên trúng phải, gây sát thương và làm choáng chúng trong 0.5 giây';
  coolDown = 3000;

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

    this.STATE = {
      FORWARD: 'forward',
      GRAB: 'grab',
    };
    this.state = this.STATE.FORWARD;
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

    // check collision with enemy
    if (this.state == this.STATE.FORWARD) {
      for (let champ of this.game.players) {
        if (champ != this.owner) {
          let distance = champ.position.dist(this.position);
          if (distance < champ.stats.size.value / 2) {
            this.state = this.STATE.GRAB;
            this.champToGrab = champ;
            this.destination = this.owner.position;
            break;
          }
        }
      }
    } else if (this.champToGrab) {
      this.champToGrab.position = this.position.copy();
    }
  }

  draw() {
    push();

    // draw line from hand to owner
    stroke(255);
    strokeWeight(2);
    line(this.owner.position.x, this.owner.position.y, this.position.x, this.position.y);

    // draw hand with five circle fingers
    let handSize = 30;
    noStroke();
    fill(255, 150, 50);
    circle(this.position.x, this.position.y, handSize);

    fill(200, 100, 90, 200);
    let dir = this.destination.copy().sub(this.owner.position).normalize();
    for (let i = 0; i < 3; i++) {
      let angle = dir.heading() + (i - 1) * 0.5;
      let x = this.position.x + cos(angle) * handSize;
      let y = this.position.y + sin(angle) * handSize;
      circle(x, y, 15);
    }

    pop();
  }
}
