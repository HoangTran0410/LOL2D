import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';

export default class ChangeStatsBuff extends Buff {
  constructor(
    duration,
    sourceUnit,
    targetUnit,
    statsModifier,
    buffAddType = BuffAddType.REPLACE_EXISTING,
    maxStacks = 1
  ) {
    super(duration, sourceUnit, targetUnit);

    this.statsModifier = statsModifier;
    this.buffAddType = buffAddType;
    this.maxStacks = maxStacks;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
