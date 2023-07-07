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
  _deactivated = false;
  _activated = false;

  constructor(duration, sourceUnit, targetUnit) {
    this.duration = duration || 0;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;
    this.game = targetUnit?.game || sourceUnit?.game;
  }

  activateBuff() {
    if (!this._created) {
      this.onCreate();
      this._created = true;
    }
    if (this._activated) return;
    this.onActivate();
    this._activated = true;
  }

  deactivateBuff() {
    if (this._deactivated) return;
    this._deactivated = true;
    this.toRemove = true;
    this.onDeactivate();
    for (let listener of this._deactivateListeners) {
      listener?.();
    }
  }

  renewBuff() {
    if (this._deactivated) {
      this.onActivate(); // re-activate
      this._deactivated = false;
    }
    this.timeElapsed = 0;
    this.toRemove = false;
  }

  update() {
    this.onUpdate();

    this.timeElapsed += deltaTime;
    if (this.duration && this.timeElapsed >= this.duration) {
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
