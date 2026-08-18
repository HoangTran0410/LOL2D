import { Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange, withinRange } from '@/game/combat/Reach';
import TargetResolver from '@/game/spell/targeting/TargetResolver';
import type { TargetingRequest } from '@/game/spell/targeting/TargetResolver';
import type { CastContext, CastSpec } from '@/game/spell/runtime/types';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Dash from '@/game/gameObject/buffs/Dash';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';

/**
 * Irelia's palette, declared once here and imported by the rest of the kit.
 *
 * Ionian steel over a dark rim: a pale blade body so it reads over grass, water
 * and stone alike, a teal edge glow that says *this part cuts*, and the rose
 * crest only on the pieces the player has to find (a planted blade, the wall).
 * Keeping all four abilities on one palette is what makes a fan of blades and a
 * pair of blades legible as the same champion's work.
 */
export const IRELIA_STEEL: [number, number, number] = [214, 240, 244];
export const IRELIA_EDGE: [number, number, number] = [52, 214, 206];
export const IRELIA_CREST: [number, number, number] = [238, 104, 152];
export const IRELIA_RIM: [number, number, number] = [14, 42, 52];

/**
 * One blade, drawn along the local +X axis and centred on the origin — the
 * caller owns `translate`/`rotate`.
 *
 * Shared rather than copied because every piece of this kit that is *a blade*
 * — the one she throws, the one standing in the ground waiting, the cluster of
 * her ultimate and the row it leaves behind — has to read as the same object at
 * four different sizes. Dark rim first so the shape survives grass, water and
 * stone; pale body over it; the teal edge line saying which part cuts; the rose
 * crest at the pommel so a blade at rest is identifiable as hers.
 */
export function drawIreliaBlade(length: number, alpha = 1): void {
  const half = length / 2;

  stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 240 * alpha);
  strokeWeight(Math.max(4, length * 0.22));
  line(-half, 0, half, 0);
  stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 250 * alpha);
  strokeWeight(Math.max(2, length * 0.1));
  line(-half, 0, half, 0);
  stroke(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 230 * alpha);
  strokeWeight(Math.max(1, length * 0.04));
  line(-half * 0.85, 0, half * 0.9, 0);

  noStroke();
  fill(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 240 * alpha);
  circle(-half * 0.78, 0, Math.max(4, length * 0.18));
}

export const Q_RANGE = 320;
export const Q_DAMAGE = 22;
export const Q_DASH_SPEED = 17;
/** A ceiling, not a duration: the surge ends the frame it arrives. */
export const Q_DASH_MAX_MS = 900;
/** She finishes beside the body rather than standing inside it. */
export const Q_ARRIVAL_GAP = 36;

/**
 * Bladesurge.
 *
 * The whole ability is the reset. A surge that kills its target hands the key
 * straight back, so Irelia's damage is not one number but however many bodies
 * are lined up for her — and the counterplay is not letting a low target be the
 * one she picks.
 *
 * The kill test is `takeDamage` being synchronous: latch `wasAlive` before,
 * read `isDead` after. Asking the target afterwards alone would credit a reset
 * to a corpse somebody else made.
 */
export default class Irelia_Q extends Spell {
  image = AssetManager.get('spell_irelia_q');
  name = 'Đâm Kiếm (Irelia_Q)';
  description = `Lướt tới một kẻ địch và chém <span class="damage">${Q_DAMAGE} sát thương</span>.
    Nếu cú chém <span class="buff">hạ gục</span> mục tiêu, Đâm Kiếm được hoàn lại ngay lập tức.`;
  coolDown = 6_000;
  manaCost = 20;
  range = Q_RANGE;

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
      range: Q_RANGE,
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => this.isValidTarget(candidate),
      getTargetInfo: candidate =>
        this.isValidTarget(candidate)
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

  private isValidTarget(target?: unknown): target is AttackableUnit {
    return (
      target instanceof AttackableUnit &&
      !target.isDead &&
      !target.toRemove &&
      target !== this.owner &&
      target.teamId !== this.owner.teamId &&
      withinRange(Q_RANGE, this.owner, target)
    );
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner) && this.isValidTarget(this.castContext?.target);
  }

  press(context: CastContext): boolean {
    if (context.target !== undefined) {
      if (!this.isValidTarget(context.target)) return false;
      return super.press(context);
    }

    const result = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return result.ok ? super.press(result.context) : false;
  }

  onSpellCast(context?: CastContext): void {
    const target = context?.target;
    if (!this.isValidTarget(target)) return;

    const launch = this.owner.position.copy();
    let struck = false;
    let interrupted = false;

    const surge = new Dash(Q_DASH_MAX_MS, this.owner, this.owner);
    surge.dashSpeed = Q_DASH_SPEED;
    surge.dashDestination = this.stopShortOf(target.position);
    surge.showTrail = false;

    surge.onDashUpdate = () => {
      if (target.isDead || target.toRemove) return;
      surge.dashDestination = this.stopShortOf(target.position);
    };

    // `Dash` fires this the frame `DASH_INTERRUPT_BUFFS` takes her off her feet,
    // immediately before deactivating — so it is the only place the ending below
    // can tell "someone stunned her out of it" from "she got there".
    surge.onCancelled = () => {
      interrupted = true;
    };

    // Arrival and expiry are the same ending, so the strike lives on the one
    // hook that runs exactly once whichever way the surge finished.
    //
    // The two endings that are *not* an arrival have to be named, because
    // `onDeactivate` fires for them too and the blow is worth 22 either way: a
    // stun mid-flight is the whole counterplay to a dash that damages on
    // landing, and `AttackableUnit.die` clears her buffs, which had a dead
    // Irelia cutting from the air.
    surge.onDeactivate = () => {
      if (struck) return;
      struck = true;
      if (interrupted || this.owner.isDead || this.owner.toRemove) return;
      this.strike(target);
    };

    this.owner.addBuff(surge);
    this.game.objectManager.addObject(new Irelia_Q_Surge(this.owner, launch, surge));
  }

  /** The blow at the end of the surge, and the reset it may buy. */
  private strike(target: AttackableUnit): void {
    if (target.toRemove) return;

    const wasAlive = !target.isDead;
    if (wasAlive) target.takeDamage(Q_DAMAGE, this.owner);
    const killed = wasAlive && target.isDead;

    this.game.objectManager.addObject(
      new Irelia_Q_Strike(this.owner, target.position.copy(), killed)
    );

    // Paid for by the corpse, not by the hit: only a surge that actually
    // finished the target hands the key back.
    if (killed) this.currentCooldown = 0;
  }

  /** A blade's length short of the body, so she lands beside it rather than in it. */
  private stopShortOf(at: p5.Vector): p5.Vector {
    const dx = at.x - this.owner.position.x;
    const dy = at.y - this.owner.position.y;
    const span = Math.hypot(dx, dy);
    if (span <= Q_ARRIVAL_GAP) return createVector(this.owner.position.x, this.owner.position.y);
    const keep = (span - Q_ARRIVAL_GAP) / span;
    return createVector(this.owner.position.x + dx * keep, this.owner.position.y + dy * keep);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The line she leaves behind her — the blade drawn out of the ground she has
 * already crossed, so the reach of the surge is readable after the fact.
 */
export class Irelia_Q_Surge extends SpellObject {
  age = 0;
  private readonly launch: p5.Vector;
  private readonly pad = 60;

  constructor(owner: AttackableUnit, launch: p5.Vector, surge: Dash) {
    super(owner);
    this.launch = launch;
    this.position = owner.position.copy();
    this.attachTo(owner, surge);
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);
  }

  draw(): void {
    const spanX = this.position.x - this.launch.x;
    const spanY = this.position.y - this.launch.y;
    const flown = Math.hypot(spanX, spanY);
    if (flown < 1) return;

    const heading = Math.atan2(spanY, spanX);

    push();
    translate(this.launch.x, this.launch.y);
    rotate(heading);

    // A wake that narrows toward the tail, so the streak states which way she
    // went rather than reading as a rope between two points.
    noStroke();
    fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 70);
    quad(0, -2, flown, -13, flown, 13, 0, 2);
    fill(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 190);
    quad(flown * 0.35, -1.5, flown, -5, flown, 5, flown * 0.35, 1.5);

    // The blade itself, riding at the head of the wake.
    stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 230);
    strokeWeight(5);
    line(flown - 26, 0, flown + 14, 0);
    stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 250);
    strokeWeight(2.5);
    line(flown - 26, 0, flown + 14, 0);
    pop();
  }

  getDisplayBoundingBox() {
    const minX = Math.min(this.launch.x, this.position.x) - this.pad;
    const maxX = Math.max(this.launch.x, this.position.x) + this.pad;
    const minY = Math.min(this.launch.y, this.position.y) - this.pad;
    const maxY = Math.max(this.launch.y, this.position.y) + this.pad;
    return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
  }
}

/**
 * The cut, drawn on the victim rather than near her.
 *
 * A reset gets its own colour: the rose crest flares only when the surge
 * actually finished someone, which is the moment the player needs to notice
 * because the key is already back.
 */
export class Irelia_Q_Strike extends SpellObject {
  lifeTime = 340;
  age = 0;
  reset: boolean;
  radius = 46;

  constructor(owner: AttackableUnit, at: p5.Vector, reset: boolean) {
    super(owner);
    this.position = at;
    this.reset = reset;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const opened = 1 - (1 - t) * (1 - t);
    const accent = this.reset ? IRELIA_CREST : IRELIA_EDGE;

    push();
    translate(this.position.x, this.position.y);

    // Two crossed slashes: the shape of a cut, not a puff of light.
    for (let i = 0; i < 2; i++) {
      push();
      rotate(i === 0 ? -0.7 : 0.7);
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 210 * fade);
      strokeWeight(9 * fade + 3);
      line(-this.radius * opened, 0, this.radius * opened, 0);
      stroke(accent[0], accent[1], accent[2], 250 * fade);
      strokeWeight(5 * fade + 1.5);
      line(-this.radius * opened, 0, this.radius * opened, 0);
      stroke(255, 255, 255, 240 * fade);
      strokeWeight(2);
      line(-this.radius * opened * 0.7, 0, this.radius * opened * 0.7, 0);
      pop();
    }

    // A reset also throws a ring, so it is distinguishable at a glance from a
    // surge that merely hurt.
    if (this.reset) {
      noFill();
      stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 230 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, this.radius * 2.4 * opened);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius * 1.6 + 30) * 2);
  }
}
