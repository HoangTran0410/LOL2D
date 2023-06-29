import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

// Đã chết
export default class Died extends Buff {
  name = 'Đã chết';
  buffAddType = BuffAddType.RENEW_EXISTING;

  onUpdate() {
    this.targetUnit.status &= ~StatusFlags.CanCast;
    this.targetUnit.status &= ~StatusFlags.CanMove;
    this.targetUnit.status |= StatusFlags.Ghosted;
  }

  onDeactivate() {
    this.targetUnit.status |= StatusFlags.CanCast;
    this.targetUnit.status |= StatusFlags.CanMove;
    this.targetUnit.status &= ~StatusFlags.Ghosted;

    let range = 2000;
    this.targetUnit.position.add(random(-range, range), random(-range, range));
  }

  draw() {
    // draw buff on target unit
    let pos = this.targetUnit.position;
    let size = this.targetUnit.stats.size.value;

    push();
    translate(pos.x, pos.y);

    // draw black circle
    fill(0, 200);
    noStroke();
    circle(0, 0, size + random(-3, 3));

    // draw X using 2 rects
    fill(255, 0, 0);
    noStroke();
    rotate(PI / 4);
    rectMode(CENTER);
    rect(0, 0, size, 15);
    rect(0, 0, 15, size);
    pop();
  }
}
