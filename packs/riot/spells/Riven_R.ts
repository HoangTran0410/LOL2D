import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CancelReason, CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Riven_R = InstanceType<ReturnType<typeof makeRiven_R>>;
type Riven_R_Reforge = InstanceType<ReturnType<typeof makeRiven_R_Reforge>>;
type Riven_R_Reforge_Vfx = InstanceType<ReturnType<typeof makeRiven_R_Reforge_Vfx>>;
type Riven_R_WindSlash = InstanceType<ReturnType<typeof makeRiven_R_WindSlash>>;



export const R_DURATION_MS = 9_000;

export const R_DAMAGE_AMP = 0.15;

export const R_LENGTH = 400;

export const R_WIDTH = 240;

export const R_DAMAGE = 24;

export const R_DAMAGE_MAX = 48;

export const R_EXECUTE_THRESHOLD = 0.5;

export const R_WAVE_COUNT = 3;

export const R_WAVE_DELAY_MS = 80;

export const R_WAVE_TRAVEL_MS = 320;


const IRON: [number, number, number] = [30, 39, 46];

const RUNE: [number, number, number] = [0, 210, 168];

const RUNE_HOT: [number, number, number] = [150, 255, 228];


/**
 * How far along the 24 -> 48 ramp a victim at `healthRatio` sits. Full health is 0,
 * R_EXECUTE_THRESHOLD and anything below it is 1. Exported so the Wind Slash art can
 * make a low-health impact visibly bigger without recomputing the rule.
 */
export function windSlashRamp(healthRatio: number): number {
  const held = Math.max(0, Math.min(1, healthRatio));
  const span = 1 - R_EXECUTE_THRESHOLD;
  if (span <= 0) return held <= R_EXECUTE_THRESHOLD ? 1 : 0;
  return Math.max(0, Math.min(1, (1 - held) / span));
}


/** R_DAMAGE at full health, rising linearly to R_DAMAGE_MAX at the execute threshold. */
export function windSlashDamage(healthRatio: number): number {
  return R_DAMAGE + (R_DAMAGE_MAX - R_DAMAGE) * windSlashRamp(healthRatio);
}


/**
 * The reforged runeblade. Its own class rather than a configured `StatAmp` so the stack
 * slot is unique and Riven_Q can ask `hasBuff` whether to grow its energy edge.
 */
function __buildRiven_R_Reforge(api: ContentApi) {
  const StatAmp = api.buffs.StatAmp;
  class Riven_R_Reforge extends StatAmp {
    bonuses = { attackDamage: { percentBonus: R_DAMAGE_AMP } };
  }
  return Riven_R_Reforge;
}
const __cacheRiven_R_Reforge = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_R_Reforge>>();
export function makeRiven_R_Reforge(api: ContentApi) {
  const cached = __cacheRiven_R_Reforge.get(api);
  if (cached) return cached;
  const built = __buildRiven_R_Reforge(api);
  __cacheRiven_R_Reforge.set(api, built);
  return built;
}


function __buildRiven_R(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const SpellForm = api.enums.SpellForm;
  const Spell = api.Spell;
  const Riven_R_Reforge = makeRiven_R_Reforge(api);
  const Riven_R_WindSlash = makeRiven_R_WindSlash(api);
  const Riven_R_Reforge_Vfx = makeRiven_R_Reforge_Vfx(api);
  class Riven_R extends Spell {
    image = api.asset('spell_riven_r');
    name = 'Lưỡi Kiếm Lưu Đày (Riven_R)';
    description =
      `Hàn lại lưỡi kiếm vỡ trong ${R_DURATION_MS / 1000} giây: ` +
      `<span class="damage">+${Math.round(R_DAMAGE_AMP * 100)}% sát thương</span> và mọi nhát Q ` +
      `mang một lưỡi năng lượng dài. Bấm lại để phóng Kiếm Phong hình nón dài ${R_LENGTH}, ` +
      `gây <span class="damage">${R_DAMAGE} sát thương</span>, tăng dần tới ` +
      `<span class="damage">${R_DAMAGE_MAX}</span> khi mục tiêu còn dưới ` +
      `${Math.round(R_EXECUTE_THRESHOLD * 100)}% máu.`;
    coolDown = 10_000;
    manaCost = 100;
    range = R_LENGTH;

    /** True between the first press and either the recast or the window running out. */
    reforged = false;
    activeElapsedMs = 0;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'RECAST',
        targeting: 'SELF',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        active: { maxDurationMs: R_DURATION_MS },
        // She has to be able to walk and fight for nine seconds while the blade is whole.
        interrupts: SpellForm.INDEPENDENT,
      };
    }

    onActivate(): void {
      this.reforged = true;
      this.activeElapsedMs = 0;
      this.owner.addBuff(new Riven_R_Reforge(R_DURATION_MS, this.owner, this.owner));
      this.game.objectManager.addObject(new Riven_R_Reforge_Vfx(this.owner));
    }

    onUpdate(): void {
      if (!this.reforged) return;
      this.activeElapsedMs += deltaTime;
      if (this.activeElapsedMs >= R_DURATION_MS) this.endReforge();
    }

    onRecast(context: CastContext): void {
      if (!this.reforged || this.activeElapsedMs >= R_DURATION_MS) return;

      const aim = this.firingDirection(context);
      const heading = Math.atan2(aim.y, aim.x);
      const slash = new Riven_R_WindSlash(this.owner, this.owner.position.copy(), heading);
      this.game.objectManager.addObject(slash);

      this.endReforge();
    }

    onCancel(_context: CastContext, _reason: CancelReason): void {
      this.endReforge();
    }

    onComplete(): void {
      this.endReforge();
    }

    /** Idempotent: the window can end by recast, by expiry or by the runtime completing it. */
    endReforge(): void {
      this.reforged = false;
      for (const buff of [...this.owner.buffs]) {
        if (buff instanceof Riven_R_Reforge) buff.deactivateBuff();
      }
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Riven_R;
}
const __cacheRiven_R = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_R>>();
export default function makeRiven_R(api: ContentApi) {
  const cached = __cacheRiven_R.get(api);
  if (cached) return cached;
  const built = __buildRiven_R(api);
  __cacheRiven_R.set(api, built);
  return built;
}


/**
 * Wind Slash. Three crescent waves leave her R_WAVE_DELAY_MS apart and run the length of
 * a cone that is exactly R_LENGTH long and R_WIDTH across at the far end; the first wave
 * to reach a unit is the one that damages it, and `hitTargets` keeps the other two off.
 */
function __buildRiven_R_WindSlash(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Riven_R_WindSlash extends SpellObject {
    readonly origin: p5.Vector;
    readonly heading: number;
    readonly hitTargets = new Set<AttackableUnit>();
    lifeTime = R_WAVE_DELAY_MS * (R_WAVE_COUNT - 1) + R_WAVE_TRAVEL_MS + 260;
    age = 0;
    /** One burst per victim, sized by how far up the damage ramp that victim sat. */
    bursts: { x: number; y: number; ramp: number; age: number }[] = [];
    /** Seeded once in onAdded: random() inside draw() would re-tear the edge every frame. */
    tears: number[] = [];

    constructor(owner: AttackableUnit, origin: p5.Vector, heading: number) {
      super(owner);
      this.origin = origin;
      this.position = origin.copy();
      this.heading = heading;
    }

    onAdded(): void {
      for (let i = 0; i < 14; i++) this.tears.push(random(-1, 1));
    }

    /** How far this wave's leading edge has travelled, 0 before it launches. */
    waveFront(index: number): number {
      const travelled = this.age - index * R_WAVE_DELAY_MS;
      if (travelled <= 0) return 0;
      const t = Math.min(1, travelled / R_WAVE_TRAVEL_MS);
      return R_LENGTH * (1 - (1 - t) * (1 - t));
    }

    update(): void {
      this.age += deltaTime;
      for (let wave = 0; wave < R_WAVE_COUNT; wave++) {
        const front = this.waveFront(wave);
        if (front > 0) this.strike(front);
      }
      for (const burst of this.bursts) burst.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    /**
     * Everything inside the cone and behind `front` that has not been cut yet. No vision
     * filter: this is an area effect, and vision gates acquisition rather than damage.
     */
    private strike(front: number): void {
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.origin.x,
          y: this.origin.y,
          r: effectiveRange(R_LENGTH, this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      const forwardX = Math.cos(this.heading);
      const forwardY = Math.sin(this.heading);

      for (const victim of candidates) {
        if (this.hitTargets.has(victim)) continue;

        const dx = victim.position.x - this.origin.x;
        const dy = victim.position.y - this.origin.y;
        const along = dx * forwardX + dy * forwardY;
        const sideways = Math.abs(dy * forwardX - dx * forwardY);
        const body = victim.collisionRadius || 0;

        if (along < -body || along > R_LENGTH + body) continue;
        if (along > front + body) continue;
        const halfWidth = (R_WIDTH / 2) * Math.max(0, Math.min(1, along / R_LENGTH));
        if (sideways > halfWidth + body) continue;

        this.hitTargets.add(victim);
        const pool = victim.stats.maxHealth.value || 1;
        const ratio = victim.stats.health.value / pool;
        victim.takeDamage(windSlashDamage(ratio), this.owner);
        this.bursts.push({
          x: victim.position.x,
          y: victim.position.y,
          ramp: windSlashRamp(ratio),
          age: 0,
        });
      }
    }

    draw(): void {
      push();
      noFill();

      // The threat itself: the exact cone the enemy is deciding whether to stand in.
      const tipX = this.origin.x + Math.cos(this.heading) * R_LENGTH;
      const tipY = this.origin.y + Math.sin(this.heading) * R_LENGTH;
      const edgeX = -Math.sin(this.heading) * (R_WIDTH / 2);
      const edgeY = Math.cos(this.heading) * (R_WIDTH / 2);
      const fade = Math.max(0, 1 - this.age / this.lifeTime);
      stroke(RUNE[0], RUNE[1], RUNE[2], 110 * fade);
      strokeWeight(2);
      line(this.origin.x, this.origin.y, tipX + edgeX, tipY + edgeY);
      line(this.origin.x, this.origin.y, tipX - edgeX, tipY - edgeY);
      line(tipX + edgeX, tipY + edgeY, tipX - edgeX, tipY - edgeY);

      for (let wave = 0; wave < R_WAVE_COUNT; wave++) {
        this.drawWave(this.waveFront(wave), wave);
      }
      for (const burst of this.bursts) this.drawBurst(burst);
      pop();
    }

    /** One crescent: a straight leading edge, a torn trailing one, brightest at the front. */
    private drawWave(front: number, wave: number): void {
      if (front <= 0) return;
      const reached = front / R_LENGTH;
      const alpha = 235 * (1 - reached * reached) * (1 - wave * 0.22);
      if (alpha <= 2) return;

      const halfSpan = (R_WIDTH / 2) * reached;
      const centreX = this.origin.x + Math.cos(this.heading) * front;
      const centreY = this.origin.y + Math.sin(this.heading) * front;
      const acrossX = -Math.sin(this.heading);
      const acrossY = Math.cos(this.heading);
      const backX = -Math.cos(this.heading);
      const backY = -Math.sin(this.heading);
      const depth = 26 + 34 * reached;

      push();
      // straight leading edge
      noStroke();
      fill(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], alpha);
      beginShape();
      for (let step = 0; step <= 10; step++) {
        const across = -1 + (step / 10) * 2;
        const bow = (1 - across * across) * 14;
        vertex(
          centreX + acrossX * halfSpan * across + backX * -bow,
          centreY + acrossY * halfSpan * across + backY * -bow
        );
      }
      // torn trailing edge, walked back the other way
      for (let step = 10; step >= 0; step--) {
        const across = -1 + (step / 10) * 2;
        const torn = this.tears.length > 0 ? this.tears[step % this.tears.length] : 0;
        const back = depth * (0.55 + 0.45 * (1 - across * across)) + torn * 13;
        vertex(
          centreX + acrossX * halfSpan * across + backX * back,
          centreY + acrossY * halfSpan * across + backY * back
        );
      }
      endShape(CLOSE);

      // the dark iron core of the crescent, so it reads as a broken blade and not a glow
      fill(IRON[0], IRON[1], IRON[2], alpha * 0.8);
      beginShape();
      for (let step = 0; step <= 8; step++) {
        const across = -0.82 + (step / 8) * 1.64;
        vertex(centreX + acrossX * halfSpan * across, centreY + acrossY * halfSpan * across);
      }
      for (let step = 8; step >= 0; step--) {
        const across = -0.82 + (step / 8) * 1.64;
        const back = depth * 0.4 * (0.5 + 0.5 * (1 - across * across));
        vertex(
          centreX + acrossX * halfSpan * across + backX * back,
          centreY + acrossY * halfSpan * across + backY * back
        );
      }
      endShape(CLOSE);
      pop();
    }

    /** The ramp made visible: the lower the victim was, the bigger and hotter the cut. */
    private drawBurst(burst: { x: number; y: number; ramp: number; age: number }): void {
      const t = Math.min(1, burst.age / 300);
      if (t >= 1) return;
      const opened = 1 - (1 - t) * (1 - t);
      const reach = (26 + 44 * burst.ramp) * (0.35 + 0.65 * opened);
      push();
      noFill();
      stroke(
        RUNE_HOT[0],
        RUNE_HOT[1] - 30 * (1 - burst.ramp),
        RUNE_HOT[2],
        (150 + 105 * burst.ramp) * (1 - t)
      );
      strokeWeight(2 + 3 * burst.ramp * (1 - t));
      circle(burst.x, burst.y, reach * 2);
      const spokes = 4 + Math.round(4 * burst.ramp);
      for (let i = 0; i < spokes; i++) {
        const spin = (i / spokes) * Math.PI * 2 + this.heading;
        line(
          burst.x + Math.cos(spin) * reach * 0.45,
          burst.y + Math.sin(spin) * reach * 0.45,
          burst.x + Math.cos(spin) * reach * 1.15,
          burst.y + Math.sin(spin) * reach * 1.15
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      // The cone runs R_LENGTH out from the origin in one direction; a square that reaches
      // that far in every direction covers it and every burst inside it.
      return this.squareDisplayBoundingBox((R_LENGTH + 60) * 2);
    }
  }
  return Riven_R_WindSlash;
}
const __cacheRiven_R_WindSlash = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_R_WindSlash>>();
export function makeRiven_R_WindSlash(api: ContentApi) {
  const cached = __cacheRiven_R_WindSlash.get(api);
  if (cached) return cached;
  const built = __buildRiven_R_WindSlash(api);
  __cacheRiven_R_WindSlash.set(api, built);
  return built;
}


/**
 * The fragments snapping back together. Attached to the reforge buff, so it lives for
 * exactly as long as the ultimate does and drops the moment the window closes.
 */
function __buildRiven_R_Reforge_Vfx(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const Riven_R_Reforge = makeRiven_R_Reforge(api);
  class Riven_R_Reforge_Vfx extends SpellObject {
    age = 0;
    shards: { angle: number; spread: number; length: number }[] = [];

    constructor(owner: AttackableUnit) {
      super(owner);
      this.position = owner.position.copy();
    }

    onAdded(): void {
      for (const candidate of this.owner.buffs) {
        if (candidate instanceof Riven_R_Reforge) {
          this.attachTo(this.owner, candidate);
          break;
        }
      }
      for (let i = 0; i < 7; i++) {
        this.shards.push({
          angle: (i / 7) * Math.PI * 2,
          spread: 30 + random(0, 26),
          length: 15 + random(0, 12),
        });
      }
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    draw(): void {
      // 0 -> 1 over the snap-together, then a slow orbit for the rest of the ultimate.
      const snap = Math.min(1, this.age / 420);
      const closed = snap * snap;
      const orbit = this.age / 900;
      const bodyRadius = this.owner.animatedValues.displaySize / 2 + 8;

      push();
      strokeWeight(2);
      for (const shard of this.shards) {
        const spin = shard.angle + orbit;
        const out = bodyRadius + shard.spread * (1 - closed) + 4;
        const x = this.position.x + Math.cos(spin) * out;
        const y = this.position.y + Math.sin(spin) * out;
        stroke(RUNE[0], RUNE[1], RUNE[2], 120 + 110 * closed);
        line(
          x,
          y,
          x - Math.cos(spin) * shard.length * (0.4 + 0.6 * closed),
          y - Math.sin(spin) * shard.length * (0.4 + 0.6 * closed)
        );
        noStroke();
        fill(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 90 + 120 * closed);
        circle(x, y, 3 + 2 * closed);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.owner.animatedValues.displaySize / 2 + 80) * 2);
    }
  }
  return Riven_R_Reforge_Vfx;
}
const __cacheRiven_R_Reforge_Vfx = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_R_Reforge_Vfx>>();
export function makeRiven_R_Reforge_Vfx(api: ContentApi) {
  const cached = __cacheRiven_R_Reforge_Vfx.get(api);
  if (cached) return cached;
  const built = __buildRiven_R_Reforge_Vfx(api);
  __cacheRiven_R_Reforge_Vfx.set(api, built);
  return built;
}