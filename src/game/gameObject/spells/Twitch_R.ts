import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import EventType from '../../enums/EventType';
import type { BasicAttackHit } from '../../combat/BasicAttack';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import StatAmp from '../buffs/StatAmp';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import type Buff from '../Buff';

export const DURATION = 7000;
export const BONUS_RANGE = 250;
export const BONUS_DAMAGE = 8;
export const BOLT_DAMAGE = 7;
export const BOLT_RANGE = 700;
export const STACK_ID = 'twitch_r';

/**
 * Spray and Pray, and the reason it is not just a stat line.
 *
 * The first version handed out attack range, attack damage and attack speed
 * and stopped there. That is an ultimate the player never *sees*: basic
 * attacks in this game are the dull part of a fight, so an ability whose whole
 * body is "your basic attacks are 25% better" reads as nothing happening. The
 * bolt below is the ability — every swing now punches through the target it
 * hit and keeps going, which changes how the fight is *positioned*, not just
 * how fast the numbers tick.
 *
 * It rides `ON_ATTACK_HIT` rather than reimplementing the swing (see
 * docs/ADDING_SPELLS.md §9), so it only fires on attacks that actually landed
 * and the original victim is never double-billed: it is seeded into the
 * missile's `hitTargets` before the bolt is in the world.
 */
export default class Twitch_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_twitch_r');
  name = 'Vãi Đạn (Twitch_R)';
  description =
    `Trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+${BONUS_RANGE} tầm đánh</span>,` +
    ` <span class="buff">+${BONUS_DAMAGE} sát thương đánh thường</span>, <span class="buff">+25% tốc độ đánh</span>,` +
    ` và mỗi đòn đánh thường <span class="damage">xuyên qua mục tiêu</span> bắn tiếp` +
    ` <span class="damage">${BOLT_DAMAGE} sát thương</span> cho mọi kẻ địch phía sau`;
  coolDown = 10000;
  manaCost = 50;

  /** Unsubscribes the piercing passive; `undefined` until the first update wires it. */
  private stopWatching?: () => void;

  onUpdate(): void {
    // Wired here, not in the constructor: every spell is instantiated once with
    // a null owner to build the picker, and that instance has no game to
    // subscribe to and must never react to a real fight.
    if (this.stopWatching || !this.owner || !this.game?.eventManager) return;

    this.stopWatching = this.game.eventManager.on(
      EventType.ON_ATTACK_HIT,
      ({ attacker, victim }: BasicAttackHit) => {
        // the event is global; every Twitch on the map hears every attack
        if (attacker !== this.owner || !victim) return;
        if (!this.isActive) return;
        this.fireBolt(victim);
      }
    );
  }

  /** True only while the buff this spell applied is still on Twitch. */
  get isActive(): boolean {
    return (
      this.owner?.buffs?.some((buff: Buff) => buff.stackId === STACK_ID && !buff.toRemove) ?? false
    );
  }

  fireBolt(victim: AttackableUnit): void {
    const through = victim.position.copy().sub(this.owner.position);
    // A victim standing exactly on Twitch gives no direction; `Game.facing()`
    // is the convention for that, never a zero vector.
    const direction = through.magSq() === 0 ? this.game.facing(this.owner) : through;
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.owner.position.copy().add(direction),
      BOLT_RANGE
    );

    const bolt = new Twitch_R_Bolt(this.owner);
    bolt.destination = to;
    // The attack already billed this one; the bolt is for whoever is behind it.
    bolt.hitTargets.push(victim);
    this.game.objectManager.addObject(bolt);
  }

  onRemoved(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    super.onRemoved();
  }

  deactivate(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    super.deactivate();
  }

  onSpellCast() {
    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = STACK_ID;
    amp.image = this.image;
    amp.name = 'Vãi Đạn';
    amp.bonuses = {
      attackRange: { baseBonus: BONUS_RANGE },
      attackDamage: { baseBonus: BONUS_DAMAGE },
      attackSpeed: { percentBaseBonus: 0.25 },
    };
    this.owner.addBuff(amp);
  }
}

export class Twitch_R_Bolt extends MissileSpellObject {
  speed = 18;
  size = 14;
  /** Infinity is the whole point: the bolt does not stop at the first body. */
  maxHitCount = Infinity;

  onHit(enemy: AttackableUnit) {
    enemy.takeDamage(BOLT_DAMAGE, this.owner);
  }

  draw() {
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    push();
    translate(this.position.x, this.position.y);
    rotate(angle);
    // a stubby tracer, not a ball: it reads as a bullet passing through
    noStroke();
    fill(200, 255, 150, 90);
    rect(-26, -3, 34, 6, 3);
    fill(240, 255, 200, 240);
    rect(-8, -1.6, 16, 3.2, 2);
    pop();
  }
}
