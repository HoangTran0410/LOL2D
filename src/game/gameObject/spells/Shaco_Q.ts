import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Invisible from '../buffs/Invisible';
import Speedup from '../buffs/Speedup';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';

export default class Shaco_Q extends Spell {
  image = AssetManager.getAsset('spell_shaco_q');
  name = 'Lừa Gạt (Shaco_Q)';
  description =
    '<span class="buff">Dịch chuyển</span> đến vị trí chỉ định, trở nên <span class="buff">Tàng Hình</span> trong <span class="time">2 giây</span> và <span class="buff">Tăng Tốc 40%</span> trong thời gian tàng hình.';
  coolDown = 5000;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      200
    );

    // flash to position
    this.owner.moveTo(to.x, to.y);
    this.owner.position.set(to.x, to.y);

    // stealth buff
    const insivibleBuff = new Invisible(2000, this.owner, this.owner);
    this.owner.addBuff(insivibleBuff);

    // speedup buff
    const speedupBuff = new Speedup(2000, this.owner, this.owner);
    speedupBuff.image = this.image;
    speedupBuff.percent = 0.4;
    this.owner.addBuff(speedupBuff);

    const obj = new Shaco_Q_Object(this.owner, from);
    obj.position = from;
    this.game.objectManager.addObject(obj);
  }
}

export class Shaco_Q_Object extends SpellObject {
  particleSystem = PredefinedParticleSystems.smoke([255, 130, 80], 2, 3);

  constructor(owner: any, position: p5.Vector) {
    super(owner);
    this.position = position;
  }

  onAdded() {
    const pos = this.position;
    const size = this.owner.stats.size.value / 2;
    for (let i = 0; i < 7; i++) {
      this.particleSystem.addParticle({
        x: pos.x + random(-size, size),
        y: pos.y + random(-size, size),
        size: random(10, 20),
        opacity: random(100, 200),
      });
    }

    this.game.objectManager.addObject(this.particleSystem);
    this.toRemove = true;
  }
}
