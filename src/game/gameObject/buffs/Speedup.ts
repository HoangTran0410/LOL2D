import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';
import { StatsModifier } from '../Stats';
import ParticleSystem from '../helpers/ParticleSystem';

interface SpeedupParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export default class Speedup extends Buff {
  image = AssetManager.getAsset('spell_ghost');
  name = 'Tăng Tốc';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  percent = 0;

  maxParticleAge = 30;
  particleSystem = new ParticleSystem({
    autoRemoveIfEmpty: false,
    getParticlePosFn: (p: SpeedupParticle) => ({ x: p.x, y: p.y }),
    getParticleSizeFn: () => 30,
    isDeadFn: (p: SpeedupParticle) => {
      return p.age > this.maxParticleAge;
    },
    updateFn: (p: SpeedupParticle) => {
      p.x += p.vx;
      p.y += p.vy;
      p.age += 1;
    },
    drawFn: (p: SpeedupParticle) => {
      strokeWeight(3);
      stroke(255, map(p.age, 0, this.maxParticleAge, 255, 10));
      line(p.x, p.y, p.x + p.vx * 10, p.y + p.vy * 10);
    },
  });

  statsModifier: StatsModifier = new StatsModifier();

  onCreate(): void {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = this.percent;

    this.game.objectManager.addObject(this.particleSystem);
  }

  onActivate(): void {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(): void {
    this.targetUnit.stats.removeModifier(this.statsModifier);
    this.particleSystem.autoRemoveIfEmpty = true;
  }

  onUpdate(): void {
    if (random(1) < 0.2) {
      const targetDestination = p5.Vector.sub(this.targetUnit.destination, this.targetUnit.position);
      const vel = targetDestination.normalize().mult(random(-2, -1));

      const size = this.targetUnit.stats.size.value / 2;
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
