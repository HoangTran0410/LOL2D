import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import DamageOverTime from '../buffs/DamageOverTime';
import Slow from '../buffs/Slow';

export const MAX_RANGE = 450;
export const RADIUS = 160;
export const DURATION = 3000;
export const SLOW_PERCENT = 0.5;
export const POISON_PER_TICK = 3;

export default class Twitch_W extends Spell {
  targetingMode = 'POINT' as const;
  image = AssetManager.get('spell_twitch_w');
  name = 'Bình Độc (Twitch_W)';
  description =
    `Ném bình độc tạo vũng bán kính <span>${RADIUS}px</span> trong <span class="time">${DURATION / 1000} giây</span>,` +
    ` <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span> và <span class="damage">nhiễm độc</span> kẻ địch bước vào`;
  coolDown = 10000;
  manaCost = 30;

  maxRange = MAX_RANGE;

  onSpellCast() {
    const aim = this.aimPoint;
    const position = aim
      .copy()
      .sub(this.owner.position)
      .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
      .add(this.owner.position);

    const cask = new Twitch_W_Object(this.owner);
    cask.position = position;
    this.game.objectManager.addObject(cask);
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}

export class Twitch_W_Object extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  radius = RADIUS;
  visionRadius = RADIUS;
  lifeTime = DURATION;
  age = 0;
  sinceTick = 0;

  update() {
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }
    if (this.sinceTick < 400) return;
    this.sinceTick -= 400;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    enemies.forEach((enemy: any) => {
      const slow = new Slow(700, this.owner, enemy);
      slow.percent = SLOW_PERCENT;
      enemy.addBuff(slow);

      // Its own stack slot: Twitch's E reads this poison, and it must not be
      // confused with a burn some other spell left on the same victim.
      const poison = new DamageOverTime(1600, this.owner, enemy);
      poison.stackId = 'twitch_poison';
      poison.name = 'Nhiễm Độc';
      poison.damagePerTick = POISON_PER_TICK;
      poison.tickInterval = 400;
      poison.flameColor = [190, 255, 120];
      poison.emberColor = [40, 120, 30];
      enemy.addBuff(poison);
    });
  }

  draw() {
    const t = this.age / this.lifeTime;
    const fade = t > 0.8 ? (1 - t) / 0.2 : 1;
    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(120, 200, 70, 55 * fade);
    circle(0, 0, this.radius * 2);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TWO_PI + this.age / 700;
      const d = this.radius * (0.3 + 0.55 * Math.abs(Math.sin(this.age / 400 + i)));
      fill(150, 230, 90, 120 * fade);
      circle(cos(a) * d, sin(a) * d, 26);
    }
    noFill();
    stroke(150, 230, 100, 150 * fade);
    strokeWeight(2);
    circle(0, 0, this.radius * 2);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.radius,
      y: this.position.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
      data: this,
    });
  }
}
