import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';

/**
 * Takes no damage from anything, and nothing else.
 *
 * Deliberately not `StatusFlags.Invulnerable`: that flag is in the enum but
 * nothing reads it — `ActionState` has no matching bit and
 * `Stats.updateActionState` has no line for it. What works is
 * `modifyIncomingDamage`, which `AttackableUnit.takeDamage` already loops
 * every buff through, returning early once damage reaches zero. `Stasis` is
 * built on exactly this.
 *
 * Deliberately not `Stasis` itself, which is this *plus* a stun and a dropped
 * `Targetable`: a player who switches invulnerability on to practise a combo
 * must still be able to move and cast.
 *
 * Icon reuses the Zhonya's hourglass — it reads correctly and needs no new
 * asset.
 */
export default class Invulnerable extends Buff {
  image: Buff['image'] = AssetManager.get('buff_stasis');
  name = 'Bất Tử';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  modifyIncomingDamage(): number {
    return 0;
  }
}
