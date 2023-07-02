// https://leagueoflegends.fandom.com/wiki/Root
import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

// Trói chân
export default class Root extends Buff {
  image = AssetManager.getAsset('buff_root');
  name = 'Trói';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  effectColor = [255, 255, 255, 200];

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
    stroke(this.effectColor);
    strokeWeight(4);
    circle(pos.x, pos.y, size + random(-3, 3));
    pop();
  }
}
