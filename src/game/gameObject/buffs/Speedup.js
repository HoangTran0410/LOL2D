import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';
import ParticleSystem from '../helpers/ParticleSystem.js';

export default class Speedup extends Buff {
  image = AssetManager.getAsset('spell_ghost');
  name = 'Tăng Tốc';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  percent = 0;

  maxParticleAge = 30;
  particleSystem = new ParticleSystem({
    autoRemoveIfEmpty: false,
    isDeadFn: p => {
      return p.age > this.maxParticleAge;
    },
    updateFn: p => {
      p.x += p.vx;
      p.y += p.vy;
      p.age += 1;
    },
    drawFn: p => {
      strokeWeight(3);
      stroke(255, map(p.age, 0, this.maxParticleAge, 255, 10));
      line(p.x, p.y, p.x + p.vx * 10, p.y + p.vy * 10);
    },
  });

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = this.percent;

    this.game.addObject(this.particleSystem);
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
    this.particleSystem.autoRemoveIfEmpty = true;
  }

  onUpdate() {
    if (random(1) < 0.2) {
      let targetDestination = p5.Vector.sub(this.targetUnit.destination, this.targetUnit.position);
      let vel = targetDestination.normalize().mult(random(-2, -1));

      let size = this.targetUnit.stats.size.value / 2;
      this.particleSystem.addParticle({
        x: this.targetUnit.position.x + random(-size, size),
        y: this.targetUnit.position.y + random(-size, size),
        vx: vel.x,
        vy: vel.y,
        age: 0,
      });
    }
  }
}
