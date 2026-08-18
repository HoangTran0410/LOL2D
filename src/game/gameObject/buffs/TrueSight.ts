import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';
import GameObject from '@/game/gameObject/GameObject';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

// Cung cấp tầm nhìn
export default class TrueSight extends Buff {
  image: Buff['image'] = AssetManager.get('buff_truesight');
  name = 'Lộ Diện';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToDisable = StatusFlags.Stealthed;

  visionRadius = 100;

  sightObj: GameObject | null = null;

  onCreate(): void {
    // share the live position vector so the sight follows the unit
    this.sightObj = new GameObject({
      game: this.game,
      position: this.targetUnit.position,
      teamId: this.sourceUnit.teamId,
      visionRadius: this.visionRadius,
    });
  }

  onActivate(): void {
    if (this.sightObj) this.game.objectManager.addObject(this.sightObj);
  }

  onDeactivate(): void {
    if (this.sightObj) this.sightObj.toRemove = true;
  }
}

export interface RevealOptions {
  /** This spell's own slot. Never shared, never omitted — see below. */
  stackId: string;
  durationMs: number;
  source: AttackableUnit;
  target: AttackableUnit;
  visionRadius?: number;
  image?: Buff['image'];
}

/**
 * A reveal applied by one particular spell.
 *
 * `stackId` is required, and that requirement is the whole reason this factory
 * exists. Four unrelated spells apply this class — Lux R, Ashe E, Morgana R,
 * Lee Sin Q — and `AttackableUnit.addBuff` groups by `stackId`. Left on the
 * default (the class itself) all four contended for one slot under
 * `REPLACE_EXISTING`, so Lux R's 1.5s reveal cut Ashe E's 3s one short, and
 * `hudState.buildBuffs`, which keys on the same id, folded them into a single
 * row wearing whichever icon happened to arrive first. Both were measured.
 *
 * Passing it as an argument rather than leaving each caller to remember an
 * assignment is what keeps a fifth spell from reopening this: the compiler
 * asks for the slot. `Veigar_Q`'s `createPowerStack` is the same shape for the
 * same reason.
 */
export const createReveal = (options: RevealOptions): TrueSight => {
  const reveal = new TrueSight(options.durationMs, options.source, options.target);
  reveal.stackId = options.stackId;
  if (options.visionRadius !== undefined) reveal.visionRadius = options.visionRadius;
  if (options.image !== undefined) reveal.image = options.image;
  return reveal;
};
