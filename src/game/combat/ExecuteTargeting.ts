import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type Spell from '@/game/gameObject/Spell';
import { canSee, type Seeable } from './Vision';
import { vecDist } from '@/utils/math.utils';

/**
 * Last-hitting, for a game that cannot click a unit.
 *
 * Several abilities are only worth casting on something that dies to them —
 * a stack-banking spell only pays out on a kill, an execute ability exists to
 * finish people. In the reference game you last hit by clicking the one you mean. Here
 * there is no unit-targeted click: those spells auto-lock, and every one of
 * them locked onto whatever was *nearest*, which is exactly the enemy you did
 * not want when a different one was two hits from dead.
 *
 * So the pick is made on lethality first and geometry second. A spell says who
 * it could hit (`executeCandidates`) and what it would do to each of them
 * (`executeDamageAgainst`); this module answers "which one dies", and only when
 * nobody does falls back to the spell's own ordinary rule — the nearest body
 * for a melee swing, the lowest bar for an execute.
 *
 * The same two methods feed `ExecuteMarks`, which paints the answer on screen
 * before the key is pressed. One definition of "this one dies", used by the
 * targeting and by the thing that promises it.
 */

/** What to hit when nothing in range would die to the cast. */
export type ExecuteFallback = 'nearest' | 'weakest';

/**
 * What a spell has to answer to take part. Implement both methods and set
 * `executeFallback`; the spell then has no targeting code of its own.
 */
export interface ExecuteSpell {
  /**
   * Everyone this spell could pick right now — already filtered for team,
   * range and whatever unit types the ability accepts. Called once per cast and
   * once per frame while the ability is ready, so it should be a single query.
   */
  executeCandidates(): AttackableUnit[];

  /**
   * Damage `target` would take if the spell went off this instant. An estimate
   * is fine and sometimes unavoidable — a delayed execute computes the real
   * number 450ms later, after the blow lands — but it must be the same formula, or the mark
   * on screen promises a kill the cast does not deliver.
   */
  executeDamageAgainst(target: AttackableUnit): number;

  /**
   * Who to hit when `executeDamageAgainst` kills nobody in range.
   *
   * Optional, and omitted by every *aimed* spell: nothing picks a target for a
   * skillshot, so it has no fallback to state. Those implement the interface
   * only to be marked — `executeCandidates` answers "who is on the line I am
   * pointing at right now" and `pickExecuteTarget` is never called on them.
   * Absent behaves as `'nearest'`.
   */
  readonly executeFallback?: ExecuteFallback;
}

/**
 * What a hit actually has to chew through: the health pool plus every shield
 * standing in front of it. `AttackableUnit.takeDamage` runs the damage past
 * `modifyIncomingDamage` before it touches health, so ignoring shields would
 * mark a shielded 5-health champion as a guaranteed kill and then bounce off.
 */
export const effectiveHealth = (unit: AttackableUnit): number =>
  Math.max(0, unit.stats.health.value) + (unit.shieldAmount || 0);

/**
 * Whether `damage` finishes `unit`.
 *
 * Rounded because `takeDamage` rounds first and only then compares against the
 * pool — a raw 24.6 against 25 health is not a kill there and must not be one
 * here either, or the mark lies by a fraction of a point.
 */
export const isLethal = (damage: number, unit: AttackableUnit): boolean =>
  Math.round(damage) >= effectiveHealth(unit);

const distanceFrom = (origin: { x: number; y: number }, unit: AttackableUnit): number =>
  vecDist(origin, unit.position);

/**
 * The caster, when the spell knows one. Every execute spell is a `Spell` and so
 * has an `owner`; the type stays loose because `lethalTargets` is also handed
 * bare fixtures by the mark tests.
 */
type ExecuteCaster = { owner?: Seeable & { position?: { x: number; y: number } } };

/**
 * Everyone the spell could hit *and* the caster can actually see.
 *
 * The candidate queries are per-spell and every one of them was blind: a
 * delayed execute would sentence a champion through a wall, and the mark promising the kill was
 * painted on a body the player could not see. Filtering here rather than in each
 * `executeCandidates` means the targeting and the mark cannot disagree, which is
 * this module's whole reason for existing.
 */
const visibleCandidates = (spell: ExecuteSpell & ExecuteCaster): AttackableUnit[] => {
  const candidates = spell.executeCandidates();
  const owner = spell.owner;
  if (!owner) return candidates;
  const seen: AttackableUnit[] = [];
  for (const candidate of candidates) {
    if (candidate && canSee(owner, candidate)) seen.push(candidate);
  }
  return seen;
};

/** A spell that carries the two methods, whether or not it declares the interface. */
export function isExecuteSpell(spell: unknown): spell is Spell & ExecuteSpell {
  const candidate = spell as Partial<ExecuteSpell> | null | undefined;
  return (
    typeof candidate?.executeCandidates === 'function' &&
    typeof candidate?.executeDamageAgainst === 'function'
  );
}

/** Everyone in range the spell would kill right now. Drives the on-screen mark. */
export function lethalTargets(spell: ExecuteSpell & ExecuteCaster): AttackableUnit[] {
  const found: AttackableUnit[] = [];
  for (const candidate of visibleCandidates(spell)) {
    if (!candidate || candidate.isDead) continue;
    if (isLethal(spell.executeDamageAgainst(candidate), candidate)) found.push(candidate);
  }
  return found;
}

/**
 * The enemy this cast should take.
 *
 * Among the ones that die, the *lowest* effective health wins rather than the
 * nearest. Two reasons, and the first is the one that bites: a lethal pick is
 * only a promise until the damage lands, and a delayed execute takes 450ms
 * to land it — during which a heal or a shield can save anyone. The candidate
 * with the least health left is the one that survives the fewest of those. The
 * second is that it is the same rule that delayed execute already used, so
 * nothing about that ability changed shape.
 *
 * Distance only breaks a tie. With nobody killable the spell's own fallback
 * decides, which is what keeps a plain stack-banking spell usable as an
 * ordinary damage button.
 */
export function pickExecuteTarget(spell: ExecuteSpell & ExecuteCaster): AttackableUnit | null {
  const origin = spell.owner?.position;
  if (!origin) return null;

  let lethalPick: AttackableUnit | null = null;
  let lethalHealth = Infinity;
  let lethalDistance = Infinity;
  let fallbackPick: AttackableUnit | null = null;
  let fallbackScore = Infinity;

  for (const candidate of visibleCandidates(spell)) {
    if (!candidate || candidate.isDead) continue;

    const health = effectiveHealth(candidate);
    const distance = distanceFrom(origin, candidate);

    if (isLethal(spell.executeDamageAgainst(candidate), candidate)) {
      if (health < lethalHealth || (health === lethalHealth && distance < lethalDistance)) {
        lethalPick = candidate;
        lethalHealth = health;
        lethalDistance = distance;
      }
      continue;
    }

    const score = spell.executeFallback === 'weakest' ? health : distance;
    if (score < fallbackScore) {
      fallbackPick = candidate;
      fallbackScore = score;
    }
  }

  // A lethal candidate is never also considered for the fallback slot above,
  // which is safe precisely because finding one means the fallback is unused.
  return lethalPick ?? fallbackPick;
}
