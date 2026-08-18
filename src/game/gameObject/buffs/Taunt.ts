import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

/**
 * "Fight me." The victim swings at whoever taunted them and at nothing else.
 *
 * The odd one out among the crowd-control buffs, and deliberately so. A stun, a
 * charm, a fear and a suppression all *take away* — `Stats.updateActionState`
 * clears `CAN_MOVE`, `CAN_CAST` and `CAN_ATTACK` for every one of them. A taunt
 * takes away only the casting. It must leave `CAN_ATTACK` alone, because the
 * whole effect is a forced swing, and `BasicAttackController.update` drops its
 * standing order the moment `canAttack` goes false — a taunt that cleared the
 * bit would order an attack and then cancel it on the same frame. It must leave
 * `CAN_MOVE` alone too, because the chase to get in range is the controller's,
 * and a rooted victim would simply stand still out of reach.
 *
 * So what it does instead is spend those two permissions on the taunter, every
 * frame, through `AttackableUnit.forceAttackTarget` — which each unit type
 * answers in its own terms (a champion's standing order, a minion's or a
 * monster's `targetLock`). Re-issued rather than set once: the victim's own AI
 * re-scans on its interval and a player can press a key, and neither is allowed
 * to win.
 *
 *   const taunt = new Taunt(1800, rammus, victim);
 *   victim.addBuff(taunt);
 */
export default class Taunt extends Buff {
  image: Buff['image'] = AssetManager.get('buff_taunt');
  name = 'Khiêu Khích';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToEnable = StatusFlags.Taunted;

  onActivate(): void {
    // Take the order on the frame the taunt lands rather than one frame later:
    // at 1.8s and a ~1s swing timer, a wasted frame is a wasted swing.
    this.forceTarget();
  }

  onUpdate(): void {
    this.forceTarget();
  }

  private forceTarget(): void {
    const source = this.sourceUnit;
    // Nobody left to be angry at. Ending the buff rather than letting it run
    // out matters: a victim held by a dead taunter is unable to cast for the
    // remainder while having nothing to attack, which is a stun by accident.
    if (!source || source.isDead || source.toRemove) {
      this.deactivateBuff();
      return;
    }
    if (this.targetUnit.isDead) return;
    this.targetUnit.forceAttackTarget(source);
  }

  /**
   * A short leash drawn from the victim to whoever is holding it, plus a ring
   * of inward barbs. The leash is the readable part: with several units taunted
   * at once, "who is dragging whom" is the only question worth answering, and a
   * ring alone cannot answer it.
   */
  draw(): void {
    const unit = this.targetUnit;
    const source = this.sourceUnit;
    if (unit.isDead || !source) return;

    const pos = unit.position;
    const radius = unit.animatedValues.displaySize / 2 + 6;
    const beat = 1 + 0.05 * sin(frameCount / 9);

    push();

    // the leash, pulling toward the taunter
    const dx = source.position.x - pos.x;
    const dy = source.position.y - pos.y;
    const span = Math.hypot(dx, dy) || 1;
    const ux = dx / span;
    const uy = dy / span;
    stroke(255, 122, 40, 130);
    strokeWeight(3);
    line(
      pos.x + ux * radius,
      pos.y + uy * radius,
      pos.x + ux * Math.min(span, radius + 46),
      pos.y + uy * Math.min(span, radius + 46)
    );

    // barbs turned in on the victim
    noFill();
    stroke(255, 150, 70, 200);
    strokeWeight(2.5);
    circle(pos.x, pos.y, radius * 2 * beat);
    stroke(255, 200, 140, 225);
    strokeWeight(2);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * TWO_PI + frameCount / 90;
      const outer = radius * beat + 9;
      const inner = radius * beat + 1;
      line(
        pos.x + cos(angle) * outer,
        pos.y + sin(angle) * outer,
        pos.x + cos(angle) * inner,
        pos.y + sin(angle) * inner
      );
    }
    pop();
  }
}
