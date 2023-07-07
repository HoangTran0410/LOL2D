// https://leagueoflegends.fandom.com/wiki/Silence
import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

// Câm lặng
export default class Silence extends Buff {
  image = AssetManager.getAsset('buff_silence');
  name = 'Câm Lặng';
  buffAddType = BuffAddType.RENEW_EXISTING;
  statusFlagsToEnable = StatusFlags.Silenced;

  draw() {
    // draw buff on target unit
    let pos = this.targetUnit.position;
    let size = this.targetUnit.stats.size.value;

    push();
    fill(30, 150);
    circle(pos.x, pos.y, size + random(-5, 10));
    pop();
  }
}
