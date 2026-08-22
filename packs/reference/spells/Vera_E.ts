import type { ContentApi } from '@moba2d/core/content/ContentApi';

/**
 * Vera's E — a short dash. Exercises `api.buffs.Dash`.
 *
 * The hook is `onDashUpdate`, never `onUpdate`. `Dash` puts the movement
 * itself in `Dash.prototype.onUpdate`, so an instance assignment replaces the
 * frame instead of hooking it and the champion plays the spell's logic
 * standing perfectly still. Three dashes in the bundled pack shipped that
 * way unnoticed, because each still dealt its damage.
 */
export const VERA_E_DISTANCE = 260;
export const VERA_E_SPEED = 18;
/**
 * Upper-bound buff duration, not the travel time — `Dash`'s constructor is
 * `(durationMs, sourceUnit, targetUnit)`, a safety net the buff deactivates
 * well before once `dashDestination` is reached. The bundled pack's dashes
 * use 1000ms as that same generous ceiling.
 */
export const VERA_E_DASH_DURATION_MS = 1_000;
export const VERA_E_COOLDOWN_MS = 10_000;
export const VERA_E_MANA = 40;

/**
 * Memoized, like every pack factory must be — see
 * `packs/riot/spells/_EmptyExample.ts`'s header for why.
 */
function __buildVeraE(api: ContentApi) {
  return class Vera_E extends api.Spell {
    name = 'Bước Chớp (Vera_E)';
    image = api.asset('reference_vera_e');
    description = 'Lướt nhanh một đoạn ngắn theo hướng chỉ định.';
    coolDown = VERA_E_COOLDOWN_MS;
    manaCost = VERA_E_MANA;
    targetingMode = 'DIRECTION' as const;
    range = VERA_E_DISTANCE;

    // Grounding blocks a self-dash; failing the cast before it charges mana
    // is the same guard every dash's own checkCastCondition uses.
    checkCastCondition(): boolean {
      return api.buffs.Dash.CanDash(this.owner);
    }

    onSpellCast(): void {
      const landing = api.utils.VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        VERA_E_DISTANCE
      ).to;

      // `Dash`'s constructor takes (durationMs, sourceUnit, targetUnit) — not
      // the destination or speed. Those are set on the instance afterward,
      // the same way every dash in the bundled pack does it.
      const dash = new api.buffs.Dash(VERA_E_DASH_DURATION_MS, this.owner, this.owner);
      dash.image = this.image;
      dash.dashDestination = landing;
      dash.dashSpeed = VERA_E_SPEED;
      this.owner.addBuff(dash);
    }
  };
}
const __cacheVeraE = new WeakMap<ContentApi, ReturnType<typeof __buildVeraE>>();
export default function makeVeraE(api: ContentApi) {
  const cached = __cacheVeraE.get(api);
  if (cached) return cached;
  const built = __buildVeraE(api);
  __cacheVeraE.set(api, built);
  return built;
}
