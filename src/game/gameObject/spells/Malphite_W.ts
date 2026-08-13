import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Shield from '../buffs/Shield';
import StatAmp from '../buffs/StatAmp';

export default class Malphite_W extends Spell {
  image = AssetManager.get('spell_malphite_w');
  name = 'Sức Mạnh Đá Tảng (Malphite_W)';
  description =
    'Malphite phình to lớp vỏ đá của mình trong <span class="time">4 giây</span>, nhận <span class="buff">Khiên hấp thụ 25 sát thương</span> và tăng kích thước cơ thể';
  coolDown = 10000;
  manaCost = 40;

  duration = 4000;
  // A champion pool is 100 health, so a shield is sized as a share of that.
  shieldAmount = 25;
  sizeBonus = 10;

  onSpellCast() {
    const shieldBuff = new Shield(this.duration, this.owner, this.owner);
    shieldBuff.image = this.image;
    shieldBuff.amount = this.shieldAmount;
    shieldBuff.color = [180, 170, 205];
    // Without its own id this shares one stack pool with every other bare Shield
    shieldBuff.stackId = 'malphite_w_shield';
    this.owner.addBuff(shieldBuff);

    const bulkBuff = new StatAmp(this.duration, this.owner, this.owner);
    bulkBuff.stackId = 'malphite_w_bulk';
    bulkBuff.image = this.image;
    bulkBuff.name = 'Đá Tảng';
    bulkBuff.bonuses = { size: { baseBonus: this.sizeBonus } };
    this.owner.addBuff(bulkBuff);

    // a shield ring plus a slightly bigger sprite is almost no feedback for a
    // 4-second self-buff, so wrap him in visible stone for exactly as long as
    // the buff lives (the object watches the buff, it does not time itself)
    const armor = new Malphite_W_Armor(this.owner);
    armor.buff = bulkBuff;
    this.game.objectManager.addObject(armor);
  }
}

/** Slabs of rock orbiting Malphite while Brutal Strikes is up. */
export class Malphite_W_Armor extends SpellObject {
  buff: any = null;
  age = 0;
  plateCount = 7;

  _dust: { a: number; r: number; age: number; size: number }[] = [];
  _dustTimer = 0;

  update() {
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    const alive = this.buff && !this.buff.toRemove && !this.owner.isDead;
    if (alive) {
      this._dustTimer += deltaTime;
      if (this._dustTimer >= 90 && this._dust.length < 12) {
        this._dustTimer = 0;
        this._dust.push({
          a: random(TWO_PI),
          r: this.owner.animatedValues.displaySize / 2 + random(0, 10),
          age: 0,
          size: random(4, 9),
        });
      }
    } else if (this._dust.length === 0) {
      this.toRemove = true;
    }

    let i = 0;
    while (i < this._dust.length) {
      const d = this._dust[i];
      d.age += deltaTime;
      if (d.age >= 550) this._dust.splice(i, 1);
      else i++;
    }
  }

  draw() {
    const size = this.owner.animatedValues.displaySize;
    const radius = size / 2;
    const alive = this.buff && !this.buff.toRemove;
    const left =
      alive && this.buff.duration
        ? constrain(1 - this.buff.timeElapsed / this.buff.duration, 0, 1)
        : 0;
    // slams on in the first 200ms, so the cast has a moment of impact
    const slam = constrain(this.age / 200, 0, 1);
    const spin = frameCount / 90;

    push();
    translate(this.position.x, this.position.y);

    // grit crumbling off the shell
    noStroke();
    for (const d of this._dust) {
      const t = d.age / 550;
      fill(150, 142, 175, 150 * (1 - t));
      circle(cos(d.a) * (d.r + t * 8), sin(d.a) * (d.r + t * 8) + t * 6, d.size * (1 - t * 0.5));
    }

    if (alive) {
      // interlocking plates, seated from outside in as the spell lands
      const seat = radius + 16 - 10 * slam;
      for (let i = 0; i < this.plateCount; i++) {
        const a = (i / this.plateCount) * TWO_PI + spin;
        push();
        rotate(a);
        translate(seat, 0);
        rotate(HALF_PI);
        stroke(52, 47, 66, 235);
        strokeWeight(2);
        fill(126, 118, 152, 235 * (0.4 + 0.6 * slam));
        beginShape();
        vertex(-13, -7);
        vertex(-7, -12);
        vertex(11, -8);
        vertex(13, 6);
        vertex(0, 12);
        vertex(-12, 6);
        endShape(CLOSE);
        noStroke();
        fill(196, 188, 220, 170);
        triangle(-7, -8, 4, -7, -3, -1);
        pop();
      }

      // how much of the 4 seconds is left
      noFill();
      stroke(150, 142, 180, 90);
      strokeWeight(4);
      circle(0, 0, radius * 2 + 44);
      stroke(225, 216, 255, 230);
      strokeWeight(4);
      arc(0, 0, radius * 2 + 44, radius * 2 + 44, -HALF_PI, -HALF_PI + TWO_PI * left);
    }

    // the slam itself
    if (this.age < 300) {
      const t = this.age / 300;
      noFill();
      stroke(215, 205, 245, 220 * (1 - t));
      strokeWeight(6 * (1 - t) + 1);
      circle(0, 0, size + 120 * t);
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.owner.animatedValues.displaySize / 2 + 90;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
