import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastSpec } from '../../spell/runtime/types';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Root from '../buffs/Root';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import {
  beamBoundingBox,
  intersectsBeam,
  type BeamGeometry,
} from '../spellObjects/BeamSpellObject';
import { consumeJhinMark } from './Jhin_Q';

export const JHIN_W_DAMAGE = 22;
export const JHIN_W_RANGE = 520;
export const JHIN_W_WIDTH = 40;
export const JHIN_W_ROOT_MS = 1_200;
export const JHIN_W_CAST_MS = 300;

const MAGENTA: [number, number, number] = [232, 67, 147];
const BONE: [number, number, number] = [245, 246, 250];
const SIGHT_LINES = 4;
const SHOT_LIFE_MS = 260;

export default class Jhin_W extends Spell {
  image = AssetManager.get('spell_jhin_w');
  name = 'Nét Vẽ Chết Chóc (Jhin_W)';
  description = `Nâng súng trong ${JHIN_W_CAST_MS / 1000} giây rồi bắn một phát xuyên thẳng
    ${JHIN_W_RANGE} đơn vị, gây <span class="damage">${JHIN_W_DAMAGE} sát thương</span> cho mọi
    kẻ địch trên đường đạn. Mục tiêu đang bị <b>đánh dấu</b> bị trói chân
    ${JHIN_W_ROOT_MS / 1000} giây và mất dấu.`;
  coolDown = 10_000;
  manaCost = 40;
  range = JHIN_W_RANGE;

  private telegraph: Jhin_W_Telegraph | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: JHIN_W_CAST_MS,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  /** Exactly where the shot will end, so the telegraph cannot lie about its reach. */
  beamEnd(): p5.Vector {
    const reach = effectiveRange(JHIN_W_RANGE, this.owner);
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, reach);
    return to.copy();
  }

  onCastStart(): void {
    const sight = new Jhin_W_Telegraph(this.owner, () => this.beamEnd());
    this.telegraph = sight;
    this.game.objectManager.addObject(sight);
  }

  onCancel(): void {
    this.dropTelegraph();
  }

  onSpellCast(): void {
    this.dropTelegraph();

    const start = this.owner.position.copy();
    const end = this.beamEnd();
    const geometry: BeamGeometry = {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      width: JHIN_W_WIDTH,
    };

    this.game.objectManager.addObject(new Jhin_W_Shot(this.owner, start, end));

    // Area damage: it hits the body in the unlit bush too, so no sight filter here.
    const swept = new Set<AttackableUnit>();
    const candidates = this.game.objectManager.queryObjects({
      area: beamBoundingBox(geometry, this),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      if (swept.has(victim)) continue;
      if (!intersectsBeam(victim, geometry)) continue;
      swept.add(victim);

      victim.takeDamage(JHIN_W_DAMAGE, this.owner);
      const wasMarked = consumeJhinMark(victim);
      if (wasMarked) victim.addBuff(new Root(JHIN_W_ROOT_MS, this.owner, victim));
      this.game.objectManager.addObject(
        new Jhin_W_Impact(this.owner, victim.position.copy(), wasMarked)
      );
    }
  }

  private dropTelegraph(): void {
    if (!this.telegraph) return;
    this.telegraph.toRemove = true;
    this.telegraph = null;
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The windup. Four thin sight lines converge on the firing axis over the cast time, drawn to
 * exactly the range the shot will cover — that number is the entire threat.
 */
export class Jhin_W_Telegraph extends SpellObject {
  lifeTime = JHIN_W_CAST_MS;
  age = 0;
  range = JHIN_W_RANGE;
  end: p5.Vector;
  private aimAt: () => p5.Vector;

  constructor(owner: AttackableUnit, aimAt: () => p5.Vector) {
    super(owner);
    this.aimAt = aimAt;
    this.end = aimAt();
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.end = this.aimAt();
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    // wind-in: the four lines start wide and pinch onto the axis
    const spread = (1 - t * t) * JHIN_W_WIDTH * 1.4 + 1;
    const heading = Math.atan2(this.end.y - this.position.y, this.end.x - this.position.x);
    const span = Math.hypot(this.end.x - this.position.x, this.end.y - this.position.y);

    push();
    translate(this.position.x, this.position.y);
    rotate(heading);
    for (let i = 0; i < SIGHT_LINES; i++) {
      const side = i < SIGHT_LINES / 2 ? -1 : 1;
      const rank = i % (SIGHT_LINES / 2);
      const offset = side * spread * (0.45 + rank * 0.55);
      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 90 + 120 * t);
      strokeWeight(1);
      line(0, offset, span, offset * 0.15);
    }
    stroke(BONE[0], BONE[1], BONE[2], 70 + 90 * t);
    strokeWeight(1);
    line(0, 0, span, 0);
    noFill();
    stroke(BONE[0], BONE[1], BONE[2], 150 * t);
    circle(span, 0, 10 + 14 * (1 - t));
    pop();
  }

  getDisplayBoundingBox() {
    return jhinBeamDisplayBox(this.position, this.end, JHIN_W_WIDTH, this);
  }
}

/** The shot itself: a bone-white line inside a magenta wash, spanning the whole range. */
export class Jhin_W_Shot extends SpellObject {
  lifeTime = SHOT_LIFE_MS;
  age = 0;
  range = JHIN_W_RANGE;
  start: p5.Vector;
  end: p5.Vector;
  flecks: { at: number; drift: number }[] = [];

  constructor(owner: AttackableUnit, start: p5.Vector, end: p5.Vector) {
    super(owner);
    this.start = start;
    this.end = end;
    this.position = start.copy();
  }

  onAdded(): void {
    for (let i = 0; i < 8; i++) {
      this.flecks.push({ at: random(0.1, 0.95), drift: random(-1, 1) });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const heading = Math.atan2(this.end.y - this.start.y, this.end.x - this.start.x);
    const span = Math.hypot(this.end.x - this.start.x, this.end.y - this.start.y);

    push();
    translate(this.start.x, this.start.y);
    rotate(heading);
    noStroke();
    fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 110 * fade);
    rect(0, -JHIN_W_WIDTH / 2, span, JHIN_W_WIDTH);
    stroke(BONE[0], BONE[1], BONE[2], 240 * fade);
    strokeWeight(3 * fade + 1);
    line(0, 0, span, 0);
    noStroke();
    for (const fleck of this.flecks) {
      const reach = span * fleck.at;
      const swept = fleck.drift * JHIN_W_WIDTH * 0.5 * t;
      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 200 * fade);
      circle(reach, swept, 4 * fade + 1);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return jhinBeamDisplayBox(this.start, this.end, JHIN_W_WIDTH, this);
  }
}

/**
 * Two outcomes, two pictures. A rooted body's lotus shatters into petals at its feet; an
 * unmarked one only takes a thin cut across the firing line.
 */
export class Jhin_W_Impact extends SpellObject {
  lifeTime = 420;
  age = 0;
  rooted: boolean;
  radius: number;
  petals: { angle: number; fall: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector, rooted: boolean) {
    super(owner);
    this.position = at;
    this.rooted = rooted;
    this.radius = rooted ? 54 : 26;
  }

  onAdded(): void {
    const count = this.rooted ? 8 : 3;
    for (let i = 0; i < count; i++) {
      this.petals.push({ angle: (i * TWO_PI) / count + random(-0.2, 0.2), fall: random(0.6, 1) });
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

    push();
    if (this.rooted) {
      // the mark's lotus coming apart on the ground, at the radius the root claims
      noFill();
      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 210 * fade);
      strokeWeight(2);
      circle(this.position.x, this.position.y, this.radius * 2 * opened);
      noStroke();
      for (const petal of this.petals) {
        const reach = this.radius * petal.fall * opened;
        const px = this.position.x + cos(petal.angle) * reach;
        const py = this.position.y + sin(petal.angle) * reach + this.radius * 0.4 * t;
        push();
        translate(px, py);
        rotate(petal.angle + t * 2);
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 235 * fade);
        triangle(0, 0, 11, -4, 11, 4);
        pop();
      }
    } else {
      stroke(BONE[0], BONE[1], BONE[2], 220 * fade);
      strokeWeight(2 * fade + 1);
      for (const petal of this.petals) {
        const reach = this.radius * petal.fall * opened;
        line(
          this.position.x - cos(petal.angle) * reach * 0.3,
          this.position.y - sin(petal.angle) * reach * 0.3,
          this.position.x + cos(petal.angle) * reach,
          this.position.y + sin(petal.angle) * reach
        );
      }
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 20) * 2);
  }
}

/**
 * A beam's box is not a square around its own centre, so it is built by hand from the two
 * endpoints — padded for the wash and the muzzle bloom.
 */
export function jhinBeamDisplayBox(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  data: unknown
) {
  const pad = width;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const span = Math.max(Math.hypot(dx, dy), 1);
  return beamBoundingBox(
    {
      start: { x: start.x - (dx / span) * pad, y: start.y - (dy / span) * pad },
      end: { x: end.x + (dx / span) * pad, y: end.y + (dy / span) * pad },
      width: width + pad * 2,
    },
    data
  );
}
