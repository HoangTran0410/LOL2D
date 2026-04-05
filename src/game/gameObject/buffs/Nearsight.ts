// TODO: https://leagueoflegends.fandom.com/wiki/Nearsight
import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';
import { StatsModifier } from '../Stats';

export default class Nearsight extends Buff {
  image = AssetManager.getAsset('buff_nearsight');
  name = 'Mờ Mắt';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToEnable = StatusFlags.NearSighted;

  // for override
  newVisionRadius = 0;
  activeLerpSpeed = 0.1; // speed of changing sight radius when buff is active
  deactiveLerpSpeed = 0.05; // speed of changing sight radius when buff is deactivated

  statsModifier: StatsModifier = new StatsModifier();

  onCreate(): void {
    this.statsModifier = new StatsModifier();
    this.statsModifier.visionRadius.baseValue =
      -this.targetUnit.stats.visionRadius.baseValue + this.newVisionRadius;
  }

  onActivate(): void {
    this.game.fogOfWar.sightChangeLerpSpeed = this.activeLerpSpeed;
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(): void {
    this.game.fogOfWar.sightChangeLerpSpeed = this.deactiveLerpSpeed;
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
