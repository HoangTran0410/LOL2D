import type { ContentApi } from '@moba2d/core/content/ContentApi';

/**
 * Vera's R — a ring that lands where it was aimed. Exercises `api.AoePulse`.
 *
 * `AoePulse` is purely cosmetic — it carries no `damage` field and deals none
 * itself. The spell queries the ring and bills each enemy directly, then
 * spawns the pulse as the visual, the same split every centred ultimate uses.
 *
 * 45 damage: ultimates are 40-60 against the ~100 health pool the whole game
 * is tuned to (`docs/VFX_STANDARD.md`). Each unit inside the ring is hit
 * exactly once, because the query runs a single time at cast — there is no
 * missile sweeping through that could double-hit anybody.
 */
export const VERA_R_DAMAGE = 45;
export const VERA_R_RADIUS = 200;
export const VERA_R_RANGE = 500;
export const VERA_R_COOLDOWN_MS = 60_000;
export const VERA_R_MANA = 100;

/**
 * Memoized, like every pack factory must be — see
 * `packs/riot/spells/_EmptyExample.ts`'s header for why.
 */
function __buildVeraR(api: ContentApi) {
  return class Vera_R extends api.Spell {
    name = 'Vòng Tận (Vera_R)';
    image = api.asset('reference_vera_r');
    description =
      'Gọi một vòng sáng tại vị trí chỉ định, gây <span class="damage">45 sát thương</span> cho mọi kẻ địch bên trong.';
    coolDown = VERA_R_COOLDOWN_MS;
    manaCost = VERA_R_MANA;
    targetingMode = 'POINT' as const;
    range = VERA_R_RANGE;

    onSpellCast(): void {
      // `getVectorWithMaxRange` clamps the landing point to the spell's own
      // reach, the same idiom every POINT-targeted orb uses.
      const point = api.utils.VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        VERA_R_RANGE
      ).to;

      const enemies = this.game.objectManager.queryObjects({
        area: new api.utils.Quadtree.Circle({ x: point.x, y: point.y, r: VERA_R_RADIUS }),
        filters: [api.combat.PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => {
        enemy.takeDamage(VERA_R_DAMAGE, this.owner);
      });

      // `AoePulse` already implements a correct `getDisplayBoundingBox()`
      // sized from `radius`, so nothing extra is needed here to keep the
      // ring visible while its centre is on screen.
      const ring = new api.AoePulse(this.owner);
      ring.position = point.copy();
      ring.radius = VERA_R_RADIUS;
      ring.lifeTime = 500;
      ring.color = [225, 60, 60];
      this.game.objectManager.addObject(ring);
    }

    drawPreview(): void {
      super.drawPreview(VERA_R_RANGE);
    }
  };
}
const __cacheVeraR = new WeakMap<ContentApi, ReturnType<typeof __buildVeraR>>();
export default function makeVeraR(api: ContentApi) {
  const cached = __cacheVeraR.get(api);
  if (cached) return cached;
  const built = __buildVeraR(api);
  __cacheVeraR.set(api, built);
  return built;
}
