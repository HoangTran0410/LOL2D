import SAT from '../../../libs/SAT';
import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { hasFlag } from '../../../utils/index';
import VectorUtils from '../../../utils/vector.utils';
import ActionState from '../../enums/ActionState';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import AttackableUnit from '../attackableUnits/AttackableUnit';

/**
 * Crystallize. A genuinely solid wall: it deals no damage and applies no
 * debuff, it just physically blocks everyone — Anivia included.
 *
 * The wall does its own collision instead of being pushed into
 * `TerrainMap.quadtree`, for two reasons: that quadtree has no `remove`, and
 * anything registered there also blocks vision, while real player-made terrain
 * explicitly does NOT block sight. Doing it here keeps the wall opaque to feet
 * and transparent to eyes, and leaves no state to unwind when it melts.
 *
 * The push-out is the same SAT resolution `TerrainMap.update` runs for map
 * walls, and it runs during `objectManager.update()`, i.e. BEFORE
 * `terrainMap.update()` in the frame — so a unit shoved by the ice into real
 * terrain gets shoved back out by the map in the same frame. That reproduces
 * "knocks units away from it, though not through terrain".
 */
export default class Anivia_W extends Spell {
  image = AssetManager.getAsset('spell_anivia_w');
  name = 'Tường Băng (Anivia_W)';
  description =
    'Dựng một bức tường băng <b>đặc</b> chắn ngang hướng chỉ định, tồn tại <span class="time">5 giây</span>. Tường <b>không gây sát thương</b> và không gây hiệu ứng khống chế — nó chặn đường đi thật sự: mọi tướng (kể cả đồng minh và chính Anivia) đều bị đẩy ra và không thể đi xuyên qua. Kỹ năng lướt/dịch chuyển vẫn vượt được tường, và tường <b>không chặn tầm nhìn</b>';
  coolDown = 12000;
  manaCost = 40;

  range = 400;
  wallLength = 260;
  wallThickness = 34;
  duration = 5000;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Anivia_W_Object(this.owner);
    obj.position = to;
    // the wall stands across the cast direction, the way a barrier should
    obj.angle = VectorUtils.getAngle(this.owner.position, to) + HALF_PI;
    obj.length = this.wallLength;
    obj.thickness = this.wallThickness;
    obj.lifeTime = this.duration;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

/** A solid, impassable slab of ice. No damage, no debuffs — just geometry. */
export class Anivia_W_Object extends SpellObject {
  position = this.owner.position.copy();
  angle = 0;
  length = 260;
  thickness = 34;

  lifeTime = 5000;
  age = 0;
  growth = 0;

  /** Built lazily: `position`/`angle`/`length` are assigned after construction. */
  _satPolygon: any = null;
  _satCircle: any = null;
  _satResponse: any = null;

  _getSATPolygon() {
    if (this._satPolygon) return this._satPolygon;

    const halfLength = this.length / 2;
    const halfThickness = this.thickness / 2;
    const polygon = new SAT.Polygon(new SAT.Vector(this.position.x, this.position.y), [
      new SAT.Vector(-halfLength, -halfThickness),
      new SAT.Vector(halfLength, -halfThickness),
      new SAT.Vector(halfLength, halfThickness),
      new SAT.Vector(-halfLength, halfThickness),
    ]);
    polygon.setAngle(this.angle);

    this._satPolygon = polygon;
    // one scratch circle + one scratch response, reused for every unit tested
    this._satCircle = new SAT.Circle(new SAT.Vector(0, 0), 1);
    this._satResponse = new SAT.Response();
    return this._satPolygon;
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    // the slab shoots up out of the ground rather than popping in
    this.growth = lerp(this.growth, 1, 0.25);

    this._blockUnits();
  }

  _blockUnits() {
    const polygon = this._getSATPolygon();
    const circle = this._satCircle;
    const response = this._satResponse;

    const units = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this._boundingRadius(),
      }),
      // the wall is terrain: it stops both teams, allies and Anivia herself
      filters: [PredefinedFilters.type(AttackableUnit), PredefinedFilters.excludeDead],
    });

    for (const unit of units) {
      // dashes and blinks clear the wall, exactly as they clear map terrain
      if (hasFlag(unit.stats.actionState, ActionState.IS_GHOSTED)) continue;

      response.clear();
      circle.pos.x = unit.position.x;
      circle.pos.y = unit.position.y;
      circle.r = unit.stats.size.value / 2;

      if (SAT.testPolygonCircle(polygon, circle, response)) {
        unit.position.x += response.overlapV.x;
        unit.position.y += response.overlapV.y;
        unit.onCollideWall?.();
      }
    }
  }

  _boundingRadius() {
    return Math.sqrt(this.length * this.length + this.thickness * this.thickness) / 2 + 60;
  }

  draw() {
    const fade =
      this.age > this.lifeTime - 500 ? map(this.age, this.lifeTime - 500, this.lifeTime, 1, 0) : 1;
    const halfLength = (this.length / 2) * this.growth;
    const halfThickness = this.thickness / 2;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    rectMode(CENTER);
    strokeWeight(2);
    stroke(235, 250, 255, 230 * fade);
    // opaque enough to read as a solid barrier rather than a ground effect
    fill(150, 210, 248, 210 * fade);
    rect(0, 0, halfLength * 2, halfThickness * 2, 6);

    // chunky ice blocks along the slab, like the segments of the real wall
    stroke(255, 200 * fade);
    strokeWeight(2);
    const columns = 8;
    for (let i = 1; i < columns; i++) {
      const x = -halfLength + (i / columns) * halfLength * 2;
      line(x, -halfThickness, x, halfThickness);
    }

    // frosted highlight down the middle
    noStroke();
    fill(255, 130 * fade);
    rect(0, 0, halfLength * 2, halfThickness * 0.5);

    pop();
  }

  getDisplayBoundingBox() {
    const r = this._boundingRadius();
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
