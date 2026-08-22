import type { ContentApi } from '@moba2d/core/content/ContentApi';

/**
 * Vera's Q — a short straight bolt.
 *
 * The reference pack's job is to be the second consumer of `ContentApi`, so it
 * uses the base class, an asset, a buff and a particle system rather than the
 * smallest thing that would compile. An API shaped by exactly one consumer is
 * shaped *around* that consumer.
 *
 * Damage is scaled to the ~100 health pool the whole game is tuned against
 * (`docs/VFX_STANDARD.md`): abilities 15-35, ultimates 40-60.
 */
export const VERA_Q_DAMAGE = 22;
export const VERA_Q_RANGE = 420;
export const VERA_Q_SPEED = 12;
export const VERA_Q_COOLDOWN_MS = 6_000;
export const VERA_Q_MANA = 30;

/**
 * `MissileSpellObject` flies `position` -> `destination`, hits enemies it
 * overlaps, dies on arrival. A subclass normally overrides only `onHit`,
 * `draw` and the tuning fields. It already reports a correct
 * `getDisplayBoundingBox()` sized from `size`, so nothing extra is needed
 * here to keep it visible while its centre is on screen.
 *
 * A named export, separate from the default `makeVeraQ`, so a test can drive
 * the missile's own collision behaviour directly rather than through a full
 * spell cast.
 */
/**
 * Memoized, like every pack factory must be — see
 * `packs/riot/spells/_EmptyExample.ts`'s header for why.
 */
function __buildVeraQObject(api: ContentApi) {
  return class VeraQObject extends api.MissileSpellObject {
    speed = VERA_Q_SPEED;
    size = 16;
    damage = VERA_Q_DAMAGE;
    // A single straight bolt: the tooltip promises "the first enemy hit", not
    // a pierce. Without this it inherits MissileSpellObject's default of
    // Infinity and damages every distinct enemy it overlaps along its whole
    // flight. `maxHitCount = 1` is the model for a single-target
    // missile; a piercing skillshot omits it on
    // purpose, which this spell is not.
    maxHitCount = 1;

    onHit(target: { takeDamage(amount: number, source: unknown): void }): void {
      target.takeDamage(this.damage, this.owner);
    }

    draw(): void {
      // Named for what it is in the effect, never for the quantity's generic
      // word: `fill`, `line`, `point` and `color` are p5 globals in this
      // project and a local of the same name silently shadows one.
      const bolt = this.position;
      push();
      noStroke();
      fill(120, 200, 255, 220);
      circle(bolt.x, bolt.y, this.size);
      fill(220, 245, 255, 160);
      circle(bolt.x, bolt.y, this.size * 0.5);
      pop();
    }
  };
}
const __cacheVeraQObject = new WeakMap<ContentApi, ReturnType<typeof __buildVeraQObject>>();
export function makeVeraQObject(api: ContentApi) {
  const cached = __cacheVeraQObject.get(api);
  if (cached) return cached;
  const built = __buildVeraQObject(api);
  __cacheVeraQObject.set(api, built);
  return built;
}

function __buildVeraQ(api: ContentApi) {
  const VeraQObject = makeVeraQObject(api);

  return class Vera_Q extends api.Spell {
    name = 'Tia Lam (Vera_Q)';
    image = api.asset('reference_vera_q');
    description =
      'Bắn một tia năng lượng thẳng, gây <span class="damage">22 sát thương</span> cho kẻ địch đầu tiên trúng.';
    // Milliseconds. `Spell.coolDown` is ms throughout — a long cooldown
    // reads as 8_000, not 8.
    coolDown = VERA_Q_COOLDOWN_MS;
    manaCost = VERA_Q_MANA;
    targetingMode = 'DIRECTION' as const;
    // Read by the base class's `previewRadius`/`declaredRange`, so the HUD
    // range ring has something to draw — the field name every aimed spell
    // in the bundled pack uses for exactly this.
    range = VERA_Q_RANGE;

    onSpellCast(): void {
      const shot = new VeraQObject(this.owner);
      // `aimPoint` + `VectorUtils.getVectorWithRange` is the established
      // DIRECTION idiom in this codebase: a cursor that
      // lands exactly on the caster degrades to a small random jitter
      // instead of a (0,0) direction, so the shot never destinations onto
      // its own origin. `aimPoint` reads the snapshotted cast context, so
      // it resolves the same way for a bot caster as for the player.
      shot.destination = api.utils.VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        VERA_Q_RANGE
      ).to;
      this.game.objectManager.addObject(shot);
    }
  };
}
const __cacheVeraQ = new WeakMap<ContentApi, ReturnType<typeof __buildVeraQ>>();
export default function makeVeraQ(api: ContentApi) {
  const cached = __cacheVeraQ.get(api);
  if (cached) return cached;
  const built = __buildVeraQ(api);
  __cacheVeraQ.set(api, built);
  return built;
}
