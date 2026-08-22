import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Thresh_W = InstanceType<ReturnType<typeof makeThresh_W>>;
type Thresh_W_Lantern_Throw = InstanceType<ReturnType<typeof makeThresh_W_Lantern_Throw>>;
type Thresh_W_Object = InstanceType<ReturnType<typeof makeThresh_W_Object>>;



export const MAX_RANGE = 500;

export const RADIUS = 200;

export const DURATION = 5000;

export const SHIELD_AMOUNT = 45;

export const THROW_SPEED = 11;


/**
 * Dark Passage. The lantern in League is a *ride*, and this game has no ally
 * targeting to click it with — so it lands as what the lantern is for instead:
 * a lit patch that keeps whoever stands in it alive. Refreshed while they stay.
 */
function __buildThresh_W(api: ContentApi) {
  const Spell = api.Spell;
  const Thresh_W_Lantern_Throw = makeThresh_W_Lantern_Throw(api);
  class Thresh_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_thresh_w');
    name = 'Con Đường Tăm Tối (Thresh_W)';
    description =
      `Ném chiếc đèn bay tới vị trí chỉ định; <span class="damage">khi đáp xuống</span> nó treo ở đó` +
      ` <span class="time">${DURATION / 1000} giây</span>: mọi đồng minh <span class="buff">đứng trong</span>` +
      ` <span>${RADIUS}px</span> liên tục nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span>`;
    coolDown = 10000;
    manaCost = 40;

    maxRange = MAX_RANGE;

    onSpellCast() {
      const aim = this.aimPoint;
      const spot = aim
        .copy()
        .sub(this.owner.position)
        .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
        .add(this.owner.position);

      // The lantern is thrown, not placed. Spawning it at the destination (which
      // this used to do) meant the ability had no travel and no tell: the light
      // simply existed, at range, the instant the key went down.
      const thrown = new Thresh_W_Lantern_Throw(this.owner);
      thrown.destination = spot;
      this.game.objectManager.addObject(thrown);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Thresh_W;
}
const __cacheThresh_W = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_W>>();
export default function makeThresh_W(api: ContentApi) {
  const cached = __cacheThresh_W.get(api);
  if (cached) return cached;
  const built = __buildThresh_W(api);
  __cacheThresh_W.set(api, built);
  return built;
}


/**
 * The lantern in flight. `maxHitCount = 0`: it is lobbed over the fight and
 * only matters where it lands, so a body in the way must not eat it.
 */
function __buildThresh_W_Lantern_Throw(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const MissileSpellObject = api.MissileSpellObject;
  const Thresh_W_Object = makeThresh_W_Object(api);
  class Thresh_W_Lantern_Throw extends MissileSpellObject {
    speed = THROW_SPEED;
    size = 22;
    maxHitCount = 0;
    swing = 0;
    totalDistance = 0;

    onAdded() {
      super.onAdded();
      this.totalDistance = Math.max(1, this.position.dist(this.destination));
    }

    onAfterMove() {
      this.swing += deltaTime / 120;
    }

    onArrive() {
      const lantern = new Thresh_W_Object(this.owner);
      lantern.position = this.destination.copy();
      this.game.objectManager.addObject(lantern);
    }

    /** Height above the ground right now: 0 at both ends of the throw. */
    _arcLift(): number {
      const travelled =
        1 - constrain(this.position.dist(this.destination) / this.totalDistance, 0, 1);
      return Math.sin(travelled * PI) * Math.min(70, this.totalDistance * 0.2);
    }

    draw() {
      const lift = this._arcLift();
      push();
      // the shadow stays on the ground and shrinks as the lantern climbs
      noStroke();
      fill(0, 0, 0, 70);
      ellipse(this.position.x, this.position.y, this.size * (1 - lift / 160), this.size * 0.45);

      translate(this.position.x, this.position.y - lift);
      rotate(Math.sin(this.swing) * 0.5);
      stroke(180, 255, 230, 220);
      strokeWeight(2);
      line(0, -24, 0, -12);
      noStroke();
      fill(60, 200, 160, 240);
      rect(-10, -12, 20, 24, 4);
      fill(210, 255, 240, 250);
      circle(0, 0, 11);
      // the glow it trails
      fill(120, 255, 210, 60);
      circle(0, 0, 34);
      pop();
    }

    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.position.x - this.size,
        y: this.position.y - this.size - 80,
        w: this.size * 2,
        h: this.size * 2 + 80,
        data: this,
      });
    }
  }
  return Thresh_W_Lantern_Throw;
}
const __cacheThresh_W_Lantern_Throw = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_W_Lantern_Throw>>();
export function makeThresh_W_Lantern_Throw(api: ContentApi) {
  const cached = __cacheThresh_W_Lantern_Throw.get(api);
  if (cached) return cached;
  const built = __buildThresh_W_Lantern_Throw(api);
  __cacheThresh_W_Lantern_Throw.set(api, built);
  return built;
}


function __buildThresh_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const Shield = api.buffs.Shield;
  class Thresh_W_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = DURATION;
    age = 0;
    sinceTick = 0;

    update() {
      this.age += deltaTime;
      this.sinceTick += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      if (this.sinceTick < 500) return;
      this.sinceTick -= 500;

      // Allies, so the filter is inverted: everything this team cannot damage,
      // minus the neutral objects with no buff list.
      //
      // The distance test is not redundant with the query. `queryObjects` walks
      // a quadtree and hands back everything whose *region* overlaps the search
      // area — candidates, not members. Every damage circle in this file's
      // neighbourhood gets away with that because a stray unit at the corner of
      // a node takes one hit it should not have; a lantern re-applies every
      // 500ms, so the same slop showed up as allies being shielded from well
      // outside the light.
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      });
      for (const unit of candidates as any[]) {
        if (!unit?.addBuff || unit.isDead) continue;
        if (unit.teamId !== this.owner.teamId && unit !== this.owner) continue;
        if (this.position.dist(unit.position) > this.radius) continue;

        const shield = new Shield(900, this.owner, unit);
        shield.stackId = 'thresh_w_lantern';
        shield.amount = SHIELD_AMOUNT;
        shield.color = [140, 255, 210];
        unit.addBuff(shield);
      }
    }

    draw() {
      const swing = Math.sin(this.age / 400) * 0.25;
      const left = 1 - this.age / this.lifeTime;
      push();
      translate(this.position.x, this.position.y);
      noStroke();
      fill(90, 255, 200, 30 * left);
      circle(0, 0, this.radius * 2);
      noFill();
      stroke(120, 255, 210, 160 * left);
      strokeWeight(2);
      circle(0, 0, this.radius * 2);
      // the lantern, swinging on its chain
      rotate(swing);
      stroke(180, 255, 230, 220);
      strokeWeight(2);
      line(0, -46, 0, -22);
      noStroke();
      fill(60, 200, 160, 235);
      rect(-11, -22, 22, 26, 4);
      fill(200, 255, 235, 240);
      circle(0, -9, 12);
      pop();
    }

    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.position.x - this.radius,
        y: this.position.y - this.radius - 50,
        w: this.radius * 2,
        h: this.radius * 2 + 50,
        data: this,
      });
    }
  }
  return Thresh_W_Object;
}
const __cacheThresh_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_W_Object>>();
export function makeThresh_W_Object(api: ContentApi) {
  const cached = __cacheThresh_W_Object.get(api);
  if (cached) return cached;
  const built = __buildThresh_W_Object(api);
  __cacheThresh_W_Object.set(api, built);
  return built;
}