import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Flash = InstanceType<ReturnType<typeof makeFlash>>;
type Flash_Object = InstanceType<ReturnType<typeof makeFlash_Object>>;



function __buildFlash(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Flash_Object = makeFlash_Object(api);
  class Flash extends Spell {
    targetingMode = 'POINT' as const;
    name = 'Tốc Biến (Flash)';
    image = api.asset('spell_flash');
    description =
      '<span class="buff">Lập tức dich chuyển</span> tới vị trí con trỏ, tối đa 180px khoảng cách';
    coolDown = 5000;
    manaCost = 100;

    /** Grounded blocks blinks. Checked here so the cast fails before it costs mana. */
    checkCastCondition() {
      return !this.owner.grounded;
    }

    onSpellCast() {
      let maxDistance = 180;

      let oldPos = this.owner.position.copy();
      let { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        maxDistance
      );
      if (!this.blinkOwnerTo(to.x, to.y)) return;

      // add smoke effect
      let newPosEffect = new Flash_Object(this.owner);
      this.game.objectManager.addObject(newPosEffect);

      let oldPosEffect = new Flash_Object(this.owner, oldPos);
      oldPosEffect.position = oldPos;
      this.game.objectManager.addObject(oldPosEffect);
    }
  }
  return Flash;
}
const __cacheFlash = new WeakMap<ContentApi, ReturnType<typeof __buildFlash>>();
export default function makeFlash(api: ContentApi) {
  const cached = __cacheFlash.get(api);
  if (cached) return cached;
  const built = __buildFlash(api);
  __cacheFlash.set(api, built);
  return built;
}


function __buildFlash_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Flash_Object extends SpellObject {
    particleSystem = PredefinedParticleSystems.smoke([255, 255, 100]);

    constructor(owner: any, position?: p5.Vector) {
      super(owner);
      if (position) this.position = position;
    }

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);

      let pos = this.position;
      let size = this.owner.stats.size.value / 2;
      for (let i = 0; i < 10; i++) {
        this.particleSystem.addParticle({
          x: pos.x + random(-size, size),
          y: pos.y + random(-size, size),
          size: random(10, 20),
          opacity: random(100, 200),
        } as any);
      }

      this.toRemove = true;
    }
  }
  return Flash_Object;
}
const __cacheFlash_Object = new WeakMap<ContentApi, ReturnType<typeof __buildFlash_Object>>();
export function makeFlash_Object(api: ContentApi) {
  const cached = __cacheFlash_Object.get(api);
  if (cached) return cached;
  const built = __buildFlash_Object(api);
  __cacheFlash_Object.set(api, built);
  return built;
}