// TODO: https://leagueoflegends.fandom.com/wiki/Nearsight
import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';

export default class Nearsight extends Buff {
  image = AssetManager.getAsset('buff_nearsight');
  name = 'Mù';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  // for override
  newSightRadius = 0;
  activeLerpSpeed = 0.1; // speed of changing sight radius when buff is active
  deactiveLerpSpeed = 0.05; // speed of changing sight radius when buff is deactivated

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.sightRadius.baseValue =
      -this.targetUnit.stats.sightRadius.baseValue + this.newSightRadius;
  }

  onActivate() {
    this.game.fogOfWar.sightChangeLerpSpeed = this.activeLerpSpeed;
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.game.fogOfWar.sightChangeLerpSpeed = this.deactiveLerpSpeed;
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
