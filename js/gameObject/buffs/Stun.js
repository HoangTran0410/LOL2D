// TODO https://leagueoflegends.fandom.com/wiki/Stun
// https://leagueoflegends.fandom.com/wiki/Root

import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

// Làm choáng
export default class Stun extends Buff {
  image = ASSETS.Buffs.stun;
  name = 'Choáng';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  onUpdate() {
    // apply root every frame
    this.targetUnit.status &= ~StatusFlags.CanCast;
    this.targetUnit.status &= ~StatusFlags.CanMove;
  }

  onDeactivate() {
    this.targetUnit.status |= StatusFlags.CanCast;
    this.targetUnit.status |= StatusFlags.CanMove;
  }

  draw() {
    // draw buff on target unit
    let pos = this.targetUnit.position;
    let size = this.targetUnit.stats.size.value;

    push();
    translate(pos.x, pos.y);
    rotate(-frameCount / 15);
    image(ASSETS.Buffs.stun.image, 0, 0, size, size);
    pop();
  }
}
