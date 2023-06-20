import SpellState from '../enums/SpellState.js';
import StatusFlags from '../enums/StatusFlags.js';

export default class Spell {
  image = null; // for display in HUD

  level = 0;
  coolDown = 0;
  currentCooldown = 0;

  constructor(owner) {
    this.owner = owner;
    this.state = SpellState.READY;

    this.onActivate();
  }

  get name() {
    return this.constructor.name;
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
      this.owner.isDead ||
      status === !StatusFlags.CanCast ||
      status === StatusFlags.Stunned ||
      status === StatusFlags.Charmed ||
      status === StatusFlags.Feared
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
