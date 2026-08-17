import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Speedup from '../buffs/Speedup';

// Exported so the suite asserts the wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const SPEED_PERCENT = 0.3;
export const DURATION_MS = 3_000;
export const MANA_COST = 40;

/**
 * The real Move Quick is an always-on passive that doubles on activation.
 * This project has no auto-attack/combat-timer system for a passive to hang
 * off, and it is not a self-dash (no position change), so it becomes a plain
 * active self-buff — press it, get bonus move speed for a few seconds. It
 * never touches `owner.position`/`teleportTo`, so the Dash/blink grounding
 * rule does not apply to it.
 */
export default class Teemo_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_teemo_w');
  name = 'Chạy Lẹ (Teemo_W)';
  description =
    'Chủ động: Teemo <span class="buff">tăng 30% tốc chạy</span> trong <span class="time">3 giây</span>, hiệu ứng không thể bị gỡ bỏ trong thời gian này.';
  // kept as a literal (not an exported constant) so the repo-wide arcade
  // cooldown-cap scan in tests/game/spells/cooldowns.test.ts can see it
  coolDown = 8_000;
  manaCost = MANA_COST;

  speedPercent = SPEED_PERCENT;
  duration = DURATION_MS;

  onSpellCast() {
    const buff = new Speedup(this.duration, this.owner, this.owner);
    // a bare Speedup's stackId is just `Speedup` itself — every other spell
    // using the base class directly (Ghost, Heal, ...) would otherwise fight
    // this one for the same stack slot
    buff.stackId = 'teemo_w_movequick';
    buff.image = AssetManager.get('spell_teemo_w');
    buff.name = 'Chạy Nhanh';
    buff.percent = this.speedPercent;
    this.owner.addBuff(buff);

    const burst = new Teemo_W_Burst(this.owner);
    this.game.objectManager.addObject(burst);
  }
}

/** The moment of activation: a quick outward pulse so the button-press itself reads clearly. */
export class Teemo_W_Burst extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  age = 0;
  lifeTime = 350;

  update() {
    // very short-lived and self-checking, same as Malphite_Q_Rush: no need to
    // outlive the owner, so bail the moment it is gone rather than reappear
    // on a respawn a few frames later
    if (this.owner.isDead) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const r = this.owner.animatedValues?.displaySize
      ? this.owner.animatedValues.displaySize / 2
      : 28;

    push();
    translate(this.position.x, this.position.y);

    // an expanding ring of quickened air underfoot
    noFill();
    stroke(215, 255, 150, 220 * fade);
    strokeWeight(4 * fade + 1);
    ellipse(0, r * 0.6, (r * 1.4 + 60 * t) * 1.3, r * 0.6 + 20 * t);

    // a handful of forward-streaking dashes, evenly spread so it reads as a burst
    stroke(235, 255, 200, 200 * fade);
    strokeWeight(2.5);
    for (let i = 0; i < 6; i++) {
      const a = (i * TWO_PI) / 6;
      const r0 = r * 0.5 + 10 * t;
      const r1 = r0 + 16 * fade + 10;
      line(cos(a) * r0, sin(a) * r0 * 0.6, cos(a) * r1, sin(a) * r1 * 0.6);
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = 110;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
