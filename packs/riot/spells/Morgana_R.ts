import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Morgana_R = InstanceType<ReturnType<typeof makeMorgana_R>>;
type Morgana_R_Shatter = InstanceType<ReturnType<typeof makeMorgana_R_Shatter>>;
type Morgana_R_Tether = InstanceType<ReturnType<typeof makeMorgana_R_Tether>>;
type Morgana_R_Tether_Object = InstanceType<ReturnType<typeof makeMorgana_R_Tether_Object>>;
type Morgana_R_Windup = InstanceType<ReturnType<typeof makeMorgana_R_Windup>>;



// Exported so the suite asserts the tether's wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
/**
 * The windup. It was 0, so the chains appeared on the frame the key went down
 * and the ultimate had no moment at all — she simply had four enemies tethered
 * with nothing in between. 0.35s is the cast time the imported wiki data
 * carries (`docs/abilities/morgana/r.json`), and it buys the two things the
 * ability was missing: an animation to watch, and a window in which the latch
 * circle is drawn on the ground for the people standing in it.
 */
export const CAST_TIME_MS = 350;

/** How long the shackles take to slam shut once they are on. */
export const SNAP_MS = 260;

/** The burst when a tether resolves or is broken. */
export const SHATTER_MS = 480;

export const LATCH_RADIUS = 500;

// Wider than LATCH_RADIUS on purpose: once caught, a target can roam a bit
// further than the acquire range before the tether actually snaps, mirroring
// the wiki (acquire 575 vs tether 625).
export const TETHER_RANGE = 620;

export const TETHER_DURATION_MS = 3_000;

export const INITIAL_DAMAGE = 35;

export const RESOLVE_DAMAGE = 35;

export const STUN_DURATION_MS = 1_500;

export const SLOW_PERCENT = 0.2;

export const SELF_HASTE_PERCENT = 0.2;

export const MANA_COST = 100;

/** Morgana's own reveal slot, so hers neither evicts nor is evicted by another spell's. */
export const REVEAL_STACK_ID = 'morgana_r_reveal';


type ShackleTarget = AttackableUnit;


function __buildMorgana_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Slow = api.buffs.Slow;
  const Speedup = api.buffs.Speedup;
  const createReveal = api.buffs.createReveal;
  const Morgana_R_Tether = makeMorgana_R_Tether(api);
  const Morgana_R_Tether_Object = makeMorgana_R_Tether_Object(api);
  const Morgana_R_Windup = makeMorgana_R_Windup(api);
  class Morgana_R extends Spell {
    image = api.asset('spell_morgana_r');
    name = 'Trói Hồn (Morgana_R)';
    description =
      'Móc xiềng năng lượng vào các kẻ địch gần đó, gây <span class="damage">35 sát thương</span>, <span class="buff">Lộ Diện</span> và <span class="buff">Làm Chậm 20%</span> chúng trong <span class="time">3 giây</span>. Nếu mục tiêu vẫn còn trong tầm xiềng khi hết hạn, chúng nhận thêm <span class="damage">35 sát thương</span> và bị <span class="buff">Choáng 1.5 giây</span>. Bản thân Morgana được <span class="buff">Tăng Tốc 20%</span> trong lúc xiềng còn hiệu lực.';
    coolDown = 10_000;
    manaCost = MANA_COST;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        castTimeMs: CAST_TIME_MS,
        resource: { commitAt: 'release', refundOn: [] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
      };
    }

    /**
     * The windup, spawned the moment the key goes down rather than at release —
     * it is the only part of the ability the victims get to react to.
     */
    onCastStart(_context: CastContext): void {
      this.game.objectManager.addObject(new Morgana_R_Windup(this.owner).attachTo(this.owner));
    }

    onRelease(context: CastContext): void {
      const origin = context.origin;
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: origin.x, y: origin.y, r: LATCH_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as ShackleTarget[];

      const targets = candidates.filter(
        target =>
          Math.hypot(target.position.x - origin.x, target.position.y - origin.y) <=
          LATCH_RADIUS + target.collisionRadius
      );

      if (targets.length === 0) return;

      const haste = new Speedup(TETHER_DURATION_MS, this.owner, this.owner);
      haste.percent = SELF_HASTE_PERCENT;
      this.owner.addBuff(haste);

      for (const target of targets) this.latch(target);
    }

    drawPreview(): void {
      super.drawPreview(LATCH_RADIUS);
    }

    private latch(target: ShackleTarget): void {
      target.takeDamage(INITIAL_DAMAGE, this.owner);

      const slow = new Slow(TETHER_DURATION_MS, this.owner, target);
      slow.percent = SLOW_PERCENT;
      target.addBuff(slow);

      const reveal = createReveal({
        stackId: REVEAL_STACK_ID,
        durationMs: TETHER_DURATION_MS,
        source: this.owner,
        target,
      });
      target.addBuff(reveal);

      const mark = new Morgana_R_Tether(TETHER_DURATION_MS, this.owner, target);
      target.addBuff(mark);

      // Both ends of the tether read a unit's position every frame, so it must
      // ride `attachTo` for the target-death/removal case. `attachTo` only
      // watches one anchor, and the owner (Morgana) is the second end, so her
      // death/removal is checked by hand in `update()` alongside it.
      const tether = new Morgana_R_Tether_Object(this.owner).attachTo(target);
      tether.target = target;
      tether.slowBuff = slow;
      tether.revealBuff = reveal;
      tether.markBuff = mark;
      this.game.objectManager.addObject(tether);
    }
  }
  return Morgana_R;
}
const __cacheMorgana_R = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_R>>();
export default function makeMorgana_R(api: ContentApi) {
  const cached = __cacheMorgana_R.get(api);
  if (cached) return cached;
  const built = __buildMorgana_R(api);
  __cacheMorgana_R.set(api, built);
  return built;
}


/**
 * The victim-facing half of the tether: a shifting rune ring plus orbiting
 * shackle studs that close in as the timer runs out. This is what tells a
 * caught target to run — the connecting line to Morgana may be off-screen
 * or easy to miss, but this sits right on their own body.
 *
 * Removed the instant a target escapes `TETHER_RANGE` (see
 * `Morgana_R_Tether_Object.endTether`), which is itself the "you got away"
 * signal: the marker just vanishes well before its own timer would have run out.
 */
function __buildMorgana_R_Tether(api: ContentApi) {
  const Buff = api.buffs.Buff;
  class Morgana_R_Tether extends Buff {
    name = 'Xiềng Hồn';
    image: Buff['image'] = api.asset('spell_morgana_r');

    draw(): void {
      const pos = this.targetUnit.position;
      const size = this.targetUnit.animatedValues.displaySize;
      const urgency = this.duration > 0 ? constrain(this.timeElapsed / this.duration, 0, 1) : 0;
      const fast = urgency > 0.7;
      const pulse = 0.5 + 0.5 * sin(frameCount / (fast ? 5 : 13));

      push();
      translate(pos.x, pos.y);

      noFill();
      stroke(150, 60, 200, 130 + 100 * pulse * (0.35 + urgency));
      strokeWeight(3 + 2 * urgency);
      circle(0, 0, size + 16 + 6 * pulse);

      // shackle studs orbiting the victim, spinning faster and drawing in as
      // the resolve moment approaches
      const spin = frameCount / (fast ? 16 : 34);
      for (let i = 0; i < 4; i++) {
        const a = spin + (i * TWO_PI) / 4;
        const r = size / 2 + 15 - urgency * 5;
        noStroke();
        fill(190, 90, 230, 210);
        circle(cos(a) * r, sin(a) * r, 6 + 3 * urgency);
        fill(240, 210, 255, 220);
        circle(cos(a) * r, sin(a) * r, 2.5);
      }

      pop();
    }
  }
  return Morgana_R_Tether;
}
const __cacheMorgana_R_Tether = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_R_Tether>>();
export function makeMorgana_R_Tether(api: ContentApi) {
  const cached = __cacheMorgana_R_Tether.get(api);
  if (cached) return cached;
  const built = __buildMorgana_R_Tether(api);
  __cacheMorgana_R_Tether.set(api, built);
  return built;
}


/**
 * The line between Morgana and one latched target, plus the escape/resolve
 * clock. `attachTo(target)` drops this the instant the target dies or is
 * removed, matching every other body-attached effect in this codebase.
 * Distance and duration are otherwise tracked independently — the mark buff
 * is never watched for its own removal, since it and this object would
 * otherwise race to end the tether on the exact same frame.
 */
function __buildMorgana_R_Tether_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const Buff = api.buffs.Buff;
  const Stun = api.buffs.Stun;
  const Morgana_R_Shatter = makeMorgana_R_Shatter(api);
  class Morgana_R_Tether_Object extends SpellObject {
    target!: ShackleTarget;
    slowBuff?: Buff;
    revealBuff?: Buff;
    markBuff?: Buff;

    elapsedMs = 0;
    durationMs = TETHER_DURATION_MS;
    maxRange = TETHER_RANGE;
    resolveDamage = RESOLVE_DAMAGE;
    stunDurationMs = STUN_DURATION_MS;

    update(deltaMs = deltaTime): void {
      if (this.toRemove) return;
      if (this.dropIfAttachmentLost() || this.owner.isDead || this.owner.toRemove) {
        this.toRemove = true;
        this.cleanupBuffs();
        return;
      }

      this.elapsedMs += Math.max(0, deltaMs);
      const distance = Math.hypot(
        this.target.position.x - this.owner.position.x,
        this.target.position.y - this.owner.position.y
      );

      if (distance > this.maxRange) {
        this.endTether(false);
        return;
      }
      if (this.elapsedMs >= this.durationMs) {
        this.endTether(true);
      }
    }

    /**
     * A chain, not a line.
     *
     * This used to be two `line()` calls from Morgana to the victim, which is why
     * the ultimate read as "a glowing wire appeared": nothing about it was a
     * shackle, and nothing about it changed between latching and resolving.
     *
     * It now draws what the ability is called. The chain hangs slack while the
     * victim is close and pulls dead straight as they near the tether's limit, so
     * the distance the player has to cover is legible from the shape alone. The
     * first `SNAP_MS` carry a surge of light out from Morgana along the links —
     * the shackles slamming shut — and the last 30% of the timer sets the whole
     * thing shaking.
     */
    draw(): void {
      const t = constrain(this.elapsedMs / this.durationMs, 0, 1);
      const urgency = t > 0.7 ? (t - 0.7) / 0.3 : 0;
      const pulse = 0.5 + 0.5 * sin(frameCount / (urgency > 0.3 ? 5 : 12));
      const ox = this.owner.position.x;
      const oy = this.owner.position.y;
      const tx = this.target.position.x;
      const ty = this.target.position.y;

      const dx = tx - ox;
      const dy = ty - oy;
      const distance = Math.max(1, Math.hypot(dx, dy));
      // Slack tells the victim how much rope is left: full sag up close, dead
      // straight by the time they are at the range that breaks the tether.
      const slack = (1 - constrain(distance / this.maxRange, 0, 1)) * 34 * (1 - urgency);
      const shake = urgency > 0 ? sin(frameCount / 2.2) * 4 * urgency : 0;
      // control point for the sagged curve, pushed perpendicular to the span
      const nx = -dy / distance;
      const ny = dx / distance;
      const cx = (ox + tx) / 2 + nx * (slack + shake);
      const cy = (oy + ty) / 2 + ny * (slack + shake);
      const at = (s: number) => {
        const u = 1 - s;
        return {
          x: u * u * ox + 2 * u * s * cx + s * s * tx,
          y: u * u * oy + 2 * u * s * cy + s * s * ty,
        };
      };

      push();

      // the light running through the chain, drawn as segments of the same curve
      blendMode(ADD);
      const SEGMENTS = 12;
      stroke(150, 70, 210, 70 + 90 * pulse * (0.35 + urgency));
      strokeWeight(6 + 4 * urgency);
      for (let i = 0; i < SEGMENTS; i++) {
        const a = at(i / SEGMENTS);
        const b = at((i + 1) / SEGMENTS);
        line(a.x, a.y, b.x, b.y);
      }
      stroke(230, 200, 255, 90 + 100 * pulse * (0.35 + urgency));
      strokeWeight(1.5 + urgency);
      for (let i = 0; i < SEGMENTS; i++) {
        const a = at(i / SEGMENTS);
        const b = at((i + 1) / SEGMENTS);
        line(a.x, a.y, b.x, b.y);
      }
      blendMode(BLEND);

      // the links themselves: alternating flat and edge-on, which is what makes a
      // row of ellipses read as chain rather than as beads
      const LINKS = Math.max(6, Math.round(distance / 26));
      for (let i = 0; i <= LINKS; i++) {
        const s = i / LINKS;
        const here = at(s);
        const ahead = at(Math.min(1, s + 0.02));
        const angle = Math.atan2(ahead.y - here.y, ahead.x - here.x);
        // the surge of light travelling out from Morgana as the cuffs slam shut
        const surge = this.elapsedMs < SNAP_MS ? 1 - Math.abs(this.elapsedMs / SNAP_MS - s) * 4 : 0;
        const hot = constrain(surge, 0, 1);

        push();
        translate(here.x, here.y);
        rotate(angle);
        noFill();
        stroke(60, 15, 90, 230);
        strokeWeight(4.5);
        ellipse(0, 0, i % 2 === 0 ? 14 : 6, i % 2 === 0 ? 8 : 12);
        stroke(186 + 60 * hot, 96 + 130 * hot, 226 + 26 * hot, 200 + 55 * hot);
        strokeWeight(2.2 + 1.6 * hot + urgency);
        ellipse(0, 0, i % 2 === 0 ? 14 : 6, i % 2 === 0 ? 8 : 12);
        pop();
      }

      // shackle cuffs anchored at both ends — the tether has two sides
      noStroke();
      fill(40, 8, 60, 235);
      circle(ox, oy, 20);
      circle(tx, ty, 20);
      fill(150, 70, 210, 230);
      circle(ox, oy, 14);
      circle(tx, ty, 14);
      fill(240, 215, 255, 220);
      circle(ox, oy, 5 + 2 * pulse);
      circle(tx, ty, 5 + 2 * pulse);
      pop();
    }

    // spans from Morgana to the target — the box must cover both
    getDisplayBoundingBox(): Rectangle {
      const pad = 24;
      return new Rectangle({
        x: Math.min(this.owner.position.x, this.target.position.x) - pad,
        y: Math.min(this.owner.position.y, this.target.position.y) - pad,
        w: Math.abs(this.target.position.x - this.owner.position.x) + pad * 2,
        h: Math.abs(this.target.position.y - this.owner.position.y) + pad * 2,
        data: this,
      });
    }

    private endTether(resolved: boolean): void {
      this.toRemove = true;
      if (resolved && !this.target.isDead) {
        this.target.takeDamage(this.resolveDamage, this.owner);
        this.target.addBuff(new Stun(this.stunDurationMs, this.owner, this.target));
      }
      // Either ending gets a picture, and they are different pictures: the chain
      // detonating on the victim, or the links snapping and falling away from
      // someone who outran it. Without this the tether simply stopped existing
      // and neither outcome was readable.
      const shatter = new Morgana_R_Shatter(this.owner);
      shatter.position = this.target.position.copy();
      shatter.resolved = resolved;
      this.game.objectManager.addObject(shatter);
      this.cleanupBuffs();
    }

    private cleanupBuffs(): void {
      this.slowBuff?.deactivateBuff();
      this.revealBuff?.deactivateBuff();
      this.markBuff?.deactivateBuff();
    }
  }
  return Morgana_R_Tether_Object;
}
const __cacheMorgana_R_Tether_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_R_Tether_Object>>();
export function makeMorgana_R_Tether_Object(api: ContentApi) {
  const cached = __cacheMorgana_R_Tether_Object.get(api);
  if (cached) return cached;
  const built = __buildMorgana_R_Tether_Object(api);
  __cacheMorgana_R_Tether_Object.set(api, built);
  return built;
}


/**
 * The 0.35s before the shackles exist.
 *
 * Ground art (`zIndex = GROUND_Z_INDEX`) on purpose: the most useful thing this draws is the
 * latch circle, closing in on Morgana over the windup, and it has to be legible
 * under the feet of the people deciding whether to walk out of it. That circle
 * is the whole counterplay to Soul Shackles, and until now it was never drawn
 * at all — the ability went from nothing to four tethers in one frame.
 */
function __buildMorgana_R_Windup(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Morgana_R_Windup extends SpellObject {
    lifeTime = CAST_TIME_MS;
    age = 0;
    zIndex = GROUND_Z_INDEX;

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.position = this.owner.position.copy();
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // eases toward 1, so the gather accelerates into the release
      const gather = t * t;

      push();
      translate(this.position.x, this.position.y);

      // the reach, drawn from the first frame so it can be walked out of
      noFill();
      stroke(20, 0, 30, 150 * t);
      strokeWeight(6);
      circle(0, 0, LATCH_RADIUS * 2);
      stroke(190, 90, 230, 200 * t);
      strokeWeight(2.5);
      circle(0, 0, LATCH_RADIUS * 2);

      // three rings collapsing onto her — the shackles being drawn in from the
      // edge of the circle before they are thrown back out at release
      for (let i = 0; i < 3; i++) {
        const phase = constrain(gather + i * 0.22, 0, 1);
        const r = LATCH_RADIUS * (1 - phase) + 30;
        stroke(210, 120, 255, 190 * (1 - phase) * t);
        strokeWeight(3 + 3 * phase);
        circle(0, 0, r * 2);
      }

      // chain spokes sweeping in with them, so the rings read as links and not
      // as a generic charge-up pulse
      const SPOKES = 8;
      const spin = frameCount / 22;
      for (let i = 0; i < SPOKES; i++) {
        const a = spin + (i * TWO_PI) / SPOKES;
        const inner = LATCH_RADIUS * (1 - gather) * 0.55 + 26;
        const outer = inner + 60 * (1 - gather) + 14;
        stroke(180, 80, 225, 200 * t);
        strokeWeight(4);
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }

      // the pool of shadow gathering under her, brightest right before release
      noStroke();
      fill(40, 5, 60, 170 * gather);
      circle(0, 0, 70 + 40 * gather);
      fill(200, 130, 255, 200 * gather * gather);
      circle(0, 0, 22 + 26 * gather);

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      return this.squareDisplayBoundingBox(LATCH_RADIUS * 2);
    }
  }
  return Morgana_R_Windup;
}
const __cacheMorgana_R_Windup = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_R_Windup>>();
export function makeMorgana_R_Windup(api: ContentApi) {
  const cached = __cacheMorgana_R_Windup.get(api);
  if (cached) return cached;
  const built = __buildMorgana_R_Windup(api);
  __cacheMorgana_R_Windup.set(api, built);
  return built;
}


/** One broken link, thrown clear when a tether ends. */
interface Shard {
  angle: number;
  speed: number;
  spin: number;
  size: number;
}


/**
 * How a tether ends. `resolved` picks which of the two endings this is: the
 * shackles detonating on someone who never got out, or the links simply
 * snapping and falling for someone who did.
 */
function __buildMorgana_R_Shatter(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Morgana_R_Shatter extends SpellObject {
    resolved = true;
    lifeTime = SHATTER_MS;
    age = 0;
    radius = 90;

    _shards: Shard[] = [];

    onAdded(): void {
      const count = this.resolved ? 12 : 7;
      for (let i = 0; i < count; i++) {
        this._shards.push({
          angle: (TWO_PI * i) / count + random(-0.25, 0.25),
          speed: random(this.resolved ? 1.6 : 0.7, this.resolved ? 3.4 : 1.5),
          spin: random(-0.25, 0.25),
          size: random(7, 13),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const burst = constrain(t / 0.25, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // the shock only belongs to the ending that actually hurt someone
      if (this.resolved) {
        noFill();
        stroke(150, 60, 200, 230 * fade);
        strokeWeight(9 * fade + 2);
        circle(0, 0, this.radius * 2 * burst);
        stroke(240, 210, 255, 200 * fade * (1 - burst * 0.5));
        strokeWeight(3 * fade + 1);
        circle(0, 0, this.radius * 1.5 * burst);
      }

      // links coming apart, tumbling as they go
      for (const shard of this._shards) {
        const d = shard.speed * this.age * 0.09;
        push();
        translate(cos(shard.angle) * d, sin(shard.angle) * d + (this.resolved ? 0 : t * t * 26));
        rotate(shard.angle + shard.spin * this.age * 0.02);
        noFill();
        stroke(60, 15, 90, 235 * fade);
        strokeWeight(4.5);
        ellipse(0, 0, shard.size, shard.size * 0.6);
        stroke(200, 120, 240, 230 * fade);
        strokeWeight(2.2);
        ellipse(0, 0, shard.size, shard.size * 0.6);
        pop();
      }

      // the white core of the resolve, gone almost immediately
      if (this.resolved && burst < 1) {
        blendMode(ADD);
        noStroke();
        fill(245, 220, 255, 235 * (1 - burst));
        circle(0, 0, this.radius * 0.8 * (1 - burst) + 20);
        blendMode(BLEND);
      }

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const span = this.radius * 1.6;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Morgana_R_Shatter;
}
const __cacheMorgana_R_Shatter = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_R_Shatter>>();
export function makeMorgana_R_Shatter(api: ContentApi) {
  const cached = __cacheMorgana_R_Shatter.get(api);
  if (cached) return cached;
  const built = __buildMorgana_R_Shatter(api);
  __cacheMorgana_R_Shatter.set(api, built);
  return built;
}