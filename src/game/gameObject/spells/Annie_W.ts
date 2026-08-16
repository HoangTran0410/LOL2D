import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';

export const REACH = 290;
export const HALF_ANGLE = 0.55;
export const DAMAGE = 30;

/**
 * Incinerate. `docs/abilities/annie/w.json`: direction-targeted cone, 600
 * effect radius on Summoner's Rift — scaled here to the map this game runs on,
 * the way every other imported range is.
 */
export default class Annie_W extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_annie_w');
  name = 'Thiêu Cháy (Annie_W)';
  description =
    `Phun lửa thành hình nón dài <span>${REACH}px</span> theo hướng chỉ định, gây` +
    ` <span class="damage">${DAMAGE} sát thương</span> cho mọi kẻ địch trong đó`;
  coolDown = 7000;
  manaCost = 35;

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
    });

    const cone = new Annie_W_Cone(this.owner);
    cone.heading = heading;
    this.game.objectManager.addObject(cone);
  }

  drawPreview() {
    super.drawPreview(REACH);
  }
}

/** A wedge of fire. Its own draw because `AoePulse`'s shapes are all radial. */
export class Annie_W_Cone extends AoePulse {
  heading = 0;
  radius = REACH;
  lifeTime = 450;
  visionRadius = REACH;

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    push();
    translate(this.owner.position.x, this.owner.position.y);
    rotate(this.heading);
    noStroke();
    fill(255, 130, 40, 110 * fade);
    arc(0, 0, REACH * 2, REACH * 2, -HALF_ANGLE, HALF_ANGLE, PIE);
    // tongues rolling down the wedge
    for (let i = 0; i < 9; i++) {
      const spread = (t + i * 0.11) % 1;
      const d = REACH * spread;
      const wobble = Math.sin(i * 2.1 + this.age / 90) * HALF_ANGLE * 0.7;
      fill(255, 210 - i * 8, 90, 220 * fade * (1 - spread));
      circle(cos(wobble) * d, sin(wobble) * d, 26 + 30 * spread);
    }
    pop();
  }
}
