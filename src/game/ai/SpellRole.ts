import type Spell from '@/game/gameObject/Spell';
import type { TargetingMode } from '@/game/spell/runtime/types';
import type { TargetTeam } from '@/game/spell/targeting/TargetResolver';

/**
 * What an ability *does*, as bit flags, so one spell can be several things at
 * once — a dash that also damages and knocks up is `Damage | Dash | Cc`, and
 * the scorer adds a term for each. A single-valued enum would have forced
 * every such spell to lie about two thirds of itself.
 */
export const SpellRole = Object.freeze({
  None: 0,
  Damage: 1 << 0,
  Poke: 1 << 1,
  Burst: 1 << 2,
  Dash: 1 << 3,
  Escape: 1 << 4,
  Cc: 1 << 5,
  Heal: 1 << 6,
  Shield: 1 << 7,
  Buff: 1 << 8,
  Zone: 1 << 9,
  Summon: 1 << 10,
  Ultimate: 1 << 11,
} as const);

export type SpellRoleMask = number;

/** The one way to build a mask. Named so a spell file reads `roles(A, B)`. */
export const roles = (...flags: SpellRoleMask[]): SpellRoleMask =>
  flags.reduce((mask, flag) => mask | flag, SpellRole.None);

export const hasRole = (mask: SpellRoleMask, role: SpellRoleMask): boolean => (mask & role) !== 0;

/** `SpellHotKeys` is `[A, Q, W, E, R, D, F]`, so R — the ultimate — is index 4. */
export const ULTIMATE_SLOT = 4;

/** At or above this, a spell is expensive enough to be treated as a burst tool. */
export const BURST_MANA_THRESHOLD = 40;
/** At or above this reach, a skillshot is a poke tool rather than a commitment. */
export const POKE_RANGE_THRESHOLD = 400;

/**
 * What we can tell about an ability from what it already declares.
 *
 * Deliberately conservative: it never guesses `Dash`, `Escape` or `Summon`,
 * because nothing here distinguishes them and a wrong guess there makes a
 * bot flee with a gap-closer. Those need `static aiRoles`.
 */
export interface InferenceInput {
  targeting: TargetingMode;
  /** 0 when the spell declares none. */
  range: number;
  targetTeam?: TargetTeam;
  manaCost: number;
}

export function inferRoles(input: InferenceInput): SpellRoleMask {
  const { range, targetTeam, manaCost } = input;
  const burst = manaCost >= BURST_MANA_THRESHOLD ? SpellRole.Burst : SpellRole.None;

  switch (input.targeting) {
    case 'SELF':
      return manaCost === 0 ? SpellRole.Buff : roles(SpellRole.Buff, SpellRole.Shield);
    case 'UNIT':
      return targetTeam === 'ALLY'
        ? roles(SpellRole.Heal, SpellRole.Shield)
        : roles(SpellRole.Damage, SpellRole.Cc, burst);
    case 'POINT':
      return range >= POKE_RANGE_THRESHOLD
        ? roles(SpellRole.Damage, SpellRole.Poke, burst)
        : roles(SpellRole.Damage, SpellRole.Zone, burst);
    default:
      return range >= POKE_RANGE_THRESHOLD
        ? roles(SpellRole.Damage, SpellRole.Poke, burst)
        : roles(SpellRole.Damage, burst);
  }
}

/**
 * Cached by *constructor*, so inference runs once per champion ability for the
 * whole match rather than once per bot per think tick.
 *
 * `Ultimate` is deliberately not in the cached value. A `Spell` instance does
 * not know its own slot — `Champion.applyPreset` builds them with
 * `map((SpellClass, index) => new SpellClass(this))` and throws the index away
 * — and the custom kit builder can put any ability in any slot. Caching a
 * slot-derived flag would let one bot's R poison every other bot's W.
 */
const classMask = new WeakMap<Function, SpellRoleMask>();

export function rolesOf(spell: Spell, slotIndex: number): SpellRoleMask {
  const ctor = spell.constructor as Function & { aiRoles?: SpellRoleMask };
  let mask = classMask.get(ctor);
  if (mask === undefined) {
    mask =
      ctor.aiRoles ??
      inferRoles({
        // `range` and `targetTeam` are NOT on `CastSpec` — verified against
        // `src/game/spell/runtime/types.ts`, which has neither. They live on
        // `TargetingRequest`, reached through `spell.targetingRequest`, and
        // `declaredRange` above is already the correct three-step chain.
        targeting: spell.castSpec.targeting,
        range: spell.declaredRange ?? 0,
        targetTeam: spell.targetingRequest?.targetTeam,
        manaCost: spell.manaCost,
      });
    classMask.set(ctor, mask);
  }
  return slotIndex === ULTIMATE_SLOT ? mask | SpellRole.Ultimate : mask;
}
