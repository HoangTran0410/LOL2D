// TODO https://leagueoflegends.fandom.com/wiki/Flee

import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';
import ParticleSystem from '../helpers/ParticleSystem.js';

export default class Fear extends Buff {
  image = AssetManager.getAsset('buff_fear');
  name = 'Sợ Hãi';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToEnable = StatusFlags.Feared;

  speed = 1;
  sourcePosition = null;

  onUpdate() {
    if (
      (this.sourcePosition || this.sourceUnit?.position) &&
      this.targetUnit &&
      !this.targetUnit.isDead
    ) {
      let destination = this.targetUnit.position
        .copy()
        .sub(this.sourcePosition || this.sourceUnit.position)
        .setMag(1000)
        .add(this.targetUnit.position);
      VectorUtils.moveVectorToVector(this.targetUnit.position, destination, this.speed);
    }
  }

  draw() {
    push();
    fill(30, 150);
    circle(
      this.targetUnit.position.x,
      this.targetUnit.position.y,
      this.targetUnit.stats.size.value + random(-10, 10)
    );
    image(
      this.image.data,
      this.targetUnit.position.x,
      this.targetUnit.position.y,
      Math.min(40, this.targetUnit.stats.size.value),
      Math.min(40, this.targetUnit.stats.size.value)
    );

    pop();
  }
}
