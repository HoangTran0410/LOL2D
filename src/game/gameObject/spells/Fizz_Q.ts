import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Dash from '../buffs/Dash';

export const RANGE = 380;
export const DAMAGE = 22;
export const DASH_SPEED = 24;
/** How far past the victim he ends up — the dash goes *through*, not up to. */
export const OVERSHOOT = 60;

/** Urchin Strike: a dash that goes through the target and out the other side. */
export default class Fizz_Q extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_fizz_q');
  name = 'Đâm Xuyên (Fizz_Q)';
  description =
    `Lướt xuyên qua kẻ địch gần nhất trong <span>${RANGE}px</span>, gây` +
    ` <span class="damage">${DAMAGE} sát thương</span> và dừng lại phía sau lưng chúng`;
  coolDown = 6000;
  manaCost = 25;

  range = RANGE;

  checkCastCondition() {
    return !!this._findTarget() && Dash.CanDash(this.owner);
  }

  onSpellCast() {
    const target = this._findTarget();
    if (!target) return;

    const through = target.position.copy().sub(this.owner.position);
    if (through.magSq() === 0) through.set(1, 0);
    const landing = target.position.copy().add(through.copy().setMag(OVERSHOOT));

    const dash = new Dash(1200, this.owner, this.owner);
    dash.image = this.image;
    dash.dashDestination = landing;
    dash.dashSpeed = DASH_SPEED;
    dash.showTrail = true;
    this.owner.addBuff(dash);

    target.takeDamage(DAMAGE, this.owner);

    const slash = new AoePulse(this.owner);
    slash.position = target.position.copy();
    slash.radius = 60;
    slash.lifeTime = 320;
    slash.color = [150, 220, 255];
    slash.style = 'shards';
    slash.spokes = 5;
    this.game.objectManager.addObject(slash);
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
