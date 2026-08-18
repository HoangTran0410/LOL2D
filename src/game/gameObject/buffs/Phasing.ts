import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

/**
 * Phasing: walks through bodies. Terrain still stops it.
 *
 * The counterpart to `Ground`, and deliberately *not* `StatusFlags.Ghosted`.
 * Ghosted turns off the wall push-out as well, which is correct for a `Dash` —
 * short, and it ends on a destination the spell already picked — and wrong for
 * anything with a duration, because a unit that may stand inside a wall can
 * walk out of the map and sit there. Every sustained effect that wants to
 * shoulder past a minion wave wants this one.
 *
 * Enforced in `AttackableUnit.collidesWithUnits`; `TerrainMap.pushOutOfWalls`
 * deliberately does not read it.
 */
export default class Phasing extends Buff {
  image: Buff['image'] = AssetManager.placeholder('Phasing buff');
  name = 'Xuyên Thấu';
  buffAddType = BuffAddType.RENEW_EXISTING;

  statusFlagsToEnable = StatusFlags.PhasesUnits;

  draw(): void {
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    // Feet blurring into the floor: the read is "this one is not quite solid",
    // and it has to survive being drawn under a champion body, so it is a
    // ground ellipse rather than anything on the silhouette.
    noStroke();
    for (let i = 0; i < 3; i++) {
      const phase = (frameCount / 40 + i / 3) % 1;
      fill(190, 220, 255, 90 * (1 - phase));
      ellipse(pos.x, pos.y + size * 0.32, size * (0.7 + phase * 0.55), size * (0.26 + phase * 0.2));
    }
    // and a thin outline that breaks up, so a solid unit and a phasing one are
    // not the same silhouette
    noFill();
    stroke(210, 232, 255, 170);
    strokeWeight(2);
    for (let i = 0; i < 5; i++) {
      const start = (i * TWO_PI) / 5 + frameCount / 90;
      arc(pos.x, pos.y, size * 1.04, size * 1.04, start, start + 0.62);
    }
    pop();
  }
}
