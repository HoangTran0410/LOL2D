import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import { Rectangle } from '../../../libs/quadtree';
import StatAmp from '../buffs/StatAmp';

export const DURATION = 8000;
export const AURA_RADIUS = 200;
export const DAMAGE_PER_TICK = 3;
export const TICK_INTERVAL = 500;
export const BONUS_HEALTH = 40;

export default class Nasus_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_nasus_r');
  name = 'Cơn Thịnh Nộ Sa Mạc (Nasus_R)';
  description =
    `Hóa khổng lồ trong <span class="time">${DURATION / 1000} giây</span>:` +
    ` <span class="buff">+${BONUS_HEALTH} máu tối đa</span> và thiêu đốt mọi kẻ địch trong <span>${AURA_RADIUS}px</span>` +
    ` <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi <span class="time">${TICK_INTERVAL / 1000} giây</span>`;
  coolDown = 10000;
  manaCost = 60;

  onSpellCast() {
    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'nasus_r_fury';
    amp.image = this.image;
    amp.name = 'Cơn Thịnh Nộ Sa Mạc';
    amp.bonuses = {
      maxHealth: { baseBonus: BONUS_HEALTH },
      health: { baseBonus: BONUS_HEALTH },
      size: { percentBaseBonus: 0.35 },
    };
    this.owner.addBuff(amp);

    const aura = new Nasus_R_Object(this.owner);
    // The storm is the buff's shadow: it ends when the buff does, wherever
    // Nasus happens to be standing by then.
    aura.attachTo(this.owner, amp);
    this.game.objectManager.addObject(aura);
  }
}

export class Nasus_R_Object extends SpellObject {
  radius = AURA_RADIUS;
  visionRadius = AURA_RADIUS;
  lifeTime = DURATION;
  age = 0;
  sinceTick = 0;

  update() {
    this.position = this.owner.position.copy();
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }
    if (this.sinceTick < TICK_INTERVAL) return;
    this.sinceTick -= TICK_INTERVAL;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => enemy.takeDamage(DAMAGE_PER_TICK, this.owner));
  }

  draw() {
    push();
    translate(this.owner.position.x, this.owner.position.y);
    noFill();
    stroke(255, 190, 80, 120);
    strokeWeight(3);
    circle(0, 0, this.radius * 2);
    // sand orbiting the giant
    noStroke();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TWO_PI + this.age / 500;
      fill(240, 200, 120, 150);
      circle(cos(a) * this.radius * 0.92, sin(a) * this.radius * 0.92, 7);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.owner.position.x - this.radius,
      y: this.owner.position.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
      data: this,
    });
  }
}
