import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';

/**
 * Shared across Anivia's kit: Flash Frost (Q) and a fully-formed Glacial Storm
 * (R) both mark a target Chilled, and Frostbite (E) reads it to double its
 * damage. Not a crowd-control effect — no statusFlags — so it keeps its own
 * ability-art icon instead of a CC icon like `buff_slow`.
 *
 * `RENEW_EXISTING` matches the Wiki text exactly: "refreshing on subsequent
 * hits" rather than stacking into something stronger.
 */
export const CHILL_DURATION_MS = 3_000;

export default class Chilled extends Buff {
  image: Buff['image'] = AssetManager.get('spell_anivia_e');
  name = 'Nhiễm Lạnh';
  buffAddType = BuffAddType.RENEW_EXISTING;

  draw(): void {
    // A few frost flecks orbiting the target's head — enough to read as a
    // mark without competing with Slow's own ring or the unit's health bar.
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;
    const r = size / 2 + 8;

    push();
    translate(pos.x, pos.y);
    noStroke();
    fill(200, 235, 255, 210);
    for (let i = 0; i < 3; i++) {
      const angle = this.timeElapsed / 260 + (i / 3) * TWO_PI;
      circle(cos(angle) * r, sin(angle) * r * 0.55 - size * 0.3, 3.5);
    }
    pop();
  }
}
