import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import TrueSight from '../buffs/TrueSight';
import TrailSystem from '../helpers/TrailSystem';

export default class Ashe_E extends Spell {
  image = AssetManager.getAsset('spell_ashe_e');
  name = 'Chim Ưng Do Thám (Ashe_E)';
  description =
    'Thả một chim ưng bay xa <span>900px</span> theo hướng chỉ định. Chim ưng không gây sát thương nhưng <span class="buff">Mở Tầm Nhìn</span> trên suốt đường bay và khiến mọi kẻ địch nó bay ngang qua bị <span class="buff">Lộ Diện</span> trong <span class="time">3 giây</span>';
  coolDown = 18000;
  manaCost = 30;

  range = 900;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Ashe_E_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    obj.direction = p5.Vector.sub(to, from).normalize();
    this.game.objectManager.addObject(obj);
  }
}

export class Ashe_E_Object extends MissileSpellObject {
  speed = 11;
  size = 22;
  // a scout, not a skillshot: it never collides with anything
  maxHitCount = 0;

  /** Feeds the fog of war, so the bird lights up the terrain it flies over. */
  visionRadius = 400;
  /** Enemies this close get revealed to the whole team for a while. */
  revealRadius = 260;
  revealDuration = 3000;
  revealVisionRadius = 150;

  /** Revealed once each — re-applying every frame would churn TrueSight's sight object. */
  revealedTargets: any[] = [];

  wingPhase = 0;

  trailSystem = new TrailSystem({
    maxLength: 25,
    trailSize: this.size / 3,
    trailColor: '#BFE9FF44',
  });

  onAfterMove() {
    this.wingPhase += 0.25;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.revealRadius,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.excludeObjects(this.revealedTargets),
      ],
    });

    for (const enemy of enemies) {
      this.revealedTargets.push(enemy);

      const sight = new TrueSight(this.revealDuration, this.owner, enemy);
      sight.visionRadius = this.revealVisionRadius;
      sight.image = AssetManager.getAsset('spell_ashe_e');
      enemy.addBuff(sight);
    }
  }

  draw() {
    const flap = sin(this.wingPhase);

    push();
    translate(this.position.x, this.position.y);
    rotate(this.direction.heading());

    // faint sight halo so the player can see how much the bird is revealing
    noStroke();
    fill(180, 225, 255, 12);
    circle(0, 0, this.revealRadius * 2);

    // body
    fill(225, 240, 255, 230);
    ellipse(0, 0, this.size, this.size / 2.2);

    // wings, folding as the bird flaps
    fill(150, 200, 245, 220);
    const span = this.size * (0.5 + 0.5 * Math.abs(flap));
    triangle(2, 0, -this.size / 2, -span, -this.size / 4, 0);
    triangle(2, 0, -this.size / 2, span, -this.size / 4, 0);

    pop();
  }

  // the vision it carries reaches far past the sprite, so the box must cover it
  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.visionRadius,
      y: this.position.y - this.visionRadius,
      w: this.visionRadius * 2,
      h: this.visionRadius * 2,
      data: this,
    });
  }
}
