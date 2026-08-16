import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import AoePulse from '../spellObjects/AoePulse';
import Slow from '../buffs/Slow';

export const MAX_RANGE = 900;
export const RADIUS = 240;
export const DAMAGE = 55;
export const WARNING_MS = 1200;

/**
 * Grand Starfall. Long range, big circle, and a second of warning drawn on the
 * ground — an ultimate that is dodgeable by walking is the house style (see
 * the combat notes in CLAUDE.md: dangerous, but never unavoidable).
 */
export default class Pantheon_R extends Spell {
  targetingMode = 'POINT' as const;
  image = AssetManager.get('spell_pantheon_r');
  name = 'Thiên Thạch Giáng Thế (Pantheon_R)';
  description =
    `Phóng ngọn giáo lên trời; sau <span class="time">${WARNING_MS / 1000} giây</span> nó rơi xuống` +
    ` vị trí chỉ định (xa tới <span>${MAX_RANGE}px</span>), gây <span class="damage">${DAMAGE} sát thương</span>` +
    ` và <span class="buff">Làm Chậm 60%</span> trong <span>${RADIUS}px</span>`;
  coolDown = 10000;
  manaCost = 80;

  maxRange = MAX_RANGE;

  onSpellCast() {
    const aim = this.aimPoint;
    const landing = aim
      .copy()
      .sub(this.owner.position)
      .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
      .add(this.owner.position);

    const star = new Pantheon_R_Object(this.owner);
    star.position = landing;
    this.game.objectManager.addObject(star);
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}

export class Pantheon_R_Object extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  radius = RADIUS;
  visionRadius = RADIUS;
  lifeTime = WARNING_MS;
  age = 0;

  update() {
    this.age += deltaTime;
    if (this.age < this.lifeTime) return;
    this.toRemove = true;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => {
      enemy.takeDamage(DAMAGE, this.owner);
      const slow = new Slow(2000, this.owner, enemy);
      slow.percent = 0.6;
      enemy.addBuff(slow);
    });

    const impact = new AoePulse(this.owner);
    impact.position = this.position.copy();
    impact.radius = this.radius;
    impact.lifeTime = 600;
    impact.color = [255, 240, 190];
    impact.style = 'crater';
    impact.spokes = 14;
    this.game.objectManager.addObject(impact);
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    push();
    translate(this.position.x, this.position.y);
    // the circle fills up as the spear falls, so the timing is readable
    noStroke();
    fill(255, 230, 160, 45);
    circle(0, 0, this.radius * 2);
    fill(255, 220, 130, 90);
    circle(0, 0, this.radius * 2 * t);
    noFill();
    stroke(255, 240, 190, 220);
    strokeWeight(3);
    circle(0, 0, this.radius * 2);
    // the spear itself, coming down out of the sky
    stroke(255, 250, 220, 240);
    strokeWeight(6 * t + 2);
    const drop = (1 - t) * 500;
    line(0, -drop - 70, 0, -drop);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.radius,
      y: this.position.y - this.radius - 600,
      w: this.radius * 2,
      h: this.radius * 2 + 600,
      data: this,
    });
  }
}
