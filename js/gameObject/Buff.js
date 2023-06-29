import BuffAddType from '../enums/BuffAddType.js';

export default class Buff {
  name = this.constructor.name;
  description = null;
  image = null;

  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 1;
  timeElapsed = 0;
  toRemove = false;

  _deactivateListeners = [];
  _created = false;

  constructor(duration, sourceUnit, targetUnit) {
    this.duration = duration;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;
  }

  activateBuff() {
    if (!this._created) {
      this.onCreate();
      this._created = true;
    }
    this.onActivate();
  }

  deactivateBuff() {
    this.toRemove = true;
    this.onDeactivate();
    for (let listener of this._deactivateListeners) {
      listener?.();
    }
  }

  renewBuff() {
    this.timeElapsed = 0;
    this.toRemove = false;
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
  draw() {}

  addDeactivateListener(listener) {
    this._deactivateListeners.push(listener);
  }
}
