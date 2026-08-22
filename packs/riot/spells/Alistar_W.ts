import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Alistar_W = InstanceType<ReturnType<typeof makeAlistar_W>>;
type Alistar_W_Object = InstanceType<ReturnType<typeof makeAlistar_W_Object>>;



function __buildAlistar_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Alistar_W_Object = makeAlistar_W_Object(api);
  class Alistar_W extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_alistar_w');
    name = 'Bò Húc (Alistar_W)';
    description =
      '<span class="buff">Lướt</span> tới kẻ địch gần nhất trong phạm vi rồi húc chúng bay ra xa, gây <span class="damage">30 sát thương</span> và <span class="buff">Hất Tung</span> trong <span class="time">0.7 giây</span>';
    coolDown = 10000;
    manaCost = 50;

    range = 400;
    knockbackDistance = 250;
    damage = 30;
    airborneTime = 700;

    findNearestEnemy(): any {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      });

      let nearestEnemy: any = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = enemy.position.dist(this.owner.position);
        if (distance < nearestDistance) {
          nearestEnemy = enemy;
          nearestDistance = distance;
        }
      }
      return nearestEnemy;
    }

    checkCastCondition() {
      return Dash.CanDash(this.owner) && !!this.findNearestEnemy();
    }

    onSpellCast() {
      const target = this.findNearestEnemy();
      if (!target) return;

      // stop just short of the target so the knockback direction stays well defined
      const gap = (target.stats.size.value + this.owner.stats.size.value) / 2;
      const distance = Math.max(1, this.owner.position.dist(target.position) - gap);
      const { to: dashTo } = VectorUtils.getVectorWithRange(
        this.owner.position,
        target.position,
        distance
      );

      const dashBuff = new Dash(2000, this.owner, this.owner);
      dashBuff.image = this.image;
      dashBuff.dashDestination = dashTo;
      dashBuff.dashSpeed = 14;
      dashBuff.onReachedDestination = () => {
        if (target.isDead) return;

        target.takeDamage(this.damage, this.owner);

        const airborneBuff = new Airborne(this.airborneTime, this.owner, target);
        airborneBuff.image = this.image;
        airborneBuff.height = 25;
        target.addBuff(airborneBuff);

        // sent flying further along the same line the charge came in on
        const direction = VectorUtils.getDirectionVector(this.owner.position, target.position);
        // read the heading before `mult` mutates the vector below
        const knockAngle = direction.heading();
        const knockTo = p5.Vector.add(target.position, direction.mult(this.knockbackDistance));

        // the headbutt itself: a shockwave punching down the knockback lane
        const impact = new Alistar_W_Object(this.owner);
        impact.position = target.position.copy();
        impact.angle = knockAngle;
        impact.knockDistance = this.knockbackDistance;
        this.game.objectManager.addObject(impact);

        const knockBuff = new Dash(this.airborneTime + 500, this.owner, target);
        knockBuff.image = this.image;
        knockBuff.dashDestination = knockTo;
        knockBuff.dashSpeed = 12;
        knockBuff.showTrail = false;
        knockBuff.cancelable = false;
        target.addBuff(knockBuff);
      };
      this.owner.addBuff(dashBuff);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Alistar_W;
}
const __cacheAlistar_W = new WeakMap<ContentApi, ReturnType<typeof __buildAlistar_W>>();
export default function makeAlistar_W(api: ContentApi) {
  const cached = __cacheAlistar_W.get(api);
  if (cached) return cached;
  const built = __buildAlistar_W(api);
  __cacheAlistar_W.set(api, built);
  return built;
}


interface Debris {
  angle: number;
  distance: number;
  speed: number;
  size: number;
}


const DEBRIS_COUNT = 14;


/**
 * The moment of the headbutt. Everything here is oriented along `angle`, the
 * direction the victim is being hurled, so the shove reads as a direction and
 * not just a flash: a bright lane down the knockback path, forward-facing
 * shock arcs, and dust thrown up under the hooves.
 */
function __buildAlistar_W_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Alistar_W_Object extends SpellObject {
    position = this.owner.position.copy();
    angle = 0;
    knockDistance = 250;

    age = 0;
    lifeTime = 600;

    _debris: Debris[] = [];

    onAdded() {
      for (let i = 0; i < DEBRIS_COUNT; i++) {
        this._debris.push({
          // biased forward, the way dirt sprays off a charge
          angle: this.angle + random(-1.5, 1.5),
          distance: random(8, 34),
          speed: random(50, 150),
          size: random(5, 13),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const cosA = cos(this.angle);
      const sinA = sin(this.angle);

      push();

      // the lane the victim is being thrown down — this is what makes the
      // knockback direction obvious even after the target has left the screen
      const laneLength = this.knockDistance * (0.3 + t * 0.7);
      stroke(255, 175, 60, 150 * fade);
      strokeWeight(34 * fade + 6);
      line(
        this.position.x + cosA * 20,
        this.position.y + sinA * 20,
        this.position.x + cosA * laneLength,
        this.position.y + sinA * laneLength
      );
      stroke(255, 250, 225, 235 * fade);
      strokeWeight(8 * fade + 2);
      line(
        this.position.x + cosA * 20,
        this.position.y + sinA * 20,
        this.position.x + cosA * laneLength,
        this.position.y + sinA * laneLength
      );

      pop();

      push();
      translate(this.position.x, this.position.y);
      rotate(this.angle);

      // three shock arcs opening forward from the point of contact
      noFill();
      for (let i = 0; i < 3; i++) {
        const size = 70 + t * 260 + i * 44;
        stroke(120, 70, 20, 200 * fade * (1 - i * 0.3));
        strokeWeight((18 - i * 4) * fade + 2);
        arc(0, 0, size, size, -1.0, 1.0);
        stroke(255, 232, 175, 255 * fade * (1 - i * 0.28));
        strokeWeight((10 - i * 2.5) * fade + 1);
        arc(0, 0, size, size, -1.0, 1.0);
      }

      // white star of contact, only in the first instants
      const flash = 1 - constrain(t / 0.3, 0, 1);
      if (flash > 0) {
        stroke(255, 255, 250, 255 * flash);
        strokeWeight(7 * flash + 1);
        for (let i = 0; i < 7; i++) {
          const a = -1.1 + (i / 6) * 2.2;
          const inner = 6;
          const outer = 30 + (1 - flash) * 70;
          line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
        }
        noStroke();
        fill(255, 255, 245, 220 * flash);
        circle(0, 0, 34 * flash + 10);
      }

      pop();

      // dirt kicked out of the ground
      push();
      noStroke();
      for (const d of this._debris) {
        const dist = d.distance + d.speed * t;
        fill(220, 200, 165, 170 * fade);
        circle(
          this.position.x + cos(d.angle) * dist,
          this.position.y + sin(d.angle) * dist,
          d.size * (1 - t * 0.6)
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.knockDistance + 140;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Alistar_W_Object;
}
const __cacheAlistar_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAlistar_W_Object>>();
export function makeAlistar_W_Object(api: ContentApi) {
  const cached = __cacheAlistar_W_Object.get(api);
  if (cached) return cached;
  const built = __buildAlistar_W_Object(api);
  __cacheAlistar_W_Object.set(api, built);
  return built;
}