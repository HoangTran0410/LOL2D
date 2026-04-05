import BuffAddType from '../enums/BuffAddType';

export default class Buff {
  name = this.constructor.name;
  description: any = null;
  image: any = null;

  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 1;
  timeElapsed = 0;
  toRemove = false;

  statusFlagsToEnable = 0;
  statusFlagsToDisable = 0;

  duration = 0;
  sourceUnit: any = null;
  targetUnit: any = null;
  game: any = null;

  _deactivateListeners: (() => void)[] = [];
  _created = false;
  _deactivated = false;
  _activated = false;

  constructor(duration?: number, sourceUnit?: any, targetUnit?: any) {
    this.duration = duration || 0;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;
    this.game = targetUnit?.game || sourceUnit?.game;
  }

  activateBuff(): void {
    if (!this._created) {
      this.onCreate();
      this._created = true;
    }
    if (this._activated) return;
    this.onActivate();
    this._activated = true;
  }

  deactivateBuff(): void {
    if (this._deactivated) return;
    this._deactivated = true;
    this.toRemove = true;
    this.onDeactivate();
    for (const listener of this._deactivateListeners) {
      listener?.();
    }
  }

  renewBuff(): void {
    if (this._deactivated) {
      this.onActivate(); // re-activate
      this._deactivated = false;
    }
    this.timeElapsed = 0;
    this.toRemove = false;
  }

  update(): void {
    this.onUpdate();

    this.timeElapsed += deltaTime;
    if (this.duration && this.timeElapsed >= this.duration) {
      this.deactivateBuff();
    }
  }

  // for override
  onCreate(): void {}
  onUpdate(): void {}
  onActivate(): void {}
  onDeactivate(): void {}
  draw(): void {}

  addDeactivateListener(listener: () => void): void {
    this._deactivateListeners.push(listener);
  }
}
