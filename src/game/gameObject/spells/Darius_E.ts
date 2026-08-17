import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Airborne from '../buffs/Airborne';
import Dash from '../buffs/Dash';
import Slow from '../buffs/Slow';
import { applyHemorrhage } from './Darius_Q';

export const CAST_TIME_MS = 250;
export const CONE_RANGE = 430;
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
export default class Darius_E extends Spell {
  image = AssetManager.get('spell_darius_e');
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

export const SWEEP_LIFETIME_MS = 460;
/** Barbs of the sweep — seeded once, then animated. */
const BARB_COUNT = 9;

/**
 * The wedge on the floor and the hooks reeling in.
 *
 * Ground art, so it takes `zIndex = 2` and paints under the feet it is dragging.
 * The chains are drawn back to Darius rather than only around the victims —
 * which is why the bounding box has to cover the whole cone.
 */
export class Darius_E_Object extends SpellObject {
  zIndex = 2;
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
    const reach = CONE_RANGE * out;

    push();
    translate(this.owner.position.x, this.owner.position.y);

    // the wedge itself — Noxian iron-grey over dried blood, and a hard edge on
    // the real reach so the cone the player sees is the cone that hit
    push();
    rotate(this.heading);
    noStroke();
    fill(150, 30, 34, 70 * fade);
    arc(0, 0, reach * 2, reach * 2, -CONE_HALF_ANGLE, CONE_HALF_ANGLE, PIE);
    noFill();
    stroke(235, 200, 190, 200 * fade);
    strokeWeight(3);
    arc(0, 0, reach * 2, reach * 2, -CONE_HALF_ANGLE, CONE_HALF_ANGLE);
    line(0, 0, cos(-CONE_HALF_ANGLE) * reach, sin(-CONE_HALF_ANGLE) * reach);
    line(0, 0, cos(CONE_HALF_ANGLE) * reach, sin(CONE_HALF_ANGLE) * reach);

    // barbs raking back toward him, so the direction of the pull is legible
    stroke(255, 120, 90, 220 * fade);
    strokeWeight(3);
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
    return new Rectangle({
      x: this.owner.position.x - r,
      y: this.owner.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
