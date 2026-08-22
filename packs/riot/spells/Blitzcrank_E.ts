import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Blitzcrank_E = InstanceType<ReturnType<typeof makeBlitzcrank_E>>;
type Blitzcrank_E_Object = InstanceType<ReturnType<typeof makeBlitzcrank_E_Object>>;



function __buildBlitzcrank_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Airborne = api.buffs.Airborne;
  const Blitzcrank_E_Object = makeBlitzcrank_E_Object(api);
  class Blitzcrank_E extends Spell {
    // Not a projectile, but the drag still only picks direction: the cone is
    // always the fixed `range` regardless of where the thumb lets go.
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_blitzcrank_e');
    name = 'Đấm Móc (Blitzcrank_E)';
    description =
      'Vung nắm đấm thành <span>hình nón</span> ngay trước mặt, gây <span class="damage">25 sát thương</span> và <span class="buff">Hất Tung</span> mọi kẻ địch trúng đòn trong <span class="time">0.6 giây</span>';
    coolDown = 6000;
    manaCost = 20;

    range = 170;
    /** Half-width of the cone: PI/4 gives a 90° swing in front of the caster. */
    halfAngle = Math.PI / 4;
    damage = 25;
    airborneDuration = 600;
    airborneHeight = 25;

    onSpellCast() {
      const angle = VectorUtils.getAngle(this.owner.position, this.aimPoint);
      const facing = p5.Vector.fromAngle(angle);
      const minDot = Math.cos(this.halfAngle);

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: this.range,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          // dot product rather than comparing raw headings: no seam at ±PI
          (o: any) => {
            const toEnemy = p5.Vector.sub(o.position, this.owner.position);
            if (toEnemy.magSq() === 0) return true;
            return facing.dot(toEnemy.normalize()) >= minDot;
          },
        ],
      });

      const hitPositions: p5.Vector[] = [];
      enemies.forEach((enemy: any) => {
        const airborneBuff = new Airborne(this.airborneDuration, this.owner, enemy);
        airborneBuff.height = this.airborneHeight;
        airborneBuff.image = this.image;
        enemy.addBuff(airborneBuff);

        enemy.takeDamage(this.damage, this.owner);
        hitPositions.push(enemy.position.copy());
      });

      const obj = new Blitzcrank_E_Object(this.owner);
      obj.angle = angle;
      obj.halfAngle = this.halfAngle;
      obj.range = this.range;
      obj.hitPositions = hitPositions;
      this.game.objectManager.addObject(obj);
    }

    /**
     * The circle a bare `drawPreview` draws is a lie: this hits a cone, not a disc.
     * Draw the actual wedge, aimed where the mouse is.
     */
    drawPreview() {
      const angle = VectorUtils.getAngle(this.owner.position, this.game.worldMouse);
      const d = this.range * 2;

      push();
      translate(this.owner.position.x, this.owner.position.y);

      noStroke();
      fill(255, 190, 80, 20);
      arc(0, 0, d, d, angle - this.halfAngle, angle + this.halfAngle, PIE);

      noFill();
      stroke(255, 205, 120, 130);
      strokeWeight(2);
      arc(0, 0, d, d, angle - this.halfAngle, angle + this.halfAngle);
      line(0, 0, cos(angle - this.halfAngle) * this.range, sin(angle - this.halfAngle) * this.range);
      line(0, 0, cos(angle + this.halfAngle) * this.range, sin(angle + this.halfAngle) * this.range);
      pop();
    }
  }
  return Blitzcrank_E;
}
const __cacheBlitzcrank_E = new WeakMap<ContentApi, ReturnType<typeof __buildBlitzcrank_E>>();
export default function makeBlitzcrank_E(api: ContentApi) {
  const cached = __cacheBlitzcrank_E.get(api);
  if (cached) return cached;
  const built = __buildBlitzcrank_E(api);
  __cacheBlitzcrank_E.set(api, built);
  return built;
}


function __buildBlitzcrank_E_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Blitzcrank_E_Object extends SpellObject {
    angle = 0;
    halfAngle = Math.PI / 4;
    range = 170;
    lifeTime = 320;
    age = 0;

    /** Cosmetic: where the punch connected, so each victim gets an impact star. */
    hitPositions: p5.Vector[] = [];

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // the fist punches out fast, then the wedge it swept fades behind it
      const punch = Math.min(1, t / 0.45);
      const fistDist = this.range * (0.2 + 0.8 * punch);
      const fade = 1 - t;
      const from = this.angle - this.halfAngle;
      const to = this.angle + this.halfAngle;

      push();
      translate(this.position.x, this.position.y);

      // --- the wedge that was actually hit ---------------------------------
      // full size from the first frame: this is a telegraph, not an expansion
      const d = this.range * 2;
      noStroke();
      fill(255, 175, 60, 90 * fade);
      arc(0, 0, d, d, from, to, PIE);

      // hard edges, so the shape of the damage is unmistakable
      noFill();
      stroke(255, 235, 170, 240 * fade);
      strokeWeight(4 * fade + 1);
      arc(0, 0, d, d, from, to);
      stroke(255, 210, 130, 200 * fade);
      strokeWeight(2);
      line(0, 0, cos(from) * this.range, sin(from) * this.range);
      line(0, 0, cos(to) * this.range, sin(to) * this.range);

      // shock ring racing out through the wedge
      stroke(255, 255, 220, 200 * (1 - punch));
      strokeWeight(5 * (1 - punch) + 1);
      arc(0, 0, fistDist * 2, fistDist * 2, from, to);

      // --- the steam fist --------------------------------------------------
      push();
      rotate(this.angle);
      translate(fistDist, 0);

      // piston arm back to Blitzcrank's shoulder
      stroke(90, 70, 45, 220 * fade);
      strokeWeight(11);
      line(-fistDist, 0, -6, 0);
      stroke(190, 150, 80, 230 * fade);
      strokeWeight(5);
      line(-fistDist, 0, -6, 0);

      // knuckle block
      stroke(70, 45, 20, 240 * fade);
      strokeWeight(2);
      fill(225, 165, 70, 245 * fade);
      rect(-14, -15, 26, 30, 6);
      fill(255, 215, 140, 235 * fade);
      rect(4, -12, 9, 24, 4);
      noStroke();
      fill(120, 80, 35, 220 * fade);
      for (let i = 0; i < 3; i++) rect(-6, -10 + i * 8, 14, 3, 2);
      pop();

      // --- who got hit ------------------------------------------------------
      if (t < 0.5) {
        const hitFade = 1 - t / 0.5;
        for (const p of this.hitPositions) {
          const x = p.x - this.position.x;
          const y = p.y - this.position.y;
          blendMode(ADD);
          noStroke();
          fill(255, 220, 150, 130 * hitFade);
          circle(x, y, 60 * (1 - hitFade) + 25);
          blendMode(BLEND);

          stroke(255, 245, 200, 240 * hitFade);
          strokeWeight(3);
          for (let i = 0; i < 4; i++) {
            const a = this.angle + (i * TWO_PI) / 4 + 0.4;
            const r0 = 12 + 20 * (1 - hitFade);
            line(
              cos(a) * r0,
              sin(a) * r0,
              cos(a) * (r0 + 16 * hitFade),
              sin(a) * (r0 + 16 * hitFade)
            );
          }
        }
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.range * 2);
    }
  }
  return Blitzcrank_E_Object;
}
const __cacheBlitzcrank_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildBlitzcrank_E_Object>>();
export function makeBlitzcrank_E_Object(api: ContentApi) {
  const cached = __cacheBlitzcrank_E_Object.get(api);
  if (cached) return cached;
  const built = __buildBlitzcrank_E_Object(api);
  __cacheBlitzcrank_E_Object.set(api, built);
  return built;
}