import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Invisible from '../buffs/Invisible.js';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem.js';
import { Ghost_Buff, Ghost_Buff_Object } from './Ghost.js';

export default class Shaco_Q extends Spell {
  image = AssetManager.getAsset('spell_shaco_q');
  name = 'Lừa Gạt (Shaco_Q)';
  description =
    'Dịch chuyển đến vị trí chỉ định (tối đa 200 khoảng cách) và trở nên tàng hình trong 2s, tăng 40% tốc độ di chuyển trong thời gian tàng hình.';
  coolDown = 5000;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      200
    );

    // flash to position
    this.owner.moveTo(to.x, to.y);
    this.owner.position.set(to.x, to.y);

    // stealth buff
    let insivibleBuff = new Invisible(2000, this.owner, this.owner);
    this.owner.addBuff(insivibleBuff);

    // speedup buff
    let speedUpEffect = new Ghost_Buff_Object(this.owner);
    this.game.addSpellObject(speedUpEffect);

    let speedupBuff = new Shaco_Q_Buff(2000, this.owner, this.owner);
    speedupBuff.addDeactivateListener(() => {
      speedUpEffect.toRemove = true;
    });
    this.owner.addBuff(speedupBuff);

    let obj = new Shaco_Q_Object(this.owner, from);
    this.game.addSpellObject(obj);
  }

  onUpdate() {}
}

export class Shaco_Q_Buff extends Ghost_Buff {
  buffAddType = BuffAddType.REPLACE_EXISTING;
  percent = 0.4;
}

export class Shaco_Q_Object extends SpellObject {
  particleSystem = PredefinedParticleSystems.smoke([255, 130, 80], 2, 3);

  constructor(owner, position) {
    super(owner);

    let pos = position || this.owner.position;
    let size = this.owner.stats.size.value / 2;
    for (let i = 0; i < 7; i++) {
      this.particleSystem.addParticle({
        x: pos.x + random(-size, size),
        y: pos.y + random(-size, size),
        size: random(10, 20),
        opacity: random(100, 200),
      });
    }
  }

  update() {
    this.particleSystem.update();
    this.toRemove = this.particleSystem.toRemove;
  }

  draw() {
    this.particleSystem.draw();
  }
}