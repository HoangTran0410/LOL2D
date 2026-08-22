import ColorUtils from '@/utils/color.utils';
import SpellObject from '@/game/gameObject/SpellObject';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/** How long a floating number stays on screen once nothing is refreshing it. */
export const COMBAT_TEXT_LIFETIME_MS = 1000;

/**
 * How long the rise-then-fall motion takes to play out, from creation.
 *
 * Deliberately its own constant rather than reusing `COMBAT_TEXT_LIFETIME_MS`
 * at the call site, even though it is set to the same value: one is "how long
 * until this fades and dies" (resets on every merge — see `CombatText.show`)
 * and the other is "how long the arc takes" (never resets — see the class doc
 * comment). They happen to agree so a single, un-merged hit's motion looks
 * unchanged from before this file separated the two clocks; a future retune
 * of one is not a retune of the other.
 */
export const COMBAT_TEXT_ARC_MS = 1000;

/**
 * What a floating number is reporting. Drives both its format and its merge
 * key — see `CombatText.show`.
 */
export type CombatTextKind = 'damage' | 'heal' | 'shield' | 'reflect';

const FORMAT_BY_KIND: Record<CombatTextKind, (total: number) => string> = {
  damage: total => '-' + total,
  heal: total => '+' + total,
  shield: total => String(total),
  reflect: total => '⟲' + total,
};

const colorKey = (textColor: string | number[]): string =>
  Array.isArray(textColor) ? textColor.join(',') : textColor;

/**
 * One live merge target per (victim, kind, color). Color is part of the key
 * because `Shield` and `DamageReflect` carry a caster-chosen color — two
 * different shields absorbing on the same unit must not blend into one
 * number that hides which spell ate what, so they key apart and only a
 * repeated hit against the *same* shield instance merges.
 *
 * A plain `WeakMap` rather than a field on `AttackableUnit`: this is display
 * bookkeeping, not unit state, and it costs nothing once the unit (and every
 * text it ever showed) is gone.
 */
const mergeTargets = new WeakMap<AttackableUnit, Map<string, CombatText>>();

/**
 * Closed-form "toss and fall": rises a little, then gravity wins and it
 * settles below its start, expressed as coefficients of `p` and `p*p` where
 * `p = min(elapsedMs, COMBAT_TEXT_ARC_MS) / COMBAT_TEXT_ARC_MS` — see
 * `CombatText.update`. Reproduces the shape the old per-tick integration
 * produced for a single, un-merged hit over its one lifetime (initial
 * velocity -1px/tick, gravity +0.05px/tick^2, at the fixed 60Hz sim tick):
 * peaks ~10px up around a third of the way through the arc, and ends ~30px
 * below the start once the arc completes.
 */
const ARC_LINEAR_PX = -60;
const ARC_QUADRATIC_PX = 90;

/** Peak sideways drift once the arc completes, so two numbers on one unit don't sit on identical x. */
const DRIFT_MAX_PX = 40;

/**
 * Extra clearance the arc's rest point keeps above the unit's health bar, in
 * screen-space px (scaled like the bar itself — see `Camera.constantSize`).
 *
 * Real League anchors its floating numbers above the health bar, not over
 * the character model (a live match's own forum complaint was text that
 * "floats behind the health bar" — same failure mode this avoids, different
 * cause). `AttackableUnit.drawHealthBar` already sits `(6 + 15) * k` above
 * `size / 2`; this is the further gap on top of that, clearing both the bar
 * and its "12 / 100" label so a merged, still-climbing number never has to
 * fight the avatar or the bar for the same few pixels.
 */
const HEALTH_BAR_CLEARANCE_PX = 20;

/**
 * A floating damage/heal/shield/reflect number over a unit's head.
 *
 * ## Why it merges, and the rule
 *
 * A fast attacker, a multi-hit spell or a crowded fight used to spawn one of
 * these *per event* — a teamfight with several champions trading blows could
 * have 150-200 alive at once, each animating, drawing and eventually being
 * GC'd, on top of the object churn itself. Nobody reads 200 overlapping
 * numbers; what a player actually wants is "how much am I taking right now."
 *
 * `CombatText.show(owner, kind, amount, textColor)` is the one door in. It
 * merges **per victim (`owner`) and per `kind`** — two units each taking 15
 * are two numbers over two heads, never one 30 floating between them — and
 * only while a live text of that exact (owner, kind, color) is still on
 * screen: the first hit in a burst shows immediately (no added latency on
 * the number a player is actually watching), and every hit that lands before
 * it fades **adds to the same instance's running total and puts it back to a
 * fresh `COMBAT_TEXT_LIFETIME_MS`**, rather than spawning another object.
 * Sustained fire keeps one number alive and climbing for as long as the fire
 * continues; it only starts to fade once a full lifetime passes with nothing
 * new to add.
 *
 * ## Two clocks, not one — and the bug that came from conflating them
 *
 * A merge resets `age` (fade + removal) but must leave the *arc* — where the
 * number sits on its rise-then-fall path — alone, or every hit pops the text
 * back to the unit's feet and restarts the climb. The first version of this
 * got that half right and then broke a different way: the arc was driven by
 * integrating `velocity`/`gravity` into `movedVector` every tick, with
 * nothing bounding it. A single un-merged hit is only ever alive for one
 * `lifeTime`, so the integration was accidentally bounded by how long the
 * object existed — but a merged text under sustained fire never dies (`age`
 * keeps getting reset before it crosses `lifeTime`), so `velocity` kept
 * accumulating `gravity` for as long as the fire lasted. A few seconds of
 * continuous hits and the text was in free fall, off the bottom of the
 * screen. Reported from a phone: "nó bay xuống hoài luôn, ra khỏi viewport
 * luôn."
 *
 * The fix is a second clock. `elapsedMs` is time since this instance was
 * *created* — a merge never resets it, unlike `age` — and the arc is a
 * closed-form function of `min(elapsedMs, COMBAT_TEXT_ARC_MS)`, not an
 * integrated velocity, so it cannot run away by construction: past
 * `COMBAT_TEXT_ARC_MS` the position is simply constant. A single hit's
 * motion is unchanged (it dies at `age > COMBAT_TEXT_LIFETIME_MS`, which
 * equals `COMBAT_TEXT_ARC_MS`, so the clamp is never actually reached before
 * removal). A merged text under sustained fire plays the same rise-and-fall
 * once, then holds at the settled position while its running total keeps
 * climbing; when the fire stops, `age` resumes counting up from its last
 * reset and the held number fades from wherever it is.
 *
 * A fixed flush tick (accumulate for ~200-250ms, emit once) was the other
 * option on the table for the *merge* rule and was rejected: it would buy
 * the same object-count reduction — the steady-state is one live text per
 * (victim, kind) either way — at the cost of up to one tick of latency on an
 * isolated hit, which reads as input lag on the number a player is most
 * likely to be watching: their own. Merging into a still-alive text gets the
 * same reduction with no added latency and no scheduler; its effective
 * window is `COMBAT_TEXT_LIFETIME_MS` itself rather than a second constant
 * to keep in sync with it.
 *
 * No separate cap on top: merging already bounds live count to one text per
 * unit currently taking a given kind of event, which is bounded by the
 * number of units on the map (`MinionSpawner.MINION_LIVE_CAP` plus the
 * roster) rather than by event rate — an AOE hitting forty units still shows
 * forty numbers, one each, which is the correct answer, not something a cap
 * should be trimming.
 */
export default class CombatText extends SpellObject {
  lifeTime: number;
  age: number;
  /** Time since this instance was *created*. Never reset by a merge — see above. */
  elapsedMs: number;
  /** Current screen-space offset from `owner.position`, refreshed each `update()`. */
  offsetX: number;
  offsetY: number;
  /** This instance's fixed sideways drift target, reached once the arc completes. */
  driftTargetX: number;
  textSize: number;
  textColor: string | number[];
  text: string;
  /** Running total this instance is displaying, before `FORMAT_BY_KIND`. */
  amount = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.lifeTime = COMBAT_TEXT_LIFETIME_MS;
    this.age = 0;
    this.elapsedMs = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.driftTargetX = random(-DRIFT_MAX_PX, DRIFT_MAX_PX);
    this.textSize = 20;
    this.textColor = 'white';
    this.text = '';
  }

  /** See the class doc comment for the merge rule this implements. */
  static show(
    owner: AttackableUnit,
    kind: CombatTextKind,
    amount: number,
    textColor: string | number[]
  ): void {
    amount = Math.round(amount);
    if (amount === 0) return;

    const key = kind + '|' + colorKey(textColor);
    const byKey = mergeTargets.get(owner);
    const existing = byKey?.get(key);
    if (existing && !existing.toRemove) {
      existing.amount += amount;
      existing.text = FORMAT_BY_KIND[kind](existing.amount);
      existing.age = 0;
      return;
    }

    const combatText = new CombatText(owner);
    combatText.amount = amount;
    combatText.text = FORMAT_BY_KIND[kind](amount);
    combatText.textColor = textColor;

    let targets = byKey;
    if (!targets) {
      targets = new Map();
      mergeTargets.set(owner, targets);
    }
    targets.set(key, combatText);

    owner.game.objectManager.addObject(combatText);
  }

  update(): void {
    this.elapsedMs += deltaTime;
    // p = 0 at creation, 1 once the arc has fully played out. Clamped rather
    // than integrated, so holding this instance alive past COMBAT_TEXT_ARC_MS
    // (a merge keeps refreshing `age` without touching `elapsedMs`) cannot
    // push the position past where the arc ends — see the class doc comment.
    const arcProgress = Math.min(this.elapsedMs, COMBAT_TEXT_ARC_MS) / COMBAT_TEXT_ARC_MS;
    this.offsetY = ARC_LINEAR_PX * arcProgress + ARC_QUADRATIC_PX * arcProgress * arcProgress;
    this.offsetX = this.driftTargetX * arcProgress * arcProgress;

    this.age += deltaTime;
    if (this.age > this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw(): void {
    push();
    const alpha = map(this.age, 0, this.lifeTime, 255, 10);
    const strokeColor = ColorUtils.applyColorAlpha('yellow', alpha);
    const colorAlpha = ColorUtils.applyColorAlpha(this.textColor, alpha);
    const size = this.owner.stats.size.value;
    const zoomFactor = this.game?.camera?.constantSize?.(1) ?? 1;
    // Rest point above the health bar, not the character model — see
    // HEALTH_BAR_CLEARANCE_PX. AttackableUnit.drawHealthBar's own bar sits
    // `(6 + 15) * k` above `size / 2`; this adds a further gap on top of
    // that so the number starts clear of both the bar and its "12 / 100"
    // label, then the arc (offsetX/offsetY) plays out from there exactly as
    // it did before this line existed.
    const restY = this.owner.position.y - size / 2 - HEALTH_BAR_CLEARANCE_PX * zoomFactor;
    const x = this.owner.position.x + this.offsetX;
    const y = restY + this.offsetY;

    strokeWeight(2);
    stroke(strokeColor);
    fill(colorAlpha);
    textStyle(BOLD);
    // An overlay, not the world: a damage number is the same size on screen at
    // every zoom. See Camera.constantSize.
    textSize(this.textSize * zoomFactor);
    text(this.text, x, y);
    pop();
  }
}
