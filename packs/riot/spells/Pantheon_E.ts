import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { drawAegis } from './Pantheon_W';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Pantheon_E = InstanceType<ReturnType<typeof makePantheon_E>>;
type Pantheon_E_Aegis = InstanceType<ReturnType<typeof makePantheon_E_Aegis>>;
type Pantheon_E_Object = InstanceType<ReturnType<typeof makePantheon_E_Object>>;



export const DURATION = 1600;

export const SHIELD_AMOUNT = 60;

export const DAMAGE_PER_TICK = 6;

export const TICK_INTERVAL = 400;

export const REACH = 200;

export const HALF_WIDTH = 70;


/**
 * Half the angle of the wedge, shared by the damage test and the art.
 *
 * These were two different numbers: the query used `atan2(HALF_WIDTH, REACH/2)`
 * and the cone was drawn at a flat ±0.55, so a sliver down each edge was lethal
 * and unpainted. One constant means retuning the width cannot desynchronise
 * them again.
 */
export const HALF_ANGLE = Math.atan2(HALF_WIDTH, REACH * 0.5);


/** How long the aegis takes to slam into the dirt before the first thrust. */
export const PLANT_MS = 180;


/**
 * Aegis Assault: he plants the shield in one direction and hammers everything
 * in front of it. The shield is the point — a window where he can stand in a
 * fight he would otherwise have to walk out of.
 *
 * The art used to be a flat blue pie slice, a 12px rounded rectangle and one
 * white line sliding in and out. Nothing about it was Pantheon, nothing about
 * it read as *hitting*, and the thing the ability is for — a braced wall of
 * bronze with a spear working from behind it — was not on screen at all.
 *
 * It is now two objects, because the two halves belong on different layers: the
 * dirt he tears up paints under the feet standing in it (`zIndex = GROUND_Z_INDEX`, the
 * ground-decal rule in CLAUDE.md), and the shield he is holding paints over
 * them.
 */
function __buildPantheon_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Shield = api.buffs.Shield;
  const Pantheon_E_Object = makePantheon_E_Object(api);
  const Pantheon_E_Aegis = makePantheon_E_Aegis(api);
  class Pantheon_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_pantheon_e');
    name = 'Tiến Công Vũ Bão (Pantheon_E)';
    description =
      `Cắm khiên về hướng chỉ định trong <span class="time">${DURATION / 1000} giây</span>:` +
      ` nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span> và liên tục đâm giáo` +
      ` <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi nhịp cho kẻ địch phía trước`;
    coolDown = 10000;
    manaCost = 35;

    range = REACH;

    onSpellCast() {
      const shield = new Shield(DURATION, this.owner, this.owner);
      shield.stackId = 'pantheon_e';
      shield.image = this.image;
      shield.amount = SHIELD_AMOUNT;
      // Bronze, not the old ice blue — that palette is Anivia's.
      shield.color = [214, 168, 96];
      this.owner.addBuff(shield);

      const direction = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, 1)
        .to.copy()
        .sub(this.owner.position);

      const ground = new Pantheon_E_Object(this.owner);
      ground.direction = direction;
      this.game.objectManager.addObject(ground);

      const aegis = new Pantheon_E_Aegis(this.owner);
      aegis.ground = ground;
      ground.aegis = aegis;
      this.game.objectManager.addObject(aegis);
    }

    drawPreview() {
      super.drawPreview(REACH);
    }
  }
  return Pantheon_E;
}
const __cachePantheon_E = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_E>>();
export default function makePantheon_E(api: ContentApi) {
  const cached = __cachePantheon_E.get(api);
  if (cached) return cached;
  const built = __buildPantheon_E(api);
  __cachePantheon_E.set(api, built);
  return built;
}


/** A crack in the dirt: fixed at spawn so the ground does not crawl. */
interface Fissure {
  angle: number;
  reach: number;
  kink: number;
}


/**
 * The torn-up ground in front of the shield — and the damage, because the wedge
 * that hurts and the wedge that is painted have to be the same wedge.
 */
function __buildPantheon_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Pantheon_E_Object extends SpellObject {
    direction: p5.Vector = this.owner.position.copy();
    lifeTime = DURATION;
    age = 0;
    sinceTick = 0;
    /** Bumped on every thrust that resolves; the aegis reads it to fire sparks. */
    tickCount = 0;
    visionRadius = REACH;
    /** Dirt, so it paints under the units standing on it. */
    zIndex = GROUND_Z_INDEX;
    aegis: Pantheon_E_Aegis | null = null;

    _fissures: Fissure[] = [];

    onAdded() {
      for (let i = 0; i < 7; i++) {
        this._fissures.push({
          angle: random(-HALF_ANGLE, HALF_ANGLE),
          reach: random(0.45, 1),
          kink: random(-0.16, 0.16),
        });
      }
    }

    update() {
      this.position = this.owner.position.copy();
      this.age += deltaTime;
      this.sinceTick += deltaTime;
      if (this.age >= this.lifeTime || this.owner.isDead) {
        this.toRemove = true;
        return;
      }
      if (this.sinceTick < TICK_INTERVAL) return;
      this.sinceTick -= TICK_INTERVAL;
      this.tickCount++;

      // A circle query filtered down to the wedge in front of him: the shield
      // only covers one side, and the damage has to agree with the art.
      const heading = Math.atan2(this.direction.y, this.direction.x);
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: REACH }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => {
        const toEnemy = Math.atan2(
          enemy.position.y - this.position.y,
          enemy.position.x - this.position.x
        );
        let delta = Math.abs(toEnemy - heading) % (Math.PI * 2);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        if (delta > HALF_ANGLE) return;
        enemy.takeDamage(DAMAGE_PER_TICK, this.owner);
      });
    }

    /** The aegis is this object's other half; it must not outlive the wedge. */
    onRemoved() {
      if (this.aegis) this.aegis.toRemove = true;
      super.onRemoved();
    }

    draw() {
      const heading = Math.atan2(this.direction.y, this.direction.x);
      // He drives the shield in before anything comes out from behind it.
      const plant = constrain(this.age / PLANT_MS, 0, 1);
      const fade = constrain((this.lifeTime - this.age) / 260, 0, 1);
      const span = REACH * (0.35 + 0.65 * plant);
      // How far the last thrust's shock has got along the ground.
      const wave = constrain(this.sinceTick / (TICK_INTERVAL * 0.62), 0, 1);

      push();
      translate(this.position.x, this.position.y);
      rotate(heading);

      // the threatened wedge
      noStroke();
      fill(120, 82, 34, 70 * fade);
      arc(0, 0, span * 2, span * 2, -HALF_ANGLE, HALF_ANGLE, PIE);
      fill(196, 142, 62, 40 * fade);
      arc(0, 0, span * 1.2, span * 1.2, -HALF_ANGLE, HALF_ANGLE, PIE);

      // cracks running out from where the shield is dug in
      stroke(78, 52, 22, 190 * fade * plant);
      strokeWeight(3);
      noFill();
      for (const fissure of this._fissures) {
        const end = span * fissure.reach;
        beginShape();
        vertex(0, 0);
        vertex(cos(fissure.angle) * end * 0.55, sin(fissure.angle) * end * 0.55 + fissure.kink * 30);
        vertex(cos(fissure.angle + fissure.kink) * end, sin(fissure.angle + fissure.kink) * end);
        endShape();
      }

      // the shock of each thrust travelling out to the rim and dying there
      if (wave < 1) {
        const shock = span * (0.25 + 0.85 * wave);
        noFill();
        stroke(255, 226, 168, 210 * (1 - wave) * fade);
        strokeWeight(7 * (1 - wave) + 1.5);
        arc(0, 0, shock * 2, shock * 2, -HALF_ANGLE * 0.92, HALF_ANGLE * 0.92);
      }

      // the far edge, so the reach reads without having to walk into it
      noFill();
      stroke(236, 196, 128, 200 * fade * plant);
      strokeWeight(3);
      arc(0, 0, span * 2, span * 2, -HALF_ANGLE, HALF_ANGLE);
      // ...and the two flanks, which are the part players actually step around
      stroke(236, 196, 128, 120 * fade * plant);
      strokeWeight(2);
      line(0, 0, cos(-HALF_ANGLE) * span, sin(-HALF_ANGLE) * span);
      line(0, 0, cos(HALF_ANGLE) * span, sin(HALF_ANGLE) * span);

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(REACH * 2);
    }
  }
  return Pantheon_E_Object;
}
const __cachePantheon_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_E_Object>>();
export function makePantheon_E_Object(api: ContentApi) {
  const cached = __cachePantheon_E_Object.get(api);
  if (cached) return cached;
  const built = __buildPantheon_E_Object(api);
  __cachePantheon_E_Object.set(api, built);
  return built;
}


interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}


/**
 * The shield itself and the spear working behind it, drawn over the units the
 * wedge is painted under.
 *
 * Held together by `ground`: one clock drives the wedge, the damage and the
 * thrust, so the spear is at full extension on exactly the frame something
 * takes the hit. A second timer here would drift apart from it within a second.
 */
function __buildPantheon_E_Aegis(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Pantheon_E_Aegis extends SpellObject {
    ground: Pantheon_E_Object | null = null;
    _sparks: Spark[] = [];
    _seenTicks = 0;

    update() {
      if (!this.ground || this.ground.toRemove || this.owner.isDead) {
        this.toRemove = true;
        return;
      }
      this.position = this.owner.position.copy();

      if (this.ground.tickCount !== this._seenTicks) {
        this._seenTicks = this.ground.tickCount;
        this._burst();
      }

      for (const spark of this._sparks) {
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.vy += 0.35; // grit falls back down
        spark.life -= deltaTime;
      }
      this._sparks = this._sparks.filter(spark => spark.life > 0);
    }

    /** Sparks off the spear head, thrown forward and along the shield face. */
    _burst() {
      const heading = this._heading();
      const tip = REACH * 0.62;
      for (let i = 0; i < 9; i++) {
        const spread = heading + random(-0.7, 0.7);
        const speed = random(2.5, 7);
        this._sparks.push({
          x: cos(heading) * tip,
          y: sin(heading) * tip,
          vx: cos(spread) * speed,
          vy: sin(spread) * speed - random(1, 3),
          life: random(160, 320),
          size: random(2.5, 5.5),
        });
      }
    }

    _heading(): number {
      const direction = this.ground?.direction;
      if (!direction) return 0;
      return Math.atan2(direction.y, direction.x);
    }

    /**
     * The thrust cycle, as a 0..1 extension of the spear, negative while he winds
     * back. He pulls it in behind the aegis before driving it out again, so the
     * strike is something the eye can see coming rather than a line that appears
     * at full length — rule 1 in docs/VFX_STANDARD.md.
     */
    _thrust(): number {
      if (!this.ground) return 0;
      const phase = constrain(this.ground.sinceTick / TICK_INTERVAL, 0, 1);
      if (phase < 0.35) {
        const out = 1 - phase / 0.35;
        return out * out * (3 - 2 * out); // smoothstep, so it settles rather than snaps
      }
      if (phase > 0.72) return -0.35 * ((phase - 0.72) / 0.28);
      return 0;
    }

    draw() {
      if (!this.ground) return;
      const heading = this._heading();
      const plant = constrain(this.ground.age / PLANT_MS, 0, 1);
      const fade = constrain((this.ground.lifeTime - this.ground.age) / 260, 0, 1);
      const thrust = this._thrust();
      const size = this.owner.stats.size.value;
      // He plants it by driving it down and forward; before that it is still high.
      const stand = 44 + size * 0.35;
      const lift = (1 - plant) * 34;
      // the shield rocks back into his shoulder on the strike and settles
      const recoil = -thrust * 7;

      push();
      translate(this.position.x, this.position.y);
      rotate(heading);

      // the spear: shaft out of his hand, clearing the rim of the shield. The
      // reach has to beat the aegis's own half-width or the thrust happens
      // entirely behind the shield and the ability looks like it does nothing.
      const reach = REACH * (0.5 + 0.28 * thrust);
      push();
      translate(0, -lift * 0.4);
      stroke(58, 40, 20, 250 * fade);
      strokeWeight(11);
      line(-size * 0.2, 7, reach, 0);
      stroke(150, 108, 58, 250 * fade);
      strokeWeight(7);
      line(-size * 0.2, 7, reach, 0);
      stroke(206, 164, 100, 250 * fade);
      strokeWeight(2.5);
      line(-size * 0.2, 7, reach, 0);
      // the head — a leaf blade, flaring white on the frame it lands
      noStroke();
      fill(40, 30, 16, 250 * fade);
      triangle(reach + 42, 0, reach - 8, -15, reach - 8, 15);
      fill(238, 226, 200, 250 * fade);
      triangle(reach + 36, 0, reach - 6, -11, reach - 6, 11);
      if (thrust > 0) {
        blendMode(ADD);
        fill(255, 246, 214, 230 * fade * thrust);
        triangle(reach + 62, 0, reach - 4, -20, reach - 4, 20);
        blendMode(BLEND);
      }
      pop();

      // the aegis, braced between him and everything in the wedge. Drawn face-on
      // and large: at 200px reach a shield rendered edge-on is four pixels of
      // bronze, which is exactly how the old version disappeared.
      push();
      translate(stand + recoil, -lift);
      noStroke();
      fill(18, 13, 6, 190 * fade); // dark backing, so it reads over pale ground
      ellipse(size * 0.2, 0, size * 2.1, size * 1.7);
      drawAegis(size * 1.45 * (0.62 + 0.38 * plant), 250 * fade);
      pop();

      // grit and sparks thrown off the point
      noStroke();
      for (const spark of this._sparks) {
        const alpha = constrain(spark.life / 2, 0, 255) * fade;
        fill(255, 214 - spark.size * 8, 130, alpha);
        circle(spark.x, spark.y, spark.size);
      }

      pop();
    }

    getDisplayBoundingBox() {
      // The spear reaches past the shield, and the wedge it works in is REACH deep.
      const span = REACH + 60;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Pantheon_E_Aegis;
}
const __cachePantheon_E_Aegis = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_E_Aegis>>();
export function makePantheon_E_Aegis(api: ContentApi) {
  const cached = __cachePantheon_E_Aegis.get(api);
  if (cached) return cached;
  const built = __buildPantheon_E_Aegis(api);
  __cachePantheon_E_Aegis.set(api, built);
  return built;
}