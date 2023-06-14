export default class Spell {
  constructor(game, SpellScript) {
    this.game = game;
    this.spellScript = SpellScript(this);
  }
}
