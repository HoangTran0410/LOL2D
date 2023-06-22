import SpellState from '../enums/SpellState.js';
import StatusFlags from '../enums/StatusFlags.js';
import { hasFlag } from '../utils/index.js';

export default class Spell {
  // for display in HUD
  name = this.constructor.name;
  image = null;
  description = null;

  // for spell logic
  level = 0;
  coolDown = 0;
  currentCooldown = 0;

  constructor(owner) {
    this.owner = owner;
    this.game = owner.game;
    this.state = SpellState.READY;

    this.onActivate();
  }

  update() {
    this.onUpdate();

    switch (this.state) {
      case SpellState.READY:
        break;

      case SpellState.COOLDOWN:
        this.currentCooldown -= deltaTime;
        if (this.currentCooldown <= 0) {
          this.currentCooldown = 0;
          this.state = SpellState.READY;
        }
        break;

      default:
    }
  }

  cast() {
    if (this.state !== SpellState.READY) return;
    if (this.castCancelCheck()) return;

    this.state = SpellState.COOLDOWN;
    this.currentCooldown = this.coolDown;
    this.onSpellCast();
  }
  castCancelCheck() {
    let status = this.owner.status;
    if (
      !hasFlag(status, StatusFlags.CanCast) ||
      hasFlag(status, StatusFlags.Silenced) ||
      hasFlag(status, StatusFlags.Stunned) ||
      hasFlag(status, StatusFlags.Charmed) ||
      hasFlag(status, StatusFlags.Feared)
    ) {
      this.resetSpellCast();
      return true;
    }

    return false;
  }

  // Notes: Deactivate is never called as spell removal hasn't been added yet.
  deactivate() {
    this.resetSpellCast();
    this.onDeactivate();
  }

  resetSpellCast() {
    this.state = SpellState.READY;
    this.currentCastTime = 0;
    this.currentChannelDuration = 0;
  }

  // for override
  onActivate() {}
  onDeactivate() {}
  onSpellCast() {}
  onUpdate() {}
}
