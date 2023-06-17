export default class Buff {
  constructor(game, BuffScriptClass, duration, sourceUnit, targetUnit) {
    this.game = game;
    this.buffScript = new BuffScriptClass();
    this.duration = duration;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;

    this.timeElapsed = 0;
    this.isToRemove = false;
  }

  get name() {
    return this.buffScript.constructor.name;
  }

  get buffAddType() {
    return this.buffScript.buffAddType;
  }

  get maxStack() {
    return this.buffScript.maxStack;
  }

  activateBuff() {
    this.buffScript.onActivate(this.targetUnit);

    // if (this.buffScript.statsModifier) {
    //   this.targetUnit.stats.addModifier(this.buffScript.statsModifier);
    // }
  }

  deactivateBuff() {
    this.buffScript.onDeactivate(this.targetUnit);

    if (this.buffScript.statsModifier) {
      this.targetUnit.stats.removeModifier(this.buffScript.statsModifier);
    }

    this.isToRemove = true;
  }

  renewBuff() {
    this.timeElapsed = 0;
  }

  update() {
    if (this.isToRemove) return;

    this.timeElapsed += deltaTime;
    this.buffScript.onUpdate();
    if (this.timeElapsed >= this.duration) {
      this.deactivateBuff();
    }
  }
}
