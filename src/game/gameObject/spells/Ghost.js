import Spell from '../Spell.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';
import BuffAddType from '../../enums/BuffAddType.js';
import SpellObject from '../SpellObject.js';
import SOUNDS, { playSound } from '../../../../assets/sounds/index.js';
import AssetManager from '../../../managers/AssetManager.js';
import ParticleSystem from '../helpers/ParticleSystem.js';

export default class Ghost extends Spell {
  name = 'Tốc Hành (Ghost)';
  image = AssetManager.getAsset('spell_ghost');
  description = 'Tăng 50% tốc độ di chuyển trong 5s';
  coolDown = 7000;
  manaCost = 100;

  onSpellCast() {
    let ghostBuff = new Ghost_Buff(5000, this.owner, this.owner);
    this.owner.addBuff(ghostBuff);

    let ghostBuffObject = new Ghost_Buff_Object(this.owner);
    this.game.addSpellObject(ghostBuffObject);

    ghostBuff.addDeactivateListener(() => {
      ghostBuffObject.toRemove = true;
    });

    playSound(SOUNDS.ghost);
  }
}

export class Ghost_Buff extends Buff {
  image = AssetManager.getAsset('spell_ghost');
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  percent = 0.5;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = this.percent;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}

export class Ghost_Buff_Object extends SpellObject {
  maxAge = 30;

  particleSystem = new ParticleSystem({
    isDeadFn: p => {
      return p.age > this.maxAge;
    },
    updateFn: p => {
      p.x += p.vx;
      p.y += p.vy;
      p.age += 1;
    },
    drawFn: p => {
      stroke(255, map(p.age, 0, this.maxAge, 255, 10));
      line(p.x, p.y, p.x + p.vx * 10, p.y + p.vy * 10);
    },
  });

  update() {
    if (random(1) < 0.2) {
      let ownerDirection = p5.Vector.sub(this.owner.destination, this.owner.position);
      let vel = ownerDirection.normalize().mult(random(-2, -1));

      let size = this.owner.stats.size.value / 2;
      this.particleSystem.addParticle({
        x: this.owner.position.x + random(-size, size),
        y: this.owner.position.y + random(-size, size),
        vx: vel.x,
        vy: vel.y,
        age: 0,
      });
    }

    this.particleSystem.update();
  }

  draw() {
    push();
    strokeWeight(3);
    this.particleSystem.draw();
    pop();
  }
}
