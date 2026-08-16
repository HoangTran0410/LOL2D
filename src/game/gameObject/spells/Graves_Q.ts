import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { Circle } from '../../../libs/quadtree';
import { PredefinedFilters } from '../../managers/ObjectManager';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const RANGE = 550;
export const TRAVEL_DAMAGE = 12;
export const BLAST_DAMAGE = 26;
export const BLAST_RADIUS = 130;

/** End of the Line: a shell that hurts on the way through and detonates at the end. */
export default class Graves_Q extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_graves_q');
  name = 'Tới Bến (Graves_Q)';
  description =
    `Bắn một viên đạn xuyên qua kẻ địch (<span class="damage">${TRAVEL_DAMAGE} sát thương</span>)` +
    ` rồi <span class="damage">phát nổ</span> ở cuối đường bay, gây thêm` +
    ` <span class="damage">${BLAST_DAMAGE} sát thương</span> trong <span>${BLAST_RADIUS}px</span>`;
  coolDown = 9000;
  manaCost = 30;

  range = RANGE;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
    const shell = new Graves_Q_Object(this.owner);
    shell.destination = to;
    this.game.objectManager.addObject(shell);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Graves_Q_Object extends MissileSpellObject {
  speed = 13;
  size = 18;

  onHit(enemy: AttackableUnit) {
    enemy.takeDamage(TRAVEL_DAMAGE, this.owner);
  }

  onArrive() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: BLAST_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => enemy.takeDamage(BLAST_DAMAGE, this.owner));

    const blast = new AoePulse(this.owner);
    blast.position = this.position.copy();
    blast.radius = BLAST_RADIUS;
    blast.lifeTime = 420;
    blast.color = [255, 170, 60];
    blast.style = 'shards';
    blast.spokes = 12;
    this.game.objectManager.addObject(blast);
  }

  draw() {
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    push();
    translate(this.position.x, this.position.y);
    rotate(angle);
    noStroke();
    fill(120, 90, 60, 200);
    rect(-14, -4, 22, 8, 3);
    fill(255, 200, 110, 240);
    circle(10, 0, 10);
    pop();
  }
}
