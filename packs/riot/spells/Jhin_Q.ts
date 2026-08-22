import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type JhinMarkBuff = InstanceType<ReturnType<typeof makeJhinMarkBuff>>;
type Jhin_Mark_Object = InstanceType<ReturnType<typeof makeJhin_Mark_Object>>;
type Jhin_Q = InstanceType<ReturnType<typeof makeJhin_Q>>;
type Jhin_Q_Blast = InstanceType<ReturnType<typeof makeJhin_Q_Blast>>;
type Jhin_Q_Object = InstanceType<ReturnType<typeof makeJhin_Q_Object>>;



/** How long a lotus mark rides a body. Shared by Q, W and E — defined here, imported there. */
export const JHIN_MARK_MS = 4_000;

export const JHIN_Q_RANGE = 420;

export const JHIN_Q_BOUNCE_RANGE = 300;

export const JHIN_Q_MAX_HITS = 4;

/** The whole mechanic: hit index picks the payload, so the fourth body pays the most. */
export const JHIN_Q_DAMAGE: readonly [number, number, number, number] = [12, 15, 18, 22];

export const JHIN_Q_BLAST_RADIUS = 34;

export const JHIN_Q_BLAST_STEP = 13;


const MAGENTA: [number, number, number] = [232, 67, 147];

const BONE: [number, number, number] = [245, 246, 250];

const MARK_PETALS = 4;

const MARK_ORBIT = 15;

const MARK_FLOAT = 46;


export function jhinBounceDamage(index: number): number {
  const step = Math.min(Math.max(Math.floor(index), 0), JHIN_Q_DAMAGE.length - 1) as 0 | 1 | 2 | 3;
  return JHIN_Q_DAMAGE[step];
}


/**
 * The mark itself. A dedicated class rather than a generic buff, because W asks "is this one
 * marked?" by type and consumes it by hand.
 */
function __buildJhinMarkBuff(api: ContentApi) {
  const Buff = api.buffs.Buff;
  class JhinMarkBuff extends Buff {
    name = 'Dấu Hoa Sen';
    description = 'Bị Jhin ngắm: Nét Vẽ Chết Chóc sẽ trói chân mục tiêu này.';
    stackId = 'jhin_lotus_mark';
  }
  return JhinMarkBuff;
}
const __cacheJhinMarkBuff = new WeakMap<ContentApi, ReturnType<typeof __buildJhinMarkBuff>>();
export function makeJhinMarkBuff(api: ContentApi) {
  const cached = __cacheJhinMarkBuff.get(api);
  if (cached) return cached;
  const built = __buildJhinMarkBuff(api);
  __cacheJhinMarkBuff.set(api, built);
  return built;
}


function __buildfindJhinMark(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const JhinMarkBuff = makeJhinMarkBuff(api);
  function findJhinMark(unit: AttackableUnit): JhinMarkBuff | null {
    for (const buff of unit.buffs) {
      if (buff instanceof JhinMarkBuff && !buff.toRemove) return buff;
    }
    return null;
  }
  return findJhinMark;
}
const __cachefindJhinMark = new WeakMap<ContentApi, ReturnType<typeof __buildfindJhinMark>>();
export function makeFindJhinMark(api: ContentApi) {
  const cached = __cachefindJhinMark.get(api);
  if (cached) return cached;
  const built = __buildfindJhinMark(api);
  __cachefindJhinMark.set(api, built);
  return built;
}


function __buildhasJhinMark(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const findJhinMark = makeFindJhinMark(api);
  function hasJhinMark(unit: AttackableUnit): boolean {
    return findJhinMark(unit) !== null;
  }
  return hasJhinMark;
}
const __cachehasJhinMark = new WeakMap<ContentApi, ReturnType<typeof __buildhasJhinMark>>();
export function makeHasJhinMark(api: ContentApi) {
  const cached = __cachehasJhinMark.get(api);
  if (cached) return cached;
  const built = __buildhasJhinMark(api);
  __cachehasJhinMark.set(api, built);
  return built;
}


/** Returns whether there was a mark to take. W's two outcomes hang off this boolean. */
function __buildconsumeJhinMark(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const findJhinMark = makeFindJhinMark(api);
  function consumeJhinMark(unit: AttackableUnit): boolean {
    const mark = findJhinMark(unit);
    if (!mark) return false;
    mark.deactivateBuff();
    return true;
  }
  return consumeJhinMark;
}
const __cacheconsumeJhinMark = new WeakMap<ContentApi, ReturnType<typeof __buildconsumeJhinMark>>();
export function makeConsumeJhinMark(api: ContentApi) {
  const cached = __cacheconsumeJhinMark.get(api);
  if (cached) return cached;
  const built = __buildconsumeJhinMark(api);
  __cacheconsumeJhinMark.set(api, built);
  return built;
}


function __buildapplyJhinMark(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const JhinMarkBuff = makeJhinMarkBuff(api);
  const findJhinMark = makeFindJhinMark(api);
  const Jhin_Mark_Object = makeJhin_Mark_Object(api);
  function applyJhinMark(source: AttackableUnit, target: AttackableUnit): void {
    const standing = findJhinMark(target);
    if (standing) {
      standing.renewBuff();
      return;
    }
    const mark = new JhinMarkBuff(JHIN_MARK_MS, source, target);
    target.addBuff(mark);
    const lotus = new Jhin_Mark_Object(source, target);
    lotus.attachTo(target, mark);
    source.game.objectManager.addObject(lotus);
  }
  return applyJhinMark;
}
const __cacheapplyJhinMark = new WeakMap<ContentApi, ReturnType<typeof __buildapplyJhinMark>>();
export function makeApplyJhinMark(api: ContentApi) {
  const cached = __cacheapplyJhinMark.get(api);
  if (cached) return cached;
  const built = __buildapplyJhinMark(api);
  __cacheapplyJhinMark.set(api, built);
  return built;
}


function __buildJhin_Q(api: ContentApi) {
  const canSee = api.combat.Vision.canSee;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const TargetResolver = api.combat.TargetResolver;
  const AttackableUnit = api.units.AttackableUnit;
  const Spell = api.Spell;
  const isGrenadeTarget = makeIsGrenadeTarget(api);
  const Jhin_Q_Object = makeJhin_Q_Object(api);
  class Jhin_Q extends Spell {
    image = api.asset('spell_jhin_q');
    name = 'Lựu Đạn Nhảy Múa (Jhin_Q)';
    description = `Ném lựu đạn hoa vào <b>một kẻ địch được chỉ định</b>, rồi nảy sang tối đa
      ${JHIN_Q_MAX_HITS - 1} mục tiêu khác trong bán kính ${JHIN_Q_BOUNCE_RANGE}, mỗi lần nảy
      mạnh hơn lần trước: <span class="damage">${JHIN_Q_DAMAGE.join(' / ')} sát thương</span>.
      Mọi mục tiêu trúng đòn bị <b>đánh dấu</b> trong ${JHIN_MARK_MS / 1000} giây.`;
    coolDown = 8_000;
    manaCost = 30;
    range = JHIN_Q_RANGE;

    /**
     * A named enemy, not a direction. Fired at empty ground this used to fly the
     * full 420, then run `seekNextBody` from wherever it stopped and latch onto
     * the nearest champion within another 300 — a free 720-unit homing missile
     * for a keypress aimed at nothing. Only the *first* body is chosen here; the
     * bounces after it are still proximity off the body it just hit.
     */
    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: this.range,
        // Without this the resolver defaults to 'ANY', and a cursor on empty
        // ground resolves the caster — Jhin grenading himself.
        targetTeam: 'ENEMY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => isGrenadeTarget(candidate),
        getTargetInfo: candidate =>
          isGrenadeTarget(candidate)
            ? {
                position: candidate.position,
                teamId: candidate.teamId,
                selectionRadius: candidate.animatedValues?.displaySize
                  ? candidate.animatedValues.displaySize / 2
                  : candidate.collisionRadius,
              }
            : null,
      };
    }

    press(context: CastContext): boolean {
      if (context.target !== undefined) return super.press(context);

      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    checkCastCondition(): boolean {
      return this.isValidTarget(this.castContext?.target);
    }

    onSpellCast(context?: CastContext): void {
      const target = context?.target ?? this.castContext?.target;
      if (!this.isValidTarget(target)) return;

      const grenade = new Jhin_Q_Object(this.owner);
      grenade.destination = createVector(target.position.x, target.position.y);
      grenade.chasing = target;
      this.game.objectManager.addObject(grenade);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private isValidTarget(target: unknown): target is AttackableUnit {
      return (
        isGrenadeTarget(target) &&
        target !== this.owner &&
        target.teamId !== this.owner.teamId &&
        canSee(this.owner, target) &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Jhin_Q;
}
const __cacheJhin_Q = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_Q>>();
export default function makeJhin_Q(api: ContentApi) {
  const cached = __cacheJhin_Q.get(api);
  if (cached) return cached;
  const built = __buildJhin_Q(api);
  __cacheJhin_Q.set(api, built);
  return built;
}


function __buildisGrenadeTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isGrenadeTarget = (target: unknown): target is AttackableUnit =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove && !target.isDead;
  return isGrenadeTarget;
}
const __cacheisGrenadeTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisGrenadeTarget>>();
export function makeIsGrenadeTarget(api: ContentApi) {
  const cached = __cacheisGrenadeTarget.get(api);
  if (cached) return cached;
  const built = __buildisGrenadeTarget(api);
  __cacheisGrenadeTarget.set(api, built);
  return built;
}


/**
 * Chases the enemy Jhin named, then bounces. Each landed hit re-aims it at the nearest body it
 * has not struck yet; the payload climbs with the hit index and the blast grows to match.
 *
 * Arriving on nothing is the end of it. Hunting from the point it stopped at is what made this
 * castable at empty ground for a guaranteed hit, so `onArrive` expires rather than seeking.
 */
function __buildJhin_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const TrailSystem = api.helpers.TrailSystem;
  const MissileSpellObject = api.MissileSpellObject;
  const applyJhinMark = makeApplyJhinMark(api);
  const Jhin_Q_Blast = makeJhin_Q_Blast(api);
  class Jhin_Q_Object extends MissileSpellObject {
    speed = 10;
    size = 22;
    maxHitCount = JHIN_Q_MAX_HITS;
    removeOnArrive = false;
    hits = 0;
    age = 0;
    /** The body it is flying at right now — the named target, then each bounce. */
    chasing: AttackableUnit | null = null;
    struck = new Set<AttackableUnit>();
    blades: { phase: number; tilt: number }[] = [];
    trailSystem = new TrailSystem({
      trailSize: this.size * 0.5,
      trailColor: '#e8439399',
      trailLifeTime: 240,
    });

    onAdded(): void {
      super.onAdded();
      for (let i = 0; i < MARK_PETALS; i++) {
        this.blades.push({ phase: random(0, TWO_PI), tilt: random(0.7, 1.3) });
      }
    }

    /** Track the body it is chasing, so a walking target is still hit. */
    onBeforeMove(): void {
      const chased = this.chasing;
      if (chased && !chased.isDead && !chased.toRemove) {
        this.destination = createVector(chased.position.x, chased.position.y);
      }
    }

    onAfterMove(): void {
      this.age += deltaTime;
    }

    onHit(enemy: AttackableUnit): void {
      if (this.hits >= JHIN_Q_MAX_HITS) return;
      if (this.struck.has(enemy)) return;
      const index = this.hits;
      this.hits += 1;
      this.struck.add(enemy);

      enemy.takeDamage(jhinBounceDamage(index), this.owner);
      applyJhinMark(this.owner, enemy);
      this.game.objectManager.addObject(new Jhin_Q_Blast(this.owner, enemy.position.copy(), index));

      if (!this.seekNextBody(enemy)) this.toRemove = true;
    }

    /** It reached where it was aimed and hit nobody. That is a miss, not a new search. */
    onArrive(): void {
      this.toRemove = true;
    }

    /**
     * The next bounce, measured from the body just struck. Picks one unit out of many, so the
     * query is gated on what Jhin can actually see.
     */
    seekNextBody(from: AttackableUnit): boolean {
      if (this.hits >= JHIN_Q_MAX_HITS) return false;
      const centre = from.position;
      const spent: AttackableUnit[] = [];
      for (const done of this.struck) spent.push(done);

      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: centre.x, y: centre.y, r: JHIN_Q_BOUNCE_RANGE }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
          PredefinedFilters.excludeObjects(spent),
        ],
      }) as AttackableUnit[];

      let chosen: AttackableUnit | null = null;
      let nearestDistance = Infinity;
      for (const candidate of candidates) {
        if (this.struck.has(candidate)) continue;
        const gap = candidate.position.dist(centre);
        if (gap >= nearestDistance) continue;
        nearestDistance = gap;
        chosen = candidate;
      }
      if (!chosen) return false;
      this.chasing = chosen;
      this.destination = chosen.position.copy();
      return true;
    }

    draw(): void {
      const spin = this.age / 90;
      const heading = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      push();
      translate(this.position.x, this.position.y);
      rotate(heading + spin);
      noStroke();
      for (let i = 0; i < this.blades.length; i++) {
        const blade = this.blades[i];
        const reach = this.size * 0.6 * (0.8 + 0.2 * sin(blade.phase + spin * blade.tilt));
        push();
        rotate((i * TWO_PI) / this.blades.length);
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 230);
        triangle(0, 0, reach, -reach * 0.36, reach, reach * 0.36);
        pop();
      }
      fill(BONE[0], BONE[1], BONE[2], 240);
      circle(0, 0, this.size * 0.34);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.size * 3);
    }
  }
  return Jhin_Q_Object;
}
const __cacheJhin_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_Q_Object>>();
export function makeJhin_Q_Object(api: ContentApi) {
  const cached = __cacheJhin_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildJhin_Q_Object(api);
  __cacheJhin_Q_Object.set(api, built);
  return built;
}


/** The blast on the body that took the hit. Bigger and brighter every bounce. */
function __buildJhin_Q_Blast(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Jhin_Q_Blast extends SpellObject {
    lifeTime = 340;
    age = 0;
    index: number;
    radius: number;
    shards: { angle: number; stretch: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector, index: number) {
      super(owner);
      this.position = at;
      this.index = index;
      this.radius = JHIN_Q_BLAST_RADIUS + index * JHIN_Q_BLAST_STEP;
    }

    onAdded(): void {
      const count = MARK_PETALS * (this.index + 1);
      for (let i = 0; i < count; i++) {
        this.shards.push({
          angle: (i * TWO_PI) / count + random(-0.14, 0.14),
          stretch: random(0.6, 1),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      // Escalation made visible: the later the bounce, the whiter and heavier the rim.
      const glare = 120 + this.index * 40;

      push();
      noFill();
      stroke(BONE[0], BONE[1], BONE[2], glare * fade);
      strokeWeight(1 + this.index * 0.9);
      // the hard rim sits on the radius the blast really claims
      circle(this.position.x, this.position.y, this.radius * 2 * opened);

      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 220 * fade);
      strokeWeight(2 + this.index * 0.6);
      for (const shard of this.shards) {
        const inner = this.radius * 0.35 * opened;
        const outer = this.radius * shard.stretch * opened;
        line(
          this.position.x + cos(shard.angle) * inner,
          this.position.y + sin(shard.angle) * inner,
          this.position.x + cos(shard.angle) * outer,
          this.position.y + sin(shard.angle) * outer
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 24) * 2);
    }
  }
  return Jhin_Q_Blast;
}
const __cacheJhin_Q_Blast = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_Q_Blast>>();
export function makeJhin_Q_Blast(api: ContentApi) {
  const cached = __cacheJhin_Q_Blast.get(api);
  if (cached) return cached;
  const built = __buildJhin_Q_Blast(api);
  __cacheJhin_Q_Blast.set(api, built);
  return built;
}


/**
 * The mark's own art: a four-petal lotus turning over the victim's head. It rides the body and
 * dies with the buff, so W's condition is readable from across the screen.
 */
function __buildJhin_Mark_Object(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Jhin_Mark_Object extends SpellObject {
    markTarget: AttackableUnit;
    age = 0;
    radius = MARK_FLOAT + MARK_ORBIT;
    petals: { phase: number; sway: number }[] = [];

    constructor(owner: AttackableUnit, target: AttackableUnit) {
      super(owner);
      this.markTarget = target;
      this.position = target.position.copy();
    }

    onAdded(): void {
      for (let i = 0; i < MARK_PETALS; i++) {
        this.petals.push({ phase: random(0, TWO_PI), sway: random(0.8, 1.2) });
      }
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.markTarget.position.x, this.markTarget.position.y);
    }

    draw(): void {
      const spin = this.age / 520;
      const cx = this.position.x;
      const cy = this.position.y - MARK_FLOAT;

      push();
      translate(cx, cy);
      noStroke();
      for (let i = 0; i < this.petals.length; i++) {
        const petal = this.petals[i];
        const reach = MARK_ORBIT * (0.82 + 0.18 * sin(petal.phase + spin * 3 * petal.sway));
        push();
        rotate(spin + (i * TWO_PI) / this.petals.length);
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 225);
        triangle(0, 0, reach, -reach * 0.34, reach, reach * 0.34);
        pop();
      }
      fill(BONE[0], BONE[1], BONE[2], 235);
      circle(0, 0, 5);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((MARK_FLOAT + MARK_ORBIT + 10) * 2);
    }
  }
  return Jhin_Mark_Object;
}
const __cacheJhin_Mark_Object = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_Mark_Object>>();
export function makeJhin_Mark_Object(api: ContentApi) {
  const cached = __cacheJhin_Mark_Object.get(api);
  if (cached) return cached;
  const built = __buildJhin_Mark_Object(api);
  __cacheJhin_Mark_Object.set(api, built);
  return built;
}