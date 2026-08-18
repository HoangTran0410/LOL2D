import { Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange, withinRange } from '@/game/combat/Reach';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import { createReveal } from '@/game/gameObject/buffs/TrueSight';
import HomingMissileSpellObject from '@/game/gameObject/spellObjects/HomingMissileSpellObject';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import TargetResolver from '@/game/spell/targeting/TargetResolver';
import type { TargetingRequest } from '@/game/spell/targeting/TargetResolver';
import type { CastContext, CastSpec } from '@/game/spell/runtime/types';
import { canSee } from '@/game/combat/Vision';

export const CAITLYN_R_RANGE = 820;
export const CAITLYN_R_DAMAGE = 55;
/** The whole counterplay: one second of a laser sight painted on your chest. */
export const CAITLYN_R_CHANNEL_MS = 1000;
export const CAITLYN_R_REVEAL_MS = 2500;
export const CAITLYN_R_REVEAL_STACK_ID = 'caitlyn_r';
export const CAITLYN_R_MISSILE_SPEED = 40;
export const CAITLYN_R_MISSILE_SIZE = 24;
/**
 * What a broken channel costs. Cheaper than the full cooldown so being stunned
 * out of it is not a lost ultimate, but not free either — otherwise the channel
 * becomes a spammable reveal.
 */
export const CAITLYN_R_CANCEL_COOLDOWN_MS = 3000;

type CaitlynRTarget = AttackableUnit;

const isCaitlynRTarget = (target: unknown): target is CaitlynRTarget =>
  target instanceof AttackableUnit && target.targetable && !target.toRemove;

/**
 * Ace in the Hole — a promise made a second before it is kept.
 *
 * The channel is the ability. She locks on, everyone can see who, and the round
 * itself is unmissable once it leaves. Interrupting the channel is the answer,
 * which is why the cancel penalty is small and the reveal outlives the cast.
 */
export default class Caitlyn_R extends Spell {
  image = AssetManager.get('spell_caitlyn_r');
  name = 'Bách Phát Bách Trúng (Caitlyn_R)';
  description =
    `Khóa mục tiêu và ngắm bắn trong <span class="time">${CAITLYN_R_CHANNEL_MS / 1000} giây</span>,` +
    ` <span class="buff">Lộ Diện</span> mục tiêu trong <span class="time">${CAITLYN_R_REVEAL_MS / 1000} giây</span>.` +
    ` Sau đó bắn một viên đạn dẫn đường gây <span class="damage">${CAITLYN_R_DAMAGE} sát thương</span>.`;

  coolDown = 10000;
  manaCost = 100;

  range = CAITLYN_R_RANGE;

  private sight: Caitlyn_R_Sight | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: CAITLYN_R_CHANNEL_MS,
      // Nothing is paid until the round actually leaves, so a broken channel
      // costs the reduced cooldown below and nothing else.
      resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: this.range,
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isCaitlynRTarget(candidate),
      getTargetInfo: candidate =>
        isCaitlynRTarget(candidate)
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

  checkCastCondition(): boolean {
    return this.isValidTarget(this.castContext?.target);
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

  onUpdate(): void {
    if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
      this.cancel('TARGET_INVALID');
    }
  }

  onCastStart(context: CastContext): void {
    if (!isCaitlynRTarget(context.target)) return;

    // The reveal starts with the lock, not with the shot: the point of the
    // ability is that the target knows, and so does everyone standing near them.
    context.target.addBuff(
      createReveal({
        stackId: CAITLYN_R_REVEAL_STACK_ID,
        durationMs: CAITLYN_R_REVEAL_MS,
        source: this.owner,
        target: context.target,
        visionRadius: 260,
      })
    );

    this.clearSight();
    const sight = new Caitlyn_R_Sight(this.owner, context.target);
    sight.lifeTime = CAITLYN_R_CHANNEL_MS;
    this.sight = sight;
    this.game.objectManager.addObject(sight);
  }

  onSpellCast(context: CastContext): void {
    this.clearSight();
    if (!isCaitlynRTarget(context.target)) return;

    const bullet = new Caitlyn_R_Bullet(this.owner, context.target);
    this.game.objectManager.addObject(bullet);
  }

  onCancel(): void {
    this.clearSight();
    // The runtime never started a countdown — cooldown begins at release — so
    // this is the whole price of a broken channel. `cancelActivation` reads the
    // remaining cooldown right after this hook to decide the state, so setting
    // it here is what puts the spell into COOLDOWN rather than straight back to
    // READY.
    this.currentCooldown = this.reducedCooldown(CAITLYN_R_CANCEL_COOLDOWN_MS);
  }

  onComplete(): void {
    this.clearSight();
  }

  drawPreview() {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }

  /** Idempotent: cancel, completion and death all converge here. */
  private clearSight() {
    if (this.sight) this.sight.toRemove = true;
    this.sight = null;
  }

  private isValidTarget(target: unknown): target is CaitlynRTarget {
    return (
      isCaitlynRTarget(target) &&
      canSee(this.owner, target) &&
      target.teamId !== this.owner.teamId &&
      withinRange(this.range, this.owner, target)
    );
  }
}

/**
 * The round.
 *
 * A plain steel slug with a heat wake — no glow, no runes. Caitlyn's ultimate is
 * the least magical thing on the map and it should look like the only one that
 * came out of a barrel.
 */
export class Caitlyn_R_Bullet extends HomingMissileSpellObject {
  speed = CAITLYN_R_MISSILE_SPEED;
  size = CAITLYN_R_MISSILE_SIZE;

  trailSystem = new TrailSystem({
    trailColor: 'rgba(255, 240, 205, 0.5)',
    trailSize: CAITLYN_R_MISSILE_SIZE * 0.45,
    trailLifeTime: 300,
    maxLength: 26,
  });

  onTargetArrive(target: AttackableUnit): void {
    target.takeDamage(CAITLYN_R_DAMAGE, this.owner);

    const hit = new Caitlyn_R_Hit(this.owner);
    hit.position = target.position.copy();
    hit.targetSize = target.animatedValues?.displaySize ?? 40;
    this.game.objectManager.addObject(hit);
  }

  draw() {
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    push();
    translate(this.position.x, this.position.y);
    rotate(angle);

    // heat wake, stretched well behind the slug at this speed
    noStroke();
    fill(255, 225, 170, 70);
    ellipse(-this.size * 0.9, 0, this.size * 3.2, this.size * 0.5);

    // the slug: brass jacket, bright nose
    fill(196, 150, 74);
    ellipse(0, 0, this.size * 1.5, this.size * 0.42);
    fill(255, 244, 214);
    ellipse(this.size * 0.5, 0, this.size * 0.5, this.size * 0.34);
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.size * 2.4;
    return this.squareDisplayBoundingBox(r * 2);
  }
}

/**
 * The laser sight: a thin line from Caitlyn to the target for the whole lock.
 *
 * A `SpellObject` and not caster VFX, and it owes the tree a box that contains
 * *both* ends — it is drawn back to the caster, so a box around its own centre
 * would blank the line whenever either of them left the camera.
 */
export class Caitlyn_R_Sight extends SpellObject {
  target: AttackableUnit;
  age = 0;
  lifeTime = CAITLYN_R_CHANNEL_MS;

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
    this.position = owner.position.copy();
  }

  update() {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime || this.owner.isDead || this.target.isDead) {
      this.toRemove = true;
    }
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const tx = this.target.position.x;
    const ty = this.target.position.y;

    push();
    // the beam thickens and brightens as the lock closes, so the last third of
    // the second is visibly the last third
    stroke(255, 90, 80, 90 + 120 * t);
    strokeWeight(1 + 2 * t);
    line(this.position.x, this.position.y, tx, ty);

    // the reticle closing on the target: three brackets tightening
    push();
    translate(tx, ty);
    rotate(-t * 1.4);
    const d = 90 - 52 * (1 - (1 - t) * (1 - t));
    noFill();
    stroke(255, 70, 60, 150 + 100 * t);
    strokeWeight(2.5);
    for (let i = 0; i < 3; i++) {
      const a = (TWO_PI / 3) * i;
      arc(0, 0, d, d, a - 0.42, a + 0.42);
    }
    // the bead sitting on them, solid only at the very end
    noStroke();
    fill(255, 80, 70, 60 + 195 * t * t);
    circle(0, 0, 5 + 5 * t);
    pop();
    pop();
  }

  getDisplayBoundingBox() {
    // both ends, because the line is drawn between them
    const minX = Math.min(this.position.x, this.target.position.x) - 70;
    const minY = Math.min(this.position.y, this.target.position.y) - 70;
    const maxX = Math.max(this.position.x, this.target.position.x) + 70;
    const maxY = Math.max(this.position.y, this.target.position.y) + 70;
    return new Rectangle({
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      data: this,
    });
  }
}

/** The landing: a hard crack, no bloom. */
export class Caitlyn_R_Hit extends SpellObject {
  age = 0;
  lifeTime = 380;
  targetSize = 40;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const ease = 1 - (1 - t) * (1 - t) * (1 - t);

    push();
    translate(this.position.x, this.position.y);

    noFill();
    stroke(255, 236, 195, 240 * fade);
    strokeWeight(6 * fade + 1.5);
    circle(0, 0, this.targetSize * 0.6 + 130 * ease);

    // six splinters thrown out of the hit, the crack rather than an explosion
    stroke(255, 210, 150, 235 * fade);
    strokeWeight(3 * fade + 1);
    for (let i = 0; i < 6; i++) {
      const a = (TWO_PI / 6) * i + 0.3;
      const inner = this.targetSize * 0.25 + 12 * ease;
      const outer = inner + 40 * ease;
      line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
    }

    const flash = 1 - constrain(t / 0.16, 0, 1);
    if (flash > 0) {
      noStroke();
      fill(255, 252, 240, 245 * flash);
      circle(0, 0, this.targetSize * 0.9 * flash + 14);
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.targetSize + 160;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
