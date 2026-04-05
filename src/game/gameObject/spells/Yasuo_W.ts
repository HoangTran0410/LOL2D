import { Rectangle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import CollideUtils from '../../../utils/collide.utils';
import { rectToVertices } from '../../../utils/index';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export default class Yasuo_W extends Spell {
  image = AssetManager.getAsset('spell_yasuo_w');
  name = 'Tường Gió (Yasuo_W)';
  description =
    'Tạo ra một bức tường gió theo hướng chỉ định, <span class="buff">Chặn</span> toàn bộ đạn đạo từ kẻ địch trong <span class="time">3.75 giây</span>';
  coolDown = 6000;
  manaCost = 20;

  onSpellCast() {
    const size = 300,
      duration = 3750;

    const startRange = this.owner.stats.size.value + 20;
    const mouse = this.game.worldMouse.copy();
    const direction = mouse.copy().sub(this.owner.position).normalize();
    const position = this.owner.position.copy().add(direction.setMag(startRange));

    const obj = new Yasuo_W_Object(this.owner);
    obj.position = position;
    obj.direction = direction;
    obj.size = size;
    obj.duration = duration;

    this.game.objectManager.addObject(obj);
  }
}

export class Yasuo_W_Object extends SpellObject {
  position = this.owner.position.copy();
  direction = p5.Vector.random2D();
  speed = 0.5;
  size = 150;
  width = 25;
  duration = 3750;
  timeSinceCreated = 0;

  // for smooth display
  animatedWidth = 0;
  animatedSize = 0;
  animatedPosition = this.owner.position.copy();

  update() {
    // move wall
    this.position.add(this.direction.setMag(this.speed));

    this.animatedSize = lerp(this.animatedSize, this.size, 0.1);
    this.animatedWidth = lerp(this.animatedWidth, this.width, 0.1);
    this.animatedPosition = lerp(this.animatedPosition, this.position, 0.1);

    // check collision with spell objects
    const rx = this.animatedPosition.x;
    const ry = this.animatedPosition.y - this.animatedSize / 2;
    const rw = this.animatedWidth;
    const rh = this.animatedSize;
    const angle = this.direction.heading();
    const vertices = rectToVertices(rx, ry, rw, rh, angle, {
      x: this.animatedPosition.x,
      y: this.animatedPosition.y,
    });

    const spellObjects = this.game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      filters: [
        PredefinedFilters.missileSpellObject,
        PredefinedFilters.excludeTeamId(this.owner.teamId),
        (o: any) => CollideUtils.pointPolygon(o.position.x, o.position.y, vertices),
      ],
    });

    spellObjects.forEach(o => {
      o.toRemove = true;
    });

    // check to remove
    this.timeSinceCreated += deltaTime;
    if (this.timeSinceCreated >= this.duration) {
      this.toRemove = true;
    }
  }

  draw() {
    push();

    const alpha = map(this.timeSinceCreated, 0, this.duration, 255, 50);
    fill(180, 170, 255, alpha);
    translate(this.animatedPosition.x, this.animatedPosition.y);
    rotate(this.direction.heading());

    beginShape();
    vertex(0, -this.animatedSize / 2);
    vertex(this.animatedWidth, -this.animatedSize / 2);
    vertex(this.animatedWidth, this.animatedSize / 2);
    vertex(0, this.animatedSize / 2);
    endShape(CLOSE);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.animatedPosition.x - this.animatedSize / 2 - this.animatedWidth / 2,
      y: this.animatedPosition.y - this.animatedSize / 2 - this.animatedWidth / 2,
      w: this.animatedSize + this.animatedWidth,
      h: this.animatedSize + this.animatedWidth,
      data: this,
    });
  }
}
