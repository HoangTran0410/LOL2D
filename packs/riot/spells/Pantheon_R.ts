import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { drawAegis } from './Pantheon_W';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Untargetable = InstanceType<ContentApi['buffs']['Untargetable']>;
type Pantheon_R = InstanceType<ReturnType<typeof makePantheon_R>>;
type Pantheon_R_Meteor = InstanceType<ReturnType<typeof makePantheon_R_Meteor>>;
type Pantheon_R_Object = InstanceType<ReturnType<typeof makePantheon_R_Object>>;
type Pantheon_R_Skyward = InstanceType<ReturnType<typeof makePantheon_R_Skyward>>;



export const MAX_RANGE = 900;

export const RADIUS = 240;

export const DAMAGE = 55;

/** Crouch and launch: he leaves the map. */
export const LAUNCH_MS = 450;

/** Airtime between leaving the map and hitting it again. */
export const FALL_MS = 950;

export const FLIGHT_MS = LAUNCH_MS + FALL_MS;

/** How long the crater burns after he lands. */
export const IMPACT_MS = 700;

/**
 * How high above the ground plane the flight is painted, in world px.
 *
 * Tuned against the real camera, not picked: at 760 the meteor only dropped
 * into frame for the last quarter-second of the fall, because everything above
 * ~450px is off the top of the screen. 560 puts him back in view for most of
 * the descent, which is the part of the ultimate worth watching.
 */
export const SKY_HEIGHT = 560;

export const SLOW_PERCENT = 0.6;

export const SLOW_DURATION = 2000;


/**
 * Grand Starfall — "Trời Sập".
 *
 * The old version threw a *spear*: Pantheon stood exactly where he was, a line
 * came down out of the sky 1.2s later, and the ultimate had nothing to do with
 * him. That is not the ability. He jumps off the map, is gone while he is up
 * there, and comes back down as the projectile himself.
 *
 * The counterplay is unchanged and deliberate: the circle is painted on the
 * ground from the frame he presses it, and 1.4s is long enough to walk out of
 * it (see the combat notes in CLAUDE.md — dangerous, never unavoidable).
 */
function __buildPantheon_R(api: ContentApi) {
  const Spell = api.Spell;
  const Pantheon_R_Skyward = makePantheon_R_Skyward(api);
  const Pantheon_R_Object = makePantheon_R_Object(api);
  const Pantheon_R_Meteor = makePantheon_R_Meteor(api);
  class Pantheon_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_pantheon_r');
    name = 'Trời Sập (Pantheon_R)';
    description =
      `Pantheon bay vút lên trời cao, <span class="buff">Không Thể Bị Chọn</span> suốt` +
      ` <span class="time">${FLIGHT_MS / 1000} giây</span>, rồi rơi như thiên thạch xuống địa điểm chỉ định` +
      ` (xa tới <span>${MAX_RANGE}px</span>): <span class="damage">${DAMAGE} sát thương</span>` +
      ` và <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span> trong bán kính <span>${RADIUS}px</span>`;
    coolDown = 10000;
    manaCost = 80;

    maxRange = MAX_RANGE;

    /** Grounded means grounded: he cannot leave the map, so the cast is refused. */
    checkCastCondition() {
      return !this.owner.grounded;
    }

    onSpellCast() {
      const aim = this.aimPoint;
      const landing = aim
        .copy()
        .sub(this.owner.position)
        .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
        .add(this.owner.position);

      // Off the map for the whole flight: untargetable, and locked out of acting
      // so he cannot walk or cast from the sky. `Stunned` is what actually clears
      // CAN_MOVE/CAN_CAST — see the note in buffs/Stasis.ts — and `Ghosted` keeps
      // terrain from grabbing a body that is 700px above it.
      const skyward = new Pantheon_R_Skyward(FLIGHT_MS, this.owner, this.owner);
      skyward.image = this.image;
      this.owner.addBuff(skyward);

      const starfall = new Pantheon_R_Object(this.owner);
      starfall.launch = this.owner.position.copy();
      starfall.landing = landing;
      starfall.skyward = skyward;
      // The landing relocates the caster, so it goes through the one gate every
      // blink in the game goes through — `tests/game/buffs/Ground.test.ts` fails
      // the build for a spell that reaches past it for `owner.teleportTo`.
      starfall.blink = (x, y) => this.blinkOwnerTo(x, y);
      this.game.objectManager.addObject(starfall);

      const meteor = new Pantheon_R_Meteor(this.owner);
      meteor.flight = starfall;
      starfall.meteor = meteor;
      this.game.objectManager.addObject(meteor);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Pantheon_R;
}
const __cachePantheon_R = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_R>>();
export default function makePantheon_R(api: ContentApi) {
  const cached = __cachePantheon_R.get(api);
  if (cached) return cached;
  const built = __buildPantheon_R(api);
  __cachePantheon_R.set(api, built);
  return built;
}


/**
 * He is not on the map. Untargetable is the half players feel; the action lock
 * is the half that stops a champion in orbit from right-clicking across the
 * lane, and `draw` is emptied because the base paints rings around a body that
 * is not there.
 */
function __buildPantheon_R_Skyward(api: ContentApi) {
  const StatusFlags = api.enums.StatusFlags;
  const Untargetable = api.buffs.Untargetable;
  class Pantheon_R_Skyward extends Untargetable {
    name = 'Trời Sập';
    statusFlagsToEnable = StatusFlags.Stealthed | StatusFlags.Stunned | StatusFlags.Ghosted;

    draw(): void {}
  }
  return Pantheon_R_Skyward;
}
const __cachePantheon_R_Skyward = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_R_Skyward>>();
export function makePantheon_R_Skyward(api: ContentApi) {
  const cached = __cachePantheon_R_Skyward.get(api);
  if (cached) return cached;
  const built = __buildPantheon_R_Skyward(api);
  __cachePantheon_R_Skyward.set(api, built);
  return built;
}


/** Ease so the fall accelerates: he hangs, then drops. */
const plunge = (t: number): number => t * t * t;

/** Ease so the launch decelerates: he leaves fast and tops out. */
const soar = (t: number): number => 1 - (1 - t) * (1 - t);


/**
 * The ultimate itself: the clock, the flight path, the ground he is going to
 * hit, and the crater afterwards.
 *
 * `zIndex = GROUND_Z_INDEX` because everything this object draws is on the dirt — the target
 * circle, the shadow racing under him and the crater all belong under the feet
 * of whoever is standing in them. The body coming down is `Pantheon_R_Meteor`,
 * which draws above them.
 */
function __buildPantheon_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Pantheon_R_Object extends SpellObject {
    launch: p5.Vector = this.owner.position.copy();
    landing: p5.Vector = this.owner.position.copy();
    skyward: Pantheon_R_Skyward | null = null;
    meteor: Pantheon_R_Meteor | null = null;
    /** Set by the spell; routes the landing through `Spell.blinkOwnerTo`. */
    blink: ((x: number, y: number) => boolean) | null = null;
    radius = RADIUS;
    visionRadius = RADIUS;
    age = 0;
    landed = false;
    zIndex = GROUND_Z_INDEX;

    /** Where on the ground plane he actually is; the flight writes it per frame. */
    _at: p5.Vector = this.owner.position.copy();

    /** 0 while he is still climbing, then 0→1 across the fall. */
    get fallProgress(): number {
      return constrain((this.age - LAUNCH_MS) / FALL_MS, 0, 1);
    }

    /** How high off the ground plane the flight is drawn, in world px. */
    get altitude(): number {
      if (this.age < LAUNCH_MS) return SKY_HEIGHT * soar(constrain(this.age / LAUNCH_MS, 0, 1));
      return SKY_HEIGHT * (1 - plunge(this.fallProgress));
    }

    /** Where he is right now — the camera and the meteor both ride this. */
    get groundPosition(): p5.Vector {
      return this._at;
    }

    /** Where the arc says he should be at this instant. */
    _pathPoint(): p5.Vector {
      const t = this.fallProgress;
      return createVector(
        this.launch.x + (this.landing.x - this.launch.x) * t,
        this.launch.y + (this.landing.y - this.launch.y) * t
      );
    }

    update() {
      this.age += deltaTime;

      if (!this.landed) {
        // He is carried across the map rather than teleported at the end: the
        // camera follows the player's own position, so a Pantheon who stayed put
        // until the last frame would leave the player watching an empty patch of
        // ground while the ultimate landed 900px off screen.
        //
        // Grounding catches him in mid-air the same way it cancels a dash — the
        // carry stops and the blink that ends the flight is refused, so he comes
        // down wherever it caught him. The strike still resolves in the circle
        // that was drawn: it is a falling body, not a decision he can take back.
        if (!this.owner.grounded) {
          const next = this._pathPoint();
          this._at.set(next.x, next.y);
          this.owner.position.set(next.x, next.y);
        }
        this.position = this._at.copy();

        if (this.age >= FLIGHT_MS) this.land();
        return;
      }

      if (this.age >= FLIGHT_MS + IMPACT_MS) this.toRemove = true;
    }

    /** Touchdown. Latched, because `onRemoved` converges here too. */
    land() {
      if (this.landed) return;
      this.landed = true;

      this.skyward?.deactivateBuff?.();
      this.meteor?.markLanded();

      // Back on the map, exactly inside the circle that was drawn all along. A
      // blink rather than a bare `position.set` for two reasons: it is the gate
      // grounding is enforced at, and it clears the path he was walking before
      // the cast, which would otherwise drag him straight back out of his own
      // crater the moment he could move again.
      if (!this.owner.isDead) this.blink?.(this.landing.x, this.landing.y);
      this.position = this.landing.copy();

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.landing.x, y: this.landing.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => {
        enemy.takeDamage(DAMAGE, this.owner);
        const slow = new Slow(SLOW_DURATION, this.owner, enemy);
        slow.percent = SLOW_PERCENT;
        enemy.addBuff(slow);
      });
    }

    onRemoved() {
      // Death, scene exit and a normal landing all arrive here; `land` latches so
      // the strike still happens exactly once.
      this.land();
      if (this.meteor) this.meteor.toRemove = true;
      super.onRemoved();
    }

    draw() {
      if (this.landed) this._drawCrater();
      else this._drawTelegraph();
    }

    /** The circle he is coming down in, and the shadow racing under him. */
    _drawTelegraph() {
      const t = this.fallProgress;
      const climb = constrain(this.age / LAUNCH_MS, 0, 1);
      const pulse = 0.5 + 0.5 * Math.sin(this.age / 70);

      push();
      translate(this.landing.x, this.landing.y);

      // the ground he is aimed at, filling up as he falls so the timing is legible
      noStroke();
      fill(120, 82, 34, 60);
      circle(0, 0, this.radius * 2);
      fill(255, 214, 132, 55 + 45 * pulse);
      circle(0, 0, this.radius * 2 * t);

      // the rim, and a second ring collapsing inwards to point at the centre
      noFill();
      stroke(20, 25, 40, 130);
      strokeWeight(6);
      circle(0, 0, this.radius * 2);
      stroke(255, 236, 178, 230);
      strokeWeight(3);
      circle(0, 0, this.radius * 2);
      stroke(255, 236, 178, 120);
      strokeWeight(2);
      circle(0, 0, this.radius * 2 * (1 - t) * 0.9 + 12);

      // four bearing marks, so the circle is Pantheon's and not a generic AoE
      stroke(255, 226, 158, 200);
      strokeWeight(4);
      for (let i = 0; i < 4; i++) {
        const a = PI / 4 + (i * PI) / 2;
        const inner = this.radius * 0.72;
        const outer = this.radius * (0.96 + 0.06 * pulse);
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }
      pop();

      // dust punched out from under him on the way up
      if (climb < 1) {
        push();
        translate(this.launch.x, this.launch.y);
        noFill();
        stroke(214, 174, 108, 200 * (1 - climb));
        strokeWeight(6 * (1 - climb) + 1);
        ellipse(0, 0, 150 * climb, 150 * climb * 0.55);
        pop();
      }

      // his shadow on the ground, tightening as he gets closer to it
      const at = this.groundPosition;
      const near = 1 - this.altitude / SKY_HEIGHT;
      push();
      noStroke();
      fill(0, 0, 0, 40 + 90 * near);
      ellipse(at.x, at.y, 30 + 90 * near, (30 + 90 * near) * 0.45);
      pop();
    }

    /** What is left of the ground afterwards. */
    _drawCrater() {
      const t = constrain((this.age - FLIGHT_MS) / IMPACT_MS, 0, 1);
      const fade = 1 - t;
      // the blast is over in the first fifth; the rest is dust settling
      const blast = constrain(t / 0.2, 0, 1);

      push();
      translate(this.landing.x, this.landing.y);

      // scorched dirt
      noStroke();
      fill(70, 46, 22, 150 * fade);
      circle(0, 0, this.radius * 2 * (0.55 + 0.45 * blast));

      // the shock going out past the rim
      noFill();
      stroke(255, 232, 170, 235 * fade);
      strokeWeight(11 * fade + 2);
      circle(0, 0, this.radius * 2 * (0.3 + 1.15 * blast));
      stroke(255, 250, 226, 200 * fade * (1 - blast * 0.5));
      strokeWeight(4 * fade + 1);
      circle(0, 0, this.radius * 2 * (0.2 + 0.95 * blast));

      // cracks thrown out from the point of impact. Deliberately ragged: evenly
      // spaced spokes of equal length read as a sunburst decal rather than as
      // broken ground.
      noFill();
      stroke(255, 196, 104, 220 * fade);
      for (let i = 0; i < 14; i++) {
        const a = (TWO_PI * i) / 14 + ((i * 53) % 17) / 40;
        const inner = this.radius * 0.12;
        const outer = this.radius * (0.55 + 0.6 * blast) * (0.42 + ((i * 37) % 61) / 90);
        const kink = (((i * 29) % 13) - 6) / 34;
        strokeWeight(5 * fade + 1);
        beginShape();
        vertex(cos(a) * inner, sin(a) * inner);
        vertex(cos(a + kink * 0.4) * outer * 0.6, sin(a + kink * 0.4) * outer * 0.6);
        vertex(cos(a + kink) * outer, sin(a + kink) * outer);
        endShape();
      }

      // the white core of the strike, gone almost immediately
      if (blast < 1) {
        blendMode(ADD);
        noStroke();
        fill(255, 250, 228, 240 * (1 - blast));
        circle(0, 0, this.radius * 1.1 * (1 - blast) + 40);
        blendMode(BLEND);
      }
      pop();
    }

    getDisplayBoundingBox() {
      // Both ends of the flight matter: the launch dust is at one, the circle at
      // the other, and the camera can be sitting on either.
      const minX = Math.min(this.launch.x, this.landing.x) - this.radius;
      const minY = Math.min(this.launch.y, this.landing.y) - this.radius;
      return new Rectangle({
        x: minX,
        y: minY,
        w: Math.abs(this.landing.x - this.launch.x) + this.radius * 2,
        h: Math.abs(this.landing.y - this.launch.y) + this.radius * 2,
        data: this,
      });
    }
  }
  return Pantheon_R_Object;
}
const __cachePantheon_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_R_Object>>();
export function makePantheon_R_Object(api: ContentApi) {
  const cached = __cachePantheon_R_Object.get(api);
  if (cached) return cached;
  const built = __buildPantheon_R_Object(api);
  __cachePantheon_R_Object.set(api, built);
  return built;
}


/**
 * Pantheon himself, above the ground plane: a bronze streak going up, then the
 * thing coming back down.
 *
 * Separate from `Pantheon_R_Object` only because of the layer — this is the half
 * of the ultimate that has to paint *over* the units, and z-index is per object.
 * It owns no state; the flight object is the clock.
 */
function __buildPantheon_R_Meteor(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Pantheon_R_Meteor extends SpellObject {
    flight: Pantheon_R_Object | null = null;
    landed = false;

    markLanded() {
      this.landed = true;
      this.toRemove = true;
    }

    update() {
      if (!this.flight || this.flight.toRemove || this.landed) {
        this.toRemove = true;
        return;
      }
      // copied, not aliased: `groundPosition` hands back the flight's own vector
      this.position = this.flight.groundPosition.copy();
    }

    draw() {
      const flight = this.flight;
      if (!flight || this.landed) return;

      const at = flight.groundPosition;
      const altitude = flight.altitude;
      const rising = flight.age < LAUNCH_MS;
      const size = this.owner.stats.size.value;
      // Fades out as he leaves and back in as he returns: at the top of the arc he
      // is genuinely off the map, and there should be nothing up there to look at.
      const presence = constrain(1.35 - altitude / SKY_HEIGHT, 0, 1);
      if (presence <= 0.01) return;

      push();
      translate(at.x, at.y - altitude);

      // The trail always hangs behind the direction of travel: below him while he
      // is climbing away from the ground, above him while he is coming back down.
      blendMode(ADD);
      noStroke();
      for (let i = 1; i <= 4; i++) {
        const alpha = (rising ? 90 : 140) / i;
        fill(255, 186 - i * 14, 92, alpha * presence);
        ellipse(
          0,
          (rising ? 1 : -1) * i * 46,
          size * (1.35 - i * 0.22),
          size * (2.6 - i * 0.4) * (rising ? 1.5 : 2.1)
        );
      }
      blendMode(BLEND);

      // The fireball goes *under* the body. Painted over it, the white core
      // swallowed the shield completely and the meteor read as an anonymous ball
      // of light — which is the whole thing this ability is not.
      if (!rising) {
        blendMode(ADD);
        noStroke();
        const heat = constrain(flight.fallProgress * 1.4, 0, 1);
        fill(255, 232, 176, 150 * heat * presence);
        circle(0, 0, size * (2.2 + 1.8 * heat));
        fill(255, 250, 224, 130 * heat * presence);
        circle(0, 0, size * (1.2 + 1.0 * heat));
        blendMode(BLEND);
      }

      // the body: the aegis leading, because it is what hits the ground first
      push();
      rotate(rising ? -HALF_PI : HALF_PI);
      stroke(48, 32, 16, 250 * presence);
      strokeWeight(9);
      line(-size * 0.9, size * 0.36, size * 1.0, size * 0.36);
      stroke(150, 108, 58, 250 * presence);
      strokeWeight(5);
      line(-size * 0.9, size * 0.36, size * 1.0, size * 0.36);
      noStroke();
      fill(240, 228, 202, 250 * presence);
      triangle(size * 1.4, size * 0.36, size * 0.95, size * 0.36 - 9, size * 0.95, size * 0.36 + 9);
      // a dark backing disc, so the bronze survives being inside the fireball
      fill(20, 14, 7, 200 * presence);
      ellipse(size * 0.1, 0, size * 2.0, size * 1.7);
      drawAegis(size * 1.35, 250 * presence);
      pop();
      pop();

      // a thin plumb line down into the circle, so the meteor and the ring read as
      // one ability rather than two effects that happen to overlap
      if (!rising) {
        push();
        stroke(255, 226, 158, 90 * presence);
        strokeWeight(2);
        line(at.x, at.y - altitude, flight.landing.x, flight.landing.y);
        pop();
      }

      // the flare left behind at the launch point, aimed the way he went
      if (rising) {
        const heading = Math.atan2(
          flight.landing.y - flight.launch.y,
          flight.landing.x - flight.launch.x
        );
        push();
        translate(flight.launch.x, flight.launch.y);
        rotate(heading);
        blendMode(ADD);
        noStroke();
        fill(255, 224, 150, 120 * (1 - constrain(flight.age / LAUNCH_MS, 0, 1)));
        triangle(0, -26, 0, 26, 120, 0);
        blendMode(BLEND);
        pop();
      }
    }

    getDisplayBoundingBox() {
      // He is painted a long way above the ground plane and the box the object
      // manager culls against is in ground coordinates — without the extra height
      // the meteor would pop out of existence while still plainly on screen.
      const span = SKY_HEIGHT + 200;
      return new Rectangle({
        x: this.position.x - 260,
        y: this.position.y - span,
        w: 520,
        h: span + 260,
        data: this,
      });
    }
  }
  return Pantheon_R_Meteor;
}
const __cachePantheon_R_Meteor = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_R_Meteor>>();
export function makePantheon_R_Meteor(api: ContentApi) {
  const cached = __cachePantheon_R_Meteor.get(api);
  if (cached) return cached;
  const built = __buildPantheon_R_Meteor(api);
  __cachePantheon_R_Meteor.set(api, built);
  return built;
}