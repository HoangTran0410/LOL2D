import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Invisible from '../buffs/Invisible';
import Speedup from '../buffs/Speedup';

export default class Twitch_Q extends Spell {
  image = AssetManager.getAsset('spell_twitch_q');
  name = 'Ẩn Mình (Twitch_Q)';
  description =
    '<span class="buff">Tàng Hình</span> và <span class="buff">Tăng Tốc 25%</span> trong <span class="time">4 giây</span>';
  coolDown = 14000;
  manaCost = 40;

  duration = 4000;
  speedupPercent = 0.25;

  onSpellCast() {
    const invisibleBuff = new Invisible(this.duration, this.owner, this.owner);
    invisibleBuff.image = this.image;
    this.owner.addBuff(invisibleBuff);

    const speedupBuff = new Speedup(this.duration, this.owner, this.owner);
    speedupBuff.image = this.image;
    speedupBuff.percent = this.speedupPercent;
    this.owner.addBuff(speedupBuff);

    const obj = new Twitch_Q_Object(this.owner);
    this.game.objectManager.addObject(obj);
  }
}

/** The puff of smoke Twitch vanishes into. */
export class Twitch_Q_Object extends SpellObject {
  position = this.owner.position.copy();
  age = 0;
  lifeTime = 500;
  maxRadius = 55;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const progress = this.age / this.lifeTime;
    const alpha = map(this.age, 0, this.lifeTime, 180, 0);

    push();
    noStroke();
    fill(120, 160, 110, alpha);
    for (let i = 0; i < 5; i++) {
      const angle = (i * TWO_PI) / 5;
      const distance = progress * this.maxRadius;
      circle(
        this.position.x + cos(angle) * distance,
        this.position.y + sin(angle) * distance,
        25 + progress * 20
      );
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.maxRadius - 25,
      y: this.position.y - this.maxRadius - 25,
      w: (this.maxRadius + 25) * 2,
      h: (this.maxRadius + 25) * 2,
      data: this,
    });
  }
}
