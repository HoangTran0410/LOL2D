// https://leagueoflegends.fandom.com/wiki/Silence
import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

// Câm lặng
export default class Silence extends Buff {
  image: Buff['image'] = AssetManager.get('buff_silence');
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
