import BuffAddType from '../enums/BuffAddType.js';

export default class Buff {
  name = this.constructor.name;
  description = null;
  image = null;

  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 1;
  timeElapsed = 0;
  isToRemove = false;

  _deactivateListeners = [];

  constructor(duration, sourceUnit, targetUnit) {
    this.duration = duration;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;

    this.onCreate();
  }

  activateBuff() {
    this.onActivate();
  }

  deactivateBuff() {
    this.isToRemove = true;
    this.onDeactivate();
    for (let listener of this._deactivateListeners) {
      listener?.();
    }
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

  addDeactivateListener(listener) {
    this._deactivateListeners.push(listener);
  }
}
