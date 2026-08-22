import BuffAddType from '@/game/enums/BuffAddType';
import Buff from '@/game/gameObject/Buff';

/**
 * Takes no damage from anything, and nothing else.
 *
 * Deliberately not `StatusFlags.Invulnerable`: that flag is in the enum but
 * nothing reads it — `ActionState` has no matching bit and
 * `Stats.updateActionState` has no line for it. What works is
 * `modifyIncomingDamage`, which `AttackableUnit.takeDamage` already loops
 * every buff through, returning early once damage reaches zero. `Stasis` is
 * built on exactly this.
 *
 * Deliberately not `Stasis` itself, which is this *plus* a stun and a dropped
 * `Targetable`: a player who switches invulnerability on to practise a combo
 * must still be able to move and cast.
 *
 * ## No icon, on purpose
 *
 * This first shipped wearing `buff_stasis`, the Zhonya's hourglass — on the
 * reasoning that an hourglass reads as invulnerability. It does not, in *this*
 * game: `Stasis` exists here and means the whole Zhonya's package (golden,
 * cannot act, cannot be targeted). Two different mechanics behind one icon is
 * the buff bar lying about which one you have.
 *
 * `hudState.ts:173` skips any buff with no `image`, so leaving it null keeps
 * this out of the buff bar entirely — which is right twice over: there is no
 * honest icon for it, and this is a practice-tool state rather than a game
 * effect. The ring below is the indicator instead, and it is deliberately in
 * the practice panel's teal rather than a crowd-control palette, because that
 * is what it belongs to.
 */
export default class Invulnerable extends Buff {
  name = 'Bất Tử';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  modifyIncomingDamage(): number {
    return 0;
  }

  /**
   * A steady double ring — no sparkle, no tint, nothing that could be mistaken
   * for `Stasis`'s rotating golden spokes. The radius is world units so it
   * hugs a unit whose size changes (a stacking self-buff), while the stroke goes through
   * `constantSize` so it stays visible when the camera is zoomed out on a
   * phone (see `Camera.constantSize`).
   */
  draw(): void {
    const unit = this.targetUnit;
    if (unit.isDead) return;

    const pos = unit.position;
    const radius = unit.animatedValues.displaySize / 2;
    const stroke1 = unit.game?.camera?.constantSize?.(2) ?? 2;

    push();
    noFill();
    stroke(8, 171, 172, 210);
    strokeWeight(stroke1);
    circle(pos.x, pos.y, (radius + 6) * 2);
    stroke(200, 245, 245, 150);
    strokeWeight(stroke1 / 2);
    circle(pos.x, pos.y, (radius + 10) * 2);
    pop();
  }
}
