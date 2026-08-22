/**
 * Templates for new spells. Copy the one that matches the shape you need.
 *
 * A pack spell is a factory: it receives `api: ContentApi` and returns the
 * class, rather than importing `Spell`/`SpellObject`/a buff directly — see
 * `docs/ADDING_SPELLS.md` and `packs/reference/spells/Vera_Q.ts`. Everything
 * this file used to import from `@/game/gameObject/...` now comes off `api`
 * instead, and an icon comes from `api.asset(key)` rather than
 * `AssetManager.get`/`.placeholder` (a pack may not import `AssetManager` at
 * all — the `pack-core-boundary` seam enforces it).
 *
 * **Every factory here is memoized, and a real spell's must be too.** A bare
 * `class X extends api.Spell {}` returned straight from a function is a new
 * class object on every call — two independent resolutions of the same spell
 * (the real game's `spellRegistry.ts` loading it once, an e2e script or a
 * test building its own copy to compare against) then get two different,
 * `instanceof`-incompatible classes with the same name, and nothing about the
 * failure points at why. `buildContentApi()` is a cached, process-wide
 * singleton for exactly this reason ("one core in the process"); a memoized
 * factory extends that same guarantee to the classes it builds. The shape is
 * always the same: a plain, unmemoized `__build<Name>` whose return type
 * TypeScript can infer from its own body (nothing about it references the
 * cache, so there is no self-reference to trip on), a `WeakMap<ContentApi,
 * ReturnType<typeof __build<Name>>>` keyed by the api instance, and the
 * exported `make<Name>` as a thin cache-check wrapper around it. Copy it
 * exactly — do not "simplify" it back to a bare `return class ...`.
 *
 * After creating the file, register it in three places or it will not show up:
 *   1. `packs/riot/spells/index.ts` — export it
 *   2. `preset.ts` SpellGroups      — add it to the champion's kit
 *   3. `AssetManager` AssetPaths    — add `spell_<name>` pointing at the icon
 */
import type { ContentApi } from '@moba2d/core/content/ContentApi';

function __buildSpellName(api: ContentApi) {
  return class SpellName extends api.Spell {
    image = api.asset('spell_name');
    name = '';
    description = 'Spell description';
    coolDown = 1000;

    onSpellCast() {}
    onUpdate() {}
  };
}
const __cacheSpellName = new WeakMap<ContentApi, ReturnType<typeof __buildSpellName>>();
export default function makeSpellName(api: ContentApi) {
  const cached = __cacheSpellName.get(api);
  if (cached) return cached;
  const built = __buildSpellName(api);
  __cacheSpellName.set(api, built);
  return built;
}

/**
 * A skillshot. `MissileSpellObject` already handles travelling to the
 * destination, hitting each enemy once, the trail, and the bounding box — so a
 * normal projectile is just tuning fields plus `onHit` and `draw`.
 */
function __buildSpellNameSkillshot(api: ContentApi) {
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
const __cacheSpellNameSkillshot = new WeakMap<
  ContentApi,
  ReturnType<typeof __buildSpellNameSkillshot>
>();
export function makeSpellNameSkillshot(api: ContentApi) {
  const cached = __cacheSpellNameSkillshot.get(api);
  if (cached) return cached;
  const built = __buildSpellNameSkillshot(api);
  __cacheSpellNameSkillshot.set(api, built);
  return built;
}

function __buildSpellNameMissile(api: ContentApi) {
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
const __cacheSpellNameMissile = new WeakMap<ContentApi, ReturnType<typeof __buildSpellNameMissile>>();
export function makeSpellNameMissile(api: ContentApi) {
  const cached = __cacheSpellNameMissile.get(api);
  if (cached) return cached;
  const built = __buildSpellNameMissile(api);
  __cacheSpellNameMissile.set(api, built);
  return built;
}

function __buildSpellNameBuff(api: ContentApi) {
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
const __cacheSpellNameBuff = new WeakMap<ContentApi, ReturnType<typeof __buildSpellNameBuff>>();
export function makeSpellNameBuff(api: ContentApi) {
  const cached = __cacheSpellNameBuff.get(api);
  if (cached) return cached;
  const built = __buildSpellNameBuff(api);
  __cacheSpellNameBuff.set(api, built);
  return built;
}

/** For effects that are not projectiles: zones, wards, tethers, summons. */
function __buildSpellNameObject(api: ContentApi) {
  return class SpellName_Object extends api.SpellObject {
    onAdded() {}
    onRemoved() {}
    update() {}
    draw() {}
    getDisplayBoundingBox(): any {}
  };
}
const __cacheSpellNameObject = new WeakMap<ContentApi, ReturnType<typeof __buildSpellNameObject>>();
export function makeSpellNameObject(api: ContentApi) {
  const cached = __cacheSpellNameObject.get(api);
  if (cached) return cached;
  const built = __buildSpellNameObject(api);
  __cacheSpellNameObject.set(api, built);
  return built;
}
