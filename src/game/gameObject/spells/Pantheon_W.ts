import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Dash from '../buffs/Dash';
import Stun from '../buffs/Stun';

export const RANGE = 400;
export const DAMAGE = 20;
export const STUN_DURATION = 1000;
export const LEAP_SPEED = 22;

/** Shield Vault: close the gap and put them on the floor. */
export default class Pantheon_W extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_pantheon_w');
  name = 'Khiên Xung Kích (Pantheon_W)';
  description =
    `Lao tới kẻ địch gần nhất trong <span>${RANGE}px</span>, gây <span class="damage">${DAMAGE} sát thương</span>` +
    ` và <span class="buff">Choáng</span> trong <span class="time">${STUN_DURATION / 1000} giây</span>`;
  coolDown = 9000;
  manaCost = 30;

  range = RANGE;

  checkCastCondition() {
    return !!this._findTarget() && Dash.CanDash(this.owner);
  }

  onSpellCast() {
    const target = this._findTarget();
    if (!target) return;

    const dash = new Dash(1200, this.owner, this.owner);
    dash.image = this.image;
    // Stops short of the body rather than inside it — the collision system
    // would shove him back out anyway.
    dash.dashDestination = target.position
      .copy()
      .sub(this.owner.position)
      .setMag(Math.max(0, this.owner.position.dist(target.position) - 40))
      .add(this.owner.position);
    dash.dashSpeed = LEAP_SPEED;
    dash.showTrail = true;
    dash.cancelable = false;
    this.owner.addBuff(dash);

    target.takeDamage(DAMAGE, this.owner);
    target.addBuff(new Stun(STUN_DURATION, this.owner, target));

    const hit = new AoePulse(this.owner);
    hit.position = target.position.copy();
    hit.radius = 70;
    hit.lifeTime = 400;
    hit.color = [170, 210, 255];
    hit.style = 'columns';
    hit.spokes = 8;
    this.game.objectManager.addObject(hit);
  }

  _findTarget() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(this.range, this.owner),
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
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}
