import AssetManager from '../../../managers/AssetManager';
import { withinRange } from '../../combat/Reach';
import HomingMissileSpellObject from '../spellObjects/HomingMissileSpellObject';
import Spell from '../Spell';
import type { CastSpec } from '../../spell/runtime/types';
import type { TargetingRequest } from '../../spell/targeting/TargetResolver';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const RANGE = 500;
export const DAMAGE = 26;
export const COOLDOWN_MS = 4_000;
export const MANA_COST = 25;
/** Wiki: a kill refunds the mana and halves the cooldown. */
export const KILL_COOLDOWN_SCALE = 0.5;

const isAnnieTarget = (target: unknown): target is AttackableUnit =>
  !!target && typeof (target as AttackableUnit).takeDamage === 'function';

/**
 * Disintegrate. Point-and-click, which is the whole character: Annie has no
 * skillshot to dodge, only a range to stay out of.
 *
 * `docs/abilities/annie/q.json`: unit-targeted, 4s cooldown, and *"if this
 * kills the target, the cooldown is reduced by 50% and the mana cost is
 * refunded"* — the reason Annie farms with it.
 */
export default class Annie_Q extends Spell {
  image = AssetManager.get('spell_annie_q');
  name = 'Huỷ Diệt (Annie_Q)';
  description =
    `Ném cầu lửa vào một mục tiêu trong <span>${RANGE}px</span>, gây` +
    ` <span class="damage">${DAMAGE} sát thương</span>. Nếu <span class="buff">hạ gục</span> mục tiêu,` +
    ` hoàn lại toàn bộ mana và <span class="buff">giảm ${(1 - KILL_COOLDOWN_SCALE) * 100}% hồi chiêu</span>`;
  coolDown = COOLDOWN_MS;
  manaCost = MANA_COST;

  range = RANGE;

  get targetingRequest(): TargetingRequest {
    return {
      range: this.range,
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isAnnieTarget(candidate) && candidate.willDraw,
      getTargetInfo: candidate =>
        isAnnieTarget(candidate)
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

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast() {
    const target = this.castContext?.target;
    if (!isAnnieTarget(target) || !withinRange(this.range, this.owner, target)) return;

    const orb = new Annie_Q_Object(this.owner, target);
    orb.spell = this;
    this.game.objectManager.addObject(orb);
  }

  /**
   * The refund, paid by the orb when it lands the kill. Reaching back into the
   * spell rather than the orb doing it itself keeps the two rewards — mana and
   * cooldown — stated once, next to the numbers they undo.
   */
  rewardKill(): void {
    this.currentCooldown = this.currentCooldown * KILL_COOLDOWN_SCALE;
    // Through `changeResource`, never `stats.mana` — that seam is what keeps
    // URF's `manaFree` honest, and it refunds exactly what was charged (see
    // the source scan in tests/game/spells/mana-spend-seam.test.ts).
    this.changeResource(this.owner.stats.mana, this.effectiveMana(this.manaCost));
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Annie_Q_Object extends HomingMissileSpellObject {
  speed = 16;
  size = 22;
  spell: Annie_Q | null = null;

  onTargetArrive(target: AttackableUnit) {
    const before = target.isDead;
    target.takeDamage(DAMAGE, this.owner);
    if (!before && target.isDead) this.spell?.rewardKill();
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(255, 140, 40, 90);
    circle(0, 0, this.size * 1.8);
    fill(255, 210, 120, 245);
    circle(0, 0, this.size * 0.8);
    pop();
  }
}
