import BuffAddType from '../enums/BuffAddType';
import type { AssetHandle } from '../../managers/AssetManager';
import type { GameObjectRuntimeContext } from './GameObject';
import type AttackableUnit from './attackableUnits/AttackableUnit';

export type BuffStackId = string | Function;

export type BuffConstructorArgs = [
  duration: number,
  sourceUnit: AttackableUnit,
  targetUnit: AttackableUnit,
];

export default class Buff {
  name = this.constructor.name;
  description: string | null = null;
  image: AssetHandle | null | undefined = null;

  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 1;

  /**
   * Identity used to decide which existing buffs this one stacks with or
   * replaces. Defaults to the class itself, which is what you want for a buff
   * that means one thing (Stun, Root).
   *
   * Set it when several unrelated spells apply the same generic buff class —
   * two bare `StatAmp`s or `DamageOverTime`s would otherwise fight over one
   * slot, so each spell should tag its own, e.g. `buff.stackId = 'ignite'`.
   */
  stackId: BuffStackId | null = null;
  timeElapsed = 0;
  toRemove = false;

  statusFlagsToEnable = 0;
  statusFlagsToDisable = 0;

  duration = 0;
  sourceUnit: AttackableUnit;
  targetUnit: AttackableUnit;
  game: GameObjectRuntimeContext;

  _deactivateListeners: (() => void)[] = [];
  _created = false;
  _deactivated = false;
  _activated = false;

  constructor(...[duration, sourceUnit, targetUnit]: BuffConstructorArgs) {
    this.duration = duration;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;
    this.game = targetUnit.game;
  }

  activateBuff(): void {
    if (!this._created) {
      this.onCreate();
      this._created = true;
    }
    if (this._activated) return;
    this.onActivate();
    this._activated = true;
  }

  deactivateBuff(): void {
    if (this._deactivated) return;
    this._deactivated = true;
    this.toRemove = true;
    this.onDeactivate();
    for (const listener of this._deactivateListeners) {
      listener?.();
    }
  }

  renewBuff(): void {
    if (this._deactivated) {
      this.onActivate(); // re-activate
      this._deactivated = false;
    }
    this.timeElapsed = 0;
    this.toRemove = false;
  }

  update(): void {
    this.onUpdate();

    this.timeElapsed += deltaTime;
    if (this.duration && this.timeElapsed >= this.duration) {
      this.deactivateBuff();
    }
  }

  // for override
  onCreate(): void {}
  onUpdate(): void {}
  onActivate(): void {}
  onDeactivate(): void {}
  draw(): void {}

  /**
   * Runs before damage reaches the target's health. Return what should get
   * through: less for shields and damage reduction, more for amplification.
   * Every buff on the unit sees the damage in turn.
   */
  modifyIncomingDamage(damage: number, _attacker?: AttackableUnit): number {
    return damage;
  }

  /**
   * Damage this buff can still absorb, drawn as a grey overlay on the health
   * bar. Anything that soaks damage should report it here so the player can see
   * how much cushion is left; the health bar never has to know the class.
   */
  get shieldAmount(): number {
    return 0;
  }

  addDeactivateListener(listener: () => void): void {
    this._deactivateListeners.push(listener);
  }
}
