// TODO https://leagueoflegends.fandom.com/wiki/Flee

import AssetManager from '@/managers/AssetManager';
import VectorUtils from '@/utils/vector.utils';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

export default class Fear extends Buff {
  image: Buff['image'] = AssetManager.get('buff_fear');
  name = 'Sợ Hãi';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToEnable = StatusFlags.Feared;

  speed = 1;
  sourcePosition: p5.Vector | null = null;

  onUpdate(): void {
    if (
      (this.sourcePosition || this.sourceUnit?.position) &&
      this.targetUnit &&
      !this.targetUnit.isDead
    ) {
      const destination = this.targetUnit.position
        .copy()
        .sub(this.sourcePosition || this.sourceUnit.position)
        .setMag(1000)
        .add(this.targetUnit.position);
      VectorUtils.moveVectorToVector(this.targetUnit.position, destination, this.speed);
    }
  }

  draw(): void {
    push();
    fill(30, 150);
    circle(
      this.targetUnit.position.x,
      this.targetUnit.position.y,
      this.targetUnit.stats.size.value + random(-10, 10)
    );
    image(
      AssetManager.renderable(this.image ?? undefined),
      this.targetUnit.position.x,
      this.targetUnit.position.y,
      Math.min(40, this.targetUnit.stats.size.value),
      Math.min(40, this.targetUnit.stats.size.value)
    );

    pop();
  }
}
