import SpellState from '../enums/SpellState.js';

export default class Spell {
  level = 0;
  coolDown = 0;
  currentCooldown = 0;

  constructor(owner) {
    this.owner = owner;

    this.state = SpellState.READY;
  }

  get name() {
    return this.constructor.name;
  }

  cast() {}

  update() {
    this.onUpdate();

    switch (this.state) {
      case SpellState.READY:
        break;
      case SpellState.CASTING:
        break;
      case SpellState.COOLDOWN:
        break;
      case SpellState.CHANNELING:
        break;
      default:
    }
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
