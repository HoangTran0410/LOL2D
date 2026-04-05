// TODO https://leagueoflegends.fandom.com/wiki/Stun
// https://leagueoflegends.fandom.com/wiki/Root
import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';

// Làm choáng
export default class Stun extends Buff {
  image = AssetManager.getAsset('buff_stun');
  name = 'Choáng';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  statusFlagsToEnable = StatusFlags.Stunned | StatusFlags.Immovable;

  draw(): void {
    // draw buff on target unit
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    translate(pos.x, pos.y);
    rotate(-frameCount / 15);
    image(AssetManager.getAsset('buff_stun')?.data, 0, 0, size, size);
    pop();
  }
}
