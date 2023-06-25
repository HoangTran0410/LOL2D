import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

// Trói chân
export default class Root extends Buff {
  image = ASSETS.Buffs.root;
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  onUpdate() {
    // apply root every frame
    this.targetUnit.status &= ~StatusFlags.CanMove;
  }

  onDeactivate() {
    this.targetUnit.status |= StatusFlags.CanMove;
  }

  draw() {
    // draw buff on target unit
    let pos = this.targetUnit.position;
    let size = this.targetUnit.stats.size.value;

    push();
    noFill();
    stroke(255, 200);
    strokeWeight(4);
    circle(pos.x, pos.y, size + random(-3, 3));
    pop();
  }
}