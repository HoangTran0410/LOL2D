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

  particleSystem = new ParticleSystem({
    isDeadFn: p => p.r > p.maxR,
    updateFn: p => {
      p.y -= 1;
      p.x += random(-2, 2);
      p.r += 0.5;
    },
    preDrawFn: () => {
      fill(30, 100);
      stroke(100, 100);
      strokeWeight(1);
    },
    drawFn: p => {
      circle(p.x, p.y, p.r);
    },
  });

  onCreate() {
    this.game.addSpellObject(this.particleSystem);
  }

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

    if (random() < 0.3) {
      let s = this.targetUnit.stats.size.value;
      let randPos = this.targetUnit.position.copy().add(p5.Vector.random2D().mult(random(s / 2)));
      this.particleSystem.addParticle({
        x: randPos.x,
        y: randPos.y,
        r: 0,
        maxR: random(10, 50),
      });
    }
    this.particleSystem.update();
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

    this.particleSystem.draw();
  }
}
