import { Circle, Rectangle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import RootBuff from '../buffs/Root';

export default class Lux_Q extends Spell {
  name = 'Khóa Ánh Sáng (Lux_Q)';
  image = AssetManager.getAsset('spell_lux_q');
  description =
    'Lux phóng ra một quả cầu ánh sáng theo đường thẳng, gây <span class="damage">20 sát thương</span> và <span class="buff">Trói Chân</span> 2 kẻ địch đầu tiên trúng phải trong <span class="time">2 giây</span>';
  coolDown = 5000;
  manaCost = 20;

  onSpellCast() {
    const range = 500;
    const stunTime = 2000;

    const { from, to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      range
    );

    const obj = new Lux_Q_Object(this.owner);
    obj.destination = destination;
    obj.stunTime = stunTime;
    obj.maxPlayersEffected = 2;

    this.game.objectManager.addObject(obj);
  }
}

export class Lux_Q_Object extends SpellObject {
  isMissile = true;
  playersEffected: any[] = [];
  maxPlayersEffected = 2;
  speed = 7;
  size = 15;
  stunTime = 2000;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();

  update() {
    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

    if (this.destination.dist(this.position) < this.speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    }

    if (this.playersEffected.length === this.maxPlayersEffected) {
      this.toRemove = true;
    } else {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.size / 2,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.playersEffected),
        ],
      });
      const enemy = enemies?.[0];
      if (enemy) {
        const stunBuff = new RootBuff(this.stunTime, this.owner, enemy);
        stunBuff.image = AssetManager.getAsset('spell_lux_q');
        enemy.addBuff(stunBuff);
        enemy.takeDamage(20, this.owner);

        this.playersEffected.push(enemy);
      }
    }
  }

  draw() {
    const alpha = Math.min(255, this.position.dist(this.destination) + 50);

    push();
    stroke(255, alpha);
    strokeWeight(2);
    fill(255, Math.max(50, alpha / 3));
    circle(this.position.x, this.position.y, this.size);

    stroke(255, alpha);
    strokeWeight(2);
    for (let i = 0; i < 5; i++) {
      const angle = random(0, 2 * PI);
      const len = random(this.size, this.size + 10);
      const x = this.position.x + len * cos(angle);
      const y = this.position.y + len * sin(angle);
      line(this.position.x, this.position.y, x, y);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }
}
