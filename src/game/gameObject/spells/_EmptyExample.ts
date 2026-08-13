/**
 * Templates for new spells. Copy the one that matches the shape you need.
 *
 * After creating the file, register it in three places or it will not show up:
 *   1. `spells/index.ts`        — export it
 *   2. `preset.ts` SpellGroups  — add it to the champion's kit
 *   3. `AssetManager` AssetPaths — add `spell_<name>` pointing at the icon
 */
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import TrailSystem from '../helpers/TrailSystem';

export default class SpellName extends Spell {
  image = AssetManager.placeholder('spell_name');
  name = '';
  description = 'Spell description';
  coolDown = 1000;

  onSpellCast() {}
  onUpdate() {}
}

/**
 * A skillshot. `MissileSpellObject` already handles travelling to the
 * destination, hitting each enemy once, the trail, and the bounding box — so a
 * normal projectile is just tuning fields plus `onHit` and `draw`.
 */
export class SpellName_Skillshot extends Spell {
  image = AssetManager.placeholder('spell_name');
  name = '';
  description = '';
  coolDown = 5000;
  range = 400;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      this.range
    );

    const obj = new SpellName_Missile(this.owner);
    obj.destination = to;
    this.game.objectManager.addObject(obj);
  }
}

export class SpellName_Missile extends MissileSpellObject {
  speed = 8;
  size = 25;
  damage = 20;

  // Infinity pierces everything, 1 dies on the first enemy, 0 never collides.
  maxHitCount = 1;
  // removeOnArrive = false;  // keep flying past the destination (boomerangs)
  // removeOnMaxHit = false;  // survive the last hit (chains that latch on)

  // declare the trail here, not in the base — it needs this class's `size`
  trailSystem = new TrailSystem({
    trailSize: this.size,
    trailColor: '#77F5',
  });

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);
    // enemy.addBuff(new SomeBuff(1000, this.owner, enemy));
  }

  draw() {
    push();
    noStroke();
    fill('#77f');
    circle(this.position.x, this.position.y, this.size);
    pop();
  }

  // Hooks for bending the default flight:
  // onBeforeMove()      — runs each frame before the step (rotation, speed ramps)
  // onAfterMove()       — after the step, before collision (size that tracks distance)
  // onArrive()          — reached the destination
  // getTrailPosition()  — emit the trail somewhere other than the centre
}

export class SpellName_Buff extends Buff {
  image = AssetManager.placeholder('buff_name');
  description = '';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 1;
  onCreate() {}
  onActivate() {}
  onDeactivate() {}
  onUpdate() {}
  draw() {}
}

/** For effects that are not projectiles: zones, wards, tethers, summons. */
export class SpellName_Object extends SpellObject {
  onAdded() {}
  onRemoved() {}
  update() {}
  draw() {}
  getDisplayBoundingBox(): any {}
}
