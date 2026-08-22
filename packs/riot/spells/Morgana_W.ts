import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, Vec2 } from '@moba2d/core/content/types';

type AreaSpellObject = InstanceType<ContentApi['AreaSpellObject']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Monster = InstanceType<ContentApi['units']['Monster']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Morgana_W = InstanceType<ReturnType<typeof makeMorgana_W>>;
type Morgana_W_Object = InstanceType<ReturnType<typeof makeMorgana_W_Object>>;



// Exported so the suite asserts the zone's wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
export const RANGE = 600;

export const RADIUS = 220;

export const CAST_TIME_MS = 0;

export const DURATION_MS = 5_000;

export const TICK_EVERY_MS = 500;

export const MIN_TICK_DAMAGE = 3;

export const MAX_TICK_DAMAGE = 5;

export const MONSTER_DAMAGE_MULTIPLIER = 1.7;

export const MANA_COST = 50;


type ShadowTarget = AttackableUnit;


/**
 * 137.5°, the angle successive seeds sit at in a sunflower head. Stepping by it
 * is the standard way to scatter N points over a disc without any two lining
 * up, for *any* N — which is the property that was missing here.
 */
const GOLDEN_ANGLE = 2.399963;


/** Deterministic [0,1) noise, so the layout is stable across frames and casts. */
const hash = (i: number, salt: number): number => {
  const x = Math.sin(i * 12.9898 + salt) * 43758.5453;
  return x - Math.floor(x);
};


export interface Spike {
  /** Radians around the zone centre. */
  angle: number;
  /** 0..1 of the zone radius. */
  radiusRatio: number;
  /** How long one rise-and-sink takes. */
  loopMs: number;
  /** Where in that loop this spike starts, so they do not pump in unison. */
  phaseOffsetMs: number;
}


/**
 * Where the spikes stand.
 *
 * The old layout put spike `i` at `angle = i * 3.171 * 2` — that is `i * 6.342`
 * against a circle of `6.28318`, so consecutive spikes were **0.06 radians**
 * apart and all ten crowded into a 30° sliver of a 220px zone. The rest of the
 * cursed ground had nothing growing out of it.
 *
 * Deterministic rather than `random()` for the same reason the motes below are:
 * `draw()` runs every frame, so a random layout would re-roll 60 times a second
 * and the spikes would strobe instead of rise. It also makes the spread
 * something a test can state, which a `random()` table is not.
 */
export function spikeLayout(count: number): Spike[] {
  const spikes: Spike[] = [];
  for (let i = 0; i < count; i++) {
    // sqrt, so the points are even by *area* — a linear ramp crowds the middle.
    const radiusRatio = (0.18 + 0.74 * Math.sqrt((i + 0.5) / count)) * (0.92 + hash(i, 7.1) * 0.16);
    const loopMs = 780 + hash(i, 3.3) * 520;
    spikes.push({
      // the jitter is small enough to keep the coverage even and large enough
      // that the result does not read as a spiral
      angle: i * GOLDEN_ANGLE + (hash(i, 1.7) - 0.5) * 0.4,
      radiusRatio: Math.min(radiusRatio, 0.97),
      loopMs,
      phaseOffsetMs: hash(i, 5.9) * loopMs,
    });
  }
  return spikes;
}


/** 220px of cursed ground carries more than the ten it used to try to. */
export const SPIKE_COUNT = 18;

const SPIKES = spikeLayout(SPIKE_COUNT);


function __buildMorgana_W(api: ContentApi) {
  const Spell = api.Spell;
  const Morgana_W_Object = makeMorgana_W_Object(api);
  class Morgana_W extends Spell {
    image = api.asset('spell_morgana_w');
    name = 'Vùng Đất Chết (Morgana_W)';
    description =
      'Nguyền rủa mặt đất tại vị trí chỉ định trong <span class="time">5 giây</span>, gây <span class="damage">3-5 sát thương phép mỗi 0.5 giây</span> cho kẻ địch đứng trong đó — sát thương tăng theo phần trăm máu đã mất của mục tiêu, và tăng 70% khi nhắm vào quái rừng.';
    coolDown = 9_000;
    manaCost = MANA_COST;

    range = RANGE;
    activeZone: Morgana_W_Object | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'POINT',
        castTimeMs: CAST_TIME_MS,
        resource: { commitAt: 'release', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onRelease(context: CastContext): void {
      const center = this.pointInRange(context.cursorWorld);
      const zone = new Morgana_W_Object(this.owner, center);
      this.activeZone = zone;
      this.game.objectManager.addObject(zone);
    }

    onUpdate(): void {
      if (this.activeZone?.toRemove) this.activeZone = null;
    }

    drawPreview(): void {
      super.drawPreview(this.range);
    }

    private pointInRange(point: Vec2): Vec2 {
      const dx = point.x - this.owner.position.x;
      const dy = point.y - this.owner.position.y;
      const distance = Math.hypot(dx, dy);
      const ratio = distance > this.range ? this.range / distance : 1;
      return { x: this.owner.position.x + dx * ratio, y: this.owner.position.y + dy * ratio };
    }
  }
  return Morgana_W;
}
const __cacheMorgana_W = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_W>>();
export default function makeMorgana_W(api: ContentApi) {
  const cached = __cacheMorgana_W.get(api);
  if (cached) return cached;
  const built = __buildMorgana_W(api);
  __cacheMorgana_W.set(api, built);
  return built;
}


function __buildMorgana_W_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Monster = api.units.Monster;
  const AreaSpellObject = api.AreaSpellObject;
  class Morgana_W_Object extends AreaSpellObject {
    constructor(owner: AttackableUnit, center: Vec2) {
      super(owner, center, RADIUS, {
        candidates: () =>
          this.game.objectManager.queryObjects({
            area: new Circle({ x: center.x, y: center.y, r: RADIUS }),
            filters: [PredefinedFilters.canTakeDamageFromTeam(owner.teamId)],
          }),
        tickEveryMs: TICK_EVERY_MS,
        durationMs: DURATION_MS,
        onEnter: target => this.damageTarget(target),
        onTick: target => this.damageTarget(target),
      });
    }

    private damageTarget(target: ShadowTarget): void {
      const maxHealth = target.stats.maxHealth.value;
      const missingRatio = maxHealth > 0 ? 1 - target.stats.health.value / maxHealth : 0;
      const base =
        MIN_TICK_DAMAGE + (MAX_TICK_DAMAGE - MIN_TICK_DAMAGE) * constrain(missingRatio, 0, 1);
      const multiplier = target instanceof Monster ? MONSTER_DAMAGE_MULTIPLIER : 1;
      target.takeDamage(base * multiplier, this.owner);
    }

    draw(): void {
      const fadeIn = constrain(this.elapsedMs / 250, 0, 1);
      const fadeOut = 1 - constrain((this.elapsedMs - (DURATION_MS - 400)) / 400, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);
      const pulse = 0.6 + 0.4 * sin(this.elapsedMs / 260);

      push();
      translate(this.center.x, this.center.y);

      // desecrated ground: a pooling dark stain, not a flat tinted circle
      noStroke();
      fill(30, 5, 45, 90 * alpha);
      circle(0, 0, this.radius * 2);
      fill(60, 10, 85, 60 * alpha * pulse);
      circle(0, 0, this.radius * 1.5);

      // boundary ring, breathing with the curse
      noFill();
      stroke(20, 0, 30, 200 * alpha);
      strokeWeight(5);
      circle(0, 0, this.radius * 2);
      stroke(190, 90, 230, (140 + 90 * pulse) * alpha);
      strokeWeight(2);
      circle(0, 0, this.radius * 2);

      // corrupted spikes rising and sinking back into the ground
      for (const spike of SPIKES) {
        const phase = ((this.elapsedMs + spike.phaseOffsetMs) % spike.loopMs) / spike.loopMs;
        const rise = sin(phase * PI);
        if (rise <= 0.02) continue;
        const r = this.radius * spike.radiusRatio;
        const px = cos(spike.angle) * r;
        const py = sin(spike.angle) * r;
        const spikeHeight = 10 + rise * 26;

        push();
        translate(px, py);
        noStroke();
        fill(150, 60, 200, 210 * rise * alpha);
        triangle(-4, 0, 4, 0, 0, -spikeHeight);
        fill(220, 170, 255, 160 * rise * alpha);
        triangle(-1.4, 0, 1.4, 0, 0, -spikeHeight);
        pop();
      }

      // slow-drifting motes of corruption over the whole area, keyed off
      // elapsedMs rather than random() so they drift instead of flickering
      noStroke();
      fill(210, 150, 255, 130 * alpha);
      const MOTE_COUNT = 16;
      for (let i = 0; i < MOTE_COUNT; i++) {
        const seed = i * 2.399963;
        const loopMs = 2_600 + (i % 5) * 220;
        const phase = ((this.elapsedMs + seed * 500) % loopMs) / loopMs;
        const r = this.radius * (0.1 + phase * 0.85);
        const a = seed + this.elapsedMs / 3_400;
        circle(cos(a) * r, sin(a) * r, 2 + (i % 3));
      }

      pop();
    }

    // the spikes reach a little past the collision radius; pad the culling box
    getDisplayBoundingBox(): Rectangle {
      const pad = this.radius + 30;
      return new Rectangle({
        x: this.center.x - pad,
        y: this.center.y - pad,
        w: pad * 2,
        h: pad * 2,
        data: this,
      });
    }
  }
  return Morgana_W_Object;
}
const __cacheMorgana_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMorgana_W_Object>>();
export function makeMorgana_W_Object(api: ContentApi) {
  const cached = __cacheMorgana_W_Object.get(api);
  if (cached) return cached;
  const built = __buildMorgana_W_Object(api);
  __cacheMorgana_W_Object.set(api, built);
  return built;
}