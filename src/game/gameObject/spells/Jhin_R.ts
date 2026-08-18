import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import { SpellForm } from '../../spell/runtime/CancelPolicy';
import type { CastSpec } from '../../spell/runtime/types';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Slow from '../buffs/Slow';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import {
  beamBoundingBox,
  intersectsBeam,
  type BeamGeometry,
} from '../spellObjects/BeamSpellObject';
import { jhinBeamDisplayBox } from './Jhin_W';

export const JHIN_R_WINDOW_MS = 6_000;
export const JHIN_R_SHOTS = 4;
export const JHIN_R_SHOT_GAP_MS = 500;
export const JHIN_R_SELF_SLOW = 0.4;
export const JHIN_R_RANGE = 700;
export const JHIN_R_WIDTH = 30;
export const JHIN_R_DAMAGE = 12;
export const JHIN_R_FINAL_DAMAGE = 40;
export const JHIN_R_SLOW = 0.4;
export const JHIN_R_SLOW_MS = 1_000;

const MAGENTA: [number, number, number] = [232, 67, 147];
const BONE: [number, number, number] = [245, 246, 250];
const PETAL_ORBIT = 52;

export default class Jhin_R extends Spell {
  image = AssetManager.get('spell_jhin_r');
  name = 'Sân Khấu Tử Thần (Jhin_R)';
  description = `Dựng sân khấu trong ${JHIN_R_WINDOW_MS / 1000} giây: Jhin bị làm chậm
    ${JHIN_R_SELF_SLOW * 100}% và có ${JHIN_R_SHOTS} phát đạn, mỗi lần kích hoạt lại bắn một
    phát dài ${JHIN_R_RANGE} đơn vị vào kẻ địch đầu tiên trên đường đạn.
    <span class="damage">${JHIN_R_DAMAGE} sát thương</span> cho ba phát đầu và
    <span class="damage">${JHIN_R_FINAL_DAMAGE} sát thương</span> cho phát cuối, làm chậm
    ${JHIN_R_SLOW * 100}% trong ${JHIN_R_SLOW_MS / 1000} giây.`;
  coolDown = 10_000;
  manaCost = 100;
  range = JHIN_R_RANGE;

  performing = false;
  shotsFired = 0;
  windowElapsedMs = 0;
  lastShotAtMs = -JHIN_R_SHOT_GAP_MS;

  private selfSlow: Slow | null = null;
  private petals: Jhin_R_Petals | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'DIRECTION',
      active: { maxDurationMs: JHIN_R_WINDOW_MS, recastDelayMs: JHIN_R_SHOT_GAP_MS },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      // He is set up, not running: walking is part of the gesture, so AIMED rather than HELD.
      interrupts: SpellForm.AIMED,
    };
  }

  /** The remaining shots are the whole tension of the ability, so the HUD icon carries them. */
  get stackCount(): number | undefined {
    if (!this.performing) return undefined;
    return JHIN_R_SHOTS - this.shotsFired;
  }

  get shotsRemaining(): number {
    return Math.max(JHIN_R_SHOTS - this.shotsFired, 0);
  }

  onActivate(): void {
    this.openCurtain();
  }

  onRecast(): void {
    this.fireShot();
  }

  onCancel(): void {
    this.closeCurtain();
  }

  onComplete(): void {
    this.closeCurtain();
  }

  onRemoved(): void {
    this.closeCurtain();
    super.onRemoved();
  }

  deactivate(): void {
    this.closeCurtain();
    super.deactivate();
  }

  onUpdate(): void {
    if (!this.performing) return;
    this.windowElapsedMs += deltaTime;
    if (this.windowElapsedMs >= JHIN_R_WINDOW_MS) this.closeCurtain();
  }

  private openCurtain(): void {
    if (this.performing) return;
    this.performing = true;
    this.shotsFired = 0;
    this.windowElapsedMs = 0;
    // the first recast may fire at once; every later one waits out the gap
    this.lastShotAtMs = -JHIN_R_SHOT_GAP_MS;

    const setup = new Slow(JHIN_R_WINDOW_MS, this.owner, this.owner);
    setup.percent = JHIN_R_SELF_SLOW;
    setup.stackId = 'jhin_curtain_call_setup';
    this.selfSlow = setup;
    this.owner.addBuff(setup);

    const petals = new Jhin_R_Petals(this.owner, this);
    petals.attachTo(this.owner);
    this.petals = petals;
    this.game.objectManager.addObject(petals);
  }

  /** Idempotent: the window lapsing and the fourth shot both land here. */
  private closeCurtain(): void {
    if (!this.performing) return;
    this.performing = false;
    if (this.selfSlow) {
      this.selfSlow.deactivateBuff();
      this.selfSlow = null;
    }
    if (this.petals) {
      this.petals.toRemove = true;
      this.petals = null;
    }
  }

  private fireShot(): void {
    if (!this.performing) return;
    if (this.shotsFired >= JHIN_R_SHOTS) return;
    if (this.windowElapsedMs - this.lastShotAtMs < JHIN_R_SHOT_GAP_MS) return;
    this.lastShotAtMs = this.windowElapsedMs;
    this.shotsFired += 1;

    const finale = this.shotsFired >= JHIN_R_SHOTS;
    const payload = finale ? JHIN_R_FINAL_DAMAGE : JHIN_R_DAMAGE;

    const start = this.owner.position.copy();
    const reach = effectiveRange(JHIN_R_RANGE, this.owner);
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, reach);
    const geometry: BeamGeometry = {
      start: { x: start.x, y: start.y },
      end: { x: to.x, y: to.y },
      width: JHIN_R_WIDTH,
    };

    // The shot stops on one body, so this query picks a victim — it is gated on sight.
    const candidates = this.game.objectManager.queryObjects({
      area: beamBoundingBox(geometry, this),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.visibleTo(this.owner),
      ],
    }) as AttackableUnit[];

    let struck: AttackableUnit | null = null;
    let nearestDistance = Infinity;
    for (const candidate of candidates) {
      if (!intersectsBeam(candidate, geometry)) continue;
      const gap = candidate.position.dist(start);
      if (gap >= nearestDistance) continue;
      nearestDistance = gap;
      struck = candidate;
    }

    const stopAt = struck ? struck.position.copy() : to.copy();
    this.game.objectManager.addObject(new Jhin_R_Beam(this.owner, start, stopAt, finale));

    if (struck) {
      struck.takeDamage(payload, this.owner);
      const slow = new Slow(JHIN_R_SLOW_MS, this.owner, struck);
      slow.percent = JHIN_R_SLOW;
      slow.stackId = 'jhin_curtain_call_slow';
      struck.addBuff(slow);
      this.game.objectManager.addObject(
        new Jhin_R_Bloom(this.owner, struck.position.copy(), finale)
      );
    }

    if (finale) this.closeCurtain();
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The shot count, drawn where the player is already looking: four petals around Jhin, one
 * falling away per shot fired.
 */
export class Jhin_R_Petals extends SpellObject {
  radius = PETAL_ORBIT;
  age = 0;
  private spell: Jhin_R;
  private fallen: number[] = [];

  constructor(owner: AttackableUnit, spell: Jhin_R) {
    super(owner);
    this.spell = spell;
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    const gone = JHIN_R_SHOTS - this.spell.shotsRemaining;
    while (this.fallen.length < gone) this.fallen.push(0);
    for (let i = 0; i < this.fallen.length; i++) {
      this.fallen[i] = Math.min(this.fallen[i] + deltaTime, 600);
    }
    if (!this.spell.performing) this.toRemove = true;
  }

  draw(): void {
    const drift = sin(this.age / 700) * 0.12;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    for (let i = 0; i < JHIN_R_SHOTS; i++) {
      const spent = i < this.fallen.length ? constrain(this.fallen[i] / 600, 0, 1) : 0;
      if (spent >= 1) continue;
      const reach = PETAL_ORBIT + spent * 46;
      const fade = 1 - spent;
      push();
      rotate((i * TWO_PI) / JHIN_R_SHOTS + drift + spent * 1.6);
      translate(reach, 0);
      rotate(spent * 2.4);
      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 235 * fade);
      triangle(-9, 0, 9, -6, 9, 6);
      fill(BONE[0], BONE[1], BONE[2], 200 * fade);
      triangle(-3, 0, 8, -2, 8, 2);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((PETAL_ORBIT + 60) * 2);
  }
}

/** One shot's line. The fourth is visibly heavier than the three that set it up. */
export class Jhin_R_Beam extends SpellObject {
  lifeTime = 300;
  age = 0;
  range = JHIN_R_RANGE;
  start: p5.Vector;
  end: p5.Vector;
  finale: boolean;

  constructor(owner: AttackableUnit, start: p5.Vector, end: p5.Vector, finale: boolean) {
    super(owner);
    this.start = start;
    this.end = end;
    this.finale = finale;
    this.position = start.copy();
    if (finale) this.lifeTime = 520;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const heft = this.finale ? 3 : 1;
    const heading = Math.atan2(this.end.y - this.start.y, this.end.x - this.start.x);
    const span = Math.hypot(this.end.x - this.start.x, this.end.y - this.start.y);

    push();
    translate(this.start.x, this.start.y);
    rotate(heading);
    noStroke();
    fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], (this.finale ? 130 : 80) * fade);
    rect(0, (-JHIN_R_WIDTH * heft) / 2, span, JHIN_R_WIDTH * heft);
    stroke(BONE[0], BONE[1], BONE[2], 245 * fade);
    strokeWeight(2 * heft * fade + 1);
    line(0, 0, span, 0);
    if (this.finale) {
      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 200 * fade);
      strokeWeight(1);
      const flare = JHIN_R_WIDTH * 1.4 * (1 - fade * 0.4);
      line(0, -flare, span, -flare * 0.2);
      line(0, flare, span, flare * 0.2);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return jhinBeamDisplayBox(this.start, this.end, JHIN_R_WIDTH * (this.finale ? 3 : 1), this);
  }
}

/** The landing, on the victim. The finale gets a far bigger lotus than the setup shots. */
export class Jhin_R_Bloom extends SpellObject {
  lifeTime: number;
  age = 0;
  finale: boolean;
  radius: number;
  petals: { angle: number; reach: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector, finale: boolean) {
    super(owner);
    this.position = at;
    this.finale = finale;
    this.radius = finale ? 120 : 42;
    this.lifeTime = finale ? 620 : 320;
  }

  onAdded(): void {
    const count = this.finale ? 16 : 4;
    for (let i = 0; i < count; i++) {
      this.petals.push({
        angle: (i * TWO_PI) / count + random(-0.12, 0.12),
        reach: random(0.6, 1),
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
    stroke(BONE[0], BONE[1], BONE[2], 230 * fade);
    strokeWeight((this.finale ? 4 : 2) * fade + 1);
    circle(this.position.x, this.position.y, this.radius * 2 * opened);
    if (this.finale) {
      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 180 * fade);
      strokeWeight(2);
      circle(this.position.x, this.position.y, this.radius * 1.2 * opened);
    }
    noStroke();
    for (const petal of this.petals) {
      const reach = this.radius * petal.reach * opened;
      push();
      translate(
        this.position.x + cos(petal.angle) * reach,
        this.position.y + sin(petal.angle) * reach
      );
      rotate(petal.angle);
      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 235 * fade);
      const petalSize = (this.finale ? 20 : 11) * fade + 4;
      triangle(0, 0, petalSize, -petalSize * 0.38, petalSize, petalSize * 0.38);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 28) * 2);
  }
}
