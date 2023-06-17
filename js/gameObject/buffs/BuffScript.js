import BuffAddType from '../../enums/BuffAddType.js';

export default class BuffScript {
  statsModifier = null;
  buffAddType = BuffAddType.RENEW_EXISTING;
  maxStack = 1;
  // buffType = null;
  // isHidden = false;

  onActivate(targetUnit, buff) {}

  onDeactivate(targetUnit, buff) {}

  onUpdate() {}
}
