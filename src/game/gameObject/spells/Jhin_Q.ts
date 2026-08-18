import { Circle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import VectorUtils from '@/utils/vector.utils';
import { effectiveRange } from '@/game/combat/Reach';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type { CastSpec } from '@/game/spell/runtime/types';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Buff from '@/game/gameObject/Buff';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';

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
export class JhinMarkBuff extends Buff {
  name = 'Dấu Hoa Sen';
  description = 'Bị Jhin ngắm: Nét Vẽ Chết Chóc sẽ trói chân mục tiêu này.';
  stackId = 'jhin_lotus_mark';
}

export function findJhinMark(unit: AttackableUnit): JhinMarkBuff | null {
  for (const buff of unit.buffs) {
    if (buff instanceof JhinMarkBuff && !buff.toRemove) return buff;
  }
  return null;
}

export function hasJhinMark(unit: AttackableUnit): boolean {
  return findJhinMark(unit) !== null;
}

/** Returns whether there was a mark to take. W's two outcomes hang off this boolean. */
export function consumeJhinMark(unit: AttackableUnit): boolean {
  const mark = findJhinMark(unit);
  if (!mark) return false;
  mark.deactivateBuff();
  return true;
}

export function applyJhinMark(source: AttackableUnit, target: AttackableUnit): void {
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

export default class Jhin_Q extends Spell {
  image = AssetManager.get('spell_jhin_q');
  name = 'Lựu Đạn Nhảy Múa (Jhin_Q)';
  description = `Bắn một viên đạn hoa nảy qua tối đa ${JHIN_Q_MAX_HITS} mục tiêu, mỗi lần nảy
    mạnh hơn lần trước: <span class="damage">${JHIN_Q_DAMAGE.join(' / ')} sát thương</span>.
    Mọi mục tiêu trúng đòn bị <b>đánh dấu</b> trong ${JHIN_MARK_MS / 1000} giây.`;
  coolDown = 8_000;
  manaCost = 30;
  range = JHIN_Q_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'POINT',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      effectiveRange(this.range, this.owner)
    );
    const grenade = new Jhin_Q_Object(this.owner);
    grenade.destination = to.copy();
    this.game.objectManager.addObject(grenade);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * Flies to the aimed point, then hunts. Each landed hit re-aims it at the nearest body it has
 * not struck yet; the payload climbs with the hit index and the blast grows to match.
 */
export class Jhin_Q_Object extends MissileSpellObject {
  speed = 10;
  size = 22;
  maxHitCount = JHIN_Q_MAX_HITS;
  removeOnArrive = false;
  hits = 0;
  age = 0;
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

  onArrive(): void {
    if (!this.seekNextBody(null)) this.toRemove = true;
  }

  /** Picks one body out of many, so the query is gated on what Jhin can actually see. */
  seekNextBody(from: AttackableUnit | null): boolean {
    if (this.hits >= JHIN_Q_MAX_HITS) return false;
    const centre = from ? from.position : this.position;
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

/** The blast on the body that took the hit. Bigger and brighter every bounce. */
export class Jhin_Q_Blast extends SpellObject {
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

/**
 * The mark's own art: a four-petal lotus turning over the victim's head. It rides the body and
 * dies with the buff, so W's condition is readable from across the screen.
 */
export class Jhin_Mark_Object extends SpellObject {
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
