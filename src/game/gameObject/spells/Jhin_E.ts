import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastSpec } from '../../spell/runtime/types';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Slow from '../buffs/Slow';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import { applyJhinMark, JHIN_MARK_MS } from './Jhin_Q';

export const JHIN_E_DAMAGE = 18;
export const JHIN_E_RANGE = 400;
export const JHIN_E_ARM_MS = 750;
export const JHIN_E_LIFETIME_MS = 20_000;
export const JHIN_E_TRIGGER_RADIUS = 90;
export const JHIN_E_SLOW = 0.6;
export const JHIN_E_SLOW_MS = 2_000;
export const JHIN_E_MAX_TRAPS = 3;

const MAGENTA: [number, number, number] = [232, 67, 147];
const BONE: [number, number, number] = [245, 246, 250];
const TRAP_PETALS = 4;
/** Ground art sits below champions — Z_INDEX_MAP is keyed by exact constructor, so say it here. */
const GROUND_Z_INDEX = 2;

/** Every live trap in the match, so one Jhin's fourth planting evicts his own oldest. */
const plantedTraps: Jhin_E_Trap[] = [];

function registerTrap(trap: Jhin_E_Trap): void {
  for (let i = plantedTraps.length - 1; i >= 0; i--) {
    const known = plantedTraps[i];
    if (!known || known.toRemove) plantedTraps.splice(i, 1);
  }
  plantedTraps.push(trap);

  const mine: Jhin_E_Trap[] = [];
  for (const known of plantedTraps) {
    if (known.owner === trap.owner) mine.push(known);
  }
  while (mine.length > JHIN_E_MAX_TRAPS) {
    const oldest = mine.shift();
    if (!oldest) break;
    oldest.toRemove = true;
    const at = plantedTraps.indexOf(oldest);
    if (at >= 0) plantedTraps.splice(at, 1);
  }
}

function releaseTrap(trap: Jhin_E_Trap): void {
  const at = plantedTraps.indexOf(trap);
  if (at >= 0) plantedTraps.splice(at, 1);
}

export default class Jhin_E extends Spell {
  image = AssetManager.get('spell_jhin_e');
  name = 'Cạm Bẫy Nghệ Thuật (Jhin_E)';
  description = `Đặt một bông sen bẫy, mở cánh sau ${JHIN_E_ARM_MS / 1000} giây và chờ
    ${JHIN_E_LIFETIME_MS / 1000} giây. Kẻ địch bước vào bán kính ${JHIN_E_TRIGGER_RADIUS} nhận
    <span class="damage">${JHIN_E_DAMAGE} sát thương</span>, bị làm chậm
    ${JHIN_E_SLOW * 100}% trong ${JHIN_E_SLOW_MS / 1000} giây và bị <b>đánh dấu</b>
    ${JHIN_MARK_MS / 1000} giây. Tối đa ${JHIN_E_MAX_TRAPS} bẫy cùng lúc.`;
  coolDown = 9_000;
  manaCost = 25;
  range = JHIN_E_RANGE;

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
    this.game.objectManager.addObject(new Jhin_E_Trap(this.owner, to.copy()));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * A closed bud while it arms, an open lotus once it can bite — two behaviours, two pictures.
 * The trigger radius is only drawn on the armed one, at exactly the radius that triggers.
 */
export class Jhin_E_Trap extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  radius = JHIN_E_TRIGGER_RADIUS;
  age = 0;
  triggered = false;
  petals: { lean: number; curl: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
    registerTrap(this);
  }

  get armed(): boolean {
    return this.age >= JHIN_E_ARM_MS;
  }

  onAdded(): void {
    for (let i = 0; i < TRAP_PETALS; i++) {
      this.petals.push({ lean: random(-0.16, 0.16), curl: random(0.85, 1.15) });
    }
  }

  onRemoved(): void {
    releaseTrap(this);
    super.onRemoved();
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= JHIN_E_ARM_MS + JHIN_E_LIFETIME_MS) {
      this.toRemove = true;
      return;
    }
    if (!this.armed || this.triggered) return;

    // A trap triggers on whoever stands on it, lit or not: proximity, not acquisition.
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: JHIN_E_TRIGGER_RADIUS,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of victims) {
      this.spring(victim);
      return;
    }
  }

  spring(victim: AttackableUnit): void {
    if (this.triggered) return;
    this.triggered = true;

    victim.takeDamage(JHIN_E_DAMAGE, this.owner);
    const slow = new Slow(JHIN_E_SLOW_MS, this.owner, victim);
    slow.percent = JHIN_E_SLOW;
    slow.stackId = 'jhin_trap_slow';
    victim.addBuff(slow);
    applyJhinMark(this.owner, victim);

    this.game.objectManager.addObject(new Jhin_E_Bloom(this.owner, victim.position.copy()));
    this.toRemove = true;
  }

  draw(): void {
    const unfolded = constrain(this.age / JHIN_E_ARM_MS, 0, 1);
    const opened = 1 - (1 - unfolded) * (1 - unfolded);
    const breath = this.armed ? 0.9 + 0.1 * sin(this.age / 420) : 1;

    push();
    translate(this.position.x, this.position.y);

    if (this.armed) {
      // the thin four-lobed outline peaks at exactly the radius that fires the trap
      noFill();
      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 130);
      strokeWeight(1);
      beginShape();
      for (let step = 0; step <= 72; step++) {
        const angle = (step / 72) * TWO_PI;
        const reach = JHIN_E_TRIGGER_RADIUS * (0.86 + 0.14 * cos(angle * 4)) * breath;
        vertex(cos(angle) * reach, sin(angle) * reach);
      }
      endShape(CLOSE);
    }

    noStroke();
    for (let i = 0; i < this.petals.length; i++) {
      const petal = this.petals[i];
      // a closed bud folds its petals inward; an open lotus lays them flat
      const reach = 13 + 17 * opened * petal.curl;
      const fold = (1 - opened) * 0.7;
      push();
      rotate((i * TWO_PI) / this.petals.length + petal.lean + fold);
      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], this.armed ? 215 : 150);
      triangle(0, 0, reach, -reach * (0.2 + 0.2 * opened), reach, reach * (0.2 + 0.2 * opened));
      pop();
    }
    fill(BONE[0], BONE[1], BONE[2], this.armed ? 235 : 170);
    circle(0, 0, 7 + 3 * opened);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((JHIN_E_TRIGGER_RADIUS + 16) * 2);
  }
}

/** The trap going off, on the body that stepped in it. */
export class Jhin_E_Bloom extends SpellObject {
  lifeTime = 460;
  age = 0;
  radius = JHIN_E_TRIGGER_RADIUS;
  petals: { angle: number; reach: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    for (let i = 0; i < TRAP_PETALS * 3; i++) {
      this.petals.push({
        angle: (i * TWO_PI) / (TRAP_PETALS * 3),
        reach: random(0.55, 1),
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

    push();
    noFill();
    stroke(BONE[0], BONE[1], BONE[2], 200 * fade);
    strokeWeight(2 * fade + 1);
    circle(this.position.x, this.position.y, this.radius * 2 * opened);
    noStroke();
    for (const petal of this.petals) {
      const reach = this.radius * petal.reach * opened;
      push();
      translate(
        this.position.x + cos(petal.angle) * reach,
        this.position.y + sin(petal.angle) * reach
      );
      rotate(petal.angle);
      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 225 * fade);
      triangle(0, 0, 13 * fade + 3, -5, 13 * fade + 3, 5);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 22) * 2);
  }
}
