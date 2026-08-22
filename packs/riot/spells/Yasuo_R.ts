import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Yasuo_R = InstanceType<ReturnType<typeof makeYasuo_R>>;
type Yasuo_R_Object = InstanceType<ReturnType<typeof makeYasuo_R_Object>>;



export const R_FIND_RANGE = 600;

export const R_AIRBORNE_RADIUS = 200;

export const R_AIRBORNE_MS = 1000;

export const R_DAMAGE = 30;

export const R_SPEEDUP_PERCENT = 0.4;

export const R_SPEEDUP_MS = 3000;

/**
 * The old value was 100 px/frame, which crossed the whole 600px search radius
 * in six frames — the ultimate was a teleport with a circle drawn on it. 28 is
 * fast enough to read as Yasuo closing the gap and slow enough that the flight
 * is an event the victims can watch coming.
 */
export const R_DASH_SPEED = 28;

/** How long the wind gathers before the blade arrives, at most. */
export const R_GATHER_TIMEOUT_MS = 1600;

/** The white core of the landing, and the shock rings that leave it. */
export const R_BURST_MS = 320;

/** Streaks in the standing vortex. */
export const R_VORTEX_STREAKS = 14;


function __buildYasuo_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Speedup = api.buffs.Speedup;
  const Yasuo_R_Object = makeYasuo_R_Object(api);
  class Yasuo_R extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_yasuo_r');
    name = 'Trăng Trối (Yasuo_R)';
    description =
      'Lao tới các mục tiêu gần nhất đang bị <span>Hất tung</span>. <span class="buff">Giữ chúng trên không</span> trong <span class="time">1 giây</span> và gây <span class="damage">30 sát thương</span>. Bạn được <span class="buff">Tăng tốc 40%</span> trong <span class="time">2 giây</span> sau đó.';
    coolDown = 10000;
    manaCost = 50;

    rangeToFindEnemies = R_FIND_RANGE;
    rangeToApplyAirborne = R_AIRBORNE_RADIUS;
    timeToApplyAirborne = R_AIRBORNE_MS;

    checkCastCondition() {
      return Dash.CanDash(this.owner);
    }

    onSpellCast() {
      const mouse = this.aimPoint;

      // query all enemies that have Airborne buff
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.rangeToFindEnemies, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
          (p: any) =>
            p.buffs.filter((buff: any) => buff.sourceUnit != p && buff instanceof Airborne)?.length >
            0,
        ],
      });

      // if no enemy found, reset spell cast
      if (enemies.length == 0) {
        this.resetCoolDown();
        return;
      }

      // find enemy that is nearest to mouse
      let nearestEnemy = enemies[0];
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = enemy.position.dist(mouse);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestEnemy = enemy;
        }
      }

      // find all enemies that are in range 300px to nearest enemy
      const enemiesInRange = this.game.objectManager.queryObjects({
        area: new Circle({
          x: nearestEnemy.position.x,
          y: nearestEnemy.position.y,
          r: this.rangeToApplyAirborne,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          (p: any) => p.hasBuff(Airborne),
        ],
      });

      // The wind starts gathering the moment the key is pressed and the blade
      // lands at the end of the flight, so the two halves of the ultimate are a
      // wind-up and a payoff rather than one simultaneous flash.
      const obj = new Yasuo_R_Object(this.owner);
      obj.position = nearestEnemy.position.copy();
      obj.radius = this.rangeToApplyAirborne;
      obj.holdTime = this.timeToApplyAirborne;
      obj.victims = enemiesInRange;
      this.game.objectManager.addObject(obj);

      // dash owner to behind (10px) nearest enemy
      const nearEnemyPos = mouse
        .copy()
        .sub(nearestEnemy.position)
        .setMag(nearestEnemy.stats.size.value + this.owner.stats.size.value / 2 + 10)
        .add(nearestEnemy.position);

      const dashBuff = new Dash(1000, this.owner, this.owner);
      dashBuff.dashDestination = nearEnemyPos;
      dashBuff.dashSpeed = R_DASH_SPEED;
      dashBuff.cancelable = false;
      dashBuff.onReachedDestination = () => {
        // the landing: flash, shock rings, and the vortex that holds them up
        obj.burst();

        // add airborne buff to owner
        this.owner.addBuff(new Airborne(this.timeToApplyAirborne, this.owner, this.owner));

        // add airborne buff to all enemies in range
        for (const enemy of enemiesInRange) {
          const buff = new Airborne(this.timeToApplyAirborne, this.owner, enemy);
          buff.buffAddType = BuffAddType.STACKS_AND_CONTINUE;
          buff.image = this.image;
          buff.draw = () => drawSuspension(enemy);
          enemy.addBuff(buff);
          enemy.takeDamage(R_DAMAGE, this.owner);
        }

        const speedup = new Speedup(R_SPEEDUP_MS, this.owner, this.owner);
        speedup.percent = R_SPEEDUP_PERCENT;
        this.owner.addBuff(speedup);
      };
      this.owner.addBuff(dashBuff);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.rangeToFindEnemies, this.owner));
    }
  }
  return Yasuo_R;
}
const __cacheYasuo_R = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_R>>();
export default function makeYasuo_R(api: ContentApi) {
  const cached = __cacheYasuo_R.get(api);
  if (cached) return cached;
  const built = __buildYasuo_R(api);
  __cacheYasuo_R.set(api, built);
  return built;
}


/**
 * What being held on a column of air looks like, drawn on the victim's own body.
 *
 * Strictly local — crescents no wider than the unit and motes rising out of it —
 * because a buff is drawn by the unit that carries it, and anything reaching
 * further would be culled the moment that unit left the camera while the damage
 * landed anyway. The parts of the ultimate that span the field (the tethers,
 * the vortex) live in `Yasuo_R_Object`, which owns a bounding box for them.
 */
function drawSuspension(unit: any) {
  const { x, y } = unit.position;
  const size = unit.stats.size.value;
  const spin = frameCount / 6;

  push();
  blendMode(ADD);
  noFill();
  strokeCap(ROUND);

  // Rings of air turning around the body at different rates. Suspension is a
  // rotation; a stun is a shake, and the two must not draw the same picture.
  for (let i = 0; i < 3; i++) {
    const k = i / 2;
    const radius = size * (0.7 + 0.45 * k);
    const phase = spin * (1 + k * 0.6) + i * 2.2;
    stroke(190, 245, 255, 175 - 40 * i);
    strokeWeight(3 - i * 0.7);
    arc(x, y, radius * 2, radius * 2, phase, phase + PI * 0.8);
  }

  // ...and the air itself, streaming up past them out of the ground.
  noStroke();
  for (let i = 0; i < 4; i++) {
    const p = (frameCount / 40 + i / 4) % 1;
    fill(230, 250, 255, 200 * (1 - p));
    circle(x + sin(spin + i * 2) * size * 0.45, y + size * 0.6 - p * size * 1.7, 4 * (1 - p) + 1.5);
  }

  blendMode(BLEND);
  pop();
}


/**
 * Last Breath, the ability rather than the icon.
 *
 * It used to be one flat blue disc at full size with `random(-5, 5)` of jitter
 * on its diameter: no growth, no landing, nothing that distinguished the frame
 * the blade arrived from the frame before it. Every value here hangs off two
 * clocks instead — `gatherAge` while Yasuo is still in the air, `burstAge`
 * afterwards — so the object is a wind-up and then a payoff.
 *
 * GATHER draws a closing ring on the ground under the victims: it is a genuine
 * telegraph now that the dash takes a real number of frames to arrive.
 * BURST is the landing — a white core, shock rings leaving it, and a standing
 * vortex with a tether to each body still in the air.
 */
function __buildYasuo_R_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const SpellObject = api.SpellObject;
  class Yasuo_R_Object extends SpellObject {
    position = this.owner.position.copy();
    radius = R_AIRBORNE_RADIUS;
    holdTime = R_AIRBORNE_MS;
    victims: any[] = [];

    gatherAge = 0;
    burstAge = 0;
    hasBurst = false;
    /** Fixed per cast so the vortex does not re-scatter between frames. */
    seed = random(TWO_PI);

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#dff9', 0.25);

    onAdded() {
      super.onAdded();
      // Nothing is emitted until the blade lands, which is most of a second away.
      // On the default an empty system would remove itself before then.
      this.particleSystem.autoRemoveIfEmpty = false;
      this.game.objectManager.addObject(this.particleSystem);
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
      super.onRemoved();
    }

    /** The blade has arrived. Called from the dash's `onReachedDestination`. */
    burst() {
      if (this.hasBurst) return;
      this.hasBurst = true;
      this.burstAge = 0;

      for (let i = 0; i < 26; i++) {
        const a = this.seed + (TWO_PI * i) / 26;
        const d = this.radius * random(0.15, 0.55);
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * d,
          y: this.position.y + sin(a) * d,
          r: random(4, 11),
        });
      }
    }

    update() {
      if (!this.hasBurst) {
        this.gatherAge += deltaTime;
        // The dash can be ended by something other than arrival; without this the
        // telegraph would sit on the ground for the rest of the match.
        if (this.gatherAge >= R_GATHER_TIMEOUT_MS) this.toRemove = true;
        return;
      }

      this.burstAge += deltaTime;
      if (this.burstAge >= this.holdTime + R_BURST_MS) this.toRemove = true;
    }

    draw() {
      if (!this.hasBurst) this._drawGather();
      else this._drawBurst();
    }

    /** The wind pulling in around the spot Yasuo is about to land on. */
    _drawGather() {
      const t = constrain(this.gatherAge / R_GATHER_TIMEOUT_MS, 0, 1);
      const pulse = 0.6 + 0.4 * sin(this.gatherAge / 80);

      push();
      translate(this.position.x, this.position.y);
      blendMode(ADD);
      noFill();
      strokeCap(ROUND);

      // the exact area that is about to be lifted — drawn from the first frame,
      // because the flight is now long enough for that to be worth knowing
      stroke(150, 220, 255, 110 + 60 * pulse);
      strokeWeight(3);
      circle(0, 0, this.radius * 2);

      // air being drawn inward: each streak starts outside the ring and is pulled
      // to the centre, so the gathering has a direction
      for (let i = 0; i < R_VORTEX_STREAKS; i++) {
        const a = this.seed + (TWO_PI * i) / R_VORTEX_STREAKS + this.gatherAge / 300;
        const outer =
          this.radius * (1.15 - 0.35 * ((this.gatherAge / 420 + i / R_VORTEX_STREAKS) % 1));
        const inner = outer * 0.55;
        stroke(185, 240, 255, 130 * (0.4 + 0.6 * t));
        strokeWeight(2);
        beginShape();
        for (let s = 0; s <= 4; s++) {
          const p = s / 4;
          const bend = a + p * 0.5;
          const rr = lerp(outer, inner, p);
          vertex(cos(bend) * rr, sin(bend) * rr);
        }
        endShape();
      }

      blendMode(BLEND);
      pop();
    }

    /** The landing, and the second the victims spend hanging over it. */
    _drawBurst() {
      const flash = 1 - constrain(this.burstAge / R_BURST_MS, 0, 1);
      const held = constrain(this.burstAge / (this.holdTime + R_BURST_MS), 0, 1);
      const fade = 1 - held;

      push();
      blendMode(ADD);

      // Tethers: the wind Yasuo is holding each body up with. Curved, so they
      // read as air rather than as a targeting line, and drawn here rather than
      // in the buff because they span the distance between two units.
      noFill();
      strokeCap(ROUND);
      for (const victim of this.victims) {
        if (!victim || victim.isDead || victim.toRemove) continue;
        const ax = this.owner.position.x;
        const ay = this.owner.position.y;
        const bx = victim.position.x;
        const by = victim.position.y;
        // bow the tether perpendicular to itself, alternating with time
        const dx = bx - ax;
        const dy = by - ay;
        const length = Math.hypot(dx, dy) || 1;
        const bow = 0.16 * length * sin(this.burstAge / 160 + victim.position.x * 0.01);
        const mx = (ax + bx) / 2 - (dy / length) * bow;
        const my = (ay + by) / 2 + (dx / length) * bow;

        stroke(150, 225, 255, 120 * fade);
        strokeWeight(5 * fade + 1);
        this._curve(ax, ay, mx, my, bx, by);
        stroke(240, 255, 255, 200 * fade);
        strokeWeight(2 * fade + 0.8);
        this._curve(ax, ay, mx, my, bx, by);
      }

      translate(this.position.x, this.position.y);

      // The standing vortex, turning where the blade landed.
      for (let i = 0; i < R_VORTEX_STREAKS; i++) {
        const a = this.seed + (TWO_PI * i) / R_VORTEX_STREAKS - this.burstAge / 220;
        const rr = this.radius * (0.35 + 0.6 * ((i / R_VORTEX_STREAKS + this.burstAge / 900) % 1));
        stroke(175, 238, 255, 150 * fade);
        strokeWeight(2.5);
        beginShape();
        for (let s = 0; s <= 4; s++) {
          const p = s / 4;
          const bend = a - p * 0.7;
          vertex(cos(bend) * rr * (1 - 0.25 * p), sin(bend) * rr * (1 - 0.25 * p));
        }
        endShape();
      }

      // the boundary of what was actually lifted, still legible while it holds
      stroke(160, 230, 255, 130 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, this.radius * 2);

      // Shock rings leaving the point of impact — these are the landing itself,
      // and they exist only in the first fraction of a second of it.
      if (flash > 0) {
        const out = 1 - flash;
        stroke(230, 250, 255, 235 * flash);
        strokeWeight(11 * flash + 2);
        circle(0, 0, this.radius * 2 * (0.15 + 0.95 * out));
        stroke(255, 255, 255, 200 * flash);
        strokeWeight(4 * flash + 1);
        circle(0, 0, this.radius * 2 * (0.05 + 0.65 * out));

        // steel debris thrown out of the strike, tumbling as it goes
        noStroke();
        for (let i = 0; i < 12; i++) {
          const a = this.seed + (TWO_PI * i) / 12;
          const d = this.radius * (0.2 + 0.85 * out) * (0.7 + 0.3 * sin(this.seed + i * 2.3));
          push();
          translate(cos(a) * d, sin(a) * d);
          rotate(a + out * 4);
          fill(235, 253, 255, 235 * flash);
          triangle(-10 * flash - 2, -3, 12 * flash + 3, 0, -10 * flash - 2, 3);
          pop();
        }

        // the white core, gone almost before it is seen
        noStroke();
        fill(255, 255, 255, 230 * flash * flash);
        circle(0, 0, this.radius * 0.9 * flash + 18);
      }

      blendMode(BLEND);
      pop();
    }

    /** A three-point curve as a polyline — p5's `curve` needs guide points. */
    _curve(ax: number, ay: number, mx: number, my: number, bx: number, by: number) {
      beginShape();
      for (let s = 0; s <= 8; s++) {
        const p = s / 8;
        const inv = 1 - p;
        vertex(
          inv * inv * ax + 2 * inv * p * mx + p * p * bx,
          inv * inv * ay + 2 * inv * p * my + p * p * by
        );
      }
      endShape();
    }

    getDisplayBoundingBox() {
      // The vortex sits on `position`, but the tethers run all the way back to
      // Yasuo — the box has to contain both ends or the whole effect is culled
      // the moment the camera drifts off the landing spot.
      let minX = Math.min(this.position.x, this.owner.position.x);
      let minY = Math.min(this.position.y, this.owner.position.y);
      let maxX = Math.max(this.position.x, this.owner.position.x);
      let maxY = Math.max(this.position.y, this.owner.position.y);

      for (const victim of this.victims) {
        if (!victim?.position) continue;
        minX = Math.min(minX, victim.position.x);
        minY = Math.min(minY, victim.position.y);
        maxX = Math.max(maxX, victim.position.x);
        maxY = Math.max(maxY, victim.position.y);
      }

      const pad = this.radius * 1.25;
      return new Rectangle({
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
        data: this,
      });
    }
  }
  return Yasuo_R_Object;
}
const __cacheYasuo_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_R_Object>>();
export function makeYasuo_R_Object(api: ContentApi) {
  const cached = __cacheYasuo_R_Object.get(api);
  if (cached) return cached;
  const built = __buildYasuo_R_Object(api);
  __cacheYasuo_R_Object.set(api, built);
  return built;
}