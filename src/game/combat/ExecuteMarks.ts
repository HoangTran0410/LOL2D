import { isExecuteSpell, lethalTargets } from './ExecuteTargeting';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type Spell from '@/game/gameObject/Spell';

/**
 * "This one dies if you press the key."
 *
 * The other half of `ExecuteTargeting`. That module makes the spell pick the
 * enemy it can finish; this one tells the player, before the press, which enemy
 * that is — otherwise a last-hit ability is a coin flip against a health bar
 * you have to read at a glance while something is chasing you.
 *
 * Deliberately *not* a `castSpec.vfx` and not drawn from `Champion.draw`. Both
 * are skipped the moment the caster is culled, and this has to keep painting on
 * a target at the far edge of the range ring — the same failure that made a
 * beam ability's own visual invisible. `Game.draw` calls it beside `drawNavDebug`, inside the camera
 * transform, so it answers only to the camera.
 *
 * Only the player's own spells are ever consulted. A ring over an enemy that
 * says "the bot can execute you" is a different feature and a much louder one.
 */

/** Warm gold-red: "finishable", not "danger" — the game's danger colour is red. */
const MARK_COLOR: [number, number, number] = [255, 170, 60];

interface SpellCarrier {
  spells?: Spell[];
  isDead?: boolean;
}

/** One enemy the player could finish, and whether the key is live right now. */
export interface ExecuteMark {
  unit: AttackableUnit;
  /**
   * `Spell.isCastableNow` — off cooldown, paid for, caster free to act.
   *
   * Deliberately *not* a condition for being marked at all. It was, and the
   * result was measured rather than argued about: spamming a fast-cooldown
   * damage spell left the
   * ring on for 7 frames out of 481, every blank frame down to
   * `state === COOLDOWN`. A mark that blinks off the instant you use the
   * ability is at its least useful exactly when you are using it — the whole
   * question is "who can I finish next". So the mark persists and the *style*
   * carries the readiness instead.
   */
  ready: boolean;
}

/**
 * Every enemy the caster could finish this instant, each listed once.
 *
 * A unit can be lethal to two different spells at once (a stacked damage-over-time
 * effect and a direct hit both reach it); it still gets one mark, because the mark means
 * "dies to something you have", not "dies twice".
 */
export function executeMarks(caster: SpellCarrier | null | undefined): ExecuteMark[] {
  if (!caster || caster.isDead || !caster.spells) return [];

  const marks: ExecuteMark[] = [];
  for (const spell of caster.spells) {
    // A disabled spell is not an ability the player has; a spell on cooldown is.
    if (!isExecuteSpell(spell) || spell.disabled) continue;
    const ready = spell.isCastableNow;
    for (const target of lethalTargets(spell)) {
      const existing = marks.find(mark => mark.unit === target);
      // Marked by two spells and live on either one: the brighter answer wins.
      if (existing) existing.ready ||= ready;
      else marks.push({ unit: target, ready });
    }
  }
  return marks;
}

/** Just the units, for callers that do not care which key is up. */
export function executeMarkTargets(caster: SpellCarrier | null | undefined): AttackableUnit[] {
  return executeMarks(caster).map(mark => mark.unit);
}

/**
 * The ring itself: a bright circle that closes in on the body, plus four
 * chevrons pointing inward at it. Drawn every frame while the spell is up, so
 * it pulses rather than animating from a start — there is no "start", the
 * player's mana and the target's health are what turn it on and off.
 */
export function drawExecuteMarks(game: { player?: SpellCarrier; camera?: any }): void {
  const marks = executeMarks(game.player);
  if (marks.length === 0) return;

  const beat = (Math.sin(frameCount / 7) + 1) / 2;
  const [r, g, b] = MARK_COLOR;

  push();
  noFill();
  for (const { unit: target, ready } of marks) {
    // Waiting on the cooldown: a thin steady outline that says "still killable"
    // and nothing more. Live: it breathes and grows the arrowheads. One state
    // is a note, the other is an invitation, and they must not be confusable.
    const pulse = ready ? beat : 0;
    const radius = (target.animatedValues?.displaySize ?? 50) / 2 + 10 + pulse * 5;
    const { x, y } = target.position;

    stroke(20, 12, 0, ready ? 150 : 80);
    strokeWeight(ready ? 5 : 3);
    circle(x, y, radius * 2);
    stroke(r, g, b, ready ? 200 + 55 * beat : 95);
    strokeWeight(ready ? 2.5 : 1.5);
    circle(x, y, radius * 2);

    if (!ready) continue;

    // four arrowheads closing on the body — the "finish it" read, and the part
    // that survives being one of six rings on a crowded screen
    strokeWeight(3);
    const reach = radius + 12 - pulse * 6;
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const tipX = x + Math.cos(angle) * radius;
      const tipY = y + Math.sin(angle) * radius;
      const backX = x + Math.cos(angle) * reach;
      const backY = y + Math.sin(angle) * reach;
      const spread = 0.32;
      stroke(20, 12, 0, 150);
      strokeWeight(5);
      line(tipX, tipY, backX + Math.cos(angle + spread) * 5, backY + Math.sin(angle + spread) * 5);
      line(tipX, tipY, backX + Math.cos(angle - spread) * 5, backY + Math.sin(angle - spread) * 5);
      stroke(r, g, b, 235);
      strokeWeight(2.5);
      line(tipX, tipY, backX + Math.cos(angle + spread) * 5, backY + Math.sin(angle + spread) * 5);
      line(tipX, tipY, backX + Math.cos(angle - spread) * 5, backY + Math.sin(angle - spread) * 5);
    }
  }
  pop();
}
