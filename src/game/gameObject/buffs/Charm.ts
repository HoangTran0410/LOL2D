// TODO https://leagueoflegends.fandom.com/wiki/Charm

import Buff from '../Buff';
import StatusFlags from '../../enums/StatusFlags';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';
import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import VectorUtils from '../../../utils/vector.utils';

export default class Charm extends Buff {
  image = AssetManager.getAsset('buff_charm');
  name = 'Mê Hoặc';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToDisable = StatusFlags.CanCast | StatusFlags.CanMove;
  statusFlagsToEnable = StatusFlags.Charmed;

  speed = 1;
  particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#f5429588', 0.1);

  onCreate(): void {
    this.game.objectManager.addObject(this.particleSystem);
  }

  onUpdate(): void {
    if (this.sourceUnit?.position && !this.targetUnit.isDead) {
      VectorUtils.moveVectorToVector(
        this.targetUnit.position,
        this.sourceUnit.position,
        this.speed
      );
    }

    // update particle system
    if (random() < 0.2) {
      const range = this.targetUnit.stats.size.value / 2;
      this.particleSystem.addParticle({
        x: this.targetUnit.position.x + random(-range, range),
        y: this.targetUnit.position.y + random(-range, range),
        r: random(5, 15),
      });
    }
    this.particleSystem.update();
  }
}
