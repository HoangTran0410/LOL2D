import StatusFlags from '@/game/enums/StatusFlags';
import type { BuffConstructor } from '@/game/gameObject/Buff';
import type { CancelReason, InterruptPolicy, SpellRuntimeState } from './types';

/**
 * What ends a spell, in one place.
 *
 * Cancellation used to be scattered: the runtime had a five-flag interrupt
 * table, `Spell` had an all-or-nothing escape hatch from it, `Dash` had a list
 * of buff classes, and each buff-driven effect invented its own end condition.
 * The question they were all answering is the same one, and it is not "which
 * interrupts apply" — it is **where the live effect lives**. A champion drawing
 * a bow is holding the spell in his hands; a tornado already standing in the
 * world is not, and stunning the summoner cannot delete it. Name that, and the
 * flags fall out of it.
 *
 * A spell picks one `SpellForm`. Everything else here is the machinery that
 * turns the caster's live state into a `CancelReason` the form can accept or
 * refuse.
 */

/** The states in which a spell is live enough to be interrupted at all. */
const INTERRUPTIBLE_STATES: readonly SpellRuntimeState[] = [
  'CASTING',
  'CHARGING',
  'CHANNELING',
  'ACTIVE',
];

export const isInterruptibleState = (state: SpellRuntimeState): boolean =>
  INTERRUPTIBLE_STATES.includes(state);

/**
 * The four shapes a live spell can have. Each is a complete interrupt table, so
 * a spell states one name instead of switching flags on and off and leaving the
 * reader to work out what it meant.
 *
 * - `HELD` — the champion is performing it right now, so everything that takes
 *   control of him away takes the spell with it. The default, and correct for
 *   every cast time, every channel and every instant press.
 * - `AIMED` — held, but walking is part of the gesture: a drawn bow tracks the
 *   cursor while the champion strafes. Crowd control still takes it.
 * - `TETHERED` — the effect stands in the world but stays bound to the caster,
 *   who may walk and be shoved around without ending it. Losing control of
 *   himself still ends it, because he is still paying for it.
 * - `INDEPENDENT` — the effect is out of his hands and running on its own
 *   clock. Only his death reaches it. This is the summoned-object case, and
 *   also the self-effect case: a roll already has its momentum.
 *
 * Death is on in every form. An effect that outlives its caster is a bug in
 * every case this codebase has; `SpellObject.attachTo` is the same rule for
 * objects glued to a body.
 */
export const SpellForm = {
  HELD: { death: true, stun: true, silence: true, displacement: true, move: true },
  AIMED: { death: true, stun: true, silence: true, displacement: true, move: false },
  TETHERED: { death: true, stun: true, silence: true, displacement: false, move: false },
  INDEPENDENT: { death: true, stun: false, silence: false, displacement: false, move: false },
} as const satisfies Record<string, InterruptPolicy>;

export type SpellFormName = keyof typeof SpellForm;

export const SPELL_FORM_NAMES = Object.keys(SpellForm) as readonly SpellFormName[];

/** The interrupt reasons a form can switch off. The rest always apply. */
export const INTERRUPT_REASONS = {
  DEATH: 'death',
  STUN: 'stun',
  SILENCE: 'silence',
  DISPLACEMENT: 'displacement',
  MOVE: 'move',
} as const satisfies Partial<Record<CancelReason, keyof InterruptPolicy>>;

/** Whether this reason is one a form may refuse, and which switch governs it. */
export const interruptSwitchFor = (reason: CancelReason): keyof InterruptPolicy | undefined =>
  (INTERRUPT_REASONS as Partial<Record<CancelReason, keyof InterruptPolicy>>)[reason];

/** A partial override read against the default form, so callers see all five. */
export const resolveInterrupts = (interrupts?: Partial<InterruptPolicy>): InterruptPolicy => ({
  ...SpellForm.HELD,
  ...interrupts,
});

/** The name of the form this table is, when it is one of them. */
export const spellFormNameOf = (
  interrupts: Partial<InterruptPolicy> | undefined
): SpellFormName | undefined => {
  const resolved = resolveInterrupts(interrupts);
  return SPELL_FORM_NAMES.find(name =>
    (Object.keys(resolved) as (keyof InterruptPolicy)[]).every(
      key => SpellForm[name][key] === resolved[key]
    )
  );
};

/** The caster state the owner watcher reads. Structural, so tests can fake it. */
export interface InterruptibleOwner {
  isDead?: boolean;
  status?: number;
  canCast?: boolean;
  position: { x: number; y: number };
  destination?: { x: number; y: number };
  movementRevision?: number;
  displacementRevision?: number;
  hasBuff?(buffClass: BuffConstructor): boolean;
}

/**
 * Where the caster was when the cast was accepted. `ownerInterruptReason`
 * updates it as it reads, so a fallback owner without revision counters is
 * compared against the previous frame rather than against the cast forever.
 */
export interface OwnerMovementSnapshot {
  position: { x: number; y: number };
  destination?: { x: number; y: number };
  movementRevision?: number;
  displacementRevision?: number;
}

export const snapshotOwnerMovement = (owner: InterruptibleOwner): OwnerMovementSnapshot => ({
  position: { x: owner.position.x, y: owner.position.y },
  ...(owner.destination ? { destination: { x: owner.destination.x, y: owner.destination.y } } : {}),
  movementRevision: owner.movementRevision,
  displacementRevision: owner.displacementRevision,
});

/**
 * A buff that suspends the watcher entirely rather than ending what it guards.
 *
 * Stasis is the case that needs it: Zhonya's makes the champion untargetable
 * and unable to act, which reads to the watcher as a stun and a silence at
 * once, but it is a pause, not an interrupt — whatever he was sustaining is
 * still his when it ends. Listed per spell in `CastSpec.suspendedBy`, so the
 * exemption is one named buff rather than a blanket opt-out.
 */
export const interruptsSuspended = (
  owner: InterruptibleOwner,
  suspendedBy: readonly BuffConstructor[] | undefined
): boolean => {
  if (!suspendedBy || suspendedBy.length === 0) return false;
  return suspendedBy.some(buffClass => owner.hasBuff?.(buffClass) === true);
};

/**
 * The one place a caster's live state becomes a `CancelReason`.
 *
 * Returns the reason regardless of whether the spell's form accepts it; the
 * runtime applies the form when it is handed the reason, which keeps "what
 * happened" and "does it matter to this spell" as two separate decisions.
 */
export const ownerInterruptReason = (
  owner: InterruptibleOwner,
  snapshot?: OwnerMovementSnapshot
): CancelReason | null => {
  if (owner.isDead) return 'DEATH';

  const status = typeof owner.status === 'number' ? owner.status : 0;
  if ((status & (StatusFlags.Stunned | StatusFlags.Suppressed)) !== 0) return 'STUN';
  if ((status & StatusFlags.Silenced) !== 0 || !owner.canCast) return 'SILENCE';
  if (!snapshot) return null;

  // A unit that counts its own move orders and displacements is authoritative:
  // "the destination changed" and "somebody moved me" are facts it already
  // records, and reading them cannot mistake one for the other.
  const hasExplicitMovementSignals =
    typeof owner.movementRevision === 'number' && typeof owner.displacementRevision === 'number';
  if (hasExplicitMovementSignals) {
    if (owner.displacementRevision !== snapshot.displacementRevision) return 'DISPLACEMENT';
    if (owner.movementRevision !== snapshot.movementRevision) return 'MOVE';
    return null;
  }

  // Fallback for a unit with no counters: infer from position and destination.
  // Walking towards a destination is a move; changing position without one is
  // something else moving the unit.
  const { position, destination } = snapshot;
  const currentPosition = owner.position;
  const currentDestination = owner.destination;
  const destinationChanged =
    !!destination &&
    !!currentDestination &&
    (currentDestination.x !== destination.x || currentDestination.y !== destination.y);
  const positionChanged = currentPosition.x !== position.x || currentPosition.y !== position.y;

  let reason: CancelReason | null = null;
  if (
    destinationChanged ||
    (positionChanged &&
      !!destination &&
      (destination.x !== position.x || destination.y !== position.y))
  ) {
    reason = 'MOVE';
  } else if (positionChanged) {
    reason = 'DISPLACEMENT';
  }

  if (destination && currentDestination) {
    destination.x = currentDestination.x;
    destination.y = currentDestination.y;
  }
  position.x = currentPosition.x;
  position.y = currentPosition.y;
  return reason;
};

/**
 * The other half of the model: an effect already applied to a unit, which ends
 * when somebody *else* takes control of that unit.
 *
 * A dash is the case. It is not a spell state, so it cannot use a form — it is
 * already flying — but the question is the same one, and the answer has to name
 * the source: a spell that roots you and then pulls you must not have its own
 * pull cancelled by its own root. `Dash.buffsToCheckCancel` is the list, and
 * `DASH_INTERRUPT_BUFFS` in that file is its default.
 */
export const foreignControlBuff = <TBuff extends { sourceUnit: unknown }>(
  buffs: readonly TBuff[],
  self: TBuff,
  sourceUnit: unknown,
  buffClasses: readonly BuffConstructor[]
): TBuff | undefined =>
  buffs.find(
    buff =>
      buff !== self &&
      buff.sourceUnit !== sourceUnit &&
      buffClasses.some(buffClass => buff instanceof buffClass)
  );
