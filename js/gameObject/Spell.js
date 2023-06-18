import SpellState from '../enums/SpellState.js';
import StatusFlags from '../enums/StatusFlags.js';

export default class Spell {
  level = 0;
  coolDown = 0;
  channelDuration = 0;

  currentCooldown = 0;
  currentCastTime = 0; // Time until casting will end for this spell.
  currentChannelDuration = 0; // Time until channeling will finish for this spell.

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

      case SpellState.CASTING:
        if (this.castCancelCheck()) break;
        this.currentCastTime -= deltaTime;

        if (this.currentCastTime <= 0) {
          this.finishCasting();

          if (this.channelDuration > 0) {
            this.channel();
          }
        }
        break;

      case SpellState.COOLDOWN:
        this.currentCooldown -= deltaTime;
        if (this.currentCooldown <= 0) {
          this.state = SpellState.READY;
        }
        break;

      case SpellState.CHANNELING:
        this.currentChannelDuration -= deltaTime;
        this.channelCancelCheck();
        if (this.currentChannelDuration <= 0) {
          this.finishChanneling();
        }
        break;

      default:
    }
  }

  cast() {
    this.onSpellPreCast();

    this.onSpellCast();

    this.onSpellPostCast();
  }
  finishCasting() {}
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

  channel() {
    this.onSpellChannel();
  }
  finishChanneling() {
    this.onSpellPostChannel();
  }
  channelCancelCheck() {
    let willCancel = this.castCancelCheck();
    if (willCancel) {
      this.onSpellChannelCancel();
    }
    return willCancel;
  }

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
  onActivate(owner, spell) {}
  onDeactivate(owner, spell) {}
  onSpellPreCast(owner, spell, target, start, end) {}
  onSpellCast(spell) {}
  onSpellPostCast(spell) {}
  onSpellChannel(spell) {}
  onSpellChannelCancel(spell, channelingStopReason) {}
  onSpellPostChannel(spell) {}
  onUpdate() {}
}
