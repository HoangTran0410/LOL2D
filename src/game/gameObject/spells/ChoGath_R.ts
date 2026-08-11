import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import StatAmp from '../buffs/StatAmp';

/** One Feast stack. Kept as constants so the heal matches the max health gained. */
const SIZE_PER_STACK = 6;
const MAX_HEALTH_PER_STACK = 75;

export default class ChoGath_R extends Spell {
  image = AssetManager.getAsset('spell_chogath_r');
  name = "Ăn Thịt (Cho'Gath_R)";
  description =
    'Ngoạm kẻ địch gần nhất trong phạm vi <span>200px</span>, gây <span class="damage">40 sát thương</span>. Mỗi lần ăn, Cho\'Gath <span class="buff">To Lên Vĩnh Viễn</span>: cộng dồn <span>+6 kích thước</span> và <span class="buff">+75 máu tối đa</span>';
  coolDown = 20000;
  manaCost = 50;
  willDrawPreview = true;

  range = 200;
  damage = 40;
  /** Effectively permanent — long enough that a match ends before it reverts. */
  growthDuration = 600000;

  checkCastCondition() {
    return !!this._findNearestEnemy();
  }

  onSpellCast() {
    const target = this._findNearestEnemy();
    if (!target) return;

    target.takeDamage(this.damage, this.owner);

    const growth = new ChoGath_R_Growth(this.growthDuration, this.owner, this.owner);
    growth.image = this.image;
    this.owner.addBuff(growth);

    // the extra max health is only worth something if it comes filled in
    this.owner.takeHeal(MAX_HEALTH_PER_STACK, this.owner);

    const obj = new ChoGath_R_Object(this.owner);
    obj.position = target.position.copy();
    this.game.objectManager.addObject(obj);
  }

  _findNearestEnemy() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    let nearest = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const distance = this.owner.position.dist(enemy.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = enemy;
      }
    }
    return nearest;
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

/**
 * Its own class rather than a bare `StatAmp`: `addBuff` groups stacks by
 * constructor, so a one-stack StatAmp from some other spell would otherwise
 * knock a Feast stack off the moment it landed.
 */
export class ChoGath_R_Growth extends StatAmp {
  name = 'Ăn Thịt';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 99;

  bonuses = {
    size: { baseBonus: SIZE_PER_STACK },
    maxHealth: { baseBonus: MAX_HEALTH_PER_STACK },
  };
}

/** The bite mark left on the victim. */
export class ChoGath_R_Object extends SpellObject {
  size = 90;
  lifeTime = 400;
  age = 0;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const alpha = 220 * (1 - t);
    // the jaws start wide open and snap shut
    const gap = (1 - t) * (PI / 3);

    push();
    noStroke();
    fill(150, 60, 70, alpha);
    arc(this.position.x, this.position.y, this.size, this.size, gap, PI - gap, PIE);
    arc(this.position.x, this.position.y, this.size, this.size, PI + gap, TWO_PI - gap, PIE);
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
