import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, DynamicWall } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Anivia_W = InstanceType<ReturnType<typeof makeAnivia_W>>;
type Anivia_W_Object = InstanceType<ReturnType<typeof makeAnivia_W_Object>>;



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
function __buildAnivia_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Anivia_W_Object = makeAnivia_W_Object(api);
  class Anivia_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_anivia_w');
    name = 'Tường Băng (Anivia_W)';
    description =
      'Dựng một bức tường băng <b>đặc</b> chắn ngang hướng chỉ định, tồn tại <span class="time">5 giây</span>. Tường <b>không gây sát thương</b> và không gây hiệu ứng khống chế — nó chặn đường đi thật sự: mọi tướng (kể cả đồng minh và chính Anivia) đều bị đẩy ra và không thể đi xuyên qua. Kỹ năng lướt/dịch chuyển vẫn vượt được tường, và tường <b>không chặn tầm nhìn</b>';
    coolDown = 6000;
    manaCost = 40;

    range = 400;
    wallLength = 260;
    wallThickness = 34;
    duration = 5000;

    onSpellCast(context: CastContext) {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      // The slab must never spawn on top of Anivia herself.
      //
      // `_blockUnits` resolves an overlapping body to its *nearest* face, which is
      // right for someone walking into the wall from outside and catastrophic for
      // someone standing inside it: past the midplane the nearest face is the far
      // one, so the push ejects them straight through. Measured on the shipped
      // 34px slab, a champion whose centre starts on the midplane is 44.5px beyond
      // the wall one frame later and walks away free.
      //
      // Anivia is the one person that reliably happens to, because the slab is
      // centred on the aim point and on a phone the aim point is wherever the
      // thumb rests — which is usually right on top of her own champion. So the
      // wall blocked both teams and let its caster stroll through it.
      //
      // Holding the centre a half-thickness plus a body radius away puts her
      // outside her own wall, so the ejection branch never runs for her and she is
      // stopped by it exactly as everyone else is. `firingDirection` is what makes
      // a cursor sitting on her feet still yield a direction: body heading first,
      // then a fixed vector, never (0,0).
      const heading = this.firingDirection(context);
      const minimum = this.wallThickness / 2 + this.owner.stats.size.value / 2;
      const dx = to.x - this.owner.position.x;
      const dy = to.y - this.owner.position.y;
      if (Math.hypot(dx, dy) < minimum) {
        to.set(
          this.owner.position.x + heading.x * minimum,
          this.owner.position.y + heading.y * minimum
        );
      }

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
  return Anivia_W;
}
const __cacheAnivia_W = new WeakMap<ContentApi, ReturnType<typeof __buildAnivia_W>>();
export default function makeAnivia_W(api: ContentApi) {
  const cached = __cacheAnivia_W.get(api);
  if (cached) return cached;
  const built = __buildAnivia_W(api);
  __cacheAnivia_W.set(api, built);
  return built;
}


/** A solid, impassable slab of ice. No damage, no debuffs — just geometry. */
function __buildAnivia_W_Object(api: ContentApi) {
  const SAT = api.utils.SAT;
  const Circle = api.utils.Quadtree.Circle;
  const hasFlag = api.utils.hasFlag;
  const ActionState = api.enums.ActionState;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const slabVertices = api.terrain.slabVertices;
  class Anivia_W_Object extends SpellObject implements DynamicWall {
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

    /**
     * `DynamicWall`: the ice is terrain for its whole life. It has no windup —
     * `growth` is the slab rising on screen, and it blocks from the first frame
     * because a barrier you can walk through while it animates is not a barrier.
     */
    get blocksMovement(): boolean {
      return !this.toRemove;
    }

    wallVertices() {
      return slabVertices(this.position, this.angle, this.length, this.thickness);
    }

    draw() {
      const fade =
        this.age > this.lifeTime - 500 ? map(this.age, this.lifeTime - 500, this.lifeTime, 1, 0) : 1;
      const halfLength = (this.length / 2) * this.growth;
      const halfThickness = this.thickness / 2;
      // how far through its life the slab is — drives the cracks that spread
      const life = constrain(this.age / this.lifeTime, 0, 1);

      push();
      translate(this.position.x, this.position.y);
      rotate(this.angle);

      // spikes of ice punched up out of the ground along both faces: the
      // silhouette that says "solid barrier" rather than "puddle of light"
      const columns = 9;
      noStroke();
      fill(120, 185, 235, 220 * fade);
      for (let i = 0; i < columns; i++) {
        const x = -halfLength + ((i + 0.5) / columns) * halfLength * 2;
        const w = (halfLength * 2) / columns / 2;
        const spike = halfThickness * (0.55 + 0.45 * sin(i * 2.3));
        triangle(x - w, -halfThickness, x + w, -halfThickness, x, -halfThickness - spike);
        triangle(x - w, halfThickness, x + w, halfThickness, x, halfThickness + spike);
      }

      rectMode(CENTER);
      strokeWeight(3);
      stroke(30, 80, 125, 235 * fade);
      // opaque enough to read as a solid barrier rather than a ground effect
      fill(150, 210, 248, 230 * fade);
      rect(0, 0, halfLength * 2, halfThickness * 2, 5);

      // chunky ice blocks along the slab, like the segments of the real wall
      stroke(235, 250, 255, 220 * fade);
      strokeWeight(2.5);
      for (let i = 1; i < columns; i++) {
        const x = -halfLength + (i / columns) * halfLength * 2;
        line(x, -halfThickness, x, halfThickness);
      }

      // frosted highlight down the middle
      noStroke();
      fill(255, 170 * fade);
      rect(0, -halfThickness * 0.35, halfLength * 2, halfThickness * 0.4);

      // the slab fissures as it ages, so its remaining life is visible in the ice
      if (life > 0.35) {
        const cracking = constrain((life - 0.35) / 0.65, 0, 1);
        stroke(255, 255, 255, 200 * cracking * fade);
        strokeWeight(1.5 + cracking * 1.5);
        for (let i = 0; i < columns; i++) {
          const x = -halfLength + ((i + 0.5) / columns) * halfLength * 2;
          const reach = halfThickness * cracking;
          const skew = sin(i * 5.1) * halfThickness * 0.5 * cracking;
          line(x, -reach, x + skew, 0);
          line(x + skew, 0, x - skew * 0.6, reach);
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this._boundingRadius();
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Anivia_W_Object;
}
const __cacheAnivia_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAnivia_W_Object>>();
export function makeAnivia_W_Object(api: ContentApi) {
  const cached = __cacheAnivia_W_Object.get(api);
  if (cached) return cached;
  const built = __buildAnivia_W_Object(api);
  __cacheAnivia_W_Object.set(api, built);
  return built;
}