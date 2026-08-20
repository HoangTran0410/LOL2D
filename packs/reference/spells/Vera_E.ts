import type { ContentApi } from '@/content/ContentApi';

/**
 * Vera's E — a short dash. Exercises `api.buffs.Dash`.
 *
 * The hook is `onDashUpdate`, never `onUpdate`. `Dash` puts the movement
 * itself in `Dash.prototype.onUpdate`, so an instance assignment replaces the
 * frame instead of hooking it and the champion plays the spell's logic
 * standing perfectly still. Camille E, Ekko E and Jarvan Q all shipped that
 * way unnoticed, because each still dealt its damage.
 */
export const VERA_E_DISTANCE = 260;
export const VERA_E_SPEED = 18;
/**
 * Upper-bound buff duration, not the travel time — `Dash`'s constructor is
 * `(durationMs, sourceUnit, targetUnit)`, a safety net the buff deactivates
 * well before once `dashDestination` is reached. Camille_E and Ekko_E both
 * use 1000ms as that same generous ceiling.
 */
export const VERA_E_DASH_DURATION_MS = 1_000;
export const VERA_E_COOLDOWN_MS = 10_000;
export const VERA_E_MANA = 40;

export default function makeVeraE(api: ContentApi) {
  return class Vera_E extends api.Spell {
    name = 'Bước Chớp (Vera_E)';
    image = api.asset('reference_vera_e');
    description = 'Lướt nhanh một đoạn ngắn theo hướng chỉ định.';
    coolDown = VERA_E_COOLDOWN_MS;
    manaCost = VERA_E_MANA;
    targetingMode = 'DIRECTION' as const;
    range = VERA_E_DISTANCE;

    // Grounding blocks a self-dash; failing the cast before it charges mana
    // is the same guard Ekko_E's own checkCastCondition uses.
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
      // the same way Camille_E and Ekko_E do it.
      const dash = new api.buffs.Dash(VERA_E_DASH_DURATION_MS, this.owner, this.owner);
      dash.image = this.image;
      dash.dashDestination = landing;
      dash.dashSpeed = VERA_E_SPEED;
      this.owner.addBuff(dash);
    }
  };
}
