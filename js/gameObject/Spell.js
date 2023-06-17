import SpellState from '../enums/SpellState.js';

export default class Spell {
  constructor(game, owner, SpellScriptClass) {
    this.game = game;
    this.owner = owner;
    this.spellScript = new SpellScriptClass();

    this.state = SpellState.READY;
  }

  cast() {}
}
