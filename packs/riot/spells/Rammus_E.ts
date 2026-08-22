import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Taunt = InstanceType<ContentApi['buffs']['Taunt']>;
type Rammus_E = InstanceType<ReturnType<typeof makeRammus_E>>;



export const RANGE = 200;

export const DAMAGE = 12;

export const DURATION = 1800;


/**
 * Frenzying Taunt, as the real thing.
 *
 * This used to be a disarm and a slow, on the reasoning that a "walk at me"
 * effect was a target-acquisition feature rather than a spell. It was both
 * backwards and unnecessary: backwards because disarming the victim is the
 * opposite of a taunt, which *forces* swings; unnecessary because the two
 * pieces already existed — `BasicAttackController` owns a standing attack
 * order, and `Charm` has dragged units toward their caster since day one.
 * `Taunt` is those pointed at Rammus, and it is a buff rather than anything
 * Rammus-specific so the next champion with one just applies it.
 *
 * It takes the whole ring, not the nearest body. That is the wiki version and
 * it is also the only version that makes sense on a tank: a single-target taunt
 * on a ten-second cooldown is a peel tool, while "everyone standing on me now
 * has to keep standing on me" is what an engage looks like.
 */
function __buildRammus_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const Taunt = api.buffs.Taunt;
  const AttackableUnit = api.units.AttackableUnit;
  class Rammus_E extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_rammus_e');
    name = 'Khiêu Khích Điên Cuồng (Rammus_E)';
    description =
      `Chọc giận <span class="buff">toàn bộ kẻ địch</span> trong <span>${RANGE}px</span>: mỗi mục tiêu chịu <span class="damage">${DAMAGE} sát thương</span>` +
      ` và <span class="buff">Khiêu Khích</span> trong <span class="time">${DURATION / 1000} giây</span> —` +
      ` mục tiêu <span class="debuff">buộc phải đuổi theo và đánh thường vào Rammus</span>,` +
      ` không thể dùng chiêu thức (vẫn đánh thường và di chuyển được, nhưng không tự chọn được nữa)`;
    coolDown = 10000;
    manaCost = 25;

    range = RANGE;

    checkCastCondition() {
      return this._findTargets().length > 0;
    }

    onSpellCast() {
      const targets = this._findTargets();
      if (targets.length === 0) return;

      for (const target of targets) {
        target.takeDamage(DAMAGE, this.owner);
        // After the damage, so a target the taunt would have killed is already
        // dead and `addBuff` refuses it rather than leaving a buff on a corpse.
        target.addBuff(new Taunt(DURATION, this.owner, target));
      }

      // One pulse on Rammus rather than one per victim: the shape of the ability
      // is the ring, and N overlapping rings on N bodies reads as N abilities.
      const ring = new AoePulse(this.owner);
      ring.position = this.owner.position.copy();
      ring.radius = effectiveRange(this.range, this.owner);
      ring.lifeTime = 450;
      ring.color = [255, 150, 90];
      ring.rings = 3;
      this.game.objectManager.addObject(ring);
    }

    /** Everyone the shout reaches. The reach grows with his body — see `Reach`. */
    _findTargets(): AttackableUnit[] {
      return this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Rammus_E;
}
const __cacheRammus_E = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_E>>();
export default function makeRammus_E(api: ContentApi) {
  const cached = __cacheRammus_E.get(api);
  if (cached) return cached;
  const built = __buildRammus_E(api);
  __cacheRammus_E.set(api, built);
  return built;
}