import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Airborne from '../buffs/Airborne';
import Slow from '../buffs/Slow';

export const MAX_RANGE = 500;
export const RADIUS = 210;
export const DAMAGE = 32;

export default class Rammus_R extends Spell {
  targetingMode = 'POINT' as const;
  image = AssetManager.get('spell_rammus_r');
  name = 'Nhảy Bổ (Rammus_R)';
  description =
    `Nhảy tới vị trí chỉ định và giáng xuống bán kính <span>${RADIUS}px</span>, gây` +
    ` <span class="damage">${DAMAGE} sát thương</span>, <span class="buff">Hất Tung</span> và` +
    ` <span class="buff">Làm Chậm 50%</span> kẻ địch trúng phải`;
  coolDown = 10000;
  manaCost = 60;

  maxRange = MAX_RANGE;

  onSpellCast() {
    const aim = this.aimPoint;
    const landing = aim
      .copy()
      .sub(this.owner.position)
      .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
      .add(this.owner.position);

    // The leap itself is instant: the slam is the ability, and a real dash
    // here would need its own cancel policy for no gameplay it does not
    // already have.
    this.owner.position.set(landing.x, landing.y);

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: landing.x, y: landing.y, r: RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    enemies.forEach((enemy: any) => {
      enemy.takeDamage(DAMAGE, this.owner);
      enemy.addBuff(new Airborne(600, this.owner, enemy));
      const slow = new Slow(2000, this.owner, enemy);
      slow.percent = 0.5;
      enemy.addBuff(slow);
    });

    const ring = new AoePulse(this.owner);
    ring.position = landing.copy();
    ring.radius = RADIUS;
    ring.lifeTime = 520;
    ring.color = [200, 200, 140];
    ring.rings = 3;
    this.game.objectManager.addObject(ring);
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}
