import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Blitzcrank_R extends Spell {
  image = ASSETS.Spells.blitzcrank_r;
  description =
    'Kích hoạt trường điện từ bán kính 200px, gây sát thương lên các kẻ địch trong tầm và làm Câm lặng chúng trong 0.5 giây';
  coolDown = 5000;

  onSpellCast() {
    this.game.objects.push(new Blitzcrank_R_Object(this.owner));

    // TODO add damage and silence
  }
}

export class Blitzcrank_R_Object extends SpellObject {
  size = 10;
  maxSize = 400;
  liveTime = 1000;
  starTime = 0;
  position = this.owner.position.copy();

  update() {
    this.starTime += deltaTime;
    if (this.starTime > this.liveTime) this.toRemove = true;

    if (this.size < this.maxSize) this.size += 35;
  }

  draw() {
    push();

    // draw range circle
    let alpha = map(this.starTime, 0, this.liveTime, 200, 0);
    stroke(255, 50 + alpha);
    strokeWeight(2);
    fill(255, alpha);
    circle(this.position.x, this.position.y, this.size);

    // draw lightning effect, random from center to edge of circle
    for (let i = 0; i < 50; i++) {
      let start = p5.Vector.random2D().mult(random(this.size / 2));
      let end = p5.Vector.random2D().mult(this.size / 2);

      line(
        this.position.x + start.x,
        this.position.y + start.y,
        this.position.x + end.x,
        this.position.y + end.y
      );
    }

    pop();
  }
}
