import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
// Relative, not `@/`: `DariusAxe` moved into `packs/riot/vfx/` (Task 2 of the
// content-pack extraction) — see `Lux_R.ts`'s identical note on `LuxBeamEffect`.
import { drawAxeArc, drawDariusAxe } from '../vfx/DariusAxe';
import { makeApplyHemorrhage } from './Darius_Q';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Darius_E = InstanceType<ReturnType<typeof makeDarius_E>>;
type Darius_E_Object = InstanceType<ReturnType<typeof makeDarius_E_Object>>;



export const CAST_TIME_MS = 250;

export const CONE_RANGE = 300;

/** Half the opening of the sweep, in radians — about a 55° wedge either side. */
export const CONE_HALF_ANGLE = 0.95;

export const DAMAGE = 15;

/** How close the hook drags them before letting go. */
export const PULL_STOP_DISTANCE = 70;

export const PULL_SPEED = 20;

/** Ceiling on the haul, so a victim yanked into a wall is not stuck forever. */
export const PULL_MAX_MS = 900;

export const SLOW_PERCENT = 0.4;

export const SLOW_MS = 1_000;


/**
 * Apprehend: the axe goes out in a wedge and everything it catches comes back.
 *
 * The pull is a `Dash` on the *victim* with Darius as its source — the same
 * shape Blitzcrank's hook uses, and for the same reason: the dash is the only
 * thing that moves them, so cleanses, grounding and Black Shield all get to
 * work on it. Writing `victim.position` directly would haul a champion who had
 * just been made immune to exactly this.
 */
function __buildDarius_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Slow = api.buffs.Slow;
  const applyHemorrhage = makeApplyHemorrhage(api);
  const Darius_E_Object = makeDarius_E_Object(api);
  class Darius_E extends Spell {
    image = api.asset('spell_darius_e');
    name = 'Bắt Giữ (Darius_E)';
    description =
      `Quét rìu thành hình quạt xa <span>${CONE_RANGE}px</span>, gây` +
      ` <span class="damage">${DAMAGE} sát thương</span>, cộng một cấp <span class="damage">Chảy Máu</span>` +
      ` và <span class="buff">kéo</span> mọi kẻ địch trúng chiêu về sát người.` +
      ` Khi tiếp đất chúng bị <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>` +
      ` trong <span class="time">${SLOW_MS / 1000} giây</span>`;
    coolDown = 9_000;
    manaCost = 45;

    range = CONE_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: CAST_TIME_MS,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context: CastContext): void {
      const aim = this.firingDirection(context);
      const heading = Math.atan2(aim.y, aim.x);

      const sweep = new Darius_E_Object(this.owner);
      sweep.heading = heading;
      this.game.objectManager.addObject(sweep);

      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: CONE_RANGE,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of candidates) {
        if (!this.insideCone(victim, heading)) continue;
        victim.takeDamage(DAMAGE, this.owner);
        applyHemorrhage(this.owner, victim);
        this.hook(victim);
        sweep.caught.push(victim);
      }
    }

    /** Whether `victim` is inside the wedge Darius swept. */
    private insideCone(victim: AttackableUnit, heading: number): boolean {
      const dx = victim.position.x - this.owner.position.x;
      const dy = victim.position.y - this.owner.position.y;
      // A body standing on top of him has no angle to test and is always caught.
      if (dx === 0 && dy === 0) return true;
      let delta = Math.atan2(dy, dx) - heading;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return Math.abs(delta) <= CONE_HALF_ANGLE;
    }

    /** Drags one victim in, and drops them slowed wherever the haul ended. */
    private hook(victim: AttackableUnit): void {
      const gap = this.owner.position.dist(victim.position);
      const destination =
        gap <= PULL_STOP_DISTANCE
          ? victim.position.copy()
          : victim.position
              .copy()
              .sub(this.owner.position)
              .setMag(PULL_STOP_DISTANCE)
              .add(this.owner.position);

      // Off their feet for the length of the haul, so the pull is not something
      // they can simply walk out of. Both buffs come from Darius, which is what
      // stops the dash's own interrupt list from cancelling the dash.
      const lifted = new Airborne(PULL_MAX_MS, this.owner, victim);
      lifted.image = this.image;
      lifted.height = 8;
      victim.addBuff(lifted);

      const haul = new Dash(PULL_MAX_MS, this.owner, victim);
      haul.image = this.image;
      haul.dashDestination = destination;
      haul.dashSpeed = PULL_SPEED;
      haul.showTrail = false;
      haul.cancelable = false;
      // The victim is being moved, not moving: leaving a standing move order on
      // them would have them walk back into Darius after the haul let go.
      haul.stayAtDestination = false;

      let landed = false;
      const land = () => {
        if (landed) return;
        landed = true;
        lifted.deactivateBuff();
        if (victim.isDead || victim.toRemove) return;
        const stagger = new Slow(SLOW_MS, this.owner, victim);
        stagger.percent = SLOW_PERCENT;
        stagger.image = this.image;
        victim.addBuff(stagger);
      };
      haul.onReachedDestination = land;
      haul.addDeactivateListener(land);

      victim.addBuff(haul);
    }

    drawPreview() {
      super.drawPreview(CONE_RANGE);
    }
  }
  return Darius_E;
}
const __cacheDarius_E = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_E>>();
export default function makeDarius_E(api: ContentApi) {
  const cached = __cacheDarius_E.get(api);
  if (cached) return cached;
  const built = __buildDarius_E(api);
  __cacheDarius_E.set(api, built);
  return built;
}


/**
 * Long enough to show the haul, not just the swing.
 *
 * At 460ms the art was gone while the `Dash` on the victims was still dragging
 * them (`PULL_MAX_MS` is 900), so the pull the ability is named for happened
 * off-screen. The wedge still fades early — it marks where the hit landed, and
 * has nothing to say once it has said that — while the axe and the chains
 * carry the rest.
 */
export const SWEEP_LIFETIME_MS = 700;

/** How much of that life is the reach out; the rest is the haul back in. */
const REACH_FRACTION = 0.32;

/** How far the axe comes back toward him over the haul, as a fraction of reach. */
const HAUL_RETRACTION = 0.72;

/** Barbs of the sweep — seeded once, then animated. */
const BARB_COUNT = 9;


/**
 * The wedge on the floor and the hooks reeling in.
 *
 * Ground art, so it takes `zIndex = GROUND_Z_INDEX` and paints under the feet it is dragging.
 * The chains are drawn back to Darius rather than only around the victims —
 * which is why the bounding box has to cover the whole cone.
 */
function __buildDarius_E_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Darius_E_Object extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    heading = 0;
    age = 0;
    /** Everyone the wedge caught; a line is drawn to each while it reels in. */
    caught: AttackableUnit[] = [];

    barbs: { spread: number; distance: number; length: number }[] = [];

    onAdded(): void {
      for (let i = 0; i < BARB_COUNT; i++) {
        this.barbs.push({
          spread: random(-CONE_HALF_ANGLE, CONE_HALF_ANGLE),
          distance: random(CONE_RANGE * 0.3, CONE_RANGE),
          length: random(18, 46),
        });
      }
    }

    update(): void {
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;
      if (this.age >= SWEEP_LIFETIME_MS) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / SWEEP_LIFETIME_MS, 0, 1);
      // snap-out: the wedge is at full reach almost immediately, then fades
      const out = 1 - (1 - Math.min(1, t * 3)) * (1 - Math.min(1, t * 3));
      const fade = 1 - t;
      // The wedge has said everything it has to say by the time the haul starts,
      // so it fades on its own clock rather than hanging around behind the axe.
      const wedgeFade = constrain(1 - t / 0.55, 0, 1);
      const reach = CONE_RANGE * out;

      push();
      translate(this.owner.position.x, this.owner.position.y);

      // the wedge itself — Noxian iron-grey over dried blood, and a hard edge on
      // the real reach so the cone the player sees is the cone that hit
      push();
      rotate(this.heading);
      noStroke();
      fill(150, 30, 34, 70 * wedgeFade);
      arc(0, 0, reach * 2, reach * 2, -CONE_HALF_ANGLE, CONE_HALF_ANGLE, PIE);
      noFill();
      stroke(235, 200, 190, 200 * wedgeFade);
      strokeWeight(3);
      arc(0, 0, reach * 2, reach * 2, -CONE_HALF_ANGLE, CONE_HALF_ANGLE);
      line(0, 0, cos(-CONE_HALF_ANGLE) * reach, sin(-CONE_HALF_ANGLE) * reach);
      line(0, 0, cos(CONE_HALF_ANGLE) * reach, sin(CONE_HALF_ANGLE) * reach);

      // Ground raked back toward him. Dull and thin on purpose: these used to be
      // bright orange spikes across the whole wedge, which read as a claw or a
      // net — the one thing on screen that should be bright is the axe below.
      stroke(122, 96, 84, 130 * wedgeFade);
      strokeWeight(2);
      for (const barb of this.barbs) {
        const far = Math.min(reach, barb.distance);
        const near = Math.max(0, far - barb.length * (0.4 + out));
        line(
          cos(barb.spread) * far,
          sin(barb.spread) * far,
          cos(barb.spread) * near,
          sin(barb.spread) * near
        );
      }

      // The axe goes out, catches, and comes back — in that order, because that
      // is the order the ability happens in. It used to sweep outward across the
      // wedge for its whole life while the `Dash` on every victim hauled them the
      // other way, so the art was telling the player the opposite of what the
      // game had just done. Reach on the first third, haul for the rest.
      const reachT = constrain(t / REACH_FRACTION, 0, 1);
      const haulT = constrain((t - REACH_FRACTION) / (1 - REACH_FRACTION), 0, 1);
      // ease-in on the way back: the haul starts slow and snaps him in
      const hauled = haulT * haulT;
      const swing = -CONE_HALF_ANGLE + CONE_HALF_ANGLE * 2 * reachT;
      // Never shorter than the grip, or the head would pass through his own body.
      const armReach = Math.max(CONE_RANGE * 0.28, reach * (1 - HAUL_RETRACTION * hauled));

      // The trail sweeps with him on the way out and drops away on the way in:
      // a hot arc still travelling outward while the bodies move inward is the
      // same contradiction, one layer down.
      drawAxeArc(
        armReach * 0.78,
        swing,
        CONE_HALF_ANGLE * 1.6 * reachT,
        210 * fade * (1 - hauled),
        16
      );

      const grip = CONE_RANGE * 0.16;
      push();
      rotate(swing);
      translate(grip, 0);
      drawDariusAxe(Math.max(1, armReach - grip), { alpha: 255 * fade, heat: 1 - hauled * 0.6 });
      pop();
      pop();

      // one chain per body still being reeled in
      stroke(210, 205, 200, 230 * fade);
      strokeWeight(4);
      for (const victim of this.caught) {
        if (!victim || victim.isDead) continue;
        const dx = victim.position.x - this.owner.position.x;
        const dy = victim.position.y - this.owner.position.y;
        const links = 6;
        for (let i = 0; i < links; i++) {
          const a = i / links;
          const b = (i + 0.55) / links;
          line(dx * a, dy * a, dx * b, dy * b);
        }
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = CONE_RANGE + 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Darius_E_Object;
}
const __cacheDarius_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_E_Object>>();
export function makeDarius_E_Object(api: ContentApi) {
  const cached = __cacheDarius_E_Object.get(api);
  if (cached) return cached;
  const built = __buildDarius_E_Object(api);
  __cacheDarius_E_Object.set(api, built);
  return built;
}