import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Veigar_W = InstanceType<ReturnType<typeof makeVeigar_W>>;
type Veigar_W_Object = InstanceType<ReturnType<typeof makeVeigar_W_Object>>;



// Exported so the suite asserts the wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const RANGE = 650;

export const RADIUS = 115;

export const WINDUP_MS = 1_300;

export const IMPACT_LIFETIME_MS = 450;

// The raw wiki number (60) was more than half a LOL2D champion's ~100 health
// pool off a basic ability. Sits at the top of the 15-35 band a normal spell
// gets here, which the 1.3s telegraph and the walk-out radius both pay for.
export const DAMAGE = 32;

export const MANA_COST = 45;


const CRACK_COUNT = 10;

// The final stretch of the wind-up gets an extra pulse so the instant of
// impact is unmistakable even at a glance, not just to someone staring at it.
const RUSH_MS = 250;


function __buildVeigar_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Veigar_W_Object = makeVeigar_W_Object(api);
  class Veigar_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_veigar_w');
    name = 'Thiên Thạch Đen (Veigar_W)';
    description = `Gọi một khối vật chất hắc ám giáng xuống vị trí chỉ định. Vùng đất bị ảnh hưởng hiện rõ trong <span class="time">${WINDUP_MS / 1000} giây</span> trước khi nổ, gây <span class="damage">${DAMAGE} sát thương</span> cho kẻ địch còn đứng trong vùng.`;
    // kept as a literal (not an exported constant) so the repo-wide arcade
    // cooldown-cap scan in tests/game/spells/cooldowns.test.ts can see it
    coolDown = 6_000;
    manaCost = MANA_COST;

    range = RANGE;
    radius = RADIUS;
    windUpMs = WINDUP_MS;
    damage = DAMAGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const obj = new Veigar_W_Object(this.owner);
      obj.position = to;
      obj.radius = this.radius;
      obj.windUpMs = this.windUpMs;
      obj.damage = this.damage;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Veigar_W;
}
const __cacheVeigar_W = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_W>>();
export default function makeVeigar_W(api: ContentApi) {
  const cached = __cacheVeigar_W.get(api);
  if (cached) return cached;
  const built = __buildVeigar_W(api);
  __cacheVeigar_W.set(api, built);
  return built;
}


/**
 * The telegraph *is* the ability: nothing here is a surprise. The exact
 * boundary is drawn from the very first frame, a closing wedge counts the
 * wind-up down, and cracks of dark energy widen as impact nears — a target
 * standing at the centre only has to cover `radius` (115) before the strike
 * lands, well inside what `windUpMs` (1.3s) gives a full-speed unit to do it.
 */
function __buildVeigar_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Veigar_W_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = RADIUS;
    windUpMs = WINDUP_MS;
    impactLifeTime = IMPACT_LIFETIME_MS;
    damage = DAMAGE;
    age = 0;
    hasImpacted = false;

    static PHASES = {
      TELEGRAPH: 0,
      IMPACT: 1,
    } as const;
    phase: (typeof Veigar_W_Object.PHASES)[keyof typeof Veigar_W_Object.PHASES] =
      Veigar_W_Object.PHASES.TELEGRAPH;

    // A fixed set of cracks, built once — keyed off `age` when drawn so the
    // ground reads as tearing open over time rather than flickering noise.
    _cracks: { angle: number; length: number; width: number }[] = Array.from(
      { length: CRACK_COUNT },
      () => ({ angle: random(TWO_PI), length: random(0.55, 1), width: random(0, 1) })
    );

    update() {
      this.age += deltaTime;

      if (this.phase === Veigar_W_Object.PHASES.TELEGRAPH) {
        if (this.age >= this.windUpMs) {
          this._impact();
          this.phase = Veigar_W_Object.PHASES.IMPACT;
          this.age = 0;
        }
        return;
      }

      if (this.age >= this.impactLifeTime) this.toRemove = true;
    }

    _impact() {
      if (this.hasImpacted) return;
      this.hasImpacted = true;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const enemy of enemies) {
        const distance = Math.hypot(
          enemy.position.x - this.position.x,
          enemy.position.y - this.position.y
        );
        if (distance <= this.radius + enemy.collisionRadius) {
          enemy.takeDamage(this.damage, this.owner);
        }
      }
    }

    draw() {
      if (this.phase === Veigar_W_Object.PHASES.TELEGRAPH) this._drawTelegraph();
      else this._drawImpact();
    }

    _drawTelegraph() {
      const t = constrain(this.age / this.windUpMs, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // danger fill: faint at first, unmistakable by the time it lands
      noStroke();
      fill(70, 15, 110, 25 + 55 * t);
      circle(0, 0, this.radius * 2);

      // the exact boundary, visible from frame one — the escape line is never a guess
      noFill();
      stroke(200, 130, 255, 220);
      strokeWeight(3);
      circle(0, 0, this.radius * 2);

      // countdown wedge sweeping shut, echoing Veigar_E's own cage timer
      noFill();
      stroke(230, 190, 255, 150 + 90 * t);
      strokeWeight(6);
      arc(0, 0, this.radius * 1.7, this.radius * 1.7, -HALF_PI, -HALF_PI + TWO_PI * t);

      // cracks of dark energy widening as impact nears
      stroke(190, 120, 255, 60 + 160 * t);
      for (const crack of this._cracks) {
        strokeWeight(1 + crack.width * 2 * t);
        const len = this.radius * crack.length * (0.3 + 0.7 * t);
        line(0, 0, cos(crack.angle) * len, sin(crack.angle) * len);
      }

      // last-second pulse so the strike moment reads clearly
      if (this.windUpMs - this.age < RUSH_MS) {
        const rushT = 1 - Math.max(0, this.windUpMs - this.age) / RUSH_MS;
        blendMode(ADD);
        noStroke();
        fill(200, 150, 255, 90 * rushT);
        circle(0, 0, this.radius * 2 * (1 + 0.15 * rushT));
        blendMode(BLEND);
      }

      pop();
    }

    _drawImpact() {
      const t = constrain(this.age / this.impactLifeTime, 0, 1);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      blendMode(ADD);
      noStroke();
      fill(150, 70, 230, 160 * fade);
      circle(0, 0, this.radius * 1.6 * (0.4 + t));
      fill(220, 190, 255, 120 * fade);
      circle(0, 0, this.radius * 0.9 * (0.4 + t));
      blendMode(BLEND);

      noFill();
      stroke(210, 160, 255, 220 * fade);
      strokeWeight(5 * fade + 1);
      circle(0, 0, this.radius * 2 * (0.5 + t * 0.6));

      stroke(230, 200, 255, 200 * fade);
      strokeWeight(2);
      for (const crack of this._cracks) {
        const len = this.radius * (1 + t * 0.6) * crack.length;
        line(
          cos(crack.angle) * this.radius * 0.3,
          sin(crack.angle) * this.radius * 0.3,
          cos(crack.angle) * len,
          sin(crack.angle) * len
        );
      }

      pop();
    }

    // covers the full danger radius plus the impact ring's overshoot, so the
    // culler never clips the strike while it is still resolving
    getDisplayBoundingBox() {
      const r = this.radius + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Veigar_W_Object;
}
const __cacheVeigar_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_W_Object>>();
export function makeVeigar_W_Object(api: ContentApi) {
  const cached = __cacheVeigar_W_Object.get(api);
  if (cached) return cached;
  const built = __buildVeigar_W_Object(api);
  __cacheVeigar_W_Object.set(api, built);
  return built;
}