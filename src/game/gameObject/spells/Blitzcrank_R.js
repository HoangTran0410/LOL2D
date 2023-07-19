import { Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Silence from '../buffs/Silence.js';

export default class Blitzcrank_R extends Spell {
  name = 'Trường Điện Từ (Blitzcrank_R)';
  image = AssetManager.getAsset('spell_blitzcrank_r');
  description =
    'Kích hoạt trường điện từ, gây <span class="damage">30 sát thương</span> lên các kẻ địch xung quanh và làm <span class="buff">Câm Lặng</span> chúng trong <span class="time">3 giây</span>';
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const range = 200,
      silenceTime = 3000;

    let obj = new Blitzcrank_R_Object(this.owner);
    obj.maxSize = range * 2;
    obj.silenceTime = silenceTime;
    this.game.objectManager.addObject(obj);
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

    this.size = Math.min(this.size + this.expantionSpeed, this.maxSize);

    // apply silence
    let enemies = this.game.queryPlayersInRange({
      position: this.position,
      range: this.size / 2,
      includePlayerSize: true,
      excludeTeamIds: [this.owner.teamId],
      excludePlayers: this.playersEffected,
    });

    enemies.forEach(enemy => {
      let silenceBuff = new Silence(this.silenceTime, this.owner, enemy);
      silenceBuff.image = AssetManager.getAsset('spell_blitzcrank_r');
      enemy.addBuff(silenceBuff);
      enemy.takeDamage(30, this.owner);
    });

    this.playersEffected.push(...enemies);
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

  getBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }
}
