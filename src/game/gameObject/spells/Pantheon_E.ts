import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Shield from '../buffs/Shield';

export const DURATION = 1600;
export const SHIELD_AMOUNT = 60;
export const DAMAGE_PER_TICK = 6;
export const TICK_INTERVAL = 400;
export const REACH = 200;
export const HALF_WIDTH = 70;

/**
 * Aegis Assault: he plants the shield in one direction and hammers everything
 * in front of it. The shield is the point — a window where he can stand in a
 * fight he would otherwise have to walk out of.
 */
export default class Pantheon_E extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_pantheon_e');
  name = 'Khiên Chắn Tấn Công (Pantheon_E)';
  description =
    `Dựng khiên về hướng chỉ định trong <span class="time">${DURATION / 1000} giây</span>:` +
    ` nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span> và đâm liên tục` +
    ` <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi nhịp cho kẻ địch phía trước`;
  coolDown = 10000;
  manaCost = 35;

  onSpellCast() {
    const shield = new Shield(DURATION, this.owner, this.owner);
    shield.stackId = 'pantheon_e';
    shield.image = this.image;
    shield.amount = SHIELD_AMOUNT;
    shield.color = [170, 210, 255];
    this.owner.addBuff(shield);

    const wall = new Pantheon_E_Object(this.owner);
    wall.direction = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, 1).to
      .copy()
      .sub(this.owner.position);
    this.game.objectManager.addObject(wall);
  }

  drawPreview() {
    super.drawPreview(REACH);
  }
}

export class Pantheon_E_Object extends SpellObject {
  direction: p5.Vector = this.owner.position.copy();
  lifeTime = DURATION;
  age = 0;
  sinceTick = 0;
  visionRadius = REACH;

  update() {
    this.position = this.owner.position.copy();
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    if (this.age >= this.lifeTime || this.owner.isDead) {
      this.toRemove = true;
      return;
    }
    if (this.sinceTick < TICK_INTERVAL) return;
    this.sinceTick -= TICK_INTERVAL;

    // A circle query filtered down to the half-plane in front of him: the
    // shield only covers one side, and the damage has to agree with the art.
    const heading = Math.atan2(this.direction.y, this.direction.x);
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: REACH }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => {
      const toEnemy = Math.atan2(
        enemy.position.y - this.position.y,
        enemy.position.x - this.position.x
      );
      let delta = Math.abs(toEnemy - heading) % (Math.PI * 2);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      if (delta > Math.atan2(HALF_WIDTH, REACH * 0.5)) return;
      enemy.takeDamage(DAMAGE_PER_TICK, this.owner);
    });
  }

  draw() {
    const heading = Math.atan2(this.direction.y, this.direction.x);
    const jab = Math.abs(Math.sin(this.age / (TICK_INTERVAL / 2)));
    push();
    translate(this.position.x, this.position.y);
    rotate(heading);
    noStroke();
    fill(150, 200, 255, 60);
    arc(0, 0, REACH * 2, REACH * 2, -0.55, 0.55, PIE);
    // the shield face, and the spear stabbing past it
    fill(190, 225, 255, 220);
    rect(24, -34, 12, 68, 4);
    stroke(230, 245, 255, 240);
    strokeWeight(5);
    line(30, 0, 60 + jab * 40, 0);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - REACH,
      y: this.position.y - REACH,
      w: REACH * 2,
      h: REACH * 2,
      data: this,
    });
  }
}
