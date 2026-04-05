// https://leagueoflegends.fandom.com/wiki/Silence
import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';

// Câm lặng
export default class Silence extends Buff {
  image = AssetManager.getAsset('buff_silence');
  name = 'Câm Lặng';
  buffAddType = BuffAddType.RENEW_EXISTING;
  statusFlagsToEnable = StatusFlags.Silenced;

  draw(): void {
    // draw buff on target unit
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    fill(100, 100);
    stroke(200, 100);
    strokeWeight(2);
    circle(pos.x, pos.y, size + random(-5, 10));
    pop();
  }
}
