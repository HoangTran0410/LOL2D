import { isChargeActivation } from '@/game/spell/runtime/types';
import type {
  ActivationPattern,
  CancelReason,
  CastContext,
  SpellRuntimeState,
} from '@/game/spell/runtime/types';

interface InputSpell {
  readonly state: SpellRuntimeState;
  /**
   * Optional so a test double need not build a whole spec. Only the pointer
   * path reads it, and only to tell a charge from everything else.
   */
  readonly castSpec?: { readonly activation: ActivationPattern };
  press(context: CastContext): boolean;
  hold(context: CastContext): boolean;
  release(context: CastContext): boolean;
  cancel(reason: CancelReason): boolean;
}

interface HeldGesture {
  readonly slot: number;
  heldMs: number;
  /**
   * True when `press` has been withheld until the finger lifts. See
   * `pointerDown` for why that is not the same as a key press.
   */
  readonly deferPress: boolean;
}

interface SpellInputControllerOptions {
  keyBindings: readonly number[];
  getSpell(slot: number): InputSpell | undefined;
  createContext(spell: InputSpell, slot: number, heldMs: number): CastContext | undefined;
}

export class SpellInputController {
  private readonly heldKeys = new Map<number, { slot: number; heldMs: number }>();
  /** Keyed by slot, not by key code: a thumb has no key. */
  private readonly heldPointers = new Map<number, HeldGesture>();

  constructor(private readonly options: SpellInputControllerOptions) {}

  keyDown(keyCode: number, repeated: boolean): void {
    if (repeated || this.heldKeys.has(keyCode)) return;

    const slot = this.options.keyBindings.indexOf(keyCode);
    if (slot < 0) return;

    const spell = this.options.getSpell(slot);
    if (!spell) return;

    this.heldKeys.set(keyCode, { slot, heldMs: 0 });
    const context = this.options.createContext(spell, slot, 0);
    if (context) spell.press(context);
  }

  keyUp(keyCode: number): void {
    const held = this.heldKeys.get(keyCode);
    if (!held) return;

    this.heldKeys.delete(keyCode);
    const spell = this.options.getSpell(held.slot);
    if (!spell || spell.state !== 'CHARGING') return;

    const context = this.options.createContext(spell, held.slot, held.heldMs);
    if (context) spell.release(context);
  }

  /**
   * A thumb has landed on slot `slot`'s button.
   *
   * A charge is pressed here, exactly as a key would press it: a charge-and-
   * release spell has to *start charging* the moment the thumb lands, and its
   * whole reason for existing is the time between that and the release.
   *
   * Everything else has its press withheld until `pointerUp`. On the keyboard
   * that distinction does not exist, because a PRESS spell casts inside
   * `press()` and the key is down and up in the same instant anyway. On glass
   * it matters enormously: pressing at touch-down would fire the spell before
   * the drag that aims it has happened at all. Deferring is done here, in the
   * one controller that owns activation, rather than by teaching SpellRuntime a
   * second way to start — the runtime never learns a touch happened.
   */
  pointerDown(slot: number): boolean {
    if (this.heldPointers.has(slot)) return false;

    const spell = this.options.getSpell(slot);
    if (!spell) return false;

    const deferPress = !isChargeActivation(spell.castSpec?.activation ?? 'PRESS');
    this.heldPointers.set(slot, { slot, heldMs: 0, deferPress });
    if (deferPress) return true;

    const context = this.options.createContext(spell, slot, 0);
    return context ? spell.press(context) : false;
  }

  /**
   * The thumb has lifted: commit. A withheld press happens now, with the aim
   * the drag ended on; a charge releases the way a key release would.
   */
  pointerUp(slot: number): boolean {
    const held = this.heldPointers.get(slot);
    if (!held) return false;

    this.heldPointers.delete(slot);
    const spell = this.options.getSpell(slot);
    if (!spell) return false;

    const context = this.options.createContext(spell, slot, held.heldMs);
    if (!context) return false;
    if (held.deferPress) return spell.press(context);
    return spell.state === 'CHARGING' ? spell.release(context) : false;
  }

  /**
   * The thumb came back to the button, or went somewhere the gesture means
   * "no". A withheld press is simply never made, so the abort costs nothing at
   * all — no mana, no cooldown, no event. A charge that is already running has
   * to be cancelled through the runtime, and what that refunds is the spell's
   * own resource policy to decide.
   */
  pointerCancel(slot: number): boolean {
    const held = this.heldPointers.get(slot);
    if (!held) return false;

    this.heldPointers.delete(slot);
    if (held.deferPress) return true;

    const spell = this.options.getSpell(slot);
    return spell ? spell.cancel('PLAYER_CANCEL') : false;
  }

  /** True while a thumb owns this slot — the drawing layer asks. */
  isPointerHeld(slot: number): boolean {
    return this.heldPointers.has(slot);
  }

  update(deltaMs: number): void {
    const elapsed = Math.max(0, deltaMs);
    for (const held of this.heldKeys.values()) {
      held.heldMs += elapsed;
      const spell = this.options.getSpell(held.slot);
      if (!spell) continue;

      const context = this.options.createContext(spell, held.slot, held.heldMs);
      if (context) spell.hold(context);
    }

    // A held pointer ticks the same way, so a charge under a thumb keeps
    // re-aiming at wherever the drag has reached. A deferred slot is skipped:
    // it has not been pressed, so there is nothing to hold, and building a
    // context for it every frame would be work for nobody.
    for (const held of this.heldPointers.values()) {
      held.heldMs += elapsed;
      if (held.deferPress) continue;
      const spell = this.options.getSpell(held.slot);
      if (!spell) continue;

      const context = this.options.createContext(spell, held.slot, held.heldMs);
      if (context) spell.hold(context);
    }
  }

  cancelAll(reason: CancelReason): void {
    const cancelled = new Set<InputSpell>();
    for (let slot = 0; slot < this.options.keyBindings.length; slot++) {
      const spell = this.options.getSpell(slot);
      if (spell && !cancelled.has(spell)) {
        cancelled.add(spell);
        spell.cancel(reason);
      }
    }
    this.heldKeys.clear();
    this.heldPointers.clear();
  }
}

export default SpellInputController;
