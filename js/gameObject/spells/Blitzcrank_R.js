import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Silence from '../buffs/Silence.js';

export default class Blitzcrank_R extends Spell {
  name = 'Trường Điện Từ (Blitzcrank_R)';
  image = ASSETS.Spells.blitzcrank_r;
  description =
    'Kích hoạt trường điện từ bán kính 200px, gây sát thương lên các kẻ địch trong tầm và làm Câm lặng chúng trong 3 giây';
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const range = 200,
      silenceTime = 3000;

    let obj = new Blitzcrank_R_Object(this.owner);
    obj.maxSize = range * 2;
    obj.silenceTime = silenceTime;
    this.game.objects.push(obj);

    // let playersInRange = this.game.players.filter(
    //   champ => champ != this.owner && champ.position.dist(this.owner.position) < range
    // );

    // playersInRange.forEach(champ => {
    //   let silenceBuff = new Silence(5000, this.owner, champ);
    //   champ.addBuff(silenceBuff);
    // });
  }
}

export class Blitzcrank_R_Object extends SpellObject {
  isMissile = false;
  size = 10;
  maxSize = 400;
  silenceTime = 3000;
  lifeTime = 1000;
  starTime = 0;
  expantionSpeed = 15;
  position = this.owner.position.copy();
  playersEffected = [];

  update() {
    this.starTime += deltaTime;
    if (this.starTime > this.lifeTime) this.toRemove = true;

    if (this.size < this.maxSize) this.size += this.expantionSpeed;

    // apply silence
    let playersInRange = this.game.players.filter(
      champ =>
        champ != this.owner &&
        champ.position.dist(this.position) < this.size / 2 && // in range
        !this.playersEffected.find(player => player == champ) // not effected yet
    );

    playersInRange.forEach(champ => {
      let silenceBuff = new Silence(this.silenceTime, this.owner, champ);
      champ.addBuff(silenceBuff);
    });

    this.playersEffected.push(...playersInRange);
  }

  draw() {
    push();

    // draw range circle
    let alpha = map(this.starTime, 0, this.lifeTime, 200, 0);
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
