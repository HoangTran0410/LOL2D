import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type XinZhao_W = InstanceType<ReturnType<typeof makeXinZhao_W>>;
type XinZhao_W_Object = InstanceType<ReturnType<typeof makeXinZhao_W_Object>>;



/** Four quick arcs around him, then the spear goes out in a line. */
export const XINZHAO_W_SLASH_COUNT = 4;

export const XINZHAO_W_SLASH_DAMAGE = 5;

export const XINZHAO_W_SLASH_RADIUS = 170;

/** Total width of the arc the slashes cover, centred on the aim. */
export const XINZHAO_W_SLASH_ARC = Math.PI * 0.9;

export const XINZHAO_W_SLASH_INTERVAL_MS = 60;

export const XINZHAO_W_THRUST_DAMAGE = 26;

export const XINZHAO_W_THRUST_RANGE = 480;

export const XINZHAO_W_THRUST_WIDTH = 70;

/** The wind-up: the slashes are the telegraph that the thrust is coming. */
export const XINZHAO_W_THRUST_DELAY_MS = 300;

export const XINZHAO_W_SLOW_PERCENT = 0.4;

export const XINZHAO_W_SLOW_MS = 1_400;


function __buildXinZhao_W(api: ContentApi) {
  const Spell = api.Spell;
  const XinZhao_W_Object = makeXinZhao_W_Object(api);
  class XinZhao_W extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_xinzhao_w');
    name = 'Phong Lôi Thương (XinZhao_W)';
    description =
      'Vung <span class="buff">4 nhát</span> quanh mình gây <span class="damage">5 sát thương</span> mỗi nhát, ' +
      'rồi <span class="time">sau 0.3 giây</span> đâm thẳng cây thương gây <span class="damage">26 sát thương</span> ' +
      'và <span class="buff">làm chậm 40%</span> trong <span class="time">1.4 giây</span>.';
    coolDown = 9_000;
    manaCost = 55;
    range = XINZHAO_W_THRUST_RANGE;

    onSpellCast(): void {
      const aim = this.aimPoint;
      let angle = Math.atan2(aim.y - this.owner.position.y, aim.x - this.owner.position.x);
      if (!Number.isFinite(angle)) angle = 0;

      const sweep = new XinZhao_W_Object(this.owner, angle);
      this.game.objectManager.addObject(sweep);
    }
  }
  return XinZhao_W;
}
const __cacheXinZhao_W = new WeakMap<ContentApi, ReturnType<typeof __buildXinZhao_W>>();
export default function makeXinZhao_W(api: ContentApi) {
  const cached = __cacheXinZhao_W.get(api);
  if (cached) return cached;
  const built = __buildXinZhao_W(api);
  __cacheXinZhao_W.set(api, built);
  return built;
}


/**
 * The sweep and the thrust, on one clock.
 *
 * Anchored where the cast happened rather than riding Xin Zhao: the arcs and
 * the line are one committed motion, and a spell whose hitbox followed him
 * would let a walking caster drag the thrust across the whole screen.
 */
function __buildXinZhao_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const AttackableUnit = api.units.AttackableUnit;
  class XinZhao_W_Object extends SpellObject {
    angle: number;
    origin: p5.Vector;
    age = 0;
    lifeTime = XINZHAO_W_THRUST_DELAY_MS + 450;
    slashesFired = 0;
    thrustFired = false;
    /** Jitter for the lightning edge, seeded once — re-rolling it per frame flickers. */
    private jitter: number[] = [];

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#ffe9a0', 0.45);

    constructor(owner: AttackableUnit, angle: number) {
      super(owner);
      this.angle = angle;
      this.origin = owner.position.copy();
      this.position = this.origin.copy();
    }

    onAdded(): void {
      this.useParticles(this.particleSystem);
      for (let i = 0; i < 12; i++) this.jitter.push(random(-9, 9));
    }

    update(): void {
      this.age += deltaTime;

      while (
        this.slashesFired < XINZHAO_W_SLASH_COUNT &&
        this.age >= this.slashesFired * XINZHAO_W_SLASH_INTERVAL_MS
      ) {
        this.slash();
        this.slashesFired++;
      }

      if (!this.thrustFired && this.age >= XINZHAO_W_THRUST_DELAY_MS) {
        this.thrustFired = true;
        this.thrust();
      }

      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    /** One arc of the sweep. Each arc is its own hit, so its own hit list. */
    private slash(): void {
      const half = XINZHAO_W_SLASH_ARC / 2;
      for (const enemy of this.enemiesAround(XINZHAO_W_SLASH_RADIUS)) {
        const toTarget = Math.atan2(
          enemy.position.y - this.origin.y,
          enemy.position.x - this.origin.x
        );
        let delta = toTarget - this.angle;
        while (delta > Math.PI) delta -= TWO_PI;
        while (delta < -Math.PI) delta += TWO_PI;
        if (Math.abs(delta) > half) continue;
        enemy.takeDamage(XINZHAO_W_SLASH_DAMAGE, this.owner);
      }
    }

    private thrust(): void {
      const endX = this.origin.x + Math.cos(this.angle) * XINZHAO_W_THRUST_RANGE;
      const endY = this.origin.y + Math.sin(this.angle) * XINZHAO_W_THRUST_RANGE;
      const halfWidth = XINZHAO_W_THRUST_WIDTH / 2;

      // the spear lands here, so the sparks do too — never at the cast
      for (let i = 0; i < 14; i++) {
        const along = (i + 1) / 15;
        this.particleSystem.addParticle({
          x: lerp(this.origin.x, endX, along) + random(-14, 14),
          y: lerp(this.origin.y, endY, along) + random(-14, 14),
          r: random(4, 11),
        });
      }

      const midX = (this.origin.x + endX) / 2;
      const midY = (this.origin.y + endY) / 2;
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: midX,
          y: midY,
          r: XINZHAO_W_THRUST_RANGE / 2 + XINZHAO_W_THRUST_WIDTH,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const enemy of enemies) {
        const distance = distanceToSegment(
          enemy.position.x,
          enemy.position.y,
          this.origin.x,
          this.origin.y,
          endX,
          endY
        );
        if (distance > halfWidth + (enemy.collisionRadius ?? 0)) continue;
        enemy.takeDamage(XINZHAO_W_THRUST_DAMAGE, this.owner);
        const slow = new Slow(XINZHAO_W_SLOW_MS, this.owner, enemy);
        slow.percent = XINZHAO_W_SLOW_PERCENT;
        enemy.addBuff(slow);
      }
    }

    private enemiesAround(radius: number): AttackableUnit[] {
      return this.game.objectManager.queryObjects({
        area: new Circle({ x: this.origin.x, y: this.origin.y, r: radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
    }

    draw(): void {
      push();
      // the arcs: each one fades on its own clock, so the sweep reads as four
      // strokes rather than one blur
      for (let i = 0; i < this.slashesFired; i++) {
        const slashAge = this.age - i * XINZHAO_W_SLASH_INTERVAL_MS;
        const t = constrain(slashAge / 260, 0, 1);
        if (t >= 1) continue;
        const half = XINZHAO_W_SLASH_ARC / 2;
        // alternate the stroke's direction so it looks like a figure of eight
        const dir = i % 2 === 0 ? 1 : -1;
        const lead = this.angle + dir * (half - XINZHAO_W_SLASH_ARC * (1 - t));
        noFill();
        stroke(255, 240, 190, 220 * (1 - t));
        strokeWeight(6 * (1 - t) + 2);
        const r = XINZHAO_W_SLASH_RADIUS * (0.75 + 0.25 * t);
        arc(this.origin.x, this.origin.y, r * 2, r * 2, lead - dir * 0.5, lead);
        // the tip of the stroke, so the eye can follow the blade
        stroke(255, 255, 255, 235 * (1 - t));
        strokeWeight(3);
        point(this.origin.x + cos(lead) * r, this.origin.y + sin(lead) * r);
      }
      pop();

      if (!this.thrustFired) return;

      const thrustAge = this.age - XINZHAO_W_THRUST_DELAY_MS;
      // extend over the first 120ms, then fade: the spear travels, never pops in
      const extend = constrain(thrustAge / 120, 0, 1);
      const eased = 1 - (1 - extend) * (1 - extend);
      const fade = constrain(1 - (thrustAge - 120) / 330, 0, 1);
      const reach = XINZHAO_W_THRUST_RANGE * eased;

      push();
      translate(this.origin.x, this.origin.y);
      rotate(this.angle);
      // body of the thrust on the exact hit width, so the hitbox is not a guess
      noStroke();
      fill(255, 226, 140, 90 * fade);
      rect(0, -XINZHAO_W_THRUST_WIDTH / 2, reach, XINZHAO_W_THRUST_WIDTH);
      // the lightning core, jagged along its length
      stroke(255, 255, 235, 240 * fade);
      strokeWeight(4);
      noFill();
      beginShape();
      for (let i = 0; i < this.jitter.length; i++) {
        const along = i / (this.jitter.length - 1);
        vertex(reach * along, this.jitter[i] * (1 - along) * fade);
      }
      endShape();
      // spear head at the leading edge
      fill(255, 245, 200, 245 * fade);
      noStroke();
      triangle(reach, 0, reach - 26, -13, reach - 26, 13);
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const reach = XINZHAO_W_THRUST_RANGE + XINZHAO_W_THRUST_WIDTH;
      return new Rectangle({
        x: this.origin.x - reach,
        y: this.origin.y - reach,
        w: reach * 2,
        h: reach * 2,
        data: this,
      });
    }
  }
  return XinZhao_W_Object;
}
const __cacheXinZhao_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildXinZhao_W_Object>>();
export function makeXinZhao_W_Object(api: ContentApi) {
  const cached = __cacheXinZhao_W_Object.get(api);
  if (cached) return cached;
  const built = __buildXinZhao_W_Object(api);
  __cacheXinZhao_W_Object.set(api, built);
  return built;
}


/** Distance from a point to a segment — the thrust is a capsule, not a circle. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}