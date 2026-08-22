import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ashe_E = InstanceType<ReturnType<typeof makeAshe_E>>;
type Ashe_E_Object = InstanceType<ReturnType<typeof makeAshe_E_Object>>;
type Ashe_E_Ping = InstanceType<ReturnType<typeof makeAshe_E_Ping>>;



/** Ashe's own reveal slot, so hers neither evicts nor is evicted by another spell's. */
export const REVEAL_STACK_ID = 'ashe_e_reveal';

const RANGE = 4000;


function __buildAshe_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Ashe_E_Object = makeAshe_E_Object(api);
  class Ashe_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_ashe_e');
    name = 'Ưng Tiễn (Ashe_E)';
    description = `Thả một chim ưng bay xa <span>${RANGE}px</span> theo hướng chỉ định. Chim ưng không gây sát thương nhưng <span class="buff">Mở Tầm Nhìn</span> trên suốt đường bay và khiến mọi kẻ địch nó bay ngang qua bị <span class="buff">Lộ Diện</span> trong <span class="time">3 giây</span>`;
    coolDown = 6000;
    manaCost = 30;

    // Fires a fixed distance in the aimed direction, not to the cursor: the cast
    // resolves the *direction* to `aimPoint` and `getVectorWithRange` (via
    // `setMag`) always extends it to the full range, overshooting a near cursor.
    range = RANGE;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const obj = new Ashe_E_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      obj.direction = p5.Vector.sub(to, from).normalize();
      this.game.objectManager.addObject(obj);
    }
  }
  return Ashe_E;
}
const __cacheAshe_E = new WeakMap<ContentApi, ReturnType<typeof __buildAshe_E>>();
export default function makeAshe_E(api: ContentApi) {
  const cached = __cacheAshe_E.get(api);
  if (cached) return cached;
  const built = __buildAshe_E(api);
  __cacheAshe_E.set(api, built);
  return built;
}


function __buildAshe_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const MissileSpellObject = api.MissileSpellObject;
  const createReveal = api.buffs.createReveal;
  const TrailSystem = api.helpers.TrailSystem;
  const Ashe_E_Ping = makeAshe_E_Ping(api);
  class Ashe_E_Object extends MissileSpellObject {
    speed = 11;
    size = 22;
    // a scout, not a skillshot: it never collides with anything
    maxHitCount = 0;

    /** How far the bird sees — the sight polygon that lights terrain for the team. */
    visionRadius = 400;
    /** Enemies this close get revealed to the whole team for a while. */
    revealRadius = 260;
    revealDuration = 3000;
    revealVisionRadius = 150;

    /**
     * The seam `FogOfWar.calculateSight` selects allied revealers on — it lives on
     * `AttackableUnit` (defaulting to `visionRadius`) and nowhere on `SpellObject`,
     * so without this the bird's `fogRevealRadius` was `undefined`, `undefined > 0`
     * was `false`, and the whole hawk was dropped from the revealer list: it lit
     * nothing for the team. Mirrors the unit default so the scout reveals a
     * wall-aware sight polygon exactly like a champion's.
     */
    get fogRevealRadius(): number {
      return this.visionRadius;
    }

    /** Revealed once each — re-applying every frame would churn TrueSight's sight object. */
    revealedTargets: any[] = [];

    wingPhase = 0;
    /** Cosmetic: the sweep line rotating inside the vision disc. */
    _scan = 0;

    trailSystem = new TrailSystem({
      maxLength: 30,
      trailSize: 7,
      trailColor: '#CFEEFF55',
    });

    onAfterMove() {
      this.wingPhase += 0.25;
      this._scan += 0.06;

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

        enemy.addBuff(
          createReveal({
            stackId: REVEAL_STACK_ID,
            durationMs: this.revealDuration,
            source: this.owner,
            target: enemy,
            visionRadius: this.revealVisionRadius,
            image: api.asset('spell_ashe_e'),
          })
        );

        // a ping on the newly spotted enemy, so being revealed is visible
        const ping = new Ashe_E_Ping(this.owner);
        ping.target = enemy;
        ping.attachTo(enemy);
        this.game.objectManager.addObject(ping);
      }
    }

    draw() {
      const flap = sin(this.wingPhase);
      const heading = this.direction.heading();

      push();
      translate(this.position.x, this.position.y);

      // --- the patch of map the hawk is lighting up -------------------------
      noStroke();
      fill(150, 210, 255, 16);
      circle(0, 0, this.revealRadius * 2);

      noFill();
      stroke(170, 225, 255, 60);
      strokeWeight(2);
      circle(0, 0, this.revealRadius * 2);

      // radar sweep, so the disc reads as "searching" rather than as a smudge
      stroke(190, 235, 255, 70);
      strokeWeight(2);
      arc(0, 0, this.revealRadius * 2, this.revealRadius * 2, this._scan, this._scan + 0.9);
      stroke(190, 235, 255, 45);
      line(
        0,
        0,
        cos(this._scan + 0.9) * this.revealRadius,
        sin(this._scan + 0.9) * this.revealRadius
      );

      // --- the bird itself --------------------------------------------------
      rotate(heading);

      // shadow underneath keeps it readable over pale terrain
      noStroke();
      fill(20, 40, 60, 90);
      ellipse(-2, 6, this.size * 1.5, this.size * 0.5);

      const span = this.size * (0.75 + 0.75 * Math.abs(flap));
      const tilt = flap * 0.35;

      // wings: swept back, folding through the flap
      fill(140, 195, 245, 235);
      beginShape();
      vertex(4, -2);
      vertex(-6, -span * (1 - tilt));
      vertex(-this.size * 1.1, -span * 0.55 * (1 - tilt));
      vertex(-8, -3);
      endShape(CLOSE);
      beginShape();
      vertex(4, 2);
      vertex(-6, span * (1 + tilt));
      vertex(-this.size * 1.1, span * 0.55 * (1 + tilt));
      vertex(-8, 3);
      endShape(CLOSE);

      // body + tail
      fill(226, 242, 255, 245);
      beginShape();
      vertex(this.size * 0.75, 0);
      vertex(0, -this.size * 0.3);
      vertex(-this.size * 0.75, -this.size * 0.26);
      vertex(-this.size * 0.55, 0);
      vertex(-this.size * 0.75, this.size * 0.26);
      vertex(0, this.size * 0.3);
      endShape(CLOSE);

      // beak and eye
      fill(255, 200, 90);
      triangle(this.size * 0.75, 0, this.size * 0.45, -3, this.size * 0.45, 3);
      fill(30, 50, 70);
      circle(this.size * 0.4, -2, 3.5);

      pop();
    }

    // the vision it carries reaches far past the sprite, so the box must cover it
    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.visionRadius * 2);
    }
  }
  return Ashe_E_Object;
}
const __cacheAshe_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAshe_E_Object>>();
export function makeAshe_E_Object(api: ContentApi) {
  const cached = __cacheAshe_E_Object.get(api);
  if (cached) return cached;
  const built = __buildAshe_E_Object(api);
  __cacheAshe_E_Object.set(api, built);
  return built;
}


/** Marker that snaps onto an enemy the hawk has just uncovered. */
function __buildAshe_E_Ping(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Ashe_E_Ping extends SpellObject {
    target: any = null;
    age = 0;
    lifeTime = 700;

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      if (this.target) this.position.set(this.target.position.x, this.target.position.y);
      if (this.age >= this.lifeTime || !this.target) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const size = this.target?.animatedValues?.displaySize ?? 40;
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      // two rings closing in on the target, like a scope locking on
      noFill();
      stroke(160, 225, 255, 220 * fade);
      strokeWeight(2);
      circle(0, 0, size + 70 * (1 - t) + 10);

      stroke(200, 240, 255, 180 * fade);
      strokeWeight(2);
      for (let i = 0; i < 4; i++) {
        const a = (i * TWO_PI) / 4 + t * 1.2;
        const r = size / 2 + 8;
        line(cos(a) * r, sin(a) * r, cos(a) * (r + 9), sin(a) * (r + 9));
      }
      pop();
    }

    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.position.x - 70,
        y: this.position.y - 70,
        w: 140,
        h: 140,
        data: this,
      });
    }
  }
  return Ashe_E_Ping;
}
const __cacheAshe_E_Ping = new WeakMap<ContentApi, ReturnType<typeof __buildAshe_E_Ping>>();
export function makeAshe_E_Ping(api: ContentApi) {
  const cached = __cacheAshe_E_Ping.get(api);
  if (cached) return cached;
  const built = __buildAshe_E_Ping(api);
  __cacheAshe_E_Ping.set(api, built);
  return built;
}