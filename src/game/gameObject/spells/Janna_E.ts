import { Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange, withinRange } from '@/game/combat/Reach';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Shield from '@/game/gameObject/buffs/Shield';
import StatAmp from '@/game/gameObject/buffs/StatAmp';
import type { CastContext, CastSpec } from '@/game/spell/runtime/types';
import TargetResolver from '@/game/spell/targeting/TargetResolver';
import type { TargetingRequest } from '@/game/spell/targeting/TargetResolver';
import { canSee } from '@/game/combat/Vision';

type EyeTarget = AttackableUnit;

const isEyeTarget = (target: unknown): target is EyeTarget =>
  target instanceof AttackableUnit && target.targetable && !target.toRemove;

/**
 * Eye of the Storm. The shield is a body-attached effect on whatever ally was
 * targeted — not necessarily the caster — so `Janna_E_Shell` tracks its own
 * `target` field rather than `owner`, and still goes through `attachTo` for
 * the corpse/respawn guarantee (see `SpellObject.attachTo`). This is the
 * "shield shell on an ally" case, the same shape as `Malphite_W_Armor` but
 * generalised past self-cast.
 *
 * The Wiki also grants bonus attack damage while the shield holds. There is now
 * an attackDamage stat and a basic attack to spend it on, so that half of the
 * payload is applied too, on the same clock as the shield.
 *
 * The passive — 20% cooldown refund, once per this spell's own cooldown
 * window, whenever one of Janna's abilities slows or knocks up an enemy
 * champion — is wired from Q/W/R via `notifyJannaControlLanded` below rather
 * than a game-wide event, since no such event is emitted anywhere in this
 * engine yet and adding one is a bigger, riskier change than this kit needs.
 */
// Exported so the suite asserts the wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const COOLDOWN_MS = 12_000;
export const MANA_COST = 70;
export const RANGE = 500;
export const SHIELD_DURATION_MS = 4_000;
export const SHIELD_AMOUNT = 30;
/**
 * Bonus attack damage while the shield holds. A champion's base is 16, so this
 * is a little under a third more — worth having, not worth building around.
 */
export const BONUS_ATTACK_DAMAGE = 5;
export const REFUND_RATIO = 0.2;

export default class Janna_E extends Spell {
  image = AssetManager.get('spell_janna_e');
  name = 'Mắt Bão (Janna_E)';
  description = `Nội tại: khi một kỹ năng của Janna làm chậm hoặc hất tung ít nhất một tướng địch, hoàn <span class="buff">${Math.round(REFUND_RATIO * 100)}% hồi chiêu</span> của kỹ năng này (một lần mỗi chu kỳ hồi chiêu). Chủ động: khiên cho tướng đồng minh hoặc trụ, hấp thụ <span class="damage">${SHIELD_AMOUNT} sát thương</span> và <span class="buff">+${BONUS_ATTACK_DAMAGE} sát thương đánh thường</span> trong <span class="time">${SHIELD_DURATION_MS / 1000} giây</span>.`;
  coolDown = COOLDOWN_MS;
  manaCost = MANA_COST;

  range = RANGE;
  shieldAmount = SHIELD_AMOUNT;
  shieldDuration = SHIELD_DURATION_MS;

  private refundArmed = true;

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
      targetTeam: 'ALLY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isEyeTarget(candidate),
      getTargetInfo: candidate =>
        isEyeTarget(candidate)
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

  onSpellCast(context: CastContext): void {
    if (!isEyeTarget(context.target)) return;
    this.refundArmed = true;

    const shield = new Shield(this.shieldDuration, this.owner, context.target);
    shield.amount = this.shieldAmount;
    shield.color = [200, 240, 235];
    // Its own pool: a shielded ally may already be carrying an unrelated
    // Shield instance (Malphite W, an item, ...) that must not merge with this.
    shield.stackId = 'janna_e_shield';
    context.target.addBuff(shield);

    // Same duration, own pool: the shield and the damage are one payload, but
    // two buff classes, and this must not merge with an unrelated StatAmp.
    const might = new StatAmp(this.shieldDuration, this.owner, context.target);
    might.name = 'Mắt Bão';
    might.image = this.image;
    might.stackId = 'janna_e_might';
    might.bonuses = { attackDamage: { baseBonus: BONUS_ATTACK_DAMAGE } };
    context.target.addBuff(might);

    const shell = new Janna_E_Shell(this.owner, context.target);
    shell.attachTo(context.target, shield);
    this.game.objectManager.addObject(shell);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }

  /** Called by Q/W/R when they land a slow or knock-up on an enemy champion. */
  notifyCrowdControlLanded(): void {
    if (!this.refundArmed || this.currentCooldown <= 0) return;
    this.refundArmed = false;
    // A fraction of the *reduced* cooldown, not the raw one: under cooldown
    // reduction the running cooldown is already shorter, so refunding a slice
    // of the raw number would hand back proportionally more than the refund is
    // meant to be — enough to zero it outright at high CDR.
    this.currentCooldown = Math.max(
      0,
      this.currentCooldown - this.reducedCooldown(this.coolDown) * REFUND_RATIO
    );
  }

  private isValidTarget(target: unknown): target is EyeTarget {
    return (
      isEyeTarget(target) &&
      canSee(this.owner, target) &&
      target.teamId === this.owner.teamId &&
      withinRange(this.range, this.owner, target)
    );
  }
}

/** Feeds Eye of the Storm's passive from any of Janna's other abilities. */
export const notifyJannaControlLanded = (owner: AttackableUnit, target: AttackableUnit): void => {
  if (!(owner instanceof Champion) || !(target instanceof Champion)) return;
  if (target.teamId === owner.teamId) return;
  const eye = owner.spells.find((spell): spell is Janna_E => spell instanceof Janna_E);
  eye?.notifyCrowdControlLanded();
};

/** The shield shell: it rides the shielded ally, not the caster. */
export class Janna_E_Shell extends SpellObject {
  target: AttackableUnit;
  age = 0;

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
    this.position = target.position.copy();
  }

  update(): void {
    this.age += deltaTime;
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.target.position.x, this.target.position.y);
  }

  draw(): void {
    const size = this.target.animatedValues?.displaySize ?? 40;
    const radius = size / 2 + 14;
    const spin = this.age / 500;
    // slams on over the first 150ms, matching Malphite W's armour cue
    const slam = constrain(this.age / 150, 0, 1);

    push();
    translate(this.position.x, this.position.y);

    // curling wind ribbons, in Janna's palette rather than Malphite's stone
    noFill();
    for (let i = 0; i < 3; i++) {
      const offset = spin + (i / 3) * TWO_PI;
      stroke(150, 235, 220, 60 * slam);
      strokeWeight(6);
      arc(0, 0, radius * 2 + 6, radius * 2 + 6, offset, offset + PI * 1.1);
      stroke(225, 255, 245, 200 * slam);
      strokeWeight(2);
      arc(0, 0, radius * 2 + 6, radius * 2 + 6, offset, offset + PI * 1.1);
    }

    // a soft halo so the shield reads at a glance under fog/terrain
    noStroke();
    fill(190, 245, 230, 26 * slam);
    circle(0, 0, radius * 2);

    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    const size = this.target.animatedValues?.displaySize ?? 40;
    const r = size / 2 + 30;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
