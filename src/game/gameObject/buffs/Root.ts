// https://leagueoflegends.fandom.com/wiki/Root
import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';

// Trói chân
export default class Root extends Buff {
  image = AssetManager.getAsset('buff_root');
  name = 'Trói';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  effectColor: [number, number, number, number] = [255, 255, 255, 200];
  statusFlagsToEnable = StatusFlags.Rooted;
  statusFlagsToDisable = StatusFlags.CanMove;

  draw(): void {
    // draw buff on target unit
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    noFill();
    stroke(this.effectColor);
    strokeWeight(4);
    circle(pos.x, pos.y, size + random(-3, 3));
    pop();
  }
}
