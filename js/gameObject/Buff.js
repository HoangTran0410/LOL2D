import BuffAddType from '../enums/BuffAddType.js';

export default class Buff {
  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 0;
  timeElapsed = 0;
  isToRemove = false;

  constructor(duration, sourceUnit, targetUnit) {
    this.duration = duration;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;

    this.onCreate();
  }

  get name() {
    return this.constructor.name;
  }

  activateBuff() {
    this.onActivate();
  }

  deactivateBuff() {
    this.isToRemove = true;
    this.onDeactivate();
  }

  renewBuff() {
    this.timeElapsed = 0;
    this.isToRemove = false;
  }

  update() {
    this.onUpdate();

    this.timeElapsed += deltaTime;
    if (this.timeElapsed >= this.duration) {
      this.deactivateBuff();
    }
  }

  // for override
  onCreate() {}
  onUpdate() {}
  onActivate() {}
  onDeactivate() {}
}
