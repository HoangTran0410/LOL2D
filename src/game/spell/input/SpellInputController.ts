import type {
  CancelReason,
  CastContext,
  SpellRuntimeState,
} from '../runtime/types';

interface InputSpell {
  readonly state: SpellRuntimeState;
  press(context: CastContext): boolean;
  hold(context: CastContext): boolean;
  release(context: CastContext): boolean;
  cancel(reason: CancelReason): boolean;
}

interface SpellInputControllerOptions {
  keyBindings: readonly number[];
  getSpell(slot: number): InputSpell | undefined;
  createContext(spell: InputSpell, slot: number, heldMs: number): CastContext | undefined;
}

export class SpellInputController {
  private readonly heldKeys = new Map<number, { slot: number; heldMs: number }>();

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

  update(deltaMs: number): void {
    const elapsed = Math.max(0, deltaMs);
    for (const held of this.heldKeys.values()) {
      held.heldMs += elapsed;
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
  }
}

export default SpellInputController;
