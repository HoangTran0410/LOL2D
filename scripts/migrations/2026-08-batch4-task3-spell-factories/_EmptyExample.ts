/**
 * Templates for new spells. Copy the one that matches the shape you need.
 *
 * A pack spell is a factory: it receives `api: ContentApi` and returns the
 * class, rather than importing `Spell`/`SpellObject`/a buff directly — see
 * `docs/ADDING_SPELLS.md` and `packs/reference/spells/Vera_Q.ts`. Everything
 * this file used to import from `@/game/gameObject/...` now comes off `api`
 * instead, and an icon comes from `api.asset(key)` rather than
 * `AssetManager.get`/`.placeholder` (a pack may not import `AssetManager` at
 * all — `tests/content/packBoundary.test.ts` enforces it).
 *
 * After creating the file, register it in three places or it will not show up:
 *   1. `packs/riot/spells/index.ts` — export it
 *   2. `preset.ts` SpellGroups      — add it to the champion's kit
 *   3. `AssetManager` AssetPaths    — add `spell_<name>` pointing at the icon
 */
import type { ContentApi } from '@/content/ContentApi';

export default function makeSpellName(api: ContentApi) {
  return class SpellName extends api.Spell {
    image = api.asset('spell_name');
    name = '';
    description = 'Spell description';
    coolDown = 1000;

    onSpellCast() {}
    onUpdate() {}
  };
}

/**
 * A skillshot. `MissileSpellObject` already handles travelling to the
 * destination, hitting each enemy once, the trail, and the bounding box — so a
 * normal projectile is just tuning fields plus `onHit` and `draw`.
 */
export function makeSpellNameSkillshot(api: ContentApi) {
  const SpellName_Missile = makeSpellNameMissile(api);

  return class SpellName_Skillshot extends api.Spell {
    image = api.asset('spell_name');
    name = '';
    description = '';
    coolDown = 5000;
    range = 400;

    onSpellCast() {
      const { to } = api.utils.VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const obj = new SpellName_Missile(this.owner);
      obj.destination = to;
      this.game.objectManager.addObject(obj);
    }
  };
}

export function makeSpellNameMissile(api: ContentApi) {
  return class SpellName_Missile extends api.MissileSpellObject {
    speed = 8;
    size = 25;
    damage = 20;

    // Infinity pierces everything, 1 dies on the first enemy, 0 never collides.
    maxHitCount = 1;
    // removeOnArrive = false;  // keep flying past the destination (boomerangs)
    // removeOnMaxHit = false;  // survive the last hit (chains that latch on)

    // declare the trail here, not in the base — it needs this class's `size`
    trailSystem = new api.helpers.TrailSystem({
      trailSize: this.size,
      trailColor: '#77F5',
    });

    onHit(enemy: any) {
      enemy.takeDamage(this.damage, this.owner);
      // enemy.addBuff(new api.buffs.SomeBuff(1000, this.owner, enemy));
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
  };
}

export function makeSpellNameBuff(api: ContentApi) {
  return class SpellName_Buff extends api.buffs.Buff {
    image = api.asset('buff_name');
    description = '';
    buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
    maxStacks = 1;
    onCreate() {}
    onActivate() {}
    onDeactivate() {}
    onUpdate() {}
    draw() {}
  };
}

/** For effects that are not projectiles: zones, wards, tethers, summons. */
export function makeSpellNameObject(api: ContentApi) {
  return class SpellName_Object extends api.SpellObject {
    onAdded() {}
    onRemoved() {}
    update() {}
    draw() {}
    getDisplayBoundingBox(): any {}
  };
}
