import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Pantheon_W = InstanceType<ReturnType<typeof makePantheon_W>>;
type Pantheon_W_Impact = InstanceType<ReturnType<typeof makePantheon_W_Impact>>;
type Pantheon_W_Vault = InstanceType<ReturnType<typeof makePantheon_W_Vault>>;



export const RANGE = 400;

export const DAMAGE = 20;

export const STUN_DURATION = 1000;

export const LEAP_SPEED = 22;

/**
 * How close the landing has to be for the shield to connect. The leap aims to
 * stop 40px short of the body, so this is that gap plus room for a target that
 * walked while he was in the air — miss it and the vault is a reposition.
 */
export const STRIKE_RADIUS = 110;

export const IMPACT_LIFETIME = 460;

/** Shards of bronze and grit thrown out by the shield hitting the ground. */
const SHARD_COUNT = 12;


/**
 * Shield Vault: close the gap and put them on the floor.
 *
 * The damage, the stun and the impact ring all used to resolve on the frame of
 * the cast, while Pantheon was still 400px away and airborne — a target could
 * be stunned, walk out of the stun and be somewhere else before he touched
 * down. The leap now carries the payload: `_land()` runs off the dash's own
 * arrival, and it only connects if he actually got there.
 */
function __buildPantheon_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const Stun = api.buffs.Stun;
  const Pantheon_W_Vault = makePantheon_W_Vault(api);
  const Pantheon_W_Impact = makePantheon_W_Impact(api);
  class Pantheon_W extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_pantheon_w');
    name = 'Khiên Trời Giáng (Pantheon_W)';
    description =
      `Lao tới kẻ địch <i>gần con trỏ chuột nhất</i> trong <span>${RANGE}px</span>.` +
      ` <i>Khi đáp xuống</i>, đập khiên gây <span class="damage">${DAMAGE} sát thương</span>` +
      ` và <span class="buff">Choáng</span> trong <span class="time">${STUN_DURATION / 1000} giây</span>`;
    coolDown = 9000;
    manaCost = 30;

    range = RANGE;

    checkCastCondition() {
      return !!this._findTarget() && Dash.CanDash(this.owner);
    }

    onSpellCast() {
      const target = this._findTarget();
      if (!target) return;

      // Stops short of the body rather than inside it — the collision system
      // would shove him back out anyway.
      const restingPoint = () =>
        target.position
          .copy()
          .sub(this.owner.position)
          .setMag(Math.max(0, this.owner.position.dist(target.position) - 40))
          .add(this.owner.position);

      const dash = new Dash(1200, this.owner, this.owner);
      dash.image = this.image;
      dash.dashDestination = restingPoint();
      // The leap follows its target. Now that the payload waits for the landing,
      // a vault aimed at where they *were* would whiff against anyone who kept
      // walking — and this is a lock-on ability with no aim to blame.
      // `onDashUpdate`, never `onUpdate`: the movement lives on that prototype.
      dash.onDashUpdate = () => {
        if (target.isDead || target.toRemove) return; // keep the last known spot
        dash.dashDestination = restingPoint();
      };
      dash.dashSpeed = LEAP_SPEED;
      dash.showTrail = true;
      dash.cancelable = false;

      // Both ends of the leap are wired before `addBuff`, because a grounded
      // Pantheon has his dash deactivated inside that very call — a listener
      // attached afterwards would never fire and the vault would eat itself.
      let landed = false;
      const land = () => {
        if (landed) return;
        landed = true;
        this._land(target);
      };
      dash.onReachedDestination = land;
      dash.addDeactivateListener(land);

      this.owner.addBuff(dash);

      // The braced shield rides the leap and dies with it. A SpellObject rather
      // than caster VFX because it is drawn around a body the camera may have
      // culled mid-flight.
      const vault = new Pantheon_W_Vault(this.owner);
      vault.attachTo(this.owner, dash);
      this.game.objectManager.addObject(vault);
    }

    /** Touchdown: the shield lands, and only then does anything take damage. */
    _land(target: AttackableUnit) {
      const impact = new Pantheon_W_Impact(this.owner);
      impact.position = this.owner.position.copy();
      impact.heading = Math.atan2(
        target.position.y - this.owner.position.y,
        target.position.x - this.owner.position.x
      );
      this.game.objectManager.addObject(impact);

      if (target.isDead || target.toRemove) return;
      // He can be stopped short — grounded on the way, or the target simply ran.
      // A vault that did not arrive is a reposition, not a stun.
      if (this.owner.position.dist(target.position) > STRIKE_RADIUS) return;

      target.takeDamage(DAMAGE, this.owner);
      target.addBuff(new Stun(STUN_DURATION, this.owner, target));
    }

    /**
     * Who the vault picks: every enemy inside `RANGE` of Pantheon is a candidate,
     * and the one nearest the **cursor** wins.
     *
     * It used to take whoever stood closest to *him*, which made the ability
     * unaimable — in a lane fight the front minion is always nearer than the
     * champion behind it, so the gap-closer spent itself on the wrong body and
     * there was nothing the player could do about it. Breaking the tie with the
     * cursor is the documented shape for these auto-locking `SELF` spells (see
     * "Auto-locking spells" in docs/ADDING_SPELLS.md, and Yasuo E, which picks
     * the same way).
     *
     * On touch, `SELF` gives no aim and the cursor sits on the champion, so this
     * degrades back to nearest-to-Pantheon rather than to nothing.
     */
    _findTarget(): AttackableUnit | null {
      const aim = this.aimPoint;
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
      }) as AttackableUnit[];
      let nearest: AttackableUnit | null = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = enemy.position.dist(aim);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = enemy;
        }
      }
      return nearest;
    }

    /**
     * The reach, plus a lock ring on whoever the cursor has currently chosen.
     * An aimed auto-lock has to show its pick, or the player is guessing which of
     * two bodies the vault is about to take.
     */
    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));

      const target = this._findTarget();
      if (!target) return;

      const size = target.stats.size.value + 16 + Math.sin(frameCount / 8) * 3;
      push();
      noFill();
      stroke(20, 25, 40, 130);
      strokeWeight(5);
      circle(target.position.x, target.position.y, size);
      stroke(248, 226, 176, 220);
      strokeWeight(2.5);
      circle(target.position.x, target.position.y, size);
      pop();
    }
  }
  return Pantheon_W;
}
const __cachePantheon_W = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_W>>();
export default function makePantheon_W(api: ContentApi) {
  const cached = __cachePantheon_W.get(api);
  if (cached) return cached;
  const built = __buildPantheon_W(api);
  __cachePantheon_W.set(api, built);
  return built;
}


/**
 * Bronze aegis outline, drawn pointing along +x in an already-rotated frame.
 *
 * Exported because the whole kit is this shield: W leads the leap with it, E
 * plants it in the dirt and R rides it down out of the sky. One silhouette
 * across four abilities is what makes the champion readable at a glance, which
 * is the first rule in docs/VFX_STANDARD.md.
 */
export const drawAegis = (size: number, alpha: number): void => {
  // A kite shield: wide at the shoulder, tapering to a point that leads the
  // leap. Shared by the flight and the landing so it is recognisably one object.
  noStroke();
  fill(96, 62, 28, alpha);
  beginShape();
  vertex(size * 0.95, 0);
  vertex(size * 0.25, -size * 0.62);
  vertex(-size * 0.5, -size * 0.5);
  vertex(-size * 0.5, size * 0.5);
  vertex(size * 0.25, size * 0.62);
  endShape(CLOSE);

  fill(206, 156, 76, alpha);
  beginShape();
  vertex(size * 0.8, 0);
  vertex(size * 0.2, -size * 0.5);
  vertex(-size * 0.38, -size * 0.4);
  vertex(-size * 0.38, size * 0.4);
  vertex(size * 0.2, size * 0.5);
  endShape(CLOSE);

  // the boss at the centre, and the ridge running out to the point
  fill(248, 226, 176, alpha);
  circle(-size * 0.05, 0, size * 0.38);
  stroke(248, 226, 176, alpha);
  strokeWeight(size * 0.07);
  line(-size * 0.05, 0, size * 0.72, 0);
  noStroke();
};


/**
 * The vault in flight: the shield braced ahead of him, with the comet he is
 * riding in on trailing behind. Ends with the dash it is attached to.
 */
function __buildPantheon_W_Vault(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Pantheon_W_Vault extends SpellObject {
    position = this.owner.position.copy();
    heading = 0;
    age = 0;
    _previous = this.owner.position.copy();

    update() {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;

      const dx = this.owner.position.x - this._previous.x;
      const dy = this.owner.position.y - this._previous.y;
      // A heading must never be (0,0): the last live one stands in on the frames
      // where the collision system has him wedged and not moving.
      if (dx * dx + dy * dy > 0.25) this.heading = Math.atan2(dy, dx);
      this._previous = this.owner.position.copy();
      this.position = this.owner.position.copy();
    }

    draw() {
      const size = this.owner.stats.size.value;
      const bob = sin(this.age / 60) * 2;

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);

      // the comet tail: he is arriving, and it should be obvious from behind
      blendMode(ADD);
      noStroke();
      for (let i = 1; i <= 3; i++) {
        fill(255, 176, 76, 70 / i);
        ellipse(-size * (0.5 + i * 0.45), 0, size * (1.5 - i * 0.28), size * (0.9 - i * 0.2));
      }
      blendMode(BLEND);

      // shield held out in front, leading the leap
      push();
      translate(size * 0.55, bob);
      drawAegis(size * 0.85, 240);
      pop();
      pop();
    }

    getDisplayBoundingBox() {
      const span = this.owner.stats.size.value * 3;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Pantheon_W_Vault;
}
const __cachePantheon_W_Vault = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_W_Vault>>();
export function makePantheon_W_Vault(api: ContentApi) {
  const cached = __cachePantheon_W_Vault.get(api);
  if (cached) return cached;
  const built = __buildPantheon_W_Vault(api);
  __cachePantheon_W_Vault.set(api, built);
  return built;
}


interface Shard {
  angle: number;
  reach: number;
  size: number;
  spin: number;
}


/**
 * Touchdown. The aegis slams flat into the ground, a comet's worth of light
 * collapses into it, and the shock goes out through the dirt — bronze and
 * starlight, which is Pantheon and nobody else here.
 */
function __buildPantheon_W_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Pantheon_W_Impact extends SpellObject {
    position = this.owner.position.copy();
    heading = 0;
    lifeTime = IMPACT_LIFETIME;
    age = 0;
    radius = STRIKE_RADIUS * 0.8;

    _shards: Shard[] = [];

    onAdded() {
      for (let i = 0; i < SHARD_COUNT; i++) {
        this._shards.push({
          angle: (TWO_PI * i) / SHARD_COUNT + random(-0.2, 0.2),
          reach: random(0.6, 1.05),
          size: random(7, 15),
          spin: random(-3, 3),
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
      // The slam is over in the first fifth; everything after it is settling.
      const slam = constrain(t / 0.2, 0, 1);
      const flash = 1 - slam;

      push();
      translate(this.position.x, this.position.y);

      // dust ring going out along the ground, flattened because the force is
      // horizontal — it is a shield driven down, not an explosion
      noFill();
      stroke(214, 168, 96, 220 * fade);
      strokeWeight(8 * fade + 2);
      ellipse(0, 0, this.radius * 2 * (0.3 + 1.1 * slam), this.radius * 1.4 * (0.3 + 1.1 * slam));
      stroke(255, 240, 206, 240 * fade * (1 - slam * 0.4));
      strokeWeight(3 * fade + 1);
      ellipse(0, 0, this.radius * 2 * (0.2 + 0.95 * slam), this.radius * 1.4 * (0.2 + 0.95 * slam));

      // bronze shards and grit thrown clear of the rim
      noStroke();
      for (const shard of this._shards) {
        const d = this.radius * shard.reach * (0.25 + 1.0 * slam);
        const lift = sin(slam * PI) * 14;
        push();
        translate(cos(shard.angle) * d, sin(shard.angle) * d * 0.8 - lift);
        rotate(shard.angle + shard.spin * t);
        fill(198, 148, 74, 235 * fade);
        quad(
          -shard.size * 0.5,
          -shard.size * 0.3,
          shard.size * 0.5,
          -shard.size * 0.2,
          shard.size * 0.4,
          shard.size * 0.35,
          -shard.size * 0.4,
          shard.size * 0.3
        );
        pop();
      }

      // the comet: a wedge of starlight still falling in behind him, collapsing
      // into the shield over the same fifth of a second the slam takes
      if (flash > 0) {
        push();
        rotate(this.heading);
        blendMode(ADD);
        noStroke();
        fill(255, 208, 130, 200 * flash);
        triangle(
          -this.radius * (2.6 * flash + 0.4),
          -this.radius * 0.32 * flash,
          -this.radius * (2.6 * flash + 0.4),
          this.radius * 0.32 * flash,
          this.radius * 0.15,
          0
        );
        fill(255, 250, 226, 235 * flash);
        circle(0, 0, this.radius * 0.9 * flash + 16);
        blendMode(BLEND);
        pop();
      }

      // the shield itself, flat on the ground where it landed, sinking as it fades
      push();
      rotate(this.heading);
      const drop = 1 - slam;
      scale(1, 0.55); // seen edge-on: it is lying in the dirt, not facing camera
      drawAegis(this.radius * (0.85 + 0.5 * drop), 235 * fade);
      pop();

      pop();
    }

    getDisplayBoundingBox() {
      // the comet overshoots the ring by a long way behind him
      const span = this.radius * 3.4;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Pantheon_W_Impact;
}
const __cachePantheon_W_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_W_Impact>>();
export function makePantheon_W_Impact(api: ContentApi) {
  const cached = __cachePantheon_W_Impact.get(api);
  if (cached) return cached;
  const built = __buildPantheon_W_Impact(api);
  __cachePantheon_W_Impact.set(api, built);
  return built;
}