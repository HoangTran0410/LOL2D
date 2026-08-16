import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Slow from '../buffs/Slow';
import Stun from '../buffs/Stun';

export const REACH = 420;
export const HALF_ANGLE = 0.6;
export const DAMAGE = 40;
export const STUN_DURATION = 1400;

/**
 * Petrifying Gaze. A cone, not a circle: it only catches what is in front of
 * her, so turning the corner on Cassiopeia is the counterplay. (League's
 * facing check has no analogue here — every unit's facing is its heading, not
 * a thing the player aims — so the cone itself is the whole condition.)
 */
export default class Cassiopeia_R extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_cassiopeia_r');
  name = 'Ánh Nhìn Hóa Đá (Cassiopeia_R)';
  description =
    `Quét một hình nón <span>${REACH}px</span> theo hướng chỉ định: <span class="damage">${DAMAGE} sát thương</span>,` +
    ` <span class="buff">Choáng</span> trong <span class="time">${STUN_DURATION / 1000} giây</span>` +
    ` và <span class="buff">Làm Chậm 50%</span> sau đó`;
  coolDown = 10000;
  manaCost = 80;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, REACH);
    const heading = Math.atan2(to.y - this.owner.position.y, to.x - this.owner.position.x);

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: REACH }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    enemies.forEach((enemy: any) => {
      const toEnemy = Math.atan2(
        enemy.position.y - this.owner.position.y,
        enemy.position.x - this.owner.position.x
      );
      let delta = Math.abs(toEnemy - heading) % (Math.PI * 2);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      if (delta > HALF_ANGLE) return;

      enemy.takeDamage(DAMAGE, this.owner);
      enemy.addBuff(new Stun(STUN_DURATION, this.owner, enemy));
      const slow = new Slow(2000, this.owner, enemy);
      slow.percent = 0.5;
      enemy.addBuff(slow);
    });

    const gaze = new Cassiopeia_R_Cone(this.owner);
    gaze.heading = heading;
    this.game.objectManager.addObject(gaze);
  }

  drawPreview() {
    super.drawPreview(REACH);
  }
}

/** The cone flash. Its own class rather than an `AoePulse`, because a wedge is not a circle. */
export class Cassiopeia_R_Cone extends AoePulse {
  heading = 0;
  radius = REACH;
  lifeTime = 520;
  visionRadius = REACH;

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    push();
    translate(this.owner.position.x, this.owner.position.y);
    rotate(this.heading);
    noStroke();
    fill(230, 200, 255, 90 * fade);
    arc(0, 0, REACH * 2, REACH * 2, -HALF_ANGLE, HALF_ANGLE, PIE);
    // rings of the gaze racing down the wedge
    noFill();
    stroke(240, 220, 255, 230 * fade);
    strokeWeight(4 * fade + 1);
    for (let i = 0; i < 3; i++) {
      const p = (t + i * 0.3) % 1;
      arc(0, 0, REACH * 2 * p, REACH * 2 * p, -HALF_ANGLE, HALF_ANGLE);
    }
    pop();
  }
}
