import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

/**
 * Zhonya's-style stasis: the unit is frozen solid — it cannot move, cast or be
 * targeted, and nothing can damage it — then comes back exactly as it was.
 *
 * Note this is self-inflicted invulnerability, not crowd control: it is a way
 * out of a fight, not a way to lock someone down.
 */
export default class Stasis extends Buff {
  // Source: https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/3157.png
  // Official Riot Data Dragon item 3157 (Zhonya's Hourglass), SHA-256:
  // fc0908ad8621e96ad635b5bac67e09f663ec80735efd732b10f07d8c498443aa
  image: Buff['image'] = AssetManager.get('buff_stasis');
  name = 'Bất Động';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  // Stunned is what actually locks movement and casting: Stats.updateActionState
  // derives CAN_MOVE/CAN_CAST from the CC flags and never reads StatusFlags.CanMove,
  // so clearing that bit alone would do nothing.
  statusFlagsToEnable = StatusFlags.Stunned;
  statusFlagsToDisable = StatusFlags.Targetable;

  onActivate(): void {
    // freeze on the spot rather than sliding on toward an old destination
    this.targetUnit.stopMovement?.();
  }

  /** Stasis eats everything, which is the whole point of it. */
  modifyIncomingDamage(): number {
    return 0;
  }

  draw(): void {
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    noStroke();
    fill(255, 215, 90, 70);
    circle(pos.x, pos.y, size + 14);

    noFill();
    stroke(255, 225, 120, 220);
    strokeWeight(3);
    circle(pos.x, pos.y, size + 14);

    // a slow sparkle so it reads as frozen rather than merely tinted
    stroke(255, 255, 220, 200);
    strokeWeight(2);
    const a = frameCount / 20;
    for (let i = 0; i < 4; i++) {
      const angle = a + (i * TWO_PI) / 4;
      const r1 = size / 2 + 4;
      const r2 = size / 2 + 12;
      line(
        pos.x + cos(angle) * r1,
        pos.y + sin(angle) * r1,
        pos.x + cos(angle) * r2,
        pos.y + sin(angle) * r2
      );
    }
    pop();
  }
}
