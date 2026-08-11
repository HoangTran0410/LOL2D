import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Dash from '../buffs/Dash';

export default class Warwick_Q extends Spell {
  image = AssetManager.getAsset('spell_warwick_q');
  name = 'Nanh Vuốt (Warwick_Q)';
  description =
    'Vồ tới kẻ địch gần nhất trong phạm vi, cắn xé gây <span class="damage">30 sát thương</span> và <span class="buff">Hồi 15 máu</span> cho bản thân';
  coolDown = 7000;
  manaCost = 30;

  range = 350;
  damage = 30;
  healAmount = 15;

  findNearestEnemy(): any {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    let nearestEnemy: any = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const distance = enemy.position.dist(this.owner.position);
      if (distance < nearestDistance) {
        nearestEnemy = enemy;
        nearestDistance = distance;
      }
    }
    return nearestEnemy;
  }

  checkCastCondition() {
    return Dash.CanDash(this.owner) && !!this.findNearestEnemy();
  }

  onSpellCast() {
    const target = this.findNearestEnemy();
    if (!target) return;

    const dashBuff = new Dash(3000, this.owner, this.owner);
    dashBuff.image = this.image;
    dashBuff.dashDestination = target.position; // live ref: the pounce tracks its prey
    dashBuff.dashSpeed = 13;
    dashBuff.onReachedDestination = () => {
      if (!target.isDead) target.takeDamage(this.damage, this.owner);
      this.owner.takeHeal(this.healAmount, this.owner);

      const obj = new Warwick_Q_Object(this.owner);
      obj.position = target.position.copy();
      this.game.objectManager.addObject(obj);
    };
    this.owner.addBuff(dashBuff);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

/** Claw marks left where the pounce landed. */
export class Warwick_Q_Object extends SpellObject {
  position = this.owner.position.copy();
  age = 0;
  lifeTime = 400;
  size = 50;
  angle = random(TWO_PI);

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const alpha = map(this.age, 0, this.lifeTime, 230, 0);

    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);
    noFill();
    stroke(220, 60, 60, alpha);
    strokeWeight(4);
    for (let i = -1; i <= 1; i++) {
      arc(i * 12, 0, this.size, this.size, -PI / 3, PI / 3);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size,
      y: this.position.y - this.size,
      w: this.size * 2,
      h: this.size * 2,
      data: this,
    });
  }
}
