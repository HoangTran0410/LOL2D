import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Airborne from '../buffs/Airborne';
import Dash from '../buffs/Dash';
import Slow from '../buffs/Slow';

export const RANGE = 160;
export const DAMAGE = 28;
/** How far behind Singed the victim lands, measured from his own feet. */
export const THROW_DISTANCE = 150;
export const THROW_SPEED = 14;

export default class Singed_E extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_singed_e');
  name = 'Quăng Người (Singed_E)';
  description =
    `Túm kẻ địch gần nhất trong <span>${RANGE}px</span> và quăng qua đầu mình, đáp xuống` +
    ` <span>${THROW_DISTANCE}px</span> phía sau lưng Singed, gây` +
    ` <span class="damage">${DAMAGE} sát thương</span>, <span class="buff">Hất Tung</span> và` +
    ` <span class="buff">Làm Chậm 40%</span> chúng`;
  coolDown = 9000;
  manaCost = 25;

  range = RANGE;

  checkCastCondition() {
    return !!this._findTarget();
  }

  onSpellCast() {
    const target = this._findTarget();
    if (!target) return;

    target.takeDamage(DAMAGE, this.owner);
    target.addBuff(new Airborne(700, this.owner, target));
    const slow = new Slow(1500, this.owner, target);
    slow.percent = 0.4;
    target.addBuff(slow);

    // Over the shoulder, not away. The victim's current side of Singed is
    // `owner -> target`; a fling puts them on the *opposite* side, measured
    // from Singed's feet rather than from theirs — pushing along that vector
    // (what this used to do) is a shove, and leaves them exactly where they
    // were relative to him, only further out.
    const heading = target.position.copy().sub(this.owner.position);
    if (heading.magSq() === 0) heading.set(1, 0);
    const landing = this.owner.position.copy().sub(heading.copy().setMag(THROW_DISTANCE));

    // A Dash rather than a teleport: the body travels, walls and the arc are
    // the engine's problem, and the arriving flight is what sells the throw.
    // `cancelable = false` because the Airborne above is Singed's own and must
    // not abort his own displacement (see DASH_INTERRUPT_BUFFS).
    const throwDash = new Dash(1500, this.owner, target);
    throwDash.dashDestination = landing;
    throwDash.dashSpeed = THROW_SPEED;
    throwDash.cancelable = false;
    throwDash.stayAtDestination = true;
    target.addBuff(throwDash);

    const ring = new AoePulse(this.owner);
    ring.position = landing;
    ring.radius = 80;
    ring.lifeTime = 450;
    ring.color = [180, 130, 220];
    ring.style = 'crater';
    this.game.objectManager.addObject(ring);
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
