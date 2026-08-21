import ColorUtils from '@/utils/color.utils';
import SpellObject from '@/game/gameObject/SpellObject';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/** How long a floating number stays on screen once nothing is refreshing it. */
export const COMBAT_TEXT_LIFETIME_MS = 1000;

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
 * new to add. Position and drift (`movedVector`/`velocity`) are left alone on
 * a merge, so the number keeps floating smoothly instead of popping back to
 * the unit's feet on every hit.
 *
 * A fixed flush tick (accumulate for ~200-250ms, emit once) was the other
 * option on the table and was rejected: it would buy the same object-count
 * reduction — the steady-state is one live text per (victim, kind) either
 * way — at the cost of up to one tick of latency on an isolated hit, which
 * reads as input lag on the number a player is most likely to be watching:
 * their own. Merging into a still-alive text gets the same reduction with no
 * added latency and no scheduler; its effective window is
 * `COMBAT_TEXT_LIFETIME_MS` itself rather than a second constant to keep in
 * sync with it.
 *
 * No separate cap on top: merging already bounds live count to one text per
 * unit currently taking a given kind of event, which is bounded by the
 * number of units on the map (`MinionSpawner.MINION_LIVE_CAP` plus the
 * roster) rather than by event rate — an AOE hitting forty units still shows
 * forty numbers, one each, which is the correct answer, not something a cap
 * should be trimming.
 */
export default class CombatText extends SpellObject {
  velocity: p5.Vector;
  gravity: p5.Vector;
  movedVector: p5.Vector;
  lifeTime: number;
  age: number;
  textSize: number;
  textColor: string | number[];
  text: string;
  /** Running total this instance is displaying, before `FORMAT_BY_KIND`. */
  amount = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.velocity = createVector(0, -1);
    this.gravity = createVector(random(-0.03, 0.03), 0.05);
    this.movedVector = createVector();
    this.lifeTime = COMBAT_TEXT_LIFETIME_MS;
    this.age = 0;
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
    this.movedVector.add(this.velocity);
    this.velocity.add(this.gravity);

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
    const x = this.owner.position.x + this.movedVector.x;
    const y = this.owner.position.y + this.movedVector.y - size / 2;

    strokeWeight(2);
    stroke(strokeColor);
    fill(colorAlpha);
    textStyle(BOLD);
    // An overlay, not the world: a damage number is the same size on screen at
    // every zoom. See Camera.constantSize.
    textSize(this.textSize * (this.game?.camera?.constantSize?.(1) ?? 1));
    text(this.text, x, y);
    pop();
  }
}
